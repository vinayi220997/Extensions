// VidSnag service worker: media detection, manifest probing, download queue, history.
import {
  classify, normalizeMediaUrl, hashId, hostOf, buildFilename, sanitizeFolder, sanitizeFilename,
  resolutionLabel, formatDuration, extFromUrl
} from './lib/util.js';
import { getSettings, validate as validateSettings, pickVariant, pickAudioVariant, getSiteRules, normalizeSiteRules } from './lib/settings.js';
import { getAddons, urlMatches, SCRIPT_PRELUDE } from './lib/addons.js';
import { parseM3U8, isPlaylist, hlsVariantLabel } from './lib/hls.js';
import { parseMPD, dashRepLabel } from './lib/dash.js';

const TAB_NONE = -1;
const MAX_ITEMS_PER_TAB = 60;
const MAX_HISTORY = 500;
const MAX_PARALLEL_STREAM_JOBS = 3;
const OFFSCREEN_URL = 'offscreen/offscreen.html';
const PANEL_URL = 'popup/popup.html';
const BADGE_COLORS = { teal: '#0f766e', blue: '#2563eb', violet: '#7c3aed', rose: '#e11d48', orange: '#c2410c', green: '#15803d', slate: '#334155' };
const WINDOW_DIMS = { S: [380, 520], M: [440, 640], L: [560, 720] };

let settingsCache = null;
async function settings() {
  if (!settingsCache) settingsCache = await getSettings();
  return settingsCache;
}
let siteRulesCache = null;
async function siteRules() {
  if (!siteRulesCache) siteRulesCache = await getSiteRules();
  return siteRulesCache;
}
let addonCache = null;
async function addons() {
  if (!addonCache) addonCache = await getAddons();
  return addonCache;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    settingsCache = validateSettings(changes.settings.newValue || {});
    setupContextMenus();
    refreshAllBadges();
    applyPanelBehavior();
  }
  if (area === 'local' && changes.siteRules) siteRulesCache = normalizeSiteRules(changes.siteRules.newValue);
  if (area === 'local' && changes.addons) {
    addonCache = Array.isArray(changes.addons.newValue) ? changes.addons.newValue : [];
    syncUserScripts();
  }
});

// ---------------------------------------------------------------------------
// Serialized storage access. Many webRequest events arrive at once, so every
// read-modify-write goes through one promise chain to avoid lost updates.
// ---------------------------------------------------------------------------
let chain = Promise.resolve();
function serialize(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch((e) => console.warn('[VidSnag]', e));
  return p;
}
const tabKey = (tabId) => `tab:${tabId}`;

async function readTab(tabId) {
  const key = tabKey(tabId);
  const res = await chrome.storage.session.get(key);
  return res[key] || { items: {}, childUrls: [], pageUrl: '', pageTitle: '' };
}
async function writeTab(tabId, state) {
  await chrome.storage.session.set({ [tabKey(tabId)]: state });
}
function mutateTab(tabId, fn) {
  return serialize(async () => {
    const state = await readTab(tabId);
    const result = await fn(state);
    await writeTab(tabId, state);
    return result;
  });
}
async function readJobs() {
  const { jobs } = await chrome.storage.session.get('jobs');
  const all = jobs || {};
  for (const j of Object.values(all)) if (!j.engine) j.engine = j.kind === 'file' ? 'browser' : 'offscreen'; // v1 jobs
  return all;
}
function mutateJobs(fn) {
  return serialize(async () => {
    const jobs = await readJobs();
    const result = await fn(jobs);
    await chrome.storage.session.set({ jobs });
    return result;
  });
}
function mutateHistory(fn) {
  return serialize(async () => {
    const { history = [] } = await chrome.storage.local.get('history');
    const result = await fn(history);
    await chrome.storage.local.set({ history: history.slice(0, MAX_HISTORY) });
    return result;
  });
}

// ---------------------------------------------------------------------------
// Network detection
// ---------------------------------------------------------------------------
const refererByRequest = new Map(); // requestId → Referer header seen on the request

chrome.webRequest.onSendHeaders.addListener((d) => {
  if (d.tabId < 0) return;
  const ref = d.requestHeaders?.find((h) => h.name.toLowerCase() === 'referer');
  if (ref) {
    refererByRequest.set(d.requestId, ref.value);
    if (refererByRequest.size > 2000) refererByRequest.delete(refererByRequest.keys().next().value);
  }
}, { urls: ['http://*/*', 'https://*/*'], types: ['media', 'xmlhttprequest', 'other', 'object'] }, ['requestHeaders', 'extraHeaders']);

chrome.webRequest.onResponseStarted.addListener((d) => {
  const referer = refererByRequest.get(d.requestId);
  refererByRequest.delete(d.requestId);
  if (d.tabId < 0 || d.method !== 'GET') return;
  if (d.statusCode < 200 || d.statusCode >= 300) return;
  const headers = Object.fromEntries((d.responseHeaders || []).map((h) => [h.name.toLowerCase(), h.value]));
  onNetworkResponse(d, headers, referer).catch((e) => console.warn('[VidSnag] detect', e));
}, { urls: ['http://*/*', 'https://*/*'], types: ['media', 'xmlhttprequest', 'other', 'object'] }, ['responseHeaders']);

function totalSize(headers) {
  const range = headers['content-range'];
  if (range) {
    const m = /\/(\d+)\s*$/.exec(range);
    if (m) return Number(m[1]);
  }
  const len = Number(headers['content-length']);
  return Number.isFinite(len) && len > 0 ? len : null;
}

// Sources that only ever serve fragmented chunks the browser stitches together itself.
const IGNORED_HOSTS = [/(^|\.)googlevideo\.com$/, /(^|\.)doubleclick\.net$/, /(^|\.)googlesyndication\.com$/];

async function onNetworkResponse(d, headers, referer) {
  const url = d.url;
  const host = hostOf(url);
  if (IGNORED_HOSTS.some((re) => re.test(host))) return;
  let c = classify(url, headers['content-type']);
  if (!c) c = await addonNetworkMatch(url, headers['content-type']);
  if (!c || c.kind === 'segment') return;
  const s = await settings();
  const size = totalSize(headers);
  if (c.kind === 'file' && size != null && size < s.minFileSizeKB * 1024) {
    // Remember small files so the DOM scanner doesn't re-add them (ads, looping GIF-videos).
    const norm = normalizeMediaUrl(url);
    const id = hashId(norm);
    await mutateTab(d.tabId, (st) => {
      st.small = [...new Set([...(st.small || []), norm])].slice(-200);
      const it = st.items[id];
      if (it && it.sources.every((x) => x === 'dom')) delete st.items[id];
    });
    updateBadge(d.tabId);
    return;
  }

  await addMedia(d.tabId, {
    url,
    kind: c.kind,
    ext: c.ext,
    audioOnly: !!c.audio,
    mime: (headers['content-type'] || '').split(';')[0],
    size,
    frameId: d.frameId,
    referer: referer || null,
    source: 'network'
  });
}

