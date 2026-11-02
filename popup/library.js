// Saved links: Videos and Pages lists, organized in categories, with link check + refresh.
import { h, icon, iconButton } from '../ui/dom.js';
import { showMenu } from '../ui/menu.js';
import { formDialog, confirmDialog } from '../ui/dialog.js';
import { formatDuration, hostOf } from '../lib/util.js';
import { ctx, send, toast, copyText, store, timeAgo } from './ctx.js';
import { setFooter } from './app.js';

const $ = (id) => document.getElementById(id);
let lib = { categories: [], items: [] };
let type = store('libType') || 'video';
let category = store('libCategory') || 'all';
const busy = new Set(); // item ids being checked/refreshed

export async function init() {
  for (const b of document.querySelectorAll('#view-library .segmented button')) {
    b.addEventListener('click', () => { type = b.dataset.type; store('libType', type); render(); });
  }
  $('libCategory').addEventListener('change', (e) => { category = e.target.value; store('libCategory', category); render(); });
  $('libSearch').addEventListener('input', render);
  $('btnLibMore').append(icon('more'));
  $('btnLibMore').addEventListener('click', moreMenu);
  await load();
}
export async function show() { await load(); }
export function onStorage(changes, area) {
  if (area === 'local' && changes.library) load();
}

async function load() {
  lib = await send({ type: 'lib-get' });
  if (category !== 'all' && category !== 'none' && !lib.categories.some((c) => c.id === category)) category = 'all';
  render();
}

const catById = (id) => lib.categories.find((c) => c.id === id) || null;

function categoryOptions(includeAll) {
  return [
    ...(includeAll ? [{ value: 'all', label: 'All categories' }] : []),
    ...lib.categories.map((c) => ({ value: c.id, label: c.name })),
    { value: 'none', label: 'Uncategorized' }
  ];
}

function render() {
  $('libraryCount').textContent = lib.items.length || '';
  for (const b of document.querySelectorAll('#view-library .segmented button')) b.classList.toggle('active', b.dataset.type === type);
  $('libVideoCount').textContent = String(lib.items.filter((x) => x.type === 'video').length);
  $('libPageCount').textContent = String(lib.items.filter((x) => x.type === 'page').length);
  const sel = $('libCategory');
  sel.replaceChildren(...categoryOptions(true).map((o) => h('option', { value: o.value, text: o.label, selected: o.value === category })));
  const q = $('libSearch').value.trim().toLowerCase();
  const items = lib.items.filter((x) => x.type === type
    && (category === 'all' || (category === 'none' ? !x.categoryId : x.categoryId === category))
    && (!q || `${x.title} ${x.url} ${x.pageUrl} ${x.notes}`.toLowerCase().includes(q)));
  $('libList').replaceChildren(...items.map(card));
  $('libEmpty').hidden = items.length > 0;
  $('libEmptyTitle').textContent = lib.items.length ? 'Nothing here' : 'Nothing saved yet';
  $('libEmptyText').textContent = lib.items.length
    ? 'No saved links match this list, category or search.'
    : type === 'video' ? 'Use “Save to list” in a video’s ⋯ menu, or right-click a video › VidSnag › Save video to list.' : 'Use the bookmark button at the top, or right-click a page › VidSnag › Save this page to list.';
  if (ctx.view === 'library') {
    const expired = lib.items.filter((x) => x.linkStatus === 'expired').length;
    setFooter(`${lib.items.length} saved${expired ? ` · ${expired} expired` : ''}`, lib.items.length ? 'Check links' : '', () => checkLinks(null));
  }
}

function statusChip(x) {
  if (busy.has(x.id)) return h('span', { class: 'chip', text: 'Checking…' });
  if (x.linkStatus === 'ok') return h('span', { class: 'chip good', text: 'Link OK', title: x.lastChecked ? `Checked ${timeAgo(x.lastChecked)}` : '' });
  if (x.linkStatus === 'expired') return h('span', { class: 'chip bad', text: 'Expired' });
  if (x.linkStatus === 'error') return h('span', { class: 'chip warn', text: 'Unreachable' });
  return null;
}

