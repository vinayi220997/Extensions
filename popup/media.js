// Media view: everything detected on the current tab.
import { h, icon, iconButton } from '../ui/dom.js';
import { showMenu } from '../ui/menu.js';
import { formDialog, infoDialog } from '../ui/dialog.js';
import { formatBytes, formatDuration, resolutionLabel, hostOf, buildFilename } from '../lib/util.js';
import { pickVariant, saveSettings, saveSiteRules, SORT_OPTIONS } from '../lib/settings.js';
import { ctx, send, toast, copyText, fileNameOf, store, onTabChange, siteAction, siteRuleFor, ACTIVE } from './ctx.js';
import { setFooter } from './app.js';
import { saveMediaDialog } from './library.js';

const $ = (id) => document.getElementById(id);
const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'video', label: 'Video', test: (i) => !isAudio(i) },
  { id: 'audio', label: 'Audio', test: (i) => isAudio(i) },
  { id: 'stream', label: 'Streams', test: (i) => i.kind === 'hls' || i.kind === 'dash' },
  { id: 'file', label: 'Files', test: (i) => i.kind === 'file' || i.kind === 'blob' }
];

let items = [];
let pageState = {};
let filter = store('mediaFilter') || 'all';
let query = '';
const chosen = new Map(); // mediaId → variantId picked in the quality dropdown
let signature = '';
let resolveReady;
export const ready = new Promise((r) => { resolveReady = r; });

const isAudio = (i) => !!i.audioOnly || (i.variants?.length > 0 && i.variants.every((v) => v.audioOnly));
export const count = () => items.length;

export function init() {
  $('btnRefreshList').append(icon('refresh'));
  $('btnMediaMore').append(icon('more'));
  $('btnRefreshList').addEventListener('click', rescan);
  $('btnViewMode').addEventListener('click', () => saveSettings({ viewMode: ctx.settings.viewMode === 'grid' ? 'list' : 'grid' }));
  $('btnMediaMore').addEventListener('click', moreMenu);
  $('mediaSearch').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); render(true); });
  $('rescan').addEventListener('click', rescan);
  $('reloadPage').addEventListener('click', reloadPage);
  const sortSel = $('mediaSort');
  sortSel.replaceChildren(...SORT_OPTIONS.map(([v, l]) => h('option', { value: v, text: l })));
  sortSel.value = ctx.settings.sortBy;
  sortSel.addEventListener('change', () => saveSettings({ sortBy: sortSel.value }));
  onTabChange(() => { chosen.clear(); load(); });
  updateViewButton();
}

export function show() { render(true); }
export function onSettings() { $('mediaSort').value = ctx.settings.sortBy; updateViewButton(); render(true); }

export function onStorage(changes, area) {
  if (area === 'session' && ctx.tab && changes[`tab:${ctx.tab.id}`]) {
    setState(changes[`tab:${ctx.tab.id}`].newValue || {});
    render();
  }
  if (area === 'session' && changes.jobs) onJobs();
}

// Jobs changed: re-render when a media item's download status changes, otherwise just move the
// progress rings/labels in place (cheap, keeps hover previews and focus intact).
export function onJobs() {
  if (!items.length) return;
  const sig = items.map((i) => statusOf(i)).join();
  if (sig !== jobSignature) { jobSignature = sig; render(true); return; }
  for (const el of document.querySelectorAll('#mediaList [data-progress-for]')) {
    const item = items.find((i) => i.id === el.dataset.progressFor);
    const job = item && jobFor(item);
    if (job) updateProgressEl(el, job);
  }
  for (const el of document.querySelectorAll('#mediaList [data-job-for]')) {
    const job = (ctx.jobs || []).find((j) => j.id === el.dataset.jobFor);
    if (job && ACTIVE.includes(job.status)) updateProgressEl(el, job); else { render(true); return; }
  }
}
let jobSignature = '';

function updateViewButton() {
  const grid = ctx.settings?.viewMode === 'grid';
  const b = $('btnViewMode');
  b.replaceChildren(icon(grid ? 'list' : 'grid'));
  b.title = grid ? 'List view' : 'Grid view';
  b.setAttribute('aria-label', b.title);
  $('mediaList').classList.toggle('grid', grid);
}

function setState(st) {
  pageState = st || {};
  items = Object.values(pageState.items || {}).sort((a, b) => a.detectedAt - b.detectedAt);
}

async function load() {
  const supported = ctx.tab && /^https?:/.test(ctx.tab.url || '');
  $('mediaUnsupported').hidden = !!supported;
  if (!supported) { setState({}); render(true); resolveReady(); return; }
  try {
    setState(await send({ type: 'get-tab', tabId: ctx.tab.id }).then((st) => ({ ...st, items: Object.fromEntries(st.items.map((i) => [i.id, i])) })));
  } catch { setState({}); }
  render(true);
  resolveReady();
}

async function rescan() {
  if (!ctx.tab) return;
  await send({ type: 'rescan', tabId: ctx.tab.id }).catch(() => {});
  toast('Scanning the page…');
  setTimeout(load, 900);
}
async function reloadPage() {
  if (!ctx.tab) return;
  await send({ type: 'reload-tab', tabId: ctx.tab.id });
  toast('Reloading the page — play the video once it loads');
}