// Rule addons can declare extra URL patterns (e.g. API endpoints that serve video).
async function addonNetworkMatch(url) {
  for (const a of await addons()) {
    if (!a.enabled || a.kind !== 'rules') continue;
    for (const re of a.detect?.networkUrlPatterns || []) {
      try {
        if (new RegExp(re).test(url)) {
          const ext = extFromUrl(url);
          if (ext === 'm3u8') return { kind: 'hls', ext };
          if (ext === 'mpd') return { kind: 'dash', ext };
          return { kind: 'file', ext: ext || 'mp4', audio: false };
        }
      } catch { /* invalid regex: ignored */ }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Media registry
// ---------------------------------------------------------------------------
async function addMedia(tabId, info) {
  const normUrl = normalizeMediaUrl(info.url);
  const id = hashId(normUrl);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  const created = await mutateTab(tabId, (state) => {
    if (!state.pageUrl) state.pageUrl = tab.url;
    state.pageTitle = tab.title || state.pageTitle;
    // A variant playlist of a master we already parsed: not a separate media.
    if (state.childUrls.includes(normUrl)) return false;
    if (info.source === 'dom' && (state.small || []).includes(normUrl)) return false;
    const existing = state.items[id];
    if (existing) {
      // Merge DOM metadata (resolution, poster) with network metadata (size, mime).
      for (const k of ['size', 'mime', 'width', 'height', 'duration', 'poster', 'referer', 'frameId']) {
        if (info[k] && !existing[k]) existing[k] = info[k];
      }
      if (!existing.sources.includes(info.source)) existing.sources.push(info.source);
      if ((existing.kind === 'file' || existing.kind === 'blob') && existing.variants[0]) Object.assign(existing.variants[0], variantForFile(existing));
      return false;
    }
    if (Object.keys(state.items).length >= MAX_ITEMS_PER_TAB) return false;
    const item = {
      id,
      url: info.url,
      kind: info.kind,
      ext: info.ext || extFromUrl(info.url),
      mime: info.mime || '',
      size: info.size || null,
      audioOnly: !!info.audioOnly,
      width: info.width || 0,
      height: info.height || 0,
      duration: info.duration || 0,
      poster: info.poster || '',
      referer: info.referer || tab.url,
      pageUrl: tab.url,
      title: info.title || tab.title || hostOf(tab.url),
      customTitle: '',
      titleFixed: !!info.title,
      selectorText: info.selectorText || '',
      frameId: info.frameId ?? 0,
      sources: [info.source],
      detectedAt: Date.now(),
      status: info.kind === 'file' || info.kind === 'blob' ? 'ready' : 'probing',
      variants: [],
      live: false,
      encrypted: false,
      drm: false,
      error: ''
    };
    if (item.kind === 'file' || item.kind === 'blob') item.variants = [variantForFile(item)];
    state.items[id] = item;
    return true;
  });
  if (created) {
    updateBadge(tabId);
    if (info.kind === 'hls' || info.kind === 'dash') probeManifest(tabId, id).catch((e) => console.warn('[VidSnag] probe', e));
  }
}

function variantForFile(item) {
  return {
    id: 'file',
    kind: item.kind === 'blob' ? 'blob' : 'file',
    url: item.url,
    ext: item.ext || 'mp4',
    width: item.width || 0,
    height: item.height || 0,
    bandwidth: 0,
    codecs: '',
    audioOnly: item.audioOnly,
    size: item.size || null,
    label: [resolutionLabel(item.height, item.width), (item.ext || '').toUpperCase()].filter(Boolean).join(' · ') || 'Original'
  };
}

async function probeManifest(tabId, id) {
  const state = await readTab(tabId);
  const item = state.items[id];
  if (!item) return;
  let patch;
  try {
    const text = await fetchText(item.url, item.referer);
    patch = item.kind === 'hls' ? await describeHls(text, item) : describeDash(text, item);
  } catch (e) {
    patch = { status: 'error', error: String(e.message || e) };
  }
  await mutateTab(tabId, (st) => {
    const it = st.items[id];
    if (!it) return;
    Object.assign(it, patch);
    if (patch.childUrls?.length) {
      st.childUrls = [...new Set([...st.childUrls, ...patch.childUrls])].slice(-500);
      // If the player fetched a variant playlist before we parsed the master, drop it.
      for (const [otherId, other] of Object.entries(st.items)) {
        if (otherId !== id && patch.childUrls.includes(normalizeMediaUrl(other.url))) delete st.items[otherId];
      }
      delete it.childUrls;
    }
  });
  updateBadge(tabId);
}

async function describeHls(text, item) {
  if (!isPlaylist(text)) throw new Error('Not a valid HLS playlist');
  const pl = parseM3U8(text, item.url);
  if (pl.type === 'master') {
    const variants = pl.variants.map((v, i) => ({
      id: `v${i}`, kind: 'hls', url: v.url, width: v.width, height: v.height,
      bandwidth: v.bandwidth, codecs: v.codecs, ext: 'mp4', audioOnly: false,
      audioGroup: v.audioGroup, label: hlsVariantLabel(v)
    }));
    const seenAudio = new Set();
    pl.audios.forEach((a, i) => {
      if (seenAudio.has(a.url)) return;
      seenAudio.add(a.url);
      variants.push({
        id: `a${i}`, kind: 'hls', url: a.url, width: 0, height: 0, bandwidth: 0, codecs: '',
        ext: 'm4a', audioOnly: true, groupId: a.groupId, isDefault: a.isDefault, label: `Audio only · ${a.name}`
      });
    });
    // Variants whose sound lives in a separate audio rendition (merged at download time).
    for (const v of variants) {
      if (!v.audioOnly && v.audioGroup && pl.audios.some((a) => a.groupId === v.audioGroup)) v.separateAudio = true;
    }
    // Peek at the best variant for duration / live / encryption info.
    let meta = {};
    const best = [...variants].filter((v) => !v.audioOnly).sort((a, b) => b.bandwidth - a.bandwidth)[0];
    if (best) {
      try {
        const media = parseM3U8(await fetchText(best.url, item.referer), best.url);
        meta = { duration: media.totalDuration, live: media.live, encrypted: media.encrypted, drm: media.drm };
      } catch { /* informational only */ }
    }
    const top = best || variants[0];
    return {
      status: meta.drm ? 'drm' : 'ready',
      variants,
      childUrls: pl.variants.map((v) => normalizeMediaUrl(v.url)).concat(pl.audios.map((a) => normalizeMediaUrl(a.url))),
      width: top?.width || item.width,
      height: top?.height || item.height,
      duration: meta.duration || item.duration,
      live: !!meta.live,
      encrypted: !!meta.encrypted,
      drm: !!meta.drm
    };
  }
  return {
    status: pl.drm ? 'drm' : 'ready',
    variants: [{
      id: 'v0', kind: 'hls', url: item.url, width: item.width, height: item.height, bandwidth: 0,
      codecs: '', ext: 'mp4', audioOnly: false,
      label: [resolutionLabel(item.height, item.width), pl.live ? 'Live' : formatDuration(pl.totalDuration)].filter(Boolean).join(' · ') || 'Stream'
    }],
    duration: pl.totalDuration,
    live: pl.live,
    encrypted: pl.encrypted,
    drm: pl.drm
  };
}

function describeDash(text, item) {
  const mpd = parseMPD(text, item.url);
  const variants = mpd.representations
    .sort((a, b) => Number(a.audioOnly) - Number(b.audioOnly) || b.height - a.height || b.bandwidth - a.bandwidth)
    .map((r) => ({
      id: `r_${r.id}`, kind: 'dash', url: item.url, repId: r.id, width: r.width, height: r.height,
      bandwidth: r.bandwidth, codecs: r.codecs, ext: r.ext, audioOnly: r.audioOnly,
      separateAudio: !r.audioOnly && mpd.representations.some((x) => x.audioOnly),
      label: dashRepLabel(r)
    }));
  const top = variants.find((v) => !v.audioOnly);
  return {
    status: mpd.drm ? 'drm' : (mpd.live || mpd.multiPeriod) ? 'error' : 'ready',
    error: mpd.live ? 'Live DASH streams are not supported' : mpd.multiPeriod ? 'Multi-period DASH (e.g. with ad breaks) is not supported' : '',
    variants,
    width: top?.width || 0,
    height: top?.height || 0,
    duration: mpd.duration,
    live: mpd.live,
    drm: mpd.drm
  };
}

// ---------------------------------------------------------------------------
// Header spoofing (Referer/Origin) for requests the extension makes itself.
// Session DNR rules only match requests that don't belong to a tab (tabId -1).
// ---------------------------------------------------------------------------
async function addHeaderRule(url, referer) {
  if (!referer) return null;
  const host = hostOf(url);
  if (!host) return null;
  let origin;
  try { origin = new URL(referer).origin; } catch { return null; }
  const id = 1 + Math.floor(Math.random() * 2_000_000_000);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [{
        id,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'referer', operation: 'set', value: referer },
            { header: 'origin', operation: 'set', value: origin }
          ]
        },
        condition: {
          requestDomains: [new URL(url).hostname],
          tabIds: [TAB_NONE],
          resourceTypes: ['xmlhttprequest', 'media', 'other']
        }
      }]
    });
    return id;
  } catch (e) {
    console.warn('[VidSnag] header rule', e);
    return null;
  }
}
async function removeHeaderRule(id) {
  if (!id) return;
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }).catch(() => {});
}

async function fetchText(url, referer) {
  const ruleId = await addHeaderRule(url, referer);
  try {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    await removeHeaderRule(ruleId);
  }
}

// ---------------------------------------------------------------------------
// Tab lifecycle + badge
// ---------------------------------------------------------------------------
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0 || d.tabId < 0) return;
  serialize(() => writeTab(d.tabId, { items: {}, childUrls: [], pageUrl: d.url, pageTitle: '' }))
    .then(() => updateBadge(d.tabId));
});
chrome.tabs.onRemoved.addListener((tabId) => {
  serialize(() => chrome.storage.session.remove(tabKey(tabId)));
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.title) {
    mutateTab(tabId, (st) => {
      st.pageTitle = change.title;
      // Pages often set their final title after the video loads: keep titles of media found on
      // this page in sync (not media from an earlier page of a single-page app).
      for (const it of Object.values(st.items)) if (sameDoc(it.pageUrl, tab.url) && !it.titleFixed) it.title = change.title;
    });
  }
});
// Single-page apps change the URL without reloading: keep the list, rescan for new players.
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
  if (d.frameId !== 0 || d.tabId < 0) return;
  mutateTab(d.tabId, (st) => { st.pageUrl = d.url; }).then(() => {
    setTimeout(() => chrome.tabs.sendMessage(d.tabId, { type: 'vidsnag-scan' }).catch(() => {}), 800);
  });
});
function sameDoc(a, b) {
  try { const x = new URL(a), y = new URL(b); x.hash = ''; y.hash = ''; return x.href === y.href; } catch { return a === b; }
}

