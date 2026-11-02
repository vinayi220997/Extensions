import { getSettings, saveSettings, resetSettings, validate, getSiteRules, saveSiteRules, normalizeSiteRules, SORT_OPTIONS } from '../lib/settings.js';
import { buildFilename, sanitizeFolder } from '../lib/util.js';
import { parseAddonFile, getAddons, saveAddons, normalizeAddon, SAMPLE_RULE_ADDON, SAMPLE_SCRIPT_ADDON } from '../lib/addons.js';
import { applyAppearance, ACCENTS } from '../ui/appearance.js';
import { h } from '../ui/dom.js';
import { formDialog, confirmDialog } from '../ui/dialog.js';

const form = document.getElementById('form');
const $ = (id) => document.getElementById(id);
const embed = new URLSearchParams(location.search).get('embed') === '1';
for (const [v, l] of SORT_OPTIONS) document.getElementById('sortBySelect').append(new Option(l, v));
if (embed) document.body.classList.add('embed');
let saveTimer = null;
let current = null;

function flash(text, isError = false) {
  const el = $('saved');
  el.textContent = text;
  el.className = `saved-toast show${isError ? ' error' : ''}`;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { el.className = 'saved-toast'; }, isError ? 4000 : 1600);
}

// ---------------------------------------------------------------------------
// Settings form
// ---------------------------------------------------------------------------
const fields = () => [...form.elements].filter((el) => el.name);

function fill(s) {
  current = s;
  for (const el of fields()) {
    if (!(el.name in s)) continue;
    if (el.type === 'checkbox') el.checked = !!s[el.name];
    else if (el.type === 'radio') el.checked = el.value === String(s[el.name]);
    else el.value = s[el.name];
  }
  renderSwatches(s);
  preview();
  document.querySelector('[name="historyDays"]').disabled = !s.historyEnabled;
  applyAppearance(s);
}

function read() {
  const out = { accent: current?.accent, accentCustom: current?.accentCustom };
  for (const el of fields()) {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.type === 'number') out[el.name] = el.value === '' ? undefined : Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

function preview() {
  const v = read();
  const name = buildFilename(v.filenameTemplate, { title: 'Big Buck Bunny', host: 'example.com', res: '1080p' });
  const folder = sanitizeFolder(v.subfolder);
  $('namePreview').textContent = `Example: Downloads/${folder ? folder + '/' : ''}${name}.mp4`;
}

async function save(patch = {}) {
  const values = { ...read(), ...patch };
  if (values.sidebarMode && values.sidebarMode !== 'unpinned') values.lastPinnedMode = values.sidebarMode;
  const next = await saveSettings(values);
  current = next;
  flash('Saved ✓');
  document.querySelector('[name="historyDays"]').disabled = !next.historyEnabled;
  applyAppearance(next);
  renderSwatches(next);
}

// History inputs live outside the <form> element (form="form"), so listen on the document.
document.addEventListener('input', (e) => {
  if (e.target.form !== form) return;
  if (e.target.name === 'filenameTemplate' || e.target.name === 'subfolder') preview();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, e.target.type === 'text' ? 400 : 0);
});
document.addEventListener('change', (e) => {
  if (e.target.form !== form) return;
  clearTimeout(saveTimer);
  save();
});
form.addEventListener('submit', (e) => e.preventDefault());

function renderSwatches(s) {
  const box = $('swatches');
  const dark = document.documentElement.dataset.theme === 'dark';
  const btns = Object.entries(ACCENTS).map(([name, pair]) => {
    const b = h('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(s.accent === name), title: name[0].toUpperCase() + name.slice(1), style: { background: dark ? pair[1] : pair[0] } });
    b.addEventListener('click', () => save({ accent: name }));
    return b;
  });
  const picker = h('input', { type: 'color', value: s.accentCustom, 'aria-label': 'Custom colour' });
  picker.addEventListener('change', () => save({ accent: 'custom', accentCustom: picker.value }));
  const custom = h('label', { class: 'swatch-custom', title: 'Custom colour' }, picker, s.accent === 'custom' ? '✓' : 'Custom');
  box.replaceChildren(...btns, custom);
}

$('reset').addEventListener('click', async () => {
  if (!(await confirmDialog('Restore defaults', 'Reset every setting to its default value? Saved links, history, site rules and addons are kept.', 'Restore defaults'))) return;
  fill(await resetSettings());
  flash('Defaults restored');
});

// ---------------------------------------------------------------------------
// Site rules
// ---------------------------------------------------------------------------
async function renderSiteRules() {
  const r = await getSiteRules();
  const rows = [];
  const hosts = [...new Set([...Object.keys(r.actions), ...Object.keys(r.naming)])].sort();
  for (const host of hosts) {
    const parts = [];
    if (r.actions[host]) parts.push(r.actions[host] === 'audio' ? 'Always download audio' : 'Always copy link');
    if (r.naming[host]) parts.push(`Naming: ${r.naming[host].template || '(default)'}${r.naming[host].selector ? ` · title from ${r.naming[host].selector}` : ''}`);
    const del = h('button', { type: 'button', class: 'btn small danger', text: 'Remove' });
    del.addEventListener('click', async () => {
      const next = await getSiteRules();
      delete next.actions[host];
      delete next.naming[host];
      await saveSiteRules(next);
      renderSiteRules();
      flash(`Rules for ${host} removed`);
    });
    rows.push(h('div', { class: 'rule' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: host }), h('div', { class: 'desc', text: parts.join(' · '), title: parts.join(' · ') })), del));
  }
  $('siteRules').replaceChildren(...(rows.length ? rows : [h('div', { class: 'empty-rules', text: 'No site rules yet.' })]));
}