function moreMenu() {
  const host = hostOf(ctx.tab?.url);
  showMenu($('btnMediaMore'), [
    { label: 'Refresh list', icon: 'refresh', onClick: rescan },
    { label: 'Refresh page', icon: 'reload', onClick: reloadPage },
    { label: 'Clear list', icon: 'trash', disabled: !items.length, onClick: () => send({ type: 'clear-tab', tabId: ctx.tab.id }).then(() => toast('List cleared')) },
    'sep',
    { label: 'Save this page to list…', icon: 'bookmark', onClick: () => document.getElementById('btnSavePage').click() },
    { label: ctx.settings.viewMode === 'grid' ? 'List view' : 'Grid view', icon: ctx.settings.viewMode === 'grid' ? 'list' : 'grid', onClick: () => $('btnViewMode').click() },
    host ? { label: `Smart naming for ${host}…`, icon: 'wand', onClick: () => smartNamingDialog(items[0] || null) } : null
  ]);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderFilters() {
  const box = $('mediaFilters');
  box.replaceChildren(...FILTERS.map((f) => {
    const n = items.filter(f.test).length;
    const b = h('button', { class: `chip-btn${filter === f.id ? ' active' : ''}`, 'aria-pressed': String(filter === f.id), disabled: f.id !== 'all' && !n && filter !== f.id },
      f.label, f.id === 'all' ? null : h('b', { text: String(n) }));
    b.addEventListener('click', () => { filter = f.id; store('mediaFilter', filter); render(true); });
    return b;
  }));
}

function renderNotices() {
  const box = $('notices');
  const n = pageState.notices || {};
  const hasStream = items.some((i) => i.kind === 'hls' || i.kind === 'dash');
  const out = [];
  if (n.drm) {
    out.push(h('div', { class: 'notice drm' }, icon('lock'),
      h('span', { text: 'This page plays DRM-protected video. Protected videos can’t be downloaded — VidSnag never bypasses copy protection.' })));
  }
  if (n.mse && !hasStream && !n.drm) {
    out.push(h('div', { class: 'notice' }, icon('info'),
      h('span', { text: 'This page uses a streaming player. Play the video for a few seconds so VidSnag can catch its stream. If nothing appears, the site uses a protected or unsupported delivery method.' })));
  }
  box.replaceChildren(...out);
}

function visibleItems() {
  const f = FILTERS.find((x) => x.id === filter) || FILTERS[0];
  const list = items.filter((i) => f.test(i) && (!query || `${i.customTitle || i.title} ${i.url} ${i.kind} ${i.ext}`.toLowerCase().includes(query)));
  return sortItems(list, ctx.settings?.sortBy || 'added-asc');
}

// ---------------------------------------------------------------------------
// Media info: size (exact or estimated), quality, download status — shared by sort + cards
// ---------------------------------------------------------------------------
export function sizeInfo(item, variant = selectedVariant(item)) {
  const exact = variant?.size || ((item.kind === 'file' || item.kind === 'blob') ? item.size : null);
  if (exact) return { bytes: exact, estimated: false };
  const bw = variant?.bandwidth || 0;
  if (bw && item.duration && !item.live) return { bytes: Math.round((bw * item.duration) / 8), estimated: true };
  return { bytes: 0, estimated: false };
}
function qualityOf(item) {
  const v = selectedVariant(item);
  const best = Math.max(0, ...item.variants.filter((x) => !x.audioOnly).map((x) => Math.min(x.height || 0, x.width || x.height || 0)));
  return (best || Math.min(item.height || 0, item.width || item.height || 0)) * 1e6 + (v?.bandwidth || 0) / 1e3;
}
export function jobFor(item) {
  let best = null;
  for (const j of ctx.jobs || []) {
    if (j.tabId !== ctx.tab?.id) continue;
    if (j.mediaId !== item.id && !item.variants.some((v) => v.url === j.source?.url)) continue;
    if (!best || j.createdAt > best.createdAt) best = j;
  }
  return best;
}
// 'active' | 'paused' | 'done' | 'error' | 'none'
export function statusOf(item) {
  const j = jobFor(item);
  if (!j) return 'none';
  if (j.status === 'paused') return 'paused';
  if (ACTIVE.includes(j.status)) return 'active';
  return j.status === 'done' ? 'done' : j.status === 'error' ? 'error' : 'none';
}
const STATUS_RANK = { active: 0, paused: 1, error: 2, none: 3, done: 4 };
const nameOf = (i) => (i.customTitle || i.title || '').toLocaleLowerCase();

function sortItems(list, by) {
  const [field, dir] = by.split('-');
  const sign = dir === 'desc' ? -1 : 1;
  const key = {
    added: (i) => i.detectedAt,
    duration: (i) => (i.live ? Infinity : i.duration || 0),
    size: (i) => sizeInfo(i).bytes,
    quality: (i) => qualityOf(i)
  }[field];
  const tie = (a, b) => a.detectedAt - b.detectedAt;
  return [...list].sort((a, b) => {
    if (field === 'name') return sign * nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }) || tie(a, b);
    if (field === 'site') return hostOf(a.url).localeCompare(hostOf(b.url)) || nameOf(a).localeCompare(nameOf(b)) || tie(a, b);
    if (field === 'status') return STATUS_RANK[statusOf(a)] - STATUS_RANK[statusOf(b)] || tie(a, b);
    const ka = key(a), kb = key(b);
    // Unknown values (0) always go last, whatever the direction.
    if (!ka && kb) return 1;
    if (ka && !kb) return -1;
    return sign * (ka - kb) || tie(a, b);
  });
}

