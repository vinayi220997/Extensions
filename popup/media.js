// Media view: everything detected on the current tab.
import { h, icon, iconButton } from '../ui/dom.js';
import { showMenu } from '../ui/menu.js';
import { formDialog, infoDialog } from '../ui/dialog.js';
import { formatBytes, formatDuration, resolutionLabel, hostOf, buildFilename } from '../lib/util.js';
import { pickVariant, saveSettings, saveSiteRules } from '../lib/settings.js';
import { ctx, send, toast, copyText, fileNameOf, store, onTabChange, siteAction } from './ctx.js';
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
  onTabChange(() => { chosen.clear(); load(); });
  updateViewButton();
}

export function show() { render(true); }
export function onSettings() { updateViewButton(); render(true); }

export function onStorage(changes, area) {
  if (area === 'session' && ctx.tab && changes[`tab:${ctx.tab.id}`]) {
    setState(changes[`tab:${ctx.tab.id}`].newValue || {});
    render();
  }
}

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
  return items.filter((i) => f.test(i) && (!query || `${i.customTitle || i.title} ${i.url} ${i.kind} ${i.ext}`.toLowerCase().includes(query)));
}

export function render(force = false) {
  $('mediaCount').textContent = items.length || '';
  const visible = visibleItems();
  const sig = JSON.stringify([filter, query, ctx.settings?.viewMode, ctx.settings?.previewMode, ctx.siteRules, pageState.thumb, pageState.notices,
    items.map((i) => [i.id, i.status, i.title, i.customTitle, i.size, i.height, i.duration, i.variants.length, i.poster])]);
  if (!force && sig === signature) return;
  const list = $('mediaList');
  // Don't rebuild while the user has a quality dropdown open.
  if (!force && list.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
  signature = sig;
  renderFilters();
  renderNotices();
  list.replaceChildren(...visible.map(mediaCard));
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
  const size = variant?.size || (item.kind === 'file' || item.kind === 'blob' ? item.size : null);
  const meta = h('div', { class: 'meta' },
    h('span', { class: 'chip kind', text: kindChip(item) }),
    item.live ? h('span', { class: 'chip live', text: 'Live' }) : null,
    item.encrypted ? h('span', { class: 'chip', text: 'AES', title: 'Encrypted with a clear key – VidSnag decrypts it' }) : null,
    item.drm || item.status === 'drm' ? h('span', { class: 'chip warn', text: 'DRM' }) : null,
    res ? h('span', { text: res }) : null,
    audio ? h('span', { text: 'Audio' }) : null,
    size ? h('span', { text: formatBytes(size) }) : null,
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

  const action = siteAction(hostOf(item.pageUrl));
  const primaryLabel = action === 'audio' ? 'Audio' : action === 'copy' ? 'Copy link' : 'Download';
  const primary = h('button', { class: 'btn primary', title: action === 'audio' ? 'Download audio (default on this site)' : action === 'copy' ? 'Copy link (default on this site)' : 'Download' },
    icon(action === 'audio' ? 'music' : action === 'copy' ? 'copy' : 'download'), primaryLabel);
  primary.addEventListener('click', () => {
    if (action === 'copy') copyText(variant?.url || item.url);
    else download(item, { variantId: select.value, output: action === 'audio' ? 'audio' : 'auto' }, primary);
  });
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
  const action = siteAction(host);
  const variant = item.variants.find((v) => v.id === select.value) || selectedVariant(item);
  const canAudio = audioAvailable(item);
  const setAction = async (a) => {
    const rules = { ...ctx.siteRules, actions: { ...ctx.siteRules.actions } };
    if (rules.actions[host] === a) delete rules.actions[host]; else rules.actions[host] = a;
    ctx.siteRules = await saveSiteRules(rules);
    toast(ctx.siteRules.actions[host] ? `On ${host} the main button now ${a === 'audio' ? 'downloads audio' : 'copies the link'}` : `On ${host} the main button downloads again`);
    render(true);
  };
  showMenu(anchor, [
    { label: 'Download', icon: 'download', onClick: () => download(item, { variantId: select.value, output: 'auto' }) },
    { label: 'Download as…', icon: 'saveas', onClick: () => downloadAsDialog(item, select.value) },
    { label: 'Download audio', icon: 'music', disabled: !canAudio, title: canAudio ? '' : 'No audio-only download for this media', onClick: () => download(item, { variantId: select.value, output: 'audio' }) },
    { label: `Always download audio on ${host}`, icon: 'music', checked: action === 'audio', disabled: !host, onClick: () => setAction('audio') },
    'sep',
    { label: 'Copy link', icon: 'copy', onClick: () => copyText(variant?.url || item.url) },
    { label: `Always copy link on ${host}`, icon: 'link', checked: action === 'copy', disabled: !host, onClick: () => setAction('copy') },
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