async function updateBadge(tabId) {
  const s = await settings();
  const state = await readTab(tabId);
  const count = Object.values(state.items).filter((i) => i.status !== 'error').length;
  const text = s.showBadge && count ? String(count) : '';
  await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ tabId, color: s.accent === 'custom' ? s.accentCustom : (BADGE_COLORS[s.accent] || BADGE_COLORS.teal) }).catch(() => {});
  await chrome.action.setTitle({ tabId, title: count ? `VidSnag – ${count} media found` : 'VidSnag' }).catch(() => {});
}
async function refreshAllBadges() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) if (t.id >= 0) updateBadge(t.id);
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
// opts: { variantId, output: 'auto'|'video'|'audio'|'ts', filename, saveAs }
async function startDownload(tabId, mediaId, opts = {}) {
  if (typeof opts === 'string' || opts === null) opts = { variantId: opts };
  const state = await readTab(tabId);
  const item = state.items[mediaId];
  if (!item) throw new Error('This media is no longer available. Reload the page and try again.');
  if (item.drm || item.status === 'drm') throw new Error('This video is DRM-protected. VidSnag does not download protected content.');
  if (item.status === 'probing') throw new Error('Still analyzing this stream — try again in a moment.');
  if (item.status === 'error') throw new Error(item.error || 'This stream could not be read.');
  const source = await buildSource(item, state, opts);
  return startFromSource(source, tabId, { filename: opts.filename, saveAs: opts.saveAs });
}

// Turn a detected media item + user choices into a download "source" (also stored in history/library).
async function buildSource(item, state, opts = {}) {
  const s = await settings();
  const output = ['auto', 'video', 'audio', 'ts'].includes(opts.output) ? opts.output : 'auto';
  let variant = item.variants.find((v) => v.id === opts.variantId) || null;
  let srcOutput = output;
  let audioTrack = null;

  if (output === 'audio') {
    const audioVariant = variant?.audioOnly ? variant : pickAudioVariant(item.variants);
    if (audioVariant) variant = audioVariant;
    else if (item.kind === 'hls') variant = variant || pickVariant(item.variants, s); // transmux audio out of the muxed stream
    else if (item.kind === 'file') {
      variant = item.variants[0];
      if (item.audioOnly) srcOutput = 'auto';
      else if (!['mp4', 'm4v', 'mov', 'm4a', '3gp'].includes((item.ext || '').toLowerCase())) {
        throw new Error(`Audio-only download isn't available for ${(item.ext || 'this').toUpperCase()} files. Download the full video instead.`);
      }
    } else if (item.kind === 'dash') throw new Error('This stream has no separate audio track.');
    else throw new Error('Audio-only download isn’t available for this media.');
  }
  variant = variant || pickVariant(item.variants, s);
  if (!variant) throw new Error('No downloadable quality found for this media.');
  if (variant.audioOnly && output !== 'audio') srcOutput = 'audio';

  // Separate audio rendition → merge it in (unless the user asked for video only).
  if (output === 'auto' && variant.separateAudio && s.mergeAudio && !variant.audioOnly) {
    if (item.kind === 'hls') {
      const group = item.variants.filter((v) => v.audioOnly && (!variant.audioGroup || v.groupId === variant.audioGroup));
      const a = group.find((v) => v.isDefault) || group[0];
      if (a) audioTrack = { url: a.url, label: a.label };
    } else if (item.kind === 'dash') {
      const want = variant.ext === 'webm' ? 'weba' : 'm4a';
      const a = item.variants.filter((v) => v.audioOnly && v.ext === want).sort((x, y) => y.bandwidth - x.bandwidth)[0];
      if (a) audioTrack = { repId: a.repId, label: a.label };
    }
  }
  if (output === 'ts' && item.kind !== 'hls') srcOutput = 'auto';

  const rules = await siteRules();
  const host = hostOf(item.pageUrl);
  const naming = rules.naming[host] || null;
  const smartTitle = naming && naming.selector && item.selectorText ? item.selectorText : '';
  const isAudio = srcOutput === 'audio' || variant.audioOnly || item.audioOnly;
  return {
    kind: variant.kind === 'blob' ? 'blob' : item.kind === 'blob' ? 'blob' : variant.kind,
    url: variant.url,
    repId: variant.repId || null,
    output: srcOutput,
    audio: audioTrack,
    referer: item.referer || item.pageUrl,
    pageUrl: item.pageUrl,
    frameId: item.frameId || 0,
    title: item.customTitle || smartTitle || item.title || state.pageTitle || hostOf(item.pageUrl),
    selectorText: item.selectorText || '',
    template: naming && naming.template ? naming.template : '',
    ext: isAudio && item.kind !== 'file' ? 'm4a' : (srcOutput === 'audio' && item.kind === 'file' && !item.audioOnly ? 'm4a' : variant.ext),
    res: isAudio ? 'audio' : resolutionLabel(variant.height || item.height, variant.width || item.width),
    label: srcOutput === 'audio' && !variant.audioOnly ? 'Audio only' : (audioTrack ? `${variant.label} + audio` : variant.label),
    size: srcOutput === 'auto' ? (variant.size || item.size || null) : null,
    live: !!item.live,
    audioOnly: isAudio,
    thumb: item.poster || state.thumb || ''
  };
}

function engineOf(source) {
  if (source.kind === 'blob') return 'page';
  if (source.kind === 'file') return source.output === 'audio' ? 'offscreen' : 'browser';
  return 'offscreen';
}