function codecLabel(codecs) {
  const c = (codecs || '').toLowerCase();
  const out = [];
  if (/avc1|avc3/.test(c)) out.push('H.264'); else if (/hvc1|hev1/.test(c)) out.push('HEVC'); else if (/vp0?9/.test(c)) out.push('VP9'); else if (/av01/.test(c)) out.push('AV1');
  if (/mp4a/.test(c)) out.push('AAC'); else if (/opus/.test(c)) out.push('Opus'); else if (/ac-3|ec-3/.test(c)) out.push('Dolby');
  return out.join('/');
}

// Measure duration/resolution of plain files the page didn't describe (2 at a time, metadata only).
const probing = new Set();
function probeMissingMeta() {
  if (!ctx.tab) return;
  const todo = items.filter((i) => i.kind === 'file' && !i.duration && !i.metaProbed && !probing.has(i.id) && /^https?:/.test(i.url));
  for (const item of todo) {
    if (probing.size >= 2) break;
    probing.add(item.id);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    let done = false;
    const finish = (meta) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      send({ type: 'set-media-meta', tabId: ctx.tab.id, mediaId: item.id, ...meta }).catch(() => {}).finally(() => { probing.delete(item.id); probeMissingMeta(); });
    };
    const timer = setTimeout(() => finish({}), 10000);
    v.addEventListener('loadedmetadata', () => finish({ duration: v.duration, width: v.videoWidth, height: v.videoHeight }));
    v.addEventListener('error', () => finish({}));
    v.src = item.url;
  }
}

