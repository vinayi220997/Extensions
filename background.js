// VidSnag service worker: media detection, manifest probing, download queue, history.
import {
  classify, normalizeMediaUrl, hashId, hostOf, buildFilename, sanitizeFolder,
  resolutionLabel, formatDuration, extFromUrl
} from './lib/util.js';
import { getSettings, DEFAULT_SETTINGS, pickVariant } from './lib/settings.js';
import { parseM3U8, isPlaylist, hlsVariantLabel } from './lib/hls.js';
import { parseMPD, dashRepLabel } from './lib/dash.js';

const TAB_NONE = -1;
const MAX_ITEMS_PER_TAB = 60;
const MAX_HISTORY = 500;
const MAX_PARALLEL_STREAM_JOBS = 3;
const OFFSCREEN_URL = 'offscreen/offscreen.html';

let settingsCache = null;
async function settings() {
  if (!settingsCache) settingsCache = await getSettings();
  return settingsCache;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    settingsCache = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    setupContextMenus();
    refreshAllBadges();
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
  return jobs || {};
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
  const c = classify(url, headers['content-type']);
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
      for (const k of ['size', 'mime', 'width', 'height', 'duration', 'poster', 'referer']) {
        if (info[k] && !existing[k]) existing[k] = info[k];
      }
      if (!existing.sources.includes(info.source)) existing.sources.push(info.source);
      if (existing.kind === 'file' && existing.variants[0]) Object.assign(existing.variants[0], variantForFile(existing));
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
      title: tab.title || hostOf(tab.url),
      sources: [info.source],
      detectedAt: Date.now(),
      status: info.kind === 'file' ? 'ready' : 'probing',
      variants: [],
      live: false,
      encrypted: false,
      drm: false,
      error: ''
    };
    if (item.kind === 'file') item.variants = [variantForFile(item)];
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
    kind: 'file',
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
        ext: 'm4a', audioOnly: true, label: `Audio only · ${a.name}`
      });
    });
    // Variants that need a separate audio rendition can't be merged without a muxer: flag them.
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
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.title) {
    mutateTab(tabId, (st) => {
      st.pageTitle = change.title;
      // Pages often set their final title after the video loads: keep item titles in sync.
      for (const it of Object.values(st.items)) if (!it.customTitle) it.title = change.title;
    });
  }
});

async function updateBadge(tabId) {
  const s = await settings();
  const state = await readTab(tabId);
  const count = Object.values(state.items).filter((i) => i.status !== 'error').length;
  const text = s.showBadge && count ? String(count) : '';
  await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#0f766e' }).catch(() => {});
  await chrome.action.setTitle({ tabId, title: count ? `VidSnag – ${count} media found` : 'VidSnag' }).catch(() => {});
}
async function refreshAllBadges() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) if (t.id >= 0) updateBadge(t.id);
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
async function startDownload(tabId, mediaId, variantId) {
  const state = await readTab(tabId);
  const item = state.items[mediaId];
  if (!item) throw new Error('This media is no longer available. Reload the page and try again.');
  if (item.drm) throw new Error('This stream is DRM-protected and cannot be downloaded.');
  const s = await settings();
  const variant = item.variants.find((v) => v.id === variantId) || pickVariant(item.variants, s);
  if (!variant) throw new Error('No downloadable quality found for this media.');
  const source = {
    kind: variant.kind,
    url: variant.url,
    repId: variant.repId || null,
    referer: item.referer || item.pageUrl,
    pageUrl: item.pageUrl,
    title: item.title || state.pageTitle || hostOf(item.pageUrl),
    ext: variant.ext,
    res: variant.audioOnly ? 'audio' : resolutionLabel(variant.height || item.height, variant.width || item.width),
    label: variant.label,
    size: variant.size || item.size || null,
    live: !!item.live,
    audioOnly: !!variant.audioOnly
  };
  return startFromSource(source, tabId);
}