function card(x) {
  const cat = catById(x.categoryId);
  const thumb = h('div', { class: 'thumb' });
  if (x.thumb && ctx.settings.previewMode !== 'none') {
    const img = h('img', { src: x.thumb, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(icon(x.type === 'page' ? 'globe' : 'play')));
    thumb.append(img);
  } else thumb.append(icon(x.type === 'page' ? 'globe' : x.res === 'audio' ? 'music' : 'play'));
  if (x.duration) thumb.append(h('span', { class: 'dur', text: formatDuration(x.duration) }));

  const meta = h('div', { class: 'meta' },
    x.type === 'video' ? h('span', { class: 'chip kind', text: x.kind === 'hls' ? 'HLS' : x.kind === 'dash' ? 'DASH' : (x.ext || 'file').toUpperCase() }) : null,
    statusChip(x),
    cat ? h('span', {}, h('span', { class: 'cat-dot', style: { background: cat.color } }), cat.name) : h('span', { text: 'Uncategorized' }),
    x.label && x.type === 'video' ? h('span', { text: x.label }) : null,
    h('span', { text: hostOf(x.pageUrl || x.url) }),
    h('span', { text: `Saved ${timeAgo(x.savedAt)}`, title: new Date(x.savedAt).toLocaleString() }));

  const el = h('article', { class: 'card', 'data-id': x.id },
    h('div', { class: 'card-head' }, thumb,
      h('div', { class: 'card-body' }, h('div', { class: 'title', text: x.title, title: x.title }), meta)));
  if (x.notes) el.append(h('div', { class: 'note info' }, h('span', { text: x.notes })));
  if (x.linkStatus === 'expired' || x.linkStatus === 'error') {
    el.append(h('div', { class: 'note' }, icon('alert'),
      h('span', { text: x.type === 'video' ? 'This link no longer works. Refresh it to fetch the current address from its page.' : 'This page didn’t respond. It may have moved.' }),
      x.type === 'video' && x.pageUrl ? h('button', { class: 'btn small', onclick: () => refreshItem(x) }, icon('refresh'), 'Refresh link') : null));
  }
  if (x.refreshedAt && Date.now() - x.refreshedAt < 120000) el.append(h('div', { class: 'note info' }, icon('check'), h('span', { text: 'Link refreshed.' })));

  const primary = x.type === 'video'
    ? h('button', { class: 'btn primary', onclick: () => downloadItem(x, 'auto') }, icon('download'), 'Download')
    : h('button', { class: 'btn primary', onclick: () => openUrl(x.url) }, icon('open'), 'Open');
  const more = iconButton('more', 'More actions', () => itemMenu(x, more));
  el.append(h('div', { class: 'actions' },
    primary,
    x.type === 'video' && x.pageUrl ? iconButton('globe', 'Open the page', () => openUrl(x.pageUrl)) : null,
    iconButton('copy', 'Copy link', () => copyText(x.url)),
    h('span', { class: 'spacer' }),
    more));
  return el;
}

function openUrl(url) {
  chrome.tabs.create({ url });
}

async function downloadItem(x, output) {
  try {
    await send({ type: 'lib-download', id: x.id, output });
    toast(output === 'audio' ? 'Audio download started' : 'Download started');
  } catch (e) { toast(e.message, true); }
}

async function checkLinks(ids) {
  const targets = ids || lib.items.map((x) => x.id);
  targets.forEach((id) => busy.add(id));
  render();
  try {
    const res = await send({ type: 'lib-check', ids });
    const bad = Object.values(res).filter((r) => r.status !== 'ok').length;
    toast(bad ? `${bad} link${bad === 1 ? '' : 's'} need attention` : 'All checked links work');
  } catch (e) { toast(e.message, true); }
  targets.forEach((id) => busy.delete(id));
  await load();
}

async function refreshItem(x) {
  busy.add(x.id);
  render();
  toast('Refreshing — loading the page in the background…');
  try {
    const r = await send({ type: 'lib-refresh', id: x.id });
    toast(r.message, r.status !== 'ok');
  } catch (e) { toast(e.message, true); }
  busy.delete(x.id);
  await load();
}

function itemMenu(x, anchor) {
  const video = x.type === 'video';
  showMenu(anchor, [
    video ? { label: 'Download', icon: 'download', onClick: () => downloadItem(x, 'auto') } : null,
    video ? { label: 'Download audio', icon: 'music', onClick: () => downloadItem(x, 'audio') } : null,
    { label: video ? 'Open video link' : 'Open page', icon: 'open', onClick: () => openUrl(x.url) },
    video && x.pageUrl ? { label: 'Open the page', icon: 'globe', onClick: () => openUrl(x.pageUrl) } : null,
    { label: 'Copy link', icon: 'copy', onClick: () => copyText(x.url) },
    'sep',
    { label: 'Check link', icon: 'check', onClick: () => checkLinks([x.id]) },
    video ? { label: 'Refresh link', icon: 'refresh', disabled: !x.pageUrl, title: x.pageUrl ? '' : 'Saved without a page', onClick: () => refreshItem(x) } : null,
    'sep',
    { label: 'Edit…', icon: 'edit', onClick: () => editDialog(x) },
    { label: 'Move to category…', icon: 'tag', onClick: () => moveDialog(x) },
    { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
      if (await confirmDialog('Delete saved link', `Remove “${x.title}” from your saved links?`, 'Delete', true)) await send({ type: 'lib-delete', ids: [x.id] });
    } }
  ]);
}