async function startFromSource(source, tabId = TAB_NONE, overrides = {}) {
  const s = await settings();
  const custom = overrides.filename ? sanitizeFilename(String(overrides.filename).replace(/\.[a-z0-9]{2,4}$/i, '')) : '';
  const baseName = custom || buildFilename(source.template || s.filenameTemplate, {
    title: source.title, host: hostOf(source.pageUrl), res: source.res, id: hashId(source.url), selector: source.selectorText
  });
  const folder = sanitizeFolder(s.subfolder);
  const job = {
    id: `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    tabId,
    source,
    title: source.title,
    baseName,
    folder,
    saveAs: typeof overrides.saveAs === 'boolean' ? overrides.saveAs : s.saveAs,
    filename: '',
    label: source.label,
    kind: source.kind,
    engine: engineOf(source),
    status: 'queued',
    progress: 0,
    bytes: 0,
    total: source.size || 0,
    segmentsDone: 0,
    segmentsTotal: 0,
    live: source.live,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    error: ''
  };
  await mutateJobs((jobs) => { jobs[job.id] = job; });
  pumpQueue();
  return job;
}

const TERMINAL = ['done', 'error', 'cancelled'];
let pumping = false;
let pumpAgain = false;
async function pumpQueue() {
  if (pumping) { pumpAgain = true; return; }
  pumping = true;
  try {
    do {
      pumpAgain = false;
      // Claim queued jobs atomically ('starting') so overlapping pumps never double-start one.
      const claimed = await mutateJobs((jobs) => {
        const all = Object.values(jobs).sort((x, y) => x.createdAt - y.createdAt);
        let activeStreams = all.filter((j) => j.engine === 'offscreen' && ['starting', 'downloading', 'finalizing'].includes(j.status)).length;
        const out = [];
        for (const job of all.filter((j) => j.status === 'queued')) {
          if (job.engine === 'offscreen') {
            if (activeStreams >= MAX_PARALLEL_STREAM_JOBS) continue;
            activeStreams++;
          }
          job.status = 'starting';
          out.push({ ...job });
        }
        return out;
      });
      // Not awaited: a "Save as" dialog must not block the rest of the queue.
      for (const job of claimed) {
        const run = job.engine === 'browser' ? runFileJob : job.engine === 'page' ? runPageBlobJob : runStreamJob;
        run(job).catch((e) => failJob(job.id, String(e)));
      }
    } while (pumpAgain);
  } finally {
    pumping = false;
  }
}

function fullPath(job, ext) {
  const name = `${job.baseName}.${ext}`;
  return job.folder ? `${job.folder}/${name}` : name;
}

async function removeJobRules(job) {
  for (const id of job?.ruleIds || []) await removeHeaderRule(id);
}

async function runFileJob(job) {
  const s = await settings();
  void s;
  const ruleId = await addHeaderRule(job.source.url, job.source.referer);
  await patchJob(job.id, { ruleIds: ruleId ? [ruleId] : [] });
  const filename = fullPath(job, job.source.ext || extFromUrl(job.source.url) || 'mp4');
  try {
    const downloadId = await chrome.downloads.download({
      url: job.source.url, filename, saveAs: job.saveAs ?? s.saveAs, conflictAction: 'uniquify'
    });
    const updated = await patchJob(job.id, { status: 'downloading', downloadId, filename });
    if (!updated || updated.status === 'cancelled') { chrome.downloads.cancel(downloadId).catch(() => {}); return; }
    ensureProgressPolling();
    await syncDownloadState(downloadId); // it may already have finished before we stored the id
  } catch (e) {
    await failJob(job.id, e.message || String(e));
  }
}

// Blob videos only exist inside the page: the content script saves them through an <a download>,
// and onDeterminingFilename below gives the file our name + folder.
const pendingBlobs = new Map(); // blob URL → job id
async function runPageBlobJob(job) {
  const filename = fullPath(job, job.source.ext || 'mp4');
  await patchJob(job.id, { status: 'downloading', filename, progress: 0 });
  pendingBlobs.set(job.source.url, job.id);
  updateFilenameHook();
  setTimeout(() => { pendingBlobs.delete(job.source.url); updateFilenameHook(); }, 120000);
  let res;
  try {
    res = await chrome.tabs.sendMessage(job.tabId, { type: 'vidsnag-save-blob', url: job.source.url, filename: filename.split('/').pop() }, { frameId: job.source.frameId || 0 });
  } catch {
    res = null;
  }
  if (!res || !res.ok) {
    pendingBlobs.delete(job.source.url);
    updateFilenameHook();
    await failJob(job.id, res?.error || 'The page is no longer open, so its in-page (blob) video can’t be saved. Reopen the page and try again.');
  }
}
chrome.downloads.onCreated.addListener(async (dl) => {
  const jobId = pendingBlobs.get(dl.url) || pendingBlobs.get(dl.finalUrl);
  if (!jobId) return;
  const updated = await patchJob(jobId, { downloadId: dl.id });
  if (updated) { ensureProgressPolling(); syncDownloadState(dl.id); }
});
// Only hooked while a blob download is pending, so other downloads are never touched.
function onDeterminingFilename(dl, suggest) {
  const jobId = pendingBlobs.get(dl.url) || pendingBlobs.get(dl.finalUrl);
  if (!jobId) return; // not ours: Chrome keeps its default name
  readJobs().then((jobs) => {
    const job = jobs[jobId];
    suggest(job ? { filename: job.filename, conflictAction: 'uniquify' } : undefined);
    pendingBlobs.delete(dl.url);
    updateFilenameHook();
  });
  return true;
}
function updateFilenameHook() {
  const hooked = chrome.downloads.onDeterminingFilename.hasListener(onDeterminingFilename);
  if (pendingBlobs.size && !hooked) chrome.downloads.onDeterminingFilename.addListener(onDeterminingFilename);
  else if (!pendingBlobs.size && hooked) chrome.downloads.onDeterminingFilename.removeListener(onDeterminingFilename);
}

async function runStreamJob(job) {
  const s = await settings();
  const ruleId = await addHeaderRule(job.source.url, job.source.referer);
  await patchJob(job.id, { status: 'downloading', ruleIds: ruleId ? [ruleId] : [] });
  try {
    await ensureOffscreen();
    await sendToOffscreen({
      type: 'start',
      jobKind: job.source.kind,
      job: { id: job.id, source: job.source },
      options: { hlsOutput: s.hlsOutput, concurrency: s.maxConcurrentSegments }
    });
  } catch (e) {
    await failJob(job.id, `Could not start the downloader: ${e.message || e}`);
  }
}

// Terminal states are final: late progress messages can't revive a cancelled/failed job.
async function patchJob(id, patch) {
  return mutateJobs((jobs) => {
    const job = jobs[id];
    if (!job) return null;
    if (TERMINAL.includes(job.status) && patch.status && !TERMINAL.includes(patch.status)) return { ...job };
    if (TERMINAL.includes(job.status) && !patch.status && 'progress' in patch) return { ...job };
    Object.assign(job, patch, { updatedAt: Date.now() });
    return { ...job };
  });
}

function revokeBlob(job) {
  if (job?.blobUrl) chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', url: job.blobUrl }).catch(() => {});
}

async function failJob(id, error) {
  const before = (await readJobs())[id];
  if (!before || TERMINAL.includes(before.status)) return;
  const job = await patchJob(id, { status: 'error', error });
  if (!job) return;
  await removeJobRules(job);
  revokeBlob(job);
  await addHistory(job, 'error');
  notify('Download failed', `${job.title}\n${error}`);
  pumpQueue();
  maybeCloseOffscreen();
}

async function cancelJob(id) {
  const job = (await readJobs())[id];
  if (!job || TERMINAL.includes(job.status)) return;
  await patchJob(id, { status: 'cancelled' });
  if (job.downloadId != null) await chrome.downloads.cancel(job.downloadId).catch(() => {});
  if (job.engine === 'offscreen') await chrome.runtime.sendMessage({ target: 'offscreen', type: 'cancel', jobId: id }).catch(() => {});
  await removeJobRules(job);
  revokeBlob(job);
  pumpQueue();
  maybeCloseOffscreen();
}

// Live streams: stop recording and save what has been captured so far.
async function stopLiveJob(id) {
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop', jobId: id }).catch(() => {});
}

// Track browser downloads that belong to our jobs.
chrome.downloads.onChanged.addListener(async (delta) => {
  const job = Object.values(await readJobs()).find((j) => j.downloadId === delta.id);
  if (!job) return;
  if (delta.filename?.current) await patchJob(job.id, { finalPath: delta.filename.current });
  if (delta.state) await syncDownloadState(delta.id);
});

async function syncDownloadState(downloadId) {
  const job = Object.values(await readJobs()).find((j) => j.downloadId === downloadId);
  const [dl] = await chrome.downloads.search({ id: downloadId });
  if (!job || !dl || TERMINAL.includes(job.status)) return;
  if (dl.state === 'complete') {
    const done = await patchJob(job.id, {
      status: 'done', progress: 1,
      bytes: dl.fileSize || dl.bytesReceived || job.bytes,
      total: dl.fileSize || job.total,
      finalPath: dl.filename || job.finalPath
    });
    await removeJobRules(job);
    revokeBlob(job);
    await addHistory(done, 'done');
    notify('Download complete', done.title);
    pumpQueue();
    maybeCloseOffscreen();
  } else if (dl.state === 'interrupted') {
    if (dl.error === 'USER_CANCELED') {
      await patchJob(job.id, { status: 'cancelled' });
      await removeJobRules(job);
      revokeBlob(job);
      pumpQueue();
      maybeCloseOffscreen();
    } else {
      await failJob(job.id, humanDownloadError(dl.error || 'Interrupted'));
    }
  }
}

function humanDownloadError(code) {
  const map = {
    NETWORK_FAILED: 'Network error', NETWORK_TIMEOUT: 'Network timeout', SERVER_FORBIDDEN: 'Server refused access (403)',
    SERVER_UNAUTHORIZED: 'Server requires login', SERVER_BAD_CONTENT: 'File not found on server',
    FILE_NO_SPACE: 'Disk is full', FILE_ACCESS_DENIED: 'No permission to write the file', FILE_NAME_TOO_LONG: 'File name too long'
  };
  return map[code] || code;
}

// Progress for direct downloads comes from polling chrome.downloads.
let pollTimer = null;
function ensureProgressPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const active = await refreshDirectProgress();
    if (!active) { clearInterval(pollTimer); pollTimer = null; }
  }, 1000);
}
async function refreshDirectProgress() {
  const jobs = await readJobs();
  const active = Object.values(jobs).filter((j) => j.engine !== 'offscreen' && j.status === 'downloading' && j.downloadId != null);
  for (const job of active) {
    const [dl] = await chrome.downloads.search({ id: job.downloadId });
    if (!dl) continue;
    const total = dl.totalBytes > 0 ? dl.totalBytes : job.total;
    await patchJob(job.id, { bytes: dl.bytesReceived, total, progress: total ? dl.bytesReceived / total : 0 });
  }
  return active.length;
}

// ---------------------------------------------------------------------------
// Offscreen document (HLS/DASH segment downloader)
// ---------------------------------------------------------------------------
// Open/close are serialized so a closing document can't swallow a job that is starting.
let offscreenChain = Promise.resolve();
function offscreenOp(fn) {
  const p = offscreenChain.then(fn, fn);
  offscreenChain = p.catch(() => {});
  return p;
}
async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}
function ensureOffscreen() {
  return offscreenOp(async () => {
    if (await hasOffscreen()) return;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['BLOBS', 'CLIPBOARD'],
      justification: 'Download stream segments and assemble them into a single video file; copy media links from the right-click menu.'
    });
  });
}
function maybeCloseOffscreen() {
  return offscreenOp(async () => {
    const jobs = Object.values(await readJobs());
    const busy = jobs.some((j) => j.engine === 'offscreen' && ['queued', 'starting', 'downloading', 'finalizing'].includes(j.status))
      || Date.now() < offscreenBusyUntil;
    if (!busy && (await hasOffscreen())) await chrome.offscreen.closeDocument().catch(() => {});
  });
}
let offscreenBusyUntil = 0;
async function copyViaOffscreen(text) {
  offscreenBusyUntil = Date.now() + 5000;
  await ensureOffscreen();
  const res = await sendToOffscreen({ type: 'copy', text });
  setTimeout(maybeCloseOffscreen, 5500);
  return !!res?.ok;
}
// The document's script may still be loading right after creation: retry briefly.
async function sendToOffscreen(msg) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await chrome.runtime.sendMessage({ target: 'offscreen', ...msg });
    } catch (e) {
      if (attempt >= 15 || !/Receiving end does not exist/i.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 100));
      await ensureOffscreen();
    }
  }
}

async function onOffscreenMessage(msg) {
  const job = (await readJobs())[msg.jobId];
  if (!job || TERMINAL.includes(job.status)) {
    if (msg.type === 'finished' && msg.url) chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', url: msg.url }).catch(() => {});
    return null;
  }
  if (msg.type === 'hosts') {
    // Segments/keys can live on other CDNs: give them the page's Referer too.
    const covered = new Set([hostOf(job.source.url)]);
    const added = [];
    for (const host of msg.hosts || []) {
      if (!host || covered.has(host)) continue;
      covered.add(host);
      const id = await addHeaderRule(`https://${host}/`, job.source.referer);
      if (id) added.push(id);
    }
    if (added.length) {
      const updated = await patchJob(job.id, { ruleIds: [...(job.ruleIds || []), ...added] });
      if (!updated || TERMINAL.includes(updated.status)) for (const id of added) await removeHeaderRule(id);
    }
    return null;
  }
  if (msg.type === 'progress') {
    if (job.downloadId != null) return null; // already handed to chrome.downloads
    await patchJob(job.id, {
      progress: msg.progress, bytes: msg.bytes, total: msg.total || job.total,
      segmentsDone: msg.segmentsDone, segmentsTotal: msg.segmentsTotal,
      status: msg.finalizing ? 'finalizing' : 'downloading', note: msg.note || ''
    });
  } else if (msg.type === 'failed') {
    await failJob(job.id, msg.error);
  } else if (msg.type === 'finished') {
    const s = await settings();
    const filename = fullPath(job, msg.ext);
    const current = await patchJob(job.id, { status: 'finalizing', blobUrl: msg.url, filename, total: msg.size, bytes: msg.size, progress: 1, note: msg.note || '' });
    if (!current || current.status !== 'finalizing') { revokeBlob({ blobUrl: msg.url }); return null; }
    try {
      const downloadId = await chrome.downloads.download({ url: msg.url, filename, saveAs: job.saveAs ?? s.saveAs, conflictAction: 'uniquify' });
      const updated = await patchJob(job.id, { downloadId });
      if (!updated || updated.status === 'cancelled') { chrome.downloads.cancel(downloadId).catch(() => {}); return null; }
      await syncDownloadState(downloadId);
    } catch (e) {
      await failJob(job.id, e.message || String(e));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
async function addHistory(job, status) {
  const s = await settings();
  if (!s.historyEnabled || !job) return;
  await mutateHistory((history) => {
    if (history.some((h) => h.jobId === job.id)) return;
    history.unshift({
      id: `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      jobId: job.id,
      title: job.title,
      filename: job.finalPath || job.filename,
      downloadId: job.downloadId ?? null,
      kind: job.kind,
      engine: job.engine,
      thumb: job.source.thumb || '',
      label: job.label,
      size: job.total || job.bytes || null,
      url: job.source.url,
      pageUrl: job.source.pageUrl,
      status,
      error: job.error || '',
      finishedAt: Date.now(),
      source: job.source
    });
  });
  await pruneHistory();
}

async function pruneHistory() {
  const s = await settings();
  if (!s.historyDays) return;
  const cutoff = Date.now() - s.historyDays * 86400000;
  await mutateHistory((history) => {
    const keep = history.filter((h) => h.finishedAt >= cutoff);
    history.length = 0;
    history.push(...keep);
  });
}

// ---------------------------------------------------------------------------
// Notifications, context menus, keyboard command
// ---------------------------------------------------------------------------
async function notify(title, message) {
  const s = await settings();
  if (!s.notifications) return;
  chrome.notifications.create({
    type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title, message: String(message || '').slice(0, 250), priority: 0
  }, () => void chrome.runtime.lastError);
}

let menuChain = Promise.resolve();
function setupContextMenus() {
  // Serialized: overlapping removeAll/create calls would otherwise create duplicate ids.
  menuChain = menuChain.then(buildContextMenus, buildContextMenus);
  return menuChain;
}
const MEDIA_LINK_PATTERNS = ['mp4', 'webm', 'mkv', 'mov', 'm4v', 'mp3', 'm4a', 'ogg', 'm3u8', 'mpd', 'flv', 'wav', 'aac']
  .flatMap((e) => [`*://*/*.${e}`, `*://*/*.${e}?*`]);

async function buildContextMenus() {
  const s = await settings();
  await chrome.contextMenus.removeAll();
  const add = (o) => chrome.contextMenus.create(o, () => void chrome.runtime.lastError);
  // Toolbar-icon menu (always available, max 6 entries).
  add({ id: 'act-sidebar', title: 'Open in sidebar', contexts: ['action'] });
  add({ id: 'act-window', title: 'Open in a separate window', contexts: ['action'] });
  add({ id: 'act-library', title: 'Saved links', contexts: ['action'] });
  add({ id: 'act-history', title: 'Download history', contexts: ['action'] });
  add({ id: 'act-help', title: 'Help & troubleshooting', contexts: ['action'] });
  add({ id: 'act-options', title: 'Settings', contexts: ['action'] });
  if (!s.contextMenu) return;
  // Page menu.
  const C = ['page', 'video', 'audio', 'link', 'frame', 'image', 'selection'];
  add({ id: 'vs', title: 'VidSnag', contexts: C });
  add({ id: 'vs-media-dl', parentId: 'vs', title: 'Download this media', contexts: ['video', 'audio'] });
  add({ id: 'vs-media-audio', parentId: 'vs', title: 'Download audio only', contexts: ['video'] });
  add({ id: 'vs-media-copy', parentId: 'vs', title: 'Copy media link', contexts: ['video', 'audio'] });
  add({ id: 'vs-media-save', parentId: 'vs', title: 'Save video to list', contexts: ['video', 'audio'] });
  add({ id: 'vs-link-dl', parentId: 'vs', title: 'Download linked media', contexts: ['link'], targetUrlPatterns: MEDIA_LINK_PATTERNS });
  add({ id: 'vs-link-save', parentId: 'vs', title: 'Save link to list', contexts: ['link'] });
  add({ id: 'vs-sep1', parentId: 'vs', type: 'separator', contexts: C });
  add({ id: 'vs-best', parentId: 'vs', title: 'Download best media on this page', contexts: C });
  add({ id: 'vs-best-audio', parentId: 'vs', title: 'Download audio of best media', contexts: C });
  add({ id: 'vs-save-page', parentId: 'vs', title: 'Save this page to list', contexts: C });
  add({ id: 'vs-rescan', parentId: 'vs', title: 'Rescan page for media', contexts: C });
  add({ id: 'vs-sep2', parentId: 'vs', type: 'separator', contexts: C });
  add({ id: 'vs-sidebar', parentId: 'vs', title: 'Open VidSnag in sidebar', contexts: C });
  add({ id: 'vs-window', parentId: 'vs', title: 'Open VidSnag in a window', contexts: C });
  add({ id: 'vs-library', parentId: 'vs', title: 'Saved links', contexts: C });
}

function panelUrl(params) {
  return chrome.runtime.getURL(`${PANEL_URL}?${new URLSearchParams(params)}`);
}
function openPanelTab(view) {
  return chrome.tabs.create({ url: panelUrl({ mode: 'tab', view }) });
}
async function openOptions() {
  await chrome.runtime.openOptionsPage();
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // sidePanel.open must run synchronously inside the user gesture.
  if (info.menuItemId === 'act-sidebar' || info.menuItemId === 'vs-sidebar') {
    const windowId = tab?.windowId;
    if (windowId != null) chrome.sidePanel.open({ windowId }).catch((e) => notify('Sidebar', e.message));
    return;
  }
  handleMenuClick(info, tab).catch((e) => notify('VidSnag', e.message || String(e)));
});

async function handleMenuClick(info, tab) {
  const id = info.menuItemId;
  if (id === 'act-window' || id === 'vs-window') return openPanelWindow();
  if (id === 'act-library' || id === 'vs-library') return openPanelTab('library');
  if (id === 'act-history') return openPanelTab('history');
  if (id === 'act-help') return openPanelTab('help');
  if (id === 'act-options') return openOptions();
  if (!tab || tab.id < 0) return;
  if (id === 'vs-rescan') {
    await chrome.tabs.sendMessage(tab.id, { type: 'vidsnag-scan' }).catch(() => {});
    return notify('Rescanning', 'Looking for media on this page…');
  }
  if (id === 'vs-best' || id === 'vs-best-audio') return downloadBest(tab, id === 'vs-best-audio' ? 'audio' : 'auto');
  if (id === 'vs-save-page') {
    await libSavePage({ url: tab.url, title: tab.title, thumb: (await readTab(tab.id)).thumb || '' });
    return notify('Saved', `“${tab.title}” was added to Saved links › Pages.`);
  }
  if (id === 'vs-link-save') {
    const url = info.linkUrl;
    const c = classify(url, '');
    if (c && c.kind !== 'segment') {
      await libSaveRaw({ type: 'video', url, title: info.selectionText || fileTitle(url), pageUrl: tab.url, kind: c.kind, ext: c.ext });
      return notify('Saved', 'Link added to Saved links › Videos.');
    }
    await libSavePage({ url, title: info.selectionText || url });
    return notify('Saved', 'Link added to Saved links › Pages.');
  }
  const url = info.srcUrl || info.linkUrl;
  if (!url) return;
  if (url.startsWith('blob:')) {
    // A blob: player – use what detection found on the page instead.
    const st = await readTab(tab.id);
    const found = Object.values(st.items).find((i) => i.url === url && i.kind === 'blob');
    if (found && (id === 'vs-media-dl')) return startDownload(tab.id, found.id, {});
    return notify('Streaming player', 'This player streams the video in pieces. Play it for a few seconds, then open VidSnag to pick the detected stream.');
  }
  if (id === 'vs-media-copy') {
    const ok = await copyViaOffscreen(url);
    return notify(ok ? 'Link copied' : 'Copy failed', url);
  }
  const c = classify(url, '') || { kind: 'file', ext: extFromUrl(url) || 'mp4' };
  if (c.kind === 'segment') return;
  await addMedia(tab.id, { url, kind: c.kind, ext: c.ext, audioOnly: !!c.audio, source: 'menu' });
  const mid = hashId(normalizeMediaUrl(url));
  if (c.kind !== 'file') await waitForProbe(tab.id, mid);
  if (id === 'vs-media-save') {
    await libSaveMedia(tab.id, mid, {});
    return notify('Saved', 'Video added to Saved links › Videos.');
  }
  await startDownload(tab.id, mid, { output: id === 'vs-media-audio' ? 'audio' : 'auto' });
}

function fileTitle(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop()) || url; } catch { return url; }
}

async function downloadBest(tab, output) {
  const st = await readTab(tab.id);
  const items = Object.values(st.items).filter((i) => i.status === 'ready');
  if (!items.length) { notify('Nothing to download', 'VidSnag has not detected any media on this page yet. Play the video, then try again.'); return; }
  const score = (i) => (i.kind === 'hls' || i.kind === 'dash' ? 1e12 : 0) + (i.height || 0) * 1e6 + (i.size || 0) / 1e3;
  const best = items.sort((a, b) => score(b) - score(a))[0];
  await startDownload(tab.id, best.id, { output });
  notify('Download started', best.customTitle || best.title);
}

async function waitForProbe(tabId, id, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const st = await readTab(tabId);
    if (!st.items[id] || st.items[id].status !== 'probing') return;
    await new Promise((r) => setTimeout(r, 300));
  }
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'open-sidebar') {
    if (tab?.windowId != null) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    return;
  }
  if (command !== 'download-best') return;
  const [active] = tab ? [tab] : await chrome.tabs.query({ active: true, currentWindow: true });
  if (active) downloadBest(active, 'auto').catch((e) => notify('Cannot download', e.message));
});

// ---------------------------------------------------------------------------
// Panels: popup / sidebar / separate window
// ---------------------------------------------------------------------------
async function applyPanelBehavior() {
  const s = await settings();
  const sidebar = s.defaultPanel === 'sidebar';
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: sidebar }).catch(() => {});
  await chrome.action.setPopup({ popup: sidebar ? '' : PANEL_URL }).catch(() => {});
}

