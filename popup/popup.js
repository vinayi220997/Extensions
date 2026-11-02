import { h, icon, iconButton } from '../ui/dom.js';
import { formatBytes, formatDuration, resolutionLabel, hostOf } from '../lib/util.js';
import { getSettings, pickVariant } from '../lib/settings.js';

const $ = (id) => document.getElementById(id);
const ACTIVE = ['queued', 'starting', 'downloading', 'finalizing'];

let tab = null;
let settings = null;
let view = 'media';
let mediaItems = [];
let pageThumb = '';
let jobs = [];
let history = [];
const chosen = new Map(); // mediaId → variantId picked by the user
const signatures = {};

async function send(msg) {
  const res = await chrome.runtime.sendMessage(msg);
  if (!res || !res.ok) throw new Error(res?.error || 'Something went wrong');
  return res.result;
}

let toastTimer = null;
function toast(text, isError = false) {
  const t = $('toast');
  t.textContent = text;
  t.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, isError ? 4000 : 2000);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copied'); } catch { toast('Could not copy the link', true); }
}

// ---------------------------------------------------------------------------
// Media view
// ---------------------------------------------------------------------------
function kindChip(item) {
  if (item.kind === 'hls') return 'HLS';
  if (item.kind === 'dash') return 'DASH';
  return (item.ext || 'file').toUpperCase();
}

function fileNameOf(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop()) || hostOf(url); } catch { return hostOf(url); }
}

function selectedVariant(item) {
  const id = chosen.get(item.id);
  return item.variants.find((v) => v.id === id) || pickVariant(item.variants, settings) || item.variants[0] || null;
}