async function editDialog(x) {
  const v = await formDialog({
    title: 'Edit saved link',
    fields: [
      { name: 'title', label: 'Title', value: x.title, required: true },
      { name: 'url', label: x.type === 'video' ? 'Video link' : 'Page link', value: x.url, type: 'url', hint: 'Paste a new address here if you have one.' },
      { name: 'categoryId', label: 'Category', type: 'select', value: x.categoryId || 'none', options: categoryOptions(false) },
      { name: 'notes', label: 'Notes', type: 'textarea', value: x.notes }
    ]
  });
  if (!v) return;
  try {
    await send({ type: 'lib-update', id: x.id, patch: { title: v.title, url: v.url, notes: v.notes, categoryId: v.categoryId === 'none' ? null : v.categoryId } });
    toast('Saved');
  } catch (e) { toast(e.message, true); }
}

async function moveDialog(x) {
  const v = await formDialog({
    title: 'Move to category',
    okLabel: 'Move',
    fields: [{ name: 'categoryId', label: 'Category', type: 'select', value: x.categoryId || 'none', options: categoryOptions(false) }]
  });
  if (v) await send({ type: 'lib-update', id: x.id, patch: { categoryId: v.categoryId === 'none' ? null : v.categoryId } });
}

function moreMenu() {
  showMenu($('btnLibMore'), [
    { label: 'New category…', icon: 'plus', onClick: () => newCategoryDialog() },
    { label: 'Manage categories…', icon: 'tag', onClick: manageCategories },
    'sep',
    { label: 'Check all links', icon: 'check', disabled: !lib.items.length, onClick: () => checkLinks(null) },
    { label: 'Refresh expired video links', icon: 'refresh', disabled: !lib.items.some((x) => x.type === 'video' && x.linkStatus === 'expired'), onClick: async () => {
      for (const x of lib.items.filter((y) => y.type === 'video' && y.linkStatus === 'expired' && y.pageUrl)) await refreshItem(x);
    } },
    'sep',
    ctx.mode !== 'tab' ? { label: 'Open Saved links in a tab', icon: 'open', onClick: () => send({ type: 'open-panel-tab', view: 'library' }).then(() => ctx.mode === 'popup' && window.close()) } : null
  ]);
}