async function openPanelWindow(view = '') {
  const s = await settings();
  const { panelWindowId } = await chrome.storage.session.get('panelWindowId');
  if (panelWindowId != null) {
    const w = await chrome.windows.get(panelWindowId).catch(() => null);
    if (w) { await chrome.windows.update(panelWindowId, { focused: true, state: 'normal' }); return panelWindowId; }
  }
  const [width, height] = WINDOW_DIMS[s.windowSize] || WINDOW_DIMS.M;
  const w = await chrome.windows.create({ url: panelUrl({ mode: 'window', ...(view ? { view } : {}) }), type: 'popup', width, height, focused: true });
  await chrome.storage.session.set({ panelWindowId: w.id });
  return w.id;
}
chrome.windows.onRemoved.addListener(async (id) => {
  const { panelWindowId } = await chrome.storage.session.get('panelWindowId');
  if (panelWindowId === id) chrome.storage.session.remove('panelWindowId');
});

// ---------------------------------------------------------------------------
// Saved links library (storage.local "library")
//   categories: [{ id, name, color }]
//   items: [{ id, type:'video'|'page', title, url, pageUrl, categoryId, kind, ext, label, res,
//             thumb, duration, notes, linkStatus:'unknown'|'ok'|'expired'|'error', lastChecked,
//             savedAt, updatedAt, refreshedAt, source }]
// ---------------------------------------------------------------------------
const CATEGORY_COLORS = ['#0f766e', '#2563eb', '#7c3aed', '#e11d48', '#c2410c', '#15803d', '#a16207', '#475569'];
const newId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function normalizeLibrary(lib) {
  const out = { categories: [], items: [] };
  if (lib && typeof lib === 'object') {
    for (const c of Array.isArray(lib.categories) ? lib.categories : []) {
      if (!c || typeof c.name !== 'string' || !c.name.trim()) continue;
      out.categories.push({ id: typeof c.id === 'string' ? c.id : newId('c'), name: c.name.trim().slice(0, 60), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : CATEGORY_COLORS[0] });
    }
    const catIds = new Set(out.categories.map((c) => c.id));
    for (const it of Array.isArray(lib.items) ? lib.items : []) {
      if (!it || typeof it.url !== 'string' || !/^https?:/i.test(it.url)) continue;
      out.items.push({
        ...it,
        id: typeof it.id === 'string' ? it.id : newId('l'),
        type: it.type === 'page' ? 'page' : 'video',
        title: String(it.title || it.url).slice(0, 300),
        categoryId: catIds.has(it.categoryId) ? it.categoryId : null,
        notes: String(it.notes || '').slice(0, 2000),
        linkStatus: ['ok', 'expired', 'error'].includes(it.linkStatus) ? it.linkStatus : 'unknown',
        savedAt: Number(it.savedAt) || Date.now()
      });
    }
  }
  if (!out.categories.length) out.categories.push({ id: 'c-general', name: 'General', color: CATEGORY_COLORS[0] });
  return out;
}
async function readLibrary() {
  const { library } = await chrome.storage.local.get('library');
  return normalizeLibrary(library);
}
function mutateLibrary(fn) {
  return serialize(async () => {
    const lib = await readLibrary();
    const result = await fn(lib);
    await chrome.storage.local.set({ library: lib });
    return result;
  });
}