// ---------------------------------------------------------------------------
// Addons
// ---------------------------------------------------------------------------
async function status() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'addons-status' });
    return res?.result || { available: false };
  } catch { return { available: false }; }
}

async function renderAddons() {
  const list = await getAddons();
  const st = await status();
  const scripts = list.filter((a) => a.kind === 'script');
  const box = $('userScriptsStatus');
  if (scripts.length && !st.available) {
    box.hidden = false;
    const openBtn = h('button', { type: 'button', class: 'btn small', text: 'Open VidSnag’s extension page' });
    openBtn.addEventListener('click', () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));
    const grant = h('button', { type: 'button', class: 'btn small', text: 'Grant permission' });
    grant.addEventListener('click', async () => { await requestUserScripts(); renderAddons(); });
    const recheck = h('button', { type: 'button', class: 'btn small', text: 'Check again' });
    recheck.addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'addons-sync' }); renderAddons(); });
    box.replaceChildren(
      h('b', { text: 'Script addons are installed but not running yet.' }),
      h('ol', {},
        st.reason === 'permission' ? h('li', {}, 'Allow VidSnag to run user scripts: ', grant) : null,
        h('li', {}, 'On VidSnag’s extension page turn on ', h('b', { text: 'Allow User Scripts' }), ' (older Chrome: turn on Developer mode). ', openBtn),
        h('li', {}, 'Come back and press ', recheck)));
  } else box.hidden = true;

  const rows = list.map((a) => {
    const toggle = h('input', { type: 'checkbox', checked: a.enabled, 'aria-label': `Enable ${a.name}` });
    toggle.addEventListener('change', async () => {
      const all = await getAddons();
      const x = all.find((y) => y.id === a.id);
      if (x) x.enabled = toggle.checked;
      await saveAddons(all);
      flash(toggle.checked ? 'Addon enabled' : 'Addon disabled');
    });
    const exp = h('button', { type: 'button', class: 'btn small', text: 'Export' });
    exp.addEventListener('click', () => {
      if (a.kind === 'script') downloadText(`${slug(a.name)}.js`, a.code, 'text/javascript');
      else downloadText(`${slug(a.name)}.json`, JSON.stringify({ type: 'vidsnag-addon', name: a.name, version: a.version, description: a.description, matches: a.matches, detect: a.detect }, null, 2));
    });
    const del = h('button', { type: 'button', class: 'btn small danger', text: 'Delete' });
    del.addEventListener('click', async () => {
      if (!(await confirmDialog('Delete addon', `Remove “${a.name}”?`, 'Delete', true))) return;
      await saveAddons((await getAddons()).filter((x) => x.id !== a.id));
      renderAddons();
    });
    const desc = [a.description, `Runs on: ${a.matches.join(', ')}`].filter(Boolean).join(' · ');
    return h('div', { class: 'rule' }, toggle,
      h('div', { class: 'grow' },
        h('div', { class: 'name' }, `${a.name} `, h('span', { class: 'tag', text: a.kind === 'script' ? 'Script' : 'Rules' }), h('span', { class: 'muted', style: { fontWeight: 400, fontSize: '.9em' }, text: ` v${a.version}` })),
        h('div', { class: 'desc', text: desc, title: desc })),
      exp, del);
  });
  $('addonList').replaceChildren(...(rows.length ? rows : [h('div', { class: 'empty-rules', text: 'No addons installed.' })]));
}