export function render(force = false) {
  $('mediaCount').textContent = items.length || '';
  const visible = visibleItems();
  const sig = JSON.stringify([filter, query, ctx.compact, ctx.settings?.viewMode, ctx.settings?.previewMode, ctx.settings?.sortBy, ctx.settings?.defaultAction, ctx.siteRules, pageState.thumb, pageState.notices,
    items.map((i) => [i.id, i.status, i.title, i.customTitle, i.size, i.height, i.duration, i.variants.length, i.poster])]);
  if (!force && sig === signature) return;
  const list = $('mediaList');
  // Don't rebuild while the user has a quality dropdown open.
  if (!force && list.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
  signature = sig;
  jobSignature = items.map((i) => statusOf(i)).join();
  renderFilters();
  renderNotices();
  list.classList.toggle('mini', ctx.compact);
  list.replaceChildren(...visible.map(ctx.compact ? miniCard : mediaCard), ...(ctx.compact ? otherJobRows(visible) : []));
  probeMissingMeta();
  const supported = ctx.tab && /^https?:/.test(ctx.tab.url || '');
  $('mediaEmpty').hidden = !supported || items.length > 0;
  $('mediaNoMatch').hidden = !items.length || visible.length > 0;
  $('mediaFilters').hidden = !items.length;
  if (ctx.view === 'media') {
    setFooter(ctx.tab?.url ? hostOf(ctx.tab.url) : '', items.length ? 'Clear list' : '', () => send({ type: 'clear-tab', tabId: ctx.tab.id }));
  }
}

function selectedVariant(item) {
  const id = chosen.get(item.id);
  return item.variants.find((v) => v.id === id) || pickVariant(item.variants, ctx.settings) || item.variants[0] || null;
}

function kindChip(item) {
  if (item.kind === 'hls') return 'HLS';
  if (item.kind === 'dash') return 'DASH';
  if (item.kind === 'blob') return 'BLOB';
  return (item.ext || 'file').toUpperCase();
}

function thumbFor(item, variant) {
  const audio = isAudio(item) || variant?.audioOnly;
  const fallback = () => icon(audio ? 'music' : item.kind === 'hls' || item.kind === 'dash' ? 'stream' : 'play');
  const box = h('div', { class: 'thumb' });
  const mode = ctx.settings.previewMode;
  const poster = item.poster || (!audio && pageState.thumb) || '';
  if (mode !== 'none' && poster) {
    const img = h('img', { src: poster, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(fallback()));
    box.append(img);
  } else box.append(fallback());
  // Short video preview on hover for directly playable files.
  if (mode === 'video' && !audio && item.kind === 'file' && /^https?:/.test(item.url)) {
    let v = null;
    box.addEventListener('mouseenter', () => {
      if (v) { v.play().catch(() => {}); return; }
      v = h('video', { src: item.url, muted: true, playsinline: true, preload: 'metadata' });
      v.muted = true;
      v.addEventListener('loadedmetadata', () => { if (isFinite(v.duration) && v.duration > 8) v.currentTime = Math.min(v.duration * 0.1, 30); v.play().catch(() => {}); });
      v.addEventListener('error', () => { v.remove(); v = null; });
      box.append(v);
    });
    box.addEventListener('mouseleave', () => v?.pause());
  }
  if (item.duration && !item.live) box.append(h('span', { class: 'dur', text: formatDuration(item.duration) }));
  return box;
}

function mediaCard(item) {
  const variant = selectedVariant(item);
  const audio = isAudio(item) || variant?.audioOnly;
  const res = !audio && variant ? resolutionLabel(variant.height || item.height, variant.width || item.width) : '';
  const si = sizeInfo(item, variant);
  const codecs = codecLabel(variant?.codecs);
  const st = statusOf(item);
  const meta = h('div', { class: 'meta' },
    h('span', { class: 'chip kind', text: kindChip(item) }),
    item.live ? h('span', { class: 'chip live', text: 'Live' }) : null,
    item.encrypted ? h('span', { class: 'chip', text: 'AES', title: 'Encrypted with a clear key – VidSnag decrypts it' }) : null,
    item.drm || item.status === 'drm' ? h('span', { class: 'chip warn', text: 'DRM' }) : null,
    res ? h('span', { text: res }) : null,
    audio ? h('span', { text: 'Audio' }) : null,
    durationSpan(item),
    si.bytes ? h('span', { class: 'm-size', text: `${si.estimated ? '~' : ''}${formatBytes(si.bytes)}`, title: si.estimated ? 'Estimated from the stream bitrate' : 'File size' }) : null,
    codecs ? h('span', { text: codecs }) : null,
    statusChip(item, st),
    h('span', { class: 'ellipsis', text: item.kind === 'file' ? fileNameOf(item.url) : item.kind === 'blob' ? 'in-page video' : hostOf(item.url), title: item.url, style: { maxWidth: '140px' } }));

  const title = item.customTitle || item.title || 'Untitled media';
  const card = h('article', { class: 'card', 'data-id': item.id },
    h('div', { class: 'card-head' }, thumbFor(item, variant),
      h('div', { class: 'card-body' }, h('div', { class: 'title', text: title, title }), meta)));

  const removeBtn = () => iconButton('close', 'Remove from list', () => send({ type: 'remove-media', tabId: ctx.tab.id, mediaId: item.id }));
  if (item.status === 'probing') {
    card.append(h('div', { class: 'note info' }, h('span', { text: 'Analyzing stream…' })));
    return card;
  }
  if (item.status === 'error') {
    card.append(h('div', { class: 'note error' }, icon('alert'), h('span', { text: item.error || 'Could not read this stream' })));
    card.append(h('div', { class: 'actions' }, h('span', { class: 'spacer' }), iconButton('copy', 'Copy link', () => copyText(item.url)), removeBtn()));
    return card;
  }
  if (item.drm || item.status === 'drm') {
    card.append(h('div', { class: 'note' }, icon('lock'), h('span', { text: 'DRM-protected — this video can be played but not downloaded.' })));
    card.append(h('div', { class: 'actions' }, h('span', { class: 'spacer' }), removeBtn()));
    return card;
  }

  const select = h('select', { 'aria-label': 'Quality', disabled: item.variants.length < 2 },
    item.variants.map((v) => h('option', { value: v.id, selected: variant && v.id === variant.id, text: v.label })));
  select.addEventListener('change', () => { chosen.set(item.id, select.value); render(true); });

  const action = effectiveAction(item);
  const primaryLabel = action === 'audio' ? 'Audio' : action === 'copy' ? 'Copy link' : 'Download';
  const primary = h('button', { class: 'btn primary', title: action === 'audio' ? 'Download audio (default on this site)' : action === 'copy' ? 'Copy link (default on this site)' : 'Download' },
    icon(action === 'audio' ? 'music' : action === 'copy' ? 'copy' : 'download'), primaryLabel);
  primary.addEventListener('click', () => runPrimary(item, select.value, primary));
  const more = iconButton('more', 'More actions', () => cardMenu(item, select, more));
  more.setAttribute('aria-haspopup', 'menu');
  card.append(h('div', { class: 'actions' }, select, primary, more));

  if (variant?.separateAudio) {
    const merging = ctx.settings.mergeAudio;
    card.append(h('div', { class: merging ? 'note info' : 'note' }, icon(merging ? 'check' : 'alert'),
      h('span', { text: merging ? 'Video and audio come as separate tracks — VidSnag merges them into one MP4.' : 'This quality has no sound (audio is a separate track). Turn on “Merge audio” in Settings or download audio separately.' })));
  }
  if (item.kind === 'blob') {
    card.append(h('div', { class: 'note info' }, icon('info'), h('span', { text: 'In-page video: saved straight from the page into your Downloads folder.' })));
  }
  return card;
}

function durationSpan(item) {
  if (item.live) return h('span', { class: 'm-dur', text: 'Live' });
  return item.duration
    ? h('span', { class: 'm-dur', text: formatDuration(item.duration), title: 'Duration' })
    : h('span', { class: 'm-dur muted', text: '–:––', title: 'Duration not known yet' });
}

function statusChip(item, st = statusOf(item)) {
  const job = jobFor(item);
  if (st === 'active') return h('span', { class: 'chip kind', 'data-progress-for': item.id, 'data-label': '1', text: job?.progress ? `${Math.round(job.progress * 100)}%` : 'Downloading' });
  if (st === 'paused') return h('span', { class: 'chip warn', text: 'Paused' });
  if (st === 'done') return h('span', { class: 'chip good', text: 'Downloaded' });
  if (st === 'error') return h('span', { class: 'chip bad', text: 'Failed', title: job?.error || '' });
  return null;
}

// Main-button action for this item: per-site rule › global default, falling back to Download when
// audio-only isn't possible for this media.
function effectiveAction(item) {
  const a = siteAction(hostOf(item.pageUrl));
  return a === 'audio' && !audioAvailable(item) ? 'download' : a;
}

function runPrimary(item, variantId, btn) {
  const action = effectiveAction(item);
  if (action === 'copy') copyText(item.variants.find((v) => v.id === variantId)?.url || item.url);
  else download(item, { variantId, output: action === 'audio' ? 'audio' : 'auto' }, btn);
}

async function pauseResume(job) {
  try {
    await send({ type: job.status === 'paused' ? 'resume' : 'pause', jobId: job.id });
  } catch (e) { toast(e.message, true); }
}

// ---------------------------------------------------------------------------
// Mini (compact) layout: round thumbnail with a progress ring, essentials only.
// The ring turns into a square with a pause glyph while the download is paused.
// ---------------------------------------------------------------------------
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function ring(job) {
  const paused = job?.status === 'paused';
  const svg = svgEl('svg', { viewBox: '0 0 48 48', class: `ring${paused ? ' paused' : ''}`, 'aria-hidden': 'true' });
  const shape = paused
    ? (cls) => svgEl('rect', { x: 3, y: 3, width: 42, height: 42, rx: 7, class: cls, pathLength: 100 })
    : (cls) => svgEl('circle', { cx: 24, cy: 24, r: 21, class: cls, pathLength: 100 });
  svg.append(shape('track'), shape('bar'));
  if (paused) svg.append(svgEl('rect', { x: 18, y: 16, width: 4, height: 16, rx: 1, class: 'glyph' }), svgEl('rect', { x: 26, y: 16, width: 4, height: 16, rx: 1, class: 'glyph' }));
  return svg;
}
function updateProgressEl(el, job) {
  const pct = Math.max(0, Math.min(100, Math.round((job.progress || 0) * 100)));
  if (el.dataset.label) { el.textContent = job.status === 'paused' ? `Paused ${pct}%` : `${pct}%`; return; }
  const bar = el.querySelector('.bar');
  if (bar) bar.style.strokeDashoffset = String(100 - pct);
  el.classList.toggle('indeterminate', ['queued', 'starting', 'finalizing'].includes(job.status) || (!!job.live && job.status === 'downloading'));
  const txt = el.closest('.mini-card')?.querySelector('.mini-progress');
  if (txt) txt.textContent = progressText(job);
}
function progressText(job) {
  const pct = Math.round((job.progress || 0) * 100);
  if (job.status === 'paused') return `Paused · ${pct}%`;
  if (job.status === 'queued' || job.status === 'starting') return 'Starting…';
  if (job.status === 'finalizing') return 'Saving…';
  if (job.live) return job.note || 'Recording…';
  return `${pct}% · ${formatBytes(job.bytes) || '0 B'}`;
}

function miniThumb(item, job) {
  const box = thumbFor(item, selectedVariant(item));
  box.classList.add('mini-thumb');
  box.querySelector('.dur')?.remove();
  const st = job ? (job.status === 'paused' ? 'paused' : ACTIVE.includes(job.status) ? 'active' : job.status) : 'none';
  const wrap = h('div', { class: `mini-frame st-${st}`, 'data-progress-for': item.id }, box);
  if (st === 'active' || st === 'paused') {
    wrap.append(ring(job));
    updateProgressEl(wrap, job);
  } else if (st === 'done') wrap.append(h('span', { class: 'mini-badge ok', text: '✓', title: 'Downloaded' }));
  else if (st === 'error') wrap.append(h('span', { class: 'mini-badge bad', text: '!', title: job.error || 'Failed' }));
  return wrap;
}

function miniCard(item) {
  const job = jobFor(item);
  const variant = selectedVariant(item);
  const si = sizeInfo(item, variant);
  const res = !isAudio(item) && variant ? resolutionLabel(variant.height || item.height, variant.width || item.width) : (isAudio(item) ? 'Audio' : '');
  const title = item.customTitle || item.title || 'Untitled media';
  const blocked = item.drm || item.status === 'drm' || item.status === 'error' || item.status === 'probing';
  const action = effectiveAction(item);
  const active = job && ACTIVE.includes(job.status);
  let btn;
  if (active && job.status !== 'paused' && !job.live && job.engine !== 'page' && ['downloading'].includes(job.status)) {
    btn = iconButton('pause', 'Pause download', () => pauseResume(job));
  } else if (job?.status === 'paused') {
    btn = iconButton('resume', 'Resume download', () => pauseResume(job));
  } else {
    btn = h('button', { class: 'icon-btn mini-go', title: action === 'audio' ? 'Download audio' : action === 'copy' ? 'Copy link' : 'Download', 'aria-label': action === 'audio' ? 'Download audio' : action === 'copy' ? 'Copy link' : 'Download', disabled: blocked },
      icon(action === 'audio' ? 'music' : action === 'copy' ? 'copy' : 'download'));
    btn.addEventListener('click', () => runPrimary(item, variant?.id, btn));
  }
  const more = iconButton('more', 'More actions', () => {
    const sel = { value: variant?.id };
    cardMenu(item, sel, more);
  });
  const info = [
    item.live ? 'Live' : item.duration ? formatDuration(item.duration) : '–:––',
    si.bytes ? `${si.estimated ? '~' : ''}${formatBytes(si.bytes)}` : '',
    res,
    kindChip(item)
  ].filter(Boolean).join(' · ');
  return h('article', { class: `mini-card${blocked ? ' blocked' : ''}`, 'data-id': item.id },
    miniThumb(item, job),
    h('div', { class: 'mini-body' },
      h('div', { class: 'mini-title ellipsis', text: title, title }),
      h('div', { class: 'mini-info ellipsis', text: blocked ? (item.status === 'probing' ? 'Analyzing…' : item.drm || item.status === 'drm' ? 'DRM-protected — can’t download' : item.error || 'Unavailable') : info }),
      job && ACTIVE.includes(job.status) ? h('div', { class: 'mini-progress', text: progressText(job) }) : null),
    btn, more);
}

// Downloads from this tab that no longer have a card (e.g. list cleared) still show their ring.
function otherJobRows(visible) {
  const shown = new Set(visible.map((i) => i.id));
  return (ctx.jobs || []).filter((j) => ACTIVE.includes(j.status) && !(j.mediaId && shown.has(j.mediaId)) && !visible.some((i) => i.variants.some((v) => v.url === j.source?.url)))
    .slice(0, 5)
    .map((j) => {
      const frame = h('div', { class: `mini-frame st-${j.status === 'paused' ? 'paused' : 'active'}`, 'data-job-for': j.id }, h('div', { class: 'thumb mini-thumb' }, icon(j.source?.audioOnly ? 'music' : 'download')), ring(j));
      updateProgressEl(frame, j);
      return h('article', { class: 'mini-card job-only' }, frame,
        h('div', { class: 'mini-body' }, h('div', { class: 'mini-title ellipsis', text: j.title }), h('div', { class: 'mini-progress', text: progressText(j) })),
        j.status === 'paused' ? iconButton('resume', 'Resume download', () => pauseResume(j))
          : j.status === 'downloading' && !j.live && j.engine !== 'page' ? iconButton('pause', 'Pause download', () => pauseResume(j)) : null);
    });
}

async function download(item, opts, btn) {
  if (btn) btn.disabled = true;
  try {
    await send({ type: 'download', tabId: ctx.tab.id, mediaId: item.id, ...opts });
    toast(item.live ? 'Recording started — stop it from the Downloads tab' : opts.output === 'audio' ? 'Audio download started' : 'Download started');
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (btn) setTimeout(() => { btn.disabled = false; }, 800);
  }
}

// ---------------------------------------------------------------------------
// Card menu + dialogs
// ---------------------------------------------------------------------------
function cardMenu(item, select, anchor) {
  const host = hostOf(item.pageUrl);
  const siteRule = siteRuleFor(host);
  const globalAction = ctx.settings.defaultAction;
  const variant = item.variants.find((v) => v.id === select.value) || selectedVariant(item);
  const canAudio = audioAvailable(item);
  const setAction = async (a) => {
    const rules = { ...ctx.siteRules, actions: { ...ctx.siteRules.actions } };
    if (rules.actions[host] === a) delete rules.actions[host]; else rules.actions[host] = a;
    ctx.siteRules = await saveSiteRules(rules);
    toast(ctx.siteRules.actions[host] ? `On ${host} the main button now ${a === 'audio' ? 'downloads audio' : 'copies the link'}` : `On ${host} the main button downloads again`);
    render(true);
  };
  const setGlobal = async (a) => {
    const next = globalAction === a ? 'download' : a;
    await saveSettings({ defaultAction: next });
    toast(next === 'download' ? 'Main button downloads on all websites again' : `Main button now ${next === 'audio' ? 'downloads audio' : 'copies the link'} on all websites`);
  };
  const job = jobFor(item);
  showMenu(anchor, [
    job && job.status === 'downloading' && !job.live && job.engine !== 'page' ? { label: 'Pause download', icon: 'pause', onClick: () => pauseResume(job) } : null,
    job && job.status === 'paused' ? { label: 'Resume download', icon: 'resume', onClick: () => pauseResume(job) } : null,
    { label: 'Download', icon: 'download', onClick: () => download(item, { variantId: select.value, output: 'auto' }) },
    { label: 'Download as…', icon: 'saveas', onClick: () => downloadAsDialog(item, select.value) },
    { label: 'Download audio', icon: 'music', disabled: !canAudio, title: canAudio ? '' : 'No audio-only download for this media', onClick: () => download(item, { variantId: select.value, output: 'audio' }) },
    { label: 'Copy link', icon: 'copy', onClick: () => copyText(variant?.url || item.url) },
    'sep',
    { header: 'Default for the main button' },
    { label: 'Always download audio — all websites', icon: 'music', checked: globalAction === 'audio', onClick: () => setGlobal('audio') },
    { label: 'Always copy link — all websites', icon: 'link', checked: globalAction === 'copy', onClick: () => setGlobal('copy') },
    { label: `Always download audio — only on ${host}`, icon: 'music', checked: siteRule === 'audio', disabled: !host, onClick: () => setAction('audio') },
    { label: `Always copy link — only on ${host}`, icon: 'link', checked: siteRule === 'copy', disabled: !host, onClick: () => setAction('copy') },
    'sep',
    { label: 'Rename…', icon: 'edit', onClick: () => renameDialog(item) },
    { label: 'Smart naming…', icon: 'wand', onClick: () => smartNamingDialog(item) },
    { label: 'Save to list…', icon: 'bookmark', disabled: item.kind === 'blob', title: item.kind === 'blob' ? 'In-page videos can’t be saved; save the page instead' : '', onClick: () => saveMediaDialog(ctx.tab, item, select.value) },
    { label: 'View details', icon: 'info', onClick: () => detailsDialog(item) },
    'sep',
    { label: 'Remove from list', icon: 'trash', danger: true, onClick: () => send({ type: 'remove-media', tabId: ctx.tab.id, mediaId: item.id }) }
  ]);
}

function audioAvailable(item) {
  if (item.kind === 'blob' || item.drm) return false;
  if (item.variants.some((v) => v.audioOnly)) return true;
  if (item.kind === 'hls') return true;
  if (item.kind === 'file') return item.audioOnly || ['mp4', 'm4v', 'mov', 'm4a', '3gp'].includes((item.ext || '').toLowerCase());
  return false;
}

function formatOptions(item, variant) {
  const opts = [];
  const ext = (variant?.ext || item.ext || 'mp4').toLowerCase();
  if (item.kind === 'file' || item.kind === 'blob') {
    opts.push({ value: 'auto', label: `Original (.${ext})` });
  } else if (item.kind === 'hls') {
    opts.push({ value: 'auto', label: variant?.separateAudio && ctx.settings.mergeAudio ? 'MP4 — video + audio merged' : 'MP4 (converted)' });
    if (variant?.separateAudio) opts.push({ value: 'video', label: 'MP4 — video only (no merge)' });
    opts.push({ value: 'ts', label: 'Original MPEG-TS (.ts)' });
  } else if (item.kind === 'dash') {
    opts.push({ value: 'auto', label: variant?.separateAudio && ctx.settings.mergeAudio ? `${ext.toUpperCase()} — video + audio merged` : `Original (.${ext})` });
    if (variant?.separateAudio) opts.push({ value: 'video', label: 'Video only (no merge)' });
  }
  if (audioAvailable(item) && !variant?.audioOnly) opts.push({ value: 'audio', label: 'Audio only (.m4a)' });
  return opts;
}

async function downloadAsDialog(item, variantId) {
  let variant = item.variants.find((v) => v.id === variantId) || selectedVariant(item);
  const suggested = await send({ type: 'preview-filename', tabId: ctx.tab.id, mediaId: item.id, variantId: variant?.id }).catch(() => '');
  const values = await formDialog({
    title: 'Download as',
    okLabel: 'Download',
    fields: [
      { name: 'variantId', label: 'Quality', type: 'select', value: variant?.id, options: item.variants.map((v) => ({ value: v.id, label: v.label })) },
      { name: 'output', label: 'Format', type: 'select', value: 'auto', options: formatOptions(item, variant) },
      { name: 'filename', label: 'File name', value: suggested.replace(/\.[a-z0-9]{2,4}$/i, ''), hint: 'The extension is added automatically.' },
      { name: 'saveAs', label: 'Choose the folder (shows the “Save as” dialog)', type: 'checkbox', value: true }
    ],
    onInput: (v, dlg) => {
      // Format choices depend on the chosen quality (e.g. "video only" exists only for split tracks).
      const nv = item.variants.find((x) => x.id === v.variantId);
      if (nv && nv !== variant) {
        variant = nv;
        const sel = dlg.querySelector('select[name="output"]');
        const cur = sel.value;
        sel.replaceChildren(...formatOptions(item, nv).map((o) => h('option', { value: o.value, text: o.label, selected: o.value === cur })));
      }
    }
  });
  if (!values) return;
  download(item, { variantId: values.variantId, output: values.output, filename: values.filename.trim(), saveAs: values.saveAs });
}

async function renameDialog(item) {
  const v = await formDialog({
    title: 'Rename',
    okLabel: 'Rename',
    fields: [{ name: 'title', label: 'Title (used for the file name)', value: item.customTitle || item.title, required: true }]
  });
  if (!v) return;
  await send({ type: 'rename-media', tabId: ctx.tab.id, mediaId: item.id, title: v.title });
  toast('Renamed');
}

async function smartNamingDialog(item) {
  const host = hostOf(item?.pageUrl || ctx.tab?.url);
  if (!host) return;
  const rule = ctx.siteRules.naming[host] || {};
  const result = h('div', { class: 'muted', style: { fontSize: '.92em' } });
  const res = item ? (resolutionLabel(item.height, item.width) || '720p') : '720p';
  let timer = null;
  const values = await formDialog({
    title: `Smart naming · ${host}`,
    okLabel: 'Save rule',
    body: h('p', { style: { margin: 0, fontSize: '.92em' }, class: 'muted', text: 'Name files from this site with your own pattern. Optionally pick the title from the page with a CSS selector (for example h1 or .video-title).' }),
    fields: [
      { name: 'template', label: 'File name pattern', value: rule.template || ctx.settings.filenameTemplate, hint: 'Tokens: {title} {selector} {res} {host} {date} {time}' },
      { name: 'selector', label: 'Title selector (optional)', value: rule.selector || '', placeholder: 'h1.video-title' },
      { name: 'remove', label: 'Remove the rule for this site', type: 'checkbox', value: false }
    ],
    onInput: (v, dlg) => {
      if (!dlg.querySelector('.sn-result')) { result.classList.add('sn-result'); dlg.querySelector('.body').append(result); }
      clearTimeout(timer);
      timer = setTimeout(async () => {
        let picked = '';
        if (v.selector.trim() && ctx.tab) {
          const r = await send({ type: 'eval-selector', tabId: ctx.tab.id, selector: v.selector.trim() }).catch((e) => ({ ok: false, error: e.message }));
          if (!r?.ok) { result.textContent = r?.error || 'Selector could not be tested.'; return; }
          picked = r.text;
          if (!r.found) { result.textContent = 'No element matches this selector on the current page.'; return; }
        }
        const title = picked || item?.customTitle || item?.title || ctx.tab?.title || 'Video title';
        const name = buildFilename(v.template, { title, selector: picked || title, host, res });
        result.textContent = `Example: ${name}.mp4${picked ? `  ·  selector found “${picked.slice(0, 60)}”` : ''}`;
      }, 250);
    }
  });
  if (!values) return;
  const rules = { ...ctx.siteRules, naming: { ...ctx.siteRules.naming } };
  if (values.remove || (!values.selector.trim() && values.template.trim() === ctx.settings.filenameTemplate)) delete rules.naming[host];
  else rules.naming[host] = { template: values.template.trim(), selector: values.selector.trim() };
  ctx.siteRules = await saveSiteRules(rules);
  toast(rules.naming[host] ? `Naming rule saved for ${host}` : `Naming rule removed for ${host}`);
  if (ctx.tab) send({ type: 'rescan', tabId: ctx.tab.id }).catch(() => {});
}

function detailsDialog(item) {
  const row = (k, v) => (v || v === 0 ? [h('dt', { text: k }), h('dd', { text: String(v) })] : []);
  const kv = h('dl', { class: 'kv' },
    row('Title', item.customTitle || item.title),
    row('Type', `${kindChip(item)}${item.live ? ' · live' : ''}${item.encrypted ? ' · AES-128' : ''}${item.drm ? ' · DRM' : ''}`),
    row('Media URL', item.url),
    row('Page', item.pageUrl),
    row('Referer', item.referer),
    row('MIME type', item.mime),
    row('Size', item.size ? `${formatBytes(item.size)} (${item.size.toLocaleString()} bytes)` : ''),
    row('Resolution', item.width && item.height ? `${item.width} × ${item.height}` : ''),
    row('Duration', item.duration ? formatDuration(item.duration) : ''),
    row('Found by', (item.sources || []).join(', ')),
    row('Detected', new Date(item.detectedAt).toLocaleString()));
  const variants = item.variants.length > 1 ? h('div', {},
    h('div', { style: { fontWeight: 600, margin: '6px 0 4px' }, text: `Qualities (${item.variants.length})` }),
    ...item.variants.map((v) => h('div', { class: 'meta', style: { justifyContent: 'space-between', flexWrap: 'nowrap' } },
      h('span', { class: 'ellipsis', text: `${v.label}${v.codecs ? ` · ${v.codecs}` : ''}`, title: v.url }),
      iconButton('copy', 'Copy this quality’s URL', () => copyText(v.url))))) : null;
  infoDialog('Media details', h('div', {}, kv, variants,
    h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', onclick: () => copyText(item.url) }, icon('copy'), 'Copy URL'),
      h('button', { class: 'btn small', type: 'button', onclick: () => copyText(JSON.stringify(item, null, 2), 'Details copied') }, 'Copy all as JSON'))));
}

export { smartNamingDialog };