async function libSaveRaw(entry) {
  return mutateLibrary((lib) => {
    const dupe = lib.items.find((x) => x.type === entry.type && x.url === entry.url);
    if (dupe) {
      Object.assign(dupe, { title: entry.title || dupe.title, categoryId: entry.categoryId ?? dupe.categoryId, updatedAt: Date.now() });
      return { ...dupe, duplicate: true };
    }
    const item = {
      id: newId('l'), type: entry.type, title: entry.title || entry.url, url: entry.url, pageUrl: entry.pageUrl || '',
      categoryId: entry.categoryId === undefined ? (lib.categories[0]?.id || null) : entry.categoryId,
      kind: entry.kind || (entry.type === 'page' ? 'page' : 'file'), ext: entry.ext || '', label: entry.label || '',
      res: entry.res || '', thumb: entry.thumb || '', duration: entry.duration || 0, notes: entry.notes || '',
      linkStatus: 'unknown', lastChecked: 0, savedAt: Date.now(), updatedAt: Date.now(), source: entry.source || null
    };
    if (!lib.categories.some((c) => c.id === item.categoryId)) item.categoryId = null;
    lib.items.unshift(item);
    if (lib.items.length > 2000) lib.items.length = 2000;
    return item;
  });
}

async function libSavePage({ url, title, thumb, categoryId, notes }) {
  if (!/^https?:/i.test(url || '')) throw new Error('Only web pages (http/https) can be saved.');
  return libSaveRaw({ type: 'page', url, title: title || url, thumb, categoryId, notes });
}

async function libSaveMedia(tabId, mediaId, { variantId, categoryId, title, notes } = {}) {
  const st = await readTab(tabId);
  const item = st.items[mediaId];
  if (!item) throw new Error('This media is no longer available.');
  if (item.kind === 'blob') throw new Error('In-page (blob) videos only exist while the page is open. Save the page link instead.');
  const source = await buildSource(item, st, { variantId, output: 'auto' });
  return libSaveRaw({
    type: 'video', url: source.url, title: title || source.title, pageUrl: item.pageUrl, categoryId, notes,
    kind: item.kind, ext: source.ext, label: source.label, res: source.res, thumb: source.thumb,
    duration: item.duration, source
  });
}

// Is a saved link still reachable?
async function checkLink(entry) {
  const target = entry.type === 'page' ? entry.url : entry.url;
  const ruleId = entry.type === 'video' ? await addHeaderRule(target, entry.pageUrl || entry.source?.referer) : null;
  try {
    const headers = entry.type === 'video' && entry.kind === 'file' ? { Range: 'bytes=0-0' } : {};
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch(target, { credentials: 'include', cache: 'no-store', headers, signal: ctl.signal }).finally(() => clearTimeout(t));
    if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410) return { status: 'expired', code: res.status };
    if (!res.ok) return { status: 'error', code: res.status };
    if (entry.type === 'video' && entry.kind === 'hls') {
      const text = await res.text();
      if (!isPlaylist(text)) return { status: 'expired', code: res.status };
    } else if (entry.type === 'video' && entry.kind === 'dash') {
      const text = await res.text();
      if (!/<MPD[\s>]/.test(text)) return { status: 'expired', code: res.status };
    } else if (entry.type === 'video') {
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.startsWith('text/html')) return { status: 'expired', code: res.status };
    }
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return { status: 'ok', code: res.status };
  } catch (e) {
    return { status: 'error', code: 0, error: e.name === 'AbortError' ? 'Timed out' : String(e.message || e) };
  } finally {
    await removeHeaderRule(ruleId);
  }
}