async function requestUserScripts() {
  try {
    if (await chrome.permissions.contains({ permissions: ['userScripts'] })) return true;
    return await chrome.permissions.request({ permissions: ['userScripts'] });
  } catch { return false; }
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'addon';

function downloadText(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

$('addonFile').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  let list = await getAddons();
  let added = 0;
  let needScripts = false;
  for (const f of files) {
    try {
      const addon = parseAddonFile(await f.text(), f.name);
      if (addon.kind === 'script') {
        const ok = await confirmDialog('Install script addon?', `“${addon.name}” will run its own JavaScript on: ${addon.matches.join(', ')}. Only continue if you trust where this file came from.`, 'Install');
        if (!ok) continue;
        needScripts = true;
      }
      const existing = list.findIndex((x) => x.name === addon.name && x.kind === addon.kind);
      if (existing >= 0) list[existing] = { ...addon, id: list[existing].id }; else list.push(addon);
      added++;
    } catch (err) {
      flash(`${f.name}: ${err.message}`, true);
    }
  }
  if (!added) return;
  if (needScripts) await requestUserScripts();
  await saveAddons(list);
  await chrome.runtime.sendMessage({ type: 'addons-sync' }).catch(() => {});
  flash(`${added} addon${added === 1 ? '' : 's'} installed`);
  renderAddons();
});
$('sampleRule').addEventListener('click', () => downloadText('vidsnag-sample-rules.json', JSON.stringify(SAMPLE_RULE_ADDON, null, 2)));
$('sampleScript').addEventListener('click', () => downloadText('vidsnag-sample-script.js', SAMPLE_SCRIPT_ADDON, 'text/javascript'));

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
async function refreshHistoryInfo() {
  const { history = [] } = await chrome.storage.local.get('history');
  $('historyInfo').textContent = `${history.length} download${history.length === 1 ? '' : 's'} recorded`;
}
$('clearHistory').addEventListener('click', async () => {
  if (!(await confirmDialog('Clear history', 'Remove all entries from the download history? Files on disk are kept.', 'Clear history', true))) return;
  await chrome.runtime.sendMessage({ type: 'clear-history' });
  refreshHistoryInfo();
});

// ---------------------------------------------------------------------------
// Backup & restore
// ---------------------------------------------------------------------------
$('exportBtn').addEventListener('click', async () => {
  const parts = new Set([...document.querySelectorAll('#exportParts input:checked')].map((x) => x.value));
  const local = await chrome.storage.local.get(['siteRules', 'addons', 'library', 'history']);
  const data = {
    app: 'VidSnag', format: 1, version: chrome.runtime.getManifest().version, exportedAt: new Date().toISOString(),
    settings: await getSettings()
  };
  if (parts.has('siteRules')) data.siteRules = normalizeSiteRules(local.siteRules);
  if (parts.has('addons')) data.addons = Array.isArray(local.addons) ? local.addons : [];
  if (parts.has('library')) data.library = local.library || { categories: [], items: [] };
  if (parts.has('history')) data.history = Array.isArray(local.history) ? local.history : [];
  const d = new Date();
  downloadText(`vidsnag-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`, JSON.stringify(data, null, 2));
  flash('Backup exported');
});

$('importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let data;
  try {
    data = JSON.parse(await f.text());
    if (!data || data.app !== 'VidSnag' || typeof data !== 'object') throw new Error('This is not a VidSnag backup file');
  } catch (err) { flash(err.message, true); return; }
  const has = ['settings', 'siteRules', 'addons', 'library', 'history'].filter((k) => data[k]);
  const choice = await formDialog({
    title: 'Import backup',
    okLabel: 'Import',
    body: h('p', { style: { margin: 0 }, text: `This backup (${data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'unknown date'}) contains: ${has.join(', ')}.` }),
    fields: [{ name: 'mode', label: 'How to import', type: 'select', value: 'merge', options: [
      { value: 'merge', label: 'Merge with what I have (keep my saved links, add new ones)' },
      { value: 'replace', label: 'Replace what I have with the backup' }] }]
  });
  if (!choice) return;
  try {
    await importBackup(data, choice.mode === 'replace');
    fill(await getSettings());
    renderSiteRules();
    renderAddons();
    refreshHistoryInfo();
    flash('Backup imported ✓');
  } catch (err) { flash(`Import failed: ${err.message}`, true); }
});

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const httpUrl = (u) => typeof u === 'string' && /^https?:/i.test(u);