export async function newCategoryDialog() {
  const v = await formDialog({
    title: 'New category',
    okLabel: 'Create',
    fields: [
      { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Tutorials', maxlength: 60 },
      { name: 'color', label: 'Colour', type: 'color', value: '#2563eb' }
    ]
  });
  if (!v) return null;
  try {
    const c = await send({ type: 'cat-create', name: v.name, color: v.color });
    toast(`Category “${c.name}” created`);
    await load();
    return c;
  } catch (e) { toast(e.message, true); return null; }
}

async function manageCategories() {
  const rows = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
  const fill = () => rows.replaceChildren(...lib.categories.map((c) => {
    const n = lib.items.filter((x) => x.categoryId === c.id).length;
    const name = h('input', { type: 'text', value: c.name, maxlength: 60, 'aria-label': 'Category name', style: { flex: 1 } });
    const color = h('input', { type: 'color', value: c.color, 'aria-label': 'Category colour', style: { width: '34px', height: '30px', padding: 0, border: 0, background: 'none' } });
    const save = async () => {
      try { await send({ type: 'cat-update', id: c.id, name: name.value, color: color.value }); await load(); toast('Category updated'); } catch (e) { toast(e.message, true); name.value = c.name; }
    };
    name.addEventListener('change', save);
    color.addEventListener('change', save);
    const del = iconButton('trash', `Delete ${c.name}`, async () => {
      const keep = n ? await formDialog({
        title: `Delete “${c.name}”`,
        okLabel: 'Delete category',
        fields: [{ name: 'what', label: `It contains ${n} saved link${n === 1 ? '' : 's'}`, type: 'select', value: 'move',
          options: [{ value: 'move', label: 'Keep them (move to Uncategorized)' }, { value: 'delete', label: 'Delete them too' }] }]
      }) : { what: 'move' };
      if (!keep) return;
      await send({ type: 'cat-delete', id: c.id, deleteItems: keep.what === 'delete' });
      await load();
      fill();
    });
    return h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, color, name, h('span', { class: 'muted', style: { fontSize: '.9em', minWidth: '24px' }, text: String(n) }), del);
  }));
  fill();
  const add = h('button', { class: 'btn small', type: 'button', onclick: async () => { if (await newCategoryDialog()) fill(); } }, icon('plus'), 'New category');
  await formDialog({ title: 'Categories', okLabel: 'Done', cancelLabel: null, body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, rows, h('div', {}, add)) });
}

// "Save to list" dialogs (also used by the Media view and the header bookmark button)
async function chooseCategoryFields(extra = []) {
  lib = await send({ type: 'lib-get' });
  return [
    ...extra,
    { name: 'categoryId', label: 'Category', type: 'select', value: lib.categories[0]?.id || 'none', options: [...categoryOptions(false), { value: '__new', label: '+ New category…' }] },
    { name: 'newCategory', label: 'New category name', placeholder: 'Only when “+ New category…” is selected' },
    { name: 'notes', label: 'Notes (optional)', type: 'textarea', rows: 2 }
  ];
}
function toggleNewCat(v, dlg) {
  const field = dlg.querySelector('input[name="newCategory"]')?.closest('label');
  if (field) field.hidden = v.categoryId !== '__new';
}
async function resolveCategory(v) {
  if (v.categoryId === '__new') {
    if (!v.newCategory.trim()) throw new Error('Enter a name for the new category');
    const c = await send({ type: 'cat-create', name: v.newCategory });
    return c.id;
  }
  return v.categoryId === 'none' ? null : v.categoryId;
}

export async function saveMediaDialog(tab, item, variantId) {
  const v = await formDialog({
    title: 'Save video to list',
    fields: await chooseCategoryFields([{ name: 'title', label: 'Title', value: item.customTitle || item.title, required: true }]),
    onInput: toggleNewCat
  });
  if (!v) return;
  try {
    const categoryId = await resolveCategory(v);
    const r = await send({ type: 'lib-save-media', tabId: tab.id, mediaId: item.id, variantId, categoryId, title: v.title, notes: v.notes });
    toast(r.duplicate ? 'Already saved — details updated' : 'Saved to Videos');
  } catch (e) { toast(e.message, true); }
}

export async function savePageDialog(tab) {
  const st = await send({ type: 'get-tab', tabId: tab.id }).catch(() => ({}));
  const v = await formDialog({
    title: 'Save page to list',
    fields: await chooseCategoryFields([{ name: 'title', label: 'Title', value: tab.title || tab.url, required: true }]),
    onInput: toggleNewCat
  });
  if (!v) return;
  try {
    const categoryId = await resolveCategory(v);
    const r = await send({ type: 'lib-save-page', url: tab.url, title: v.title, thumb: st.thumb || '', categoryId, notes: v.notes });
    toast(r.duplicate ? 'Already saved — details updated' : 'Saved to Pages');
  } catch (e) { toast(e.message, true); }
}