async function libCheck(ids) {
  const lib = await readLibrary();
  const targets = lib.items.filter((x) => !ids || ids.includes(x.id));
  const results = {};
  for (let i = 0; i < targets.length; i += 4) {
    await Promise.all(targets.slice(i, i + 4).map(async (x) => { results[x.id] = await checkLink(x); }));
  }
  await mutateLibrary((l) => {
    for (const x of l.items) if (results[x.id]) { x.linkStatus = results[x.id].status; x.lastChecked = Date.now(); }
  });
  return results;
}

// Path similarity between two media URLs (ignores query strings, tokens and numbers).
function urlSimilarity(a, b) {
  const norm = (u) => { try { const x = new URL(u); return { host: x.hostname, parts: x.pathname.split('/').filter(Boolean) }; } catch { return { host: '', parts: [] }; } };
  const A = norm(a), B = norm(b);
  const generic = (p) => /^[0-9a-f-]{16,}$/i.test(p) || /^\d+$/.test(p) || p.length > 40;
  const pa = A.parts.filter((p) => !generic(p)), pb = new Set(B.parts.filter((p) => !generic(p)));
  const common = pa.filter((p) => pb.has(p)).length;
  return (A.host === B.host ? 2 : 0) + common / Math.max(1, Math.max(pa.length, pb.size)) * 3
    + (A.parts.at(-1) && A.parts.at(-1) === B.parts.at(-1) ? 2 : 0);
}

// Refresh an expired video link: load its page (in a background tab if it isn't open),
// let detection find the media again, and replace the stored URL with the fresh one.
async function libRefresh(id) {
  const lib = await readLibrary();
  const entry = lib.items.find((x) => x.id === id);
  if (!entry) throw new Error('Saved item not found');
  if (entry.type === 'page') {
    const r = (await libCheck([id]))[id];
    return { updated: false, status: r.status, message: r.status === 'ok' ? 'The page is reachable.' : `The page returned ${r.code || r.error || 'an error'}.` };
  }
  if (!entry.pageUrl) throw new Error('This link was saved without its web page, so it can’t be refreshed automatically.');

  let tabId = null;
  let created = false;
  const open = (await chrome.tabs.query({})).find((t) => t.url && sameDoc(t.url, entry.pageUrl));
  if (open) {
    tabId = open.id;
    chrome.tabs.sendMessage(tabId, { type: 'vidsnag-scan' }).catch(() => {});
  } else {
    const t = await chrome.tabs.create({ url: entry.pageUrl, active: false });
    tabId = t.id;
    created = true;
  }
  try {
    let candidates = [];
    const end = Date.now() + 25000;
    let rescanned = false;
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, 700));
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) break;
      if (tab.status === 'complete' && !rescanned) { rescanned = true; chrome.tabs.sendMessage(tabId, { type: 'vidsnag-scan' }).catch(() => {}); }
      const st = await readTab(tabId);
      candidates = Object.values(st.items).filter((i) => i.status === 'ready' && i.kind !== 'blob');
      const probing = Object.values(st.items).some((i) => i.status === 'probing');
      if (candidates.length && !probing && tab.status === 'complete' && Date.now() > end - 21000) break;
    }
    if (!candidates.length) {
      await mutateLibrary((l) => { const x = l.items.find((y) => y.id === id); if (x) { x.linkStatus = 'expired'; x.lastChecked = Date.now(); } });
      return { updated: false, status: 'expired', message: 'No video was found on the page automatically. Open the page, play the video, then save it again.' };
    }
    const scored = candidates.map((c) => ({ c, score: (c.kind === entry.kind ? 3 : 0) + urlSimilarity(c.url, entry.url) + (c.variants.some((v) => v.label === entry.label) ? 1 : 0) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0].c;
    const st = await readTab(tabId);
    const sameLabel = best.variants.find((v) => v.label === entry.label);
    const source = await buildSource(best, st, { variantId: sameLabel?.id, output: entry.source?.output === 'audio' ? 'audio' : 'auto' });
    const changed = source.url !== entry.url;
    await mutateLibrary((l) => {
      const x = l.items.find((y) => y.id === id);
      if (!x) return;
      Object.assign(x, {
        previousUrl: changed ? x.url : x.previousUrl, url: source.url, kind: best.kind, ext: source.ext, label: source.label,
        res: source.res, thumb: x.thumb || source.thumb, source, linkStatus: 'ok', lastChecked: Date.now(),
        refreshedAt: Date.now(), updatedAt: Date.now()
      });
    });
    return { updated: changed, status: 'ok', message: changed ? 'Link refreshed with the page’s current video address.' : 'The link is still current.' };
  } finally {
    if (created) chrome.tabs.remove(tabId).catch(() => {});
  }
}

async function libDownload(id, output) {
  const lib = await readLibrary();
  const x = lib.items.find((y) => y.id === id);
  if (!x) throw new Error('Saved item not found');
  if (x.type !== 'video') throw new Error('This is a page link. Open it, then download the video from there.');
  const source = x.source ? { ...x.source, url: x.url } : {
    kind: x.kind || 'file', url: x.url, output: 'auto', referer: x.pageUrl || x.url, pageUrl: x.pageUrl || x.url,
    title: x.title, ext: x.ext || extFromUrl(x.url) || 'mp4', res: x.res || '', label: x.label || '', live: false, audioOnly: false
  };
  if (output === 'audio') { source.output = 'audio'; source.ext = 'm4a'; source.res = 'audio'; source.label = 'Audio only'; }
  return startFromSource(source);
}

// ---------------------------------------------------------------------------
// Script addons via chrome.userScripts (needs "Allow User Scripts" enabled by the user)
// ---------------------------------------------------------------------------
function userScriptsStatus() {
  try {
    if (!chrome.userScripts) return { available: false, reason: 'permission' };
    chrome.userScripts.getScripts(); // throws when the toggle is off
    return { available: true };
  } catch {
    return { available: false, reason: 'toggle' };
  }
}
let userScriptChain = Promise.resolve();
function syncUserScripts() {
  userScriptChain = userScriptChain.then(doSyncUserScripts, doSyncUserScripts);
  return userScriptChain;
}
async function doSyncUserScripts() {
  if (!userScriptsStatus().available) return;
  try {
    await chrome.userScripts.configureWorld({ messaging: true });
    const existing = await chrome.userScripts.getScripts();
    if (existing.length) await chrome.userScripts.unregister({ ids: existing.map((x) => x.id) });
    const scripts = (await addons()).filter((a) => a.kind === 'script' && a.enabled);
    if (!scripts.length) return;
    await chrome.userScripts.register(scripts.map((a) => ({
      id: `vs-${a.id}`,
      matches: a.matches.map((m) => (m === '<all_urls>' ? '*://*/*' : m)),
      js: [{ code: SCRIPT_PRELUDE }, { code: a.code }],
      runAt: 'document_idle',
      allFrames: true,
      world: 'USER_SCRIPT'
    })));
  } catch (e) {
    console.warn('[VidSnag] user scripts', e);
  }
}
if (chrome.runtime.onUserScriptMessage) {
  chrome.runtime.onUserScriptMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'script-media' && sender.tab?.id >= 0) {
      ingestReportedMedia(sender.tab.id, msg.items, 'script', sender).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
      return true;
    }
    return false;
  });
}

// Shared by content-script and addon reports.
async function ingestReportedMedia(tabId, items, defaultSource, sender) {
  for (const m of (items || []).slice(0, 80)) {
    if (!m || typeof m.url !== 'string') continue;
    let kind, ext, audio = false;
    if (m.kind === 'blob' || /^blob:/i.test(m.url)) {
      if (!/^blob:https?:/i.test(m.url)) continue;
      kind = 'blob'; ext = m.ext || 'mp4'; audio = m.tag === 'audio';
    } else {
      if (!/^https?:/i.test(m.url)) continue;
      const c = (m.kind === 'hls' ? { kind: 'hls', ext: 'm3u8' } : m.kind === 'dash' ? { kind: 'dash', ext: 'mpd' } : null)
        || classify(m.url, m.mime)
        || { kind: 'file', ext: extFromUrl(m.url) || (m.tag === 'audio' ? 'mp3' : 'mp4'), audio: m.tag === 'audio' };
      if (c.kind === 'segment') continue;
      ({ kind, ext } = c);
      audio = m.tag === 'audio' || !!c.audio;
    }
    await addMedia(tabId, {
      url: m.url, kind, ext, audioOnly: audio, mime: m.mime || '', size: m.size || null,
      width: m.width, height: m.height, duration: m.duration, poster: m.poster, title: m.title || '',
      source: m.source || defaultSource, referer: sender.url || null, frameId: sender.frameId ?? 0,
      selectorText: m.selectorText || ''
    });
  }
}