async function startFromSource(source, tabId = TAB_NONE) {
  const s = await settings();
  const baseName = buildFilename(s.filenameTemplate, {
    title: source.title, host: hostOf(source.pageUrl), res: source.res, id: hashId(source.url)
  });
  const folder = sanitizeFolder(s.subfolder);
  const job = {
    id: `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    tabId,
    source,
    title: source.title,
    baseName,
    folder,
    filename: '',
    label: source.label,
    kind: source.kind,
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
        let activeStreams = all.filter((j) => j.kind !== 'file' && ['starting', 'downloading', 'finalizing'].includes(j.status)).length;
        const out = [];
        for (const job of all.filter((j) => j.status === 'queued')) {
          if (job.kind !== 'file') {
            if (activeStreams >= MAX_PARALLEL_STREAM_JOBS) continue;
            activeStreams++;
          }
          job.status = 'starting';
          out.push({ ...job });
        }
        return out;
      });
      // Not awaited: a "Save as" dialog must not block the rest of the queue.
      for (const job of claimed) (job.kind === 'file' ? runFileJob(job) : runStreamJob(job)).catch((e) => failJob(job.id, String(e)));
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
  const ruleId = await addHeaderRule(job.source.url, job.source.referer);
  await patchJob(job.id, { ruleIds: ruleId ? [ruleId] : [] });
  const filename = fullPath(job, job.source.ext || extFromUrl(job.source.url) || 'mp4');
  try {
    const downloadId = await chrome.downloads.download({
      url: job.source.url, filename, saveAs: s.saveAs, conflictAction: 'uniquify'
    });
    const updated = await patchJob(job.id, { status: 'downloading', downloadId, filename });
    if (!updated || updated.status === 'cancelled') { chrome.downloads.cancel(downloadId).catch(() => {}); return; }
    ensureProgressPolling();
    await syncDownloadState(downloadId); // it may already have finished before we stored the id
  } catch (e) {
    await failJob(job.id, e.message || String(e));
  }
}

async function runStreamJob(job) {
  const s = await settings();
  const ruleId = await addHeaderRule(job.source.url, job.source.referer);
  await patchJob(job.id, { status: 'downloading', ruleIds: ruleId ? [ruleId] : [] });
  try {
    await ensureOffscreen();
    await sendToOffscreen({
      type: 'start',
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
  if (job.kind !== 'file') await chrome.runtime.sendMessage({ target: 'offscreen', type: 'cancel', jobId: id }).catch(() => {});
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
  const active = Object.values(jobs).filter((j) => j.kind === 'file' && j.status === 'downloading' && j.downloadId != null);
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
      reasons: ['BLOBS'],
      justification: 'Download stream segments and assemble them into a single video file.'
    });
  });
}
function maybeCloseOffscreen() {
  return offscreenOp(async () => {
    const jobs = Object.values(await readJobs());
    const busy = jobs.some((j) => j.kind !== 'file' && ['queued', 'starting', 'downloading', 'finalizing'].includes(j.status));
    if (!busy && (await hasOffscreen())) await chrome.offscreen.closeDocument().catch(() => {});
  });
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
      const downloadId = await chrome.downloads.download({ url: msg.url, filename, saveAs: s.saveAs, conflictAction: 'uniquify' });
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
async function buildContextMenus() {
  const s = await settings();
  await chrome.contextMenus.removeAll();
  if (!s.contextMenu) return;
  chrome.contextMenus.create({ id: 'vidsnag-media', title: 'Download this media with VidSnag', contexts: ['video', 'audio'] });
  chrome.contextMenus.create({
    id: 'vidsnag-link', title: 'Download linked media with VidSnag', contexts: ['link'],
    targetUrlPatterns: ['mp4', 'webm', 'mkv', 'mov', 'm4v', 'mp3', 'm4a', 'ogg', 'm3u8', 'mpd'].flatMap((e) => [`*://*/*.${e}`, `*://*/*.${e}?*`])
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.srcUrl || info.linkUrl;
  if (!url || !tab) return;
  if (url.startsWith('blob:')) {
    notify('Streaming player', 'This player streams the video in pieces. Play it for a few seconds, then open the VidSnag popup to pick the detected stream.');
    return;
  }
  const c = classify(url, '') || { kind: 'file', ext: extFromUrl(url) || 'mp4' };
  if (c.kind === 'segment') return;
  await addMedia(tab.id, { url, kind: c.kind, ext: c.ext, audioOnly: !!c.audio, source: 'menu' });
  const id = hashId(normalizeMediaUrl(url));
  if (c.kind !== 'file') await waitForProbe(tab.id, id);
  try { await startDownload(tab.id, id, null); } catch (e) { notify('Cannot download', e.message); }
});

async function waitForProbe(tabId, id, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const st = await readTab(tabId);
    if (!st.items[id] || st.items[id].status !== 'probing') return;
    await new Promise((r) => setTimeout(r, 300));
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'download-best') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const st = await readTab(tab.id);
  const items = Object.values(st.items).filter((i) => i.status === 'ready');
  if (!items.length) { notify('Nothing to download', 'VidSnag has not detected any media on this page yet.'); return; }
  const score = (i) => (i.kind !== 'file' ? 1e12 : 0) + (i.height || 0) * 1e6 + (i.size || 0) / 1e3;
  const best = items.sort((a, b) => score(b) - score(a))[0];
  try { await startDownload(tab.id, best.id, null); } catch (e) { notify('Cannot download', e.message); }
});

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
      const s = await settings();
      if (!s.detectDomMedia) return null;
      if (msg.thumb && sender.frameId === 0) {
        await mutateTab(tabId, (st) => { st.thumb = msg.thumb; });
      }
      for (const m of msg.items || []) {
        const c = classify(m.url, m.mime) || { kind: 'file', ext: extFromUrl(m.url) || (m.tag === 'audio' ? 'mp3' : 'mp4'), audio: m.tag === 'audio' };
        if (c.kind === 'segment') continue;
        await addMedia(tabId, {
          url: m.url, kind: c.kind, ext: c.ext, audioOnly: m.tag === 'audio' || !!c.audio, mime: m.mime || '',
          width: m.width, height: m.height, duration: m.duration, poster: m.poster, source: 'dom',
          referer: sender.url || null
        });
      }
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
      return startDownload(msg.tabId, msg.mediaId, msg.variantId);
    case 'redownload':
      return startFromSource(msg.source);
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
});

chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
  pruneHistory();
});

// Jobs that were mid-flight when the browser/worker died can't resume: mark them failed,
// drop header rules that no live job owns, and restart the queue.
(async () => {
  const offscreenAlive = await hasOffscreen();
  const staleBefore = Date.now() - 15000; // active jobs update every few hundred ms
  for (const j of Object.values(await readJobs())) {
    if (TERMINAL.includes(j.status) || j.updatedAt > staleBefore) continue;
    if (j.kind === 'file') {
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