function mediaCard(item) {
  const variant = selectedVariant(item);
  const isAudio = item.audioOnly || (variant && variant.audioOnly);
  const thumb = h('div', { class: 'thumb' });
  const poster = item.poster || (!isAudio && pageThumb);
  if (poster) {
    const img = h('img', { src: poster, alt: '', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => { img.replaceWith(icon(isAudio ? 'music' : item.kind === 'file' ? 'play' : 'stream')); });
    thumb.append(img);
  } else thumb.append(icon(isAudio ? 'music' : item.kind === 'file' ? 'play' : 'stream'));

  const res = variant ? resolutionLabel(variant.height || item.height, variant.width || item.width) : resolutionLabel(item.height, item.width);
  const size = (variant && variant.size) || (item.kind === 'file' ? item.size : null);
  const meta = h('div', { class: 'meta' },
    h('span', { class: 'chip kind', text: kindChip(item) }),
    item.live ? h('span', { class: 'chip live', text: 'Live' }) : null,
    item.encrypted ? h('span', { class: 'chip', text: 'AES', title: 'Encrypted with a clear key – VidSnag decrypts it' }) : null,
    item.drm ? h('span', { class: 'chip warn', text: 'DRM' }) : null,
    res && !isAudio ? h('span', { text: res }) : null,
    isAudio ? h('span', { text: 'Audio' }) : null,
    item.duration && !item.live ? h('span', { text: formatDuration(item.duration) }) : null,
    size ? h('span', { text: formatBytes(size) }) : null,
    h('span', { class: 'ellipsis', text: item.kind === 'file' ? fileNameOf(item.url) : hostOf(item.url), title: item.url, style: { maxWidth: '130px' } })
  );

  const card = h('article', { class: 'card', 'data-id': item.id },
    h('div', { class: 'card-head' }, thumb,
      h('div', { class: 'card-body' }, h('div', { class: 'title', text: item.title || 'Untitled media', title: item.title }), meta)));

  if (item.status === 'probing') {
    card.append(h('div', { class: 'note', style: { color: 'var(--muted)' } }, 'Analyzing stream…'));
    return card;
  }
  if (item.status === 'error') {
    card.append(h('div', { class: 'note error' }, icon('alert'), h('span', { text: item.error || 'Could not read this stream' })));
    card.append(h('div', { class: 'actions' }, h('span', { class: 'spacer' }), iconButton('copy', 'Copy link', () => copy(item.url)), iconButton('close', 'Remove from list', () => removeMedia(item.id))));
    return card;
  }
  if (item.drm || item.status === 'drm') {
    card.append(h('div', { class: 'note' }, icon('lock'), h('span', { text: 'DRM-protected stream – it can be played but not downloaded.' })));
    card.append(h('div', { class: 'actions' }, h('span', { class: 'spacer' }), iconButton('close', 'Remove from list', () => removeMedia(item.id))));
    return card;
  }

  const select = h('select', { 'aria-label': 'Quality', disabled: item.variants.length < 2 },
    item.variants.map((v) => h('option', { value: v.id, selected: variant && v.id === variant.id, text: v.label })));
  select.addEventListener('change', () => { chosen.set(item.id, select.value); signatures.media = ''; renderMedia(); });

  const dlBtn = h('button', { class: 'btn primary', title: 'Download' }, icon('download'), 'Download');
  dlBtn.addEventListener('click', async () => {
    dlBtn.disabled = true;
    try {
      await send({ type: 'download', tabId: tab.id, mediaId: item.id, variantId: select.value });
      dlBtn.replaceChildren('Started ✓');
      toast(item.live ? 'Recording started – stop it from the Downloads tab' : 'Download started');
      refreshJobs();
      setTimeout(() => { dlBtn.replaceChildren(icon('download'), 'Download'); dlBtn.disabled = false; }, 1500);
    } catch (e) {
      toast(e.message, true);
      dlBtn.disabled = false;
    }
  });

  card.append(h('div', { class: 'actions' },
    select, dlBtn,
    iconButton('copy', 'Copy media link', () => copy(variant?.url || item.url)),
    iconButton('close', 'Remove from list', () => removeMedia(item.id))));

  if (variant && variant.separateAudio) {
    card.append(h('div', { class: 'note' }, icon('alert'),
      h('span', { text: 'This quality has no sound – the audio is a separate track. Pick an “Audio only” entry to save it too.' })));
  }
  return card;
}

async function removeMedia(id) {
  await send({ type: 'remove-media', tabId: tab.id, mediaId: id }).catch((e) => toast(e.message, true));
}

function renderMedia() {
  const visible = mediaItems;
  $('mediaCount').textContent = visible.length || '';
  const sig = JSON.stringify(visible.map((i) => [i.id, i.status, i.title, i.size, i.height, i.duration, i.variants.length, i.poster])) + view + pageThumb;
  if (sig === signatures.media) return;
  signatures.media = sig;
  const list = $('mediaList');
  // Don't rebuild while the user has a quality dropdown open.
  if (list.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') { signatures.media = ''; return; }
  list.replaceChildren(...visible.map(mediaCard));
  $('mediaEmpty').hidden = visible.length > 0;
  updateFooter();
}

async function loadMedia() {
  const st = await send({ type: 'get-tab', tabId: tab.id });
  mediaItems = st.items;
  pageThumb = st.thumb || '';
  renderMedia();
}

// ---------------------------------------------------------------------------
// Downloads view
// ---------------------------------------------------------------------------
function jobStatus(job) {
  const pct = Math.round((job.progress || 0) * 100);
  switch (job.status) {
    case 'queued': return ['Waiting…', ''];
    case 'starting': return ['Starting…', ''];
    case 'downloading':
      if (job.live) return [job.note || 'Recording…', formatBytes(job.bytes)];
      if (job.kind === 'file') return [`${pct}%`, job.total ? `${formatBytes(job.bytes)} of ${formatBytes(job.total)}` : formatBytes(job.bytes)];
      return [`${pct}% · ${job.segmentsDone || 0}/${job.segmentsTotal || '?'} segments`, formatBytes(job.bytes)];
    case 'finalizing': return ['Saving file…', formatBytes(job.bytes)];
    case 'done': return ['Completed', formatBytes(job.total || job.bytes)];
    case 'error': return [job.error || 'Failed', ''];
    case 'cancelled': return ['Cancelled', ''];
    default: return [job.status, ''];
  }
}

function jobCard(job) {
  const [left, right] = jobStatus(job);
  const indeterminate = job.status === 'queued' || job.status === 'starting' || job.status === 'finalizing' || (job.live && job.status === 'downloading') || (job.status === 'downloading' && !job.progress && job.kind === 'file' && !job.total);
  const width = job.status === 'done' ? 100 : Math.round((job.progress || 0) * 100);
  const fileName = (job.finalPath || job.filename || job.baseName || '').split(/[\\/]/).pop();

  const actions = h('div', { class: 'actions' }, h('span', { class: 'spacer' }));
  if (ACTIVE.includes(job.status)) {
    if (job.live && job.status === 'downloading') {
      actions.append(h('button', { class: 'btn primary', onclick: () => send({ type: 'stop-live', jobId: job.id }).then(() => toast('Saving recording…')) }, icon('stop'), 'Stop & save'));
    }
    actions.append(h('button', { class: 'btn danger', onclick: () => send({ type: 'cancel', jobId: job.id }).catch((e) => toast(e.message, true)) }, 'Cancel'));
  } else if (job.status === 'done' && job.downloadId != null) {
    actions.append(
      h('button', { class: 'btn', onclick: () => openDownload(job.downloadId, false) }, icon('open'), 'Open'),
      h('button', { class: 'btn', onclick: () => openDownload(job.downloadId, true) }, icon('folder'), 'Show in folder'));
  } else if (job.status === 'error' || job.status === 'cancelled') {
    actions.append(h('button', { class: 'btn', onclick: () => send({ type: 'redownload', source: job.source }).then(() => toast('Retrying…')).catch((e) => toast(e.message, true)) }, icon('retry'), 'Retry'));
  }

  const statusClass = job.status === 'done' ? 'status-done' : job.status === 'error' ? 'status-error' : '';
  return h('article', { class: 'card' },
    h('div', { class: 'title', text: job.title, title: job.title }),
    h('div', { class: 'meta' },
      h('span', { class: 'chip kind', text: job.kind === 'file' ? (job.source.ext || 'file') : job.kind }),
      job.label ? h('span', { text: job.label }) : null,
      fileName ? h('span', { class: 'ellipsis', text: fileName, title: job.finalPath || job.filename, style: { maxWidth: '200px' } }) : null),
    ACTIVE.includes(job.status) || job.status === 'done'
      ? h('div', { class: `progress${indeterminate ? ' indeterminate' : ''}` }, h('div', { style: { width: `${width}%` } }))
      : null,
    h('div', { class: 'status-line' }, h('span', { class: statusClass, text: left }), h('span', { text: right })),
    job.note && job.status === 'done' ? h('div', { class: 'note' }, icon('alert'), h('span', { text: job.note })) : null,
    actions);
}

function renderJobs() {
  const activeCount = jobs.filter((j) => ACTIVE.includes(j.status)).length;
  $('jobsCount').textContent = activeCount || '';
  const sig = JSON.stringify(jobs.map((j) => [j.id, j.status, Math.round((j.progress || 0) * 200), j.bytes, j.note, j.segmentsDone]));
  if (sig === signatures.jobs) return;
  signatures.jobs = sig;
  $('jobsList').replaceChildren(...jobs.map(jobCard));
  $('jobsEmpty').hidden = jobs.length > 0;
  updateFooter();
}

async function refreshJobs() {
  jobs = await send({ type: 'get-jobs' });
  renderJobs();
}

async function openDownload(downloadId, showInFolder) {
  const exists = await send({ type: 'download-exists', downloadId }).catch(() => false);
  if (!exists) { toast('The file was moved or deleted', true); return; }
  await send({ type: 'open-download', downloadId, show: showInFolder }).catch((e) => toast(e.message, true));
}

// ---------------------------------------------------------------------------
// History view
// ---------------------------------------------------------------------------
function historyCard(entry) {
  const date = new Date(entry.finishedAt);
  const fileName = (entry.filename || '').split(/[\\/]/).pop();
  return h('article', { class: 'card' },
    h('div', { class: 'title', text: entry.title, title: entry.title }),
    h('div', { class: 'meta' },
      h('span', { class: `chip ${entry.status === 'done' ? 'kind' : 'live'}`, text: entry.status === 'done' ? 'Saved' : 'Failed' }),
      h('span', { text: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }),
      entry.label ? h('span', { text: entry.label }) : null,
      entry.size ? h('span', { text: formatBytes(entry.size) }) : null),
    fileName ? h('div', { class: 'muted ellipsis', style: { marginTop: '4px', fontSize: '12px' }, text: fileName, title: entry.filename }) : null,
    entry.status === 'error' && entry.error ? h('div', { class: 'note error' }, h('span', { text: entry.error })) : null,
    h('div', { class: 'actions' },
      entry.status === 'done' && entry.downloadId != null ? iconButton('open', 'Open file', () => openDownload(entry.downloadId, false)) : null,
      entry.status === 'done' && entry.downloadId != null ? iconButton('folder', 'Show in folder', () => openDownload(entry.downloadId, true)) : null,
      h('span', { class: 'spacer' }),
      iconButton('copy', 'Copy source link', () => copy(entry.url)),
      iconButton('retry', 'Download again', () => send({ type: 'redownload', source: entry.source }).then(() => toast('Download started')).catch((e) => toast(e.message, true))),
      iconButton('trash', 'Remove from history', () => send({ type: 'remove-history', id: entry.id }))));
}

function renderHistory() {
  const q = $('historySearch').value.trim().toLowerCase();
  const items = q ? history.filter((e) => `${e.title} ${e.filename} ${e.pageUrl}`.toLowerCase().includes(q)) : history;
  $('historyList').replaceChildren(...items.slice(0, 200).map(historyCard));
  $('historyEmpty').hidden = items.length > 0;
  $('historyEmptyText').textContent = settings && !settings.historyEnabled
    ? 'History is turned off in Settings.'
    : q ? 'No matches.' : 'Finished downloads are listed here.';
  updateFooter();
}

async function loadHistory() {
  history = await send({ type: 'get-history' });
  renderHistory();
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
function updateFooter() {
  const info = $('footerInfo');
  const action = $('footerAction');
  action.onclick = null;
  if (view === 'media') {
    info.textContent = tab?.url ? hostOf(tab.url) : '';
    action.textContent = mediaItems.length ? 'Clear list' : '';
    action.onclick = () => send({ type: 'clear-tab', tabId: tab.id });
  } else if (view === 'jobs') {
    const active = jobs.filter((j) => ACTIVE.includes(j.status)).length;
    info.textContent = active ? `${active} active` : `${jobs.length} download${jobs.length === 1 ? '' : 's'}`;
    action.textContent = jobs.some((j) => !ACTIVE.includes(j.status)) ? 'Clear finished' : '';
    action.onclick = () => send({ type: 'clear-finished-jobs' }).then(refreshJobs);
  } else {
    info.textContent = `${history.length} item${history.length === 1 ? '' : 's'}`;
    action.textContent = history.length ? 'Clear history' : '';
    action.onclick = async () => {
      if (!confirm('Remove all entries from the download history? Files on disk are kept.')) return;
      await send({ type: 'clear-history' });
    };
  }
}

function switchView(next) {
  view = next;
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.view === next);
  for (const s of document.querySelectorAll('.view')) s.classList.toggle('active', s.id === `view-${next}`);
  if (next === 'history') loadHistory();
  if (next === 'jobs') refreshJobs();
  updateFooter();
}

async function init() {
  $('openOptions').append(icon('gear'));
  $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => switchView(b.dataset.view));
  $('historySearch').addEventListener('input', renderHistory);
  $('rescan').addEventListener('click', async () => {
    await send({ type: 'rescan', tabId: tab.id }).catch(() => {});
    toast('Scanning…');
    setTimeout(loadMedia, 800);
  });

  settings = await getSettings();
  // ?tabId=N lets the popup be opened as a normal page for a given tab (used by tests).
  const forcedTab = Number(new URLSearchParams(location.search).get('tabId'));
  tab = forcedTab
    ? await chrome.tabs.get(forcedTab).catch(() => null)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab || !/^https?:/.test(tab.url || '')) {
    $('mediaUnsupported').hidden = false;
    $('mediaEmpty').hidden = true;
    mediaItems = [];
  } else {
    await loadMedia();
  }
  await refreshJobs();
  // Open on Downloads when something is running and the page has nothing new.
  if (!mediaItems.length && jobs.some((j) => ACTIVE.includes(j.status))) switchView('jobs');
  updateFooter();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session') {
      if (tab && changes[`tab:${tab.id}`]) {
        const st = changes[`tab:${tab.id}`].newValue;
        mediaItems = st ? Object.values(st.items).sort((a, b) => a.detectedAt - b.detectedAt) : [];
        pageThumb = st?.thumb || '';
        renderMedia();
      }
      if (changes.jobs) {
        jobs = Object.values(changes.jobs.newValue || {}).sort((a, b) => b.createdAt - a.createdAt);
        renderJobs();
      }
    } else if (area === 'local' && changes.history) {
      history = changes.history.newValue || [];
      if (view === 'history') renderHistory();
    } else if (area === 'sync' && changes.settings) {
      getSettings().then((s) => { settings = s; signatures.media = ''; renderMedia(); });
    }
  });

  // Direct downloads report progress by polling: nudge the worker while any run.
  setInterval(() => {
    if (jobs.some((j) => j.kind === 'file' && j.status === 'downloading')) refreshJobs().catch(() => {});
  }, 1000);
}

init().catch((e) => toast(e.message, true));