// ---------------------------------------------------------------------------
// Messages from popup / options / content scripts / offscreen
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false;
  if (msg.target === 'background' && msg.from === 'offscreen') {
    onOffscreenMessage(msg).then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  handleMessage(msg, sender).then(
    (result) => sendResponse({ ok: true, result }),
    (e) => sendResponse({ ok: false, error: e.message || String(e) })
  );
  return true;
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'dom-media': {
      const tabId = sender.tab?.id;
      if (tabId == null || tabId < 0) return null;
      await mutateTab(tabId, (st) => {
        if (sender.frameId === 0) {
          if (msg.thumb) st.thumb = msg.thumb;
          if (typeof msg.selectorText === 'string') {
            st.selectorText = msg.selectorText;
            for (const it of Object.values(st.items)) if (sameDoc(it.pageUrl, sender.tab.url)) it.selectorText = msg.selectorText;
          }
        }
        if (msg.notices) {
          // Notices (streaming player / DRM) are kept per frame so embedded players count too.
          st.frameNotices = { ...(st.frameNotices || {}), [sender.frameId]: { mse: +msg.notices.mse || 0, drm: !!msg.notices.drm } };
          const all = Object.values(st.frameNotices);
          st.notices = { mse: all.reduce((n, x) => n + x.mse, 0), drm: all.some((x) => x.drm) };
        }
      });
      const items = (msg.items || []).slice(0, 80); // the content script already applies the detection settings
      for (const m of items) if (!m.selectorText && msg.selectorText) m.selectorText = msg.selectorText;
      await ingestReportedMedia(tabId, items, 'dom', sender);
      return null;
    }
    case 'get-tab': {
      const st = await readTab(msg.tabId);
      return { ...st, items: Object.values(st.items).sort((a, b) => a.detectedAt - b.detectedAt) };
    }
    case 'clear-tab':
      await serialize(async () => {
        const st = await readTab(msg.tabId);
        await writeTab(msg.tabId, { ...st, items: {} });
      });
      updateBadge(msg.tabId);
      return null;
    case 'remove-media':
      await mutateTab(msg.tabId, (st) => { delete st.items[msg.mediaId]; });
      updateBadge(msg.tabId);
      return null;
    case 'rescan':
      await chrome.tabs.sendMessage(msg.tabId, { type: 'vidsnag-scan' }).catch(() => {});
      return null;
    case 'download':
      return startDownload(msg.tabId, msg.mediaId, { variantId: msg.variantId, output: msg.output, filename: msg.filename, saveAs: msg.saveAs });
    case 'redownload':
      return startFromSource(msg.source);
    case 'rename-media':
      await mutateTab(msg.tabId, (st) => {
        const it = st.items[msg.mediaId];
        if (it) it.customTitle = String(msg.title || '').trim().slice(0, 200);
      });
      return null;
    case 'preview-filename': {
      const st = await readTab(msg.tabId);
      const it = st.items[msg.mediaId];
      if (!it) return '';
      const src = await buildSource(it, st, { variantId: msg.variantId, output: msg.output });
      const s = await settings();
      return `${buildFilename(src.template || s.filenameTemplate, { title: src.title, host: hostOf(src.pageUrl), res: src.res, selector: src.selectorText })}.${src.output === 'ts' ? 'ts' : src.ext}`;
    }
    case 'eval-selector':
      return chrome.tabs.sendMessage(msg.tabId, { type: 'vidsnag-eval-selector', selector: msg.selector }, { frameId: 0 }).catch(() => ({ ok: false, error: 'The page is not reachable. Reload it and try again.' }));
    case 'open-window':
      return openPanelWindow(msg.view || '');
    case 'open-panel-tab':
      return openPanelTab(msg.view || 'media');
    case 'reload-tab':
      await chrome.tabs.reload(msg.tabId);
      return null;
    // ----- library -----
    case 'lib-get':
      return readLibrary();
    case 'lib-save-media':
      return libSaveMedia(msg.tabId, msg.mediaId, msg);
    case 'lib-save-page':
      return libSavePage(msg);
    case 'lib-update':
      return mutateLibrary((lib) => {
        const x = lib.items.find((y) => y.id === msg.id);
        if (!x) throw new Error('Saved item not found');
        const p = msg.patch || {};
        if (typeof p.title === 'string' && p.title.trim()) x.title = p.title.trim().slice(0, 300);
        if (typeof p.notes === 'string') x.notes = p.notes.slice(0, 2000);
        if ('categoryId' in p) x.categoryId = lib.categories.some((c) => c.id === p.categoryId) ? p.categoryId : null;
        if (typeof p.url === 'string' && /^https?:/i.test(p.url)) { x.url = p.url; x.linkStatus = 'unknown'; if (x.source) x.source.url = p.url; }
        x.updatedAt = Date.now();
        return x;
      });
    case 'lib-delete':
      return mutateLibrary((lib) => { lib.items = lib.items.filter((x) => !(msg.ids || []).includes(x.id)); });
    case 'cat-create':
      return mutateLibrary((lib) => {
        const name = String(msg.name || '').trim().slice(0, 60);
        if (!name) throw new Error('Enter a category name');
        if (lib.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error('A category with that name already exists');
        const c = { id: newId('c'), name, color: /^#[0-9a-f]{6}$/i.test(msg.color) ? msg.color : CATEGORY_COLORS[lib.categories.length % CATEGORY_COLORS.length] };
        lib.categories.push(c);
        return c;
      });
    case 'cat-update':
      return mutateLibrary((lib) => {
        const c = lib.categories.find((x) => x.id === msg.id);
        if (!c) throw new Error('Category not found');
        const name = String(msg.name ?? c.name).trim().slice(0, 60);
        if (!name) throw new Error('Enter a category name');
        if (lib.categories.some((x) => x.id !== c.id && x.name.toLowerCase() === name.toLowerCase())) throw new Error('A category with that name already exists');
        c.name = name;
        if (/^#[0-9a-f]{6}$/i.test(msg.color)) c.color = msg.color;
        return c;
      });
    case 'cat-delete':
      return mutateLibrary((lib) => {
        lib.categories = lib.categories.filter((c) => c.id !== msg.id);
        if (msg.deleteItems) lib.items = lib.items.filter((x) => x.categoryId !== msg.id);
        else for (const x of lib.items) if (x.categoryId === msg.id) x.categoryId = msg.moveTo && lib.categories.some((c) => c.id === msg.moveTo) ? msg.moveTo : null;
      });
    case 'lib-check':
      return libCheck(msg.ids || null);
    case 'lib-refresh':
      return libRefresh(msg.id);
    case 'lib-download':
      return libDownload(msg.id, msg.output);
    case 'copy-text':
      return copyViaOffscreen(String(msg.text || ''));
    // ----- addons -----
    case 'addons-status':
      return { ...userScriptsStatus(), extensionId: chrome.runtime.id };
    case 'addons-sync':
      addonCache = null;
      await syncUserScripts();
      return userScriptsStatus();
    case 'get-site-rules':
      return siteRules();
    case 'cancel':
      return cancelJob(msg.jobId);
    case 'stop-live':
      return stopLiveJob(msg.jobId);
    case 'get-jobs':
      await refreshDirectProgress();
      return Object.values(await readJobs()).sort((a, b) => b.createdAt - a.createdAt);
    case 'clear-finished-jobs':
      await mutateJobs((jobs) => {
        for (const [id, j] of Object.entries(jobs)) if (['done', 'error', 'cancelled'].includes(j.status)) delete jobs[id];
      });
      return null;
    case 'get-history': {
      const { history = [] } = await chrome.storage.local.get('history');
      return history;
    }
    case 'clear-history':
      await mutateHistory((h) => { h.length = 0; });
      return null;
    case 'remove-history':
      await mutateHistory((h) => {
        const i = h.findIndex((x) => x.id === msg.id);
        if (i >= 0) h.splice(i, 1);
      });
      return null;
    case 'open-download':
      if (msg.show) chrome.downloads.show(msg.downloadId);
      else await chrome.downloads.open(msg.downloadId);
      return null;
    case 'download-exists': {
      const [dl] = await chrome.downloads.search({ id: msg.downloadId });
      return !!(dl && dl.exists && dl.state === 'complete');
    }
    default:
      throw new Error(`Unknown message: ${msg.type}`);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const { settings: stored } = await chrome.storage.sync.get('settings');
    if (!stored) await chrome.storage.sync.set({ settings: { ...DEFAULT_SETTINGS } });
  }
  setupContextMenus();
  pruneHistory();
  applyPanelBehavior();
  syncUserScripts();
});

chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
  pruneHistory();
  applyPanelBehavior();
  syncUserScripts();
});

// Jobs that were mid-flight when the browser/worker died can't resume: mark them failed,
// drop header rules that no live job owns, and restart the queue.
(async () => {
  const offscreenAlive = await hasOffscreen();
  const staleBefore = Date.now() - 15000; // active jobs update every few hundred ms
  for (const j of Object.values(await readJobs())) {
    if (TERMINAL.includes(j.status) || j.updatedAt > staleBefore) continue;
    if (j.engine !== 'offscreen') {
      if (j.status === 'starting') await patchJob(j.id, { status: 'queued' });
      continue;
    }
    if (offscreenAlive && j.status !== 'starting') continue;
    if (j.status === 'finalizing' && j.downloadId != null) continue; // browser download still tracked
    await failJob(j.id, 'Interrupted (browser or extension restarted)');
  }
  const live = new Set(Object.values(await readJobs())
    .filter((j) => !TERMINAL.includes(j.status)).flatMap((j) => j.ruleIds || []));
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const stale = rules.map((r) => r.id).filter((id) => !live.has(id));
  if (stale.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: stale }).catch(() => {});
  pumpQueue();
})();

// Used by the automated test-suite (native context menus can't be clicked in headless Chrome).
globalThis.__vidsnag = { handleMenuClick, downloadBest, applyPanelBehavior, openPanelWindow };