// Validate the whole backup before writing anything, so a bad file can't leave a half-import.
function sanitizeBackup(data) {
  const out = {};
  if (isObj(data.settings)) {
    // Keep only the keys the backup actually has (older backups don't know newer settings).
    const v = validate(data.settings);
    out.settings = Object.fromEntries(Object.entries(v).filter(([k]) => k in data.settings));
  }
  if (isObj(data.siteRules)) out.siteRules = normalizeSiteRules(data.siteRules);
  if (Array.isArray(data.addons)) {
    out.addons = [];
    for (const a of data.addons) { try { out.addons.push(normalizeAddon(a)); } catch { /* skip invalid addon */ } }
  }
  if (isObj(data.library)) {
    const cats = (Array.isArray(data.library.categories) ? data.library.categories : [])
      .filter((c) => isObj(c) && typeof c.name === 'string' && c.name.trim())
      .map((c) => ({ id: typeof c.id === 'string' ? c.id : `c${Math.random().toString(36).slice(2, 9)}`, name: c.name.trim().slice(0, 60), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#0f766e' }));
    const items = (Array.isArray(data.library.items) ? data.library.items : [])
      .filter((x) => isObj(x) && httpUrl(x.url))
      .map((x) => ({ ...x, type: x.type === 'page' ? 'page' : 'video', title: String(x.title || x.url).slice(0, 300), pageUrl: httpUrl(x.pageUrl) ? x.pageUrl : '', notes: String(x.notes || '').slice(0, 2000) }));
    out.library = { categories: cats, items };
  }
  if (Array.isArray(data.history)) {
    out.history = data.history.filter((x) => isObj(x) && typeof x.id === 'string' && httpUrl(x.url))
      .map((x) => ({ ...x, title: String(x.title || '').slice(0, 300), pageUrl: httpUrl(x.pageUrl) ? x.pageUrl : '', finishedAt: Number(x.finishedAt) || 0 }));
  }
  return out;
}

async function importBackup(raw, replace) {
  const data = sanitizeBackup(raw);
  const scripts = (data.addons || []).filter((a) => a.kind === 'script');
  if (scripts.length) {
    const ok = await confirmDialog('Install script addons from this backup?',
      `The backup contains ${scripts.length} script addon${scripts.length === 1 ? '' : 's'} (${scripts.map((a) => a.name).join(', ')}) that run their own JavaScript on the pages they match. Only continue if you trust this backup. Choosing Cancel imports everything else without them.`, 'Install scripts');
    if (!ok) data.addons = data.addons.filter((a) => a.kind !== 'script');
  }
  if (data.settings) await saveSettings(validate({ ...(replace ? {} : await getSettings()), ...data.settings }));
  const local = await chrome.storage.local.get(['siteRules', 'addons', 'library', 'history']);
  if (data.siteRules) {
    const inc = normalizeSiteRules(data.siteRules);
    const cur = normalizeSiteRules(local.siteRules);
    await saveSiteRules(replace ? inc : { actions: { ...cur.actions, ...inc.actions }, naming: { ...cur.naming, ...inc.naming } });
  }
  if (Array.isArray(data.addons)) {
    const valid = data.addons;
    const cur = replace ? [] : (Array.isArray(local.addons) ? local.addons : []);
    for (const a of valid) {
      const i = cur.findIndex((x) => x.id === a.id || (x.name === a.name && x.kind === a.kind));
      if (i >= 0) cur[i] = a; else cur.push(a);
    }
    if (valid.some((a) => a.kind === 'script')) await requestUserScripts();
    await saveAddons(cur);
    chrome.runtime.sendMessage({ type: 'addons-sync' }).catch(() => {});
  }
  if (data.library) {
    const inc = data.library;
    if (replace) await chrome.storage.local.set({ library: inc });
    else {
      const cur = isObj(local.library) ? {
        categories: (local.library.categories || []).filter((x) => isObj(x) && typeof x.name === 'string'),
        items: (local.library.items || []).filter(isObj)
      } : { categories: [], items: [] };
      const idMap = new Map();
      for (const c of inc.categories) {
        const same = cur.categories.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
        if (same) idMap.set(c.id, same.id);
        else { const id = cur.categories.some((x) => x.id === c.id) ? `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}` : c.id; cur.categories.push({ ...c, id }); idMap.set(c.id, id); }
      }
      const keys = new Set(cur.items.map((x) => `${x.type}|${x.url}`));
      for (const it of inc.items) {
        if (keys.has(`${it.type}|${it.url}`)) continue;
        keys.add(`${it.type}|${it.url}`);
        cur.items.push({ ...it, categoryId: idMap.get(it.categoryId) ?? null });
      }
      await chrome.storage.local.set({ library: cur });
    }
  }
  if (Array.isArray(data.history)) {
    const cur = replace ? [] : (Array.isArray(local.history) ? local.history : []);
    const ids = new Set(cur.map((x) => x.id));
    const merged = [...cur, ...data.history.filter((x) => x && !ids.has(x.id))].sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0)).slice(0, 500);
    await chrome.storage.local.set({ history: merged });
  }
}

// ---------------------------------------------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.history) refreshHistoryInfo();
  if (area === 'local' && changes.siteRules) renderSiteRules();
  if (area === 'local' && changes.addons) renderAddons();
  if (area === 'sync' && changes.settings && !document.hasFocus()) getSettings().then(fill);
});
if (embed) $('helpLink').target = '_blank';

getSettings().then(fill);
renderSiteRules();
renderAddons();
refreshHistoryInfo();
