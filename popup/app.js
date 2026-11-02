// Panel app shell: modes (popup / sidebar / window / PiP / tab), view switching, header actions.
import { icon } from '../ui/dom.js';
import { showMenu } from '../ui/menu.js';
import { applyAppearance, WINDOW_SIZES } from '../ui/appearance.js';
import { getSettings, getSiteRules, saveSettings } from '../lib/settings.js';
import { ctx, send, toast } from './ctx.js';
import * as media from './media.js';
import * as jobs from './jobs.js';
import * as history from './history.js';
import * as library from './library.js';
import * as help from './help.js';

const $ = (id) => document.getElementById(id);
const VIEWS = { media, jobs, library, history, help };
let pipWindow = null;

// ---------------------------------------------------------------------------
// Which tab are we showing?
// ---------------------------------------------------------------------------
async function resolveTab() {
  if (ctx.forcedTabId) return chrome.tabs.get(ctx.forcedTabId).catch(() => null);
  if (ctx.mode === 'float') return (await chrome.tabs.getCurrent()) || null; // the page hosting the indicator
  if (ctx.mode === 'popup' || ctx.mode === 'sidebar') {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return t || null;
  }
  // window / pip / tab: follow the last focused normal browser window.
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  if (win) {
    const [t] = await chrome.tabs.query({ active: true, windowId: win.id });
    if (t && /^https?:/.test(t.url || '')) return t;
  }
  const tabs = (await chrome.tabs.query({ windowType: 'normal' })).filter((t) => /^https?:/.test(t.url || ''));
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return tabs[0] || null;
}

async function setTab(t) {
  const changed = (t?.id ?? null) !== (ctx.tab?.id ?? null) || (t?.url !== ctx.tab?.url);
  ctx.tab = t;
  if (changed) for (const fn of ctx.listeners) fn();
}

function watchTabs() {
  if (ctx.forcedTabId || ctx.mode === 'popup' || ctx.mode === 'float') return;
  let myWindowId = null;
  chrome.windows.getCurrent().then((w) => { myWindowId = w.id; });
  const refresh = async () => setTab(await resolveTab());
  chrome.tabs.onActivated.addListener((info) => {
    if (ctx.mode === 'sidebar' && info.windowId !== myWindowId) return;
    refresh();
  });
  chrome.tabs.onUpdated.addListener((id, change) => {
    if (id === ctx.tab?.id && (change.url || change.status === 'complete')) refresh();
  });
  chrome.windows.onFocusChanged.addListener((wid) => {
    if (ctx.mode !== 'sidebar' && wid !== chrome.windows.WINDOW_ID_NONE && wid !== myWindowId) refresh();
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
export function switchView(next) {
  if (!VIEWS[next] && next !== 'settings') next = 'media';
  if (ctx.compact && next !== 'settings') next = 'media'; // Mini shows the media list only
  ctx.view = next;
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.view === next);
  for (const s of document.querySelectorAll('.view')) s.classList.toggle('active', s.id === `view-${next}`);
  $('btnHelp').classList.toggle('active', next === 'help');
  $('btnOptions').classList.toggle('active', next === 'settings');
  if (next === 'settings') {
    const f = $('settingsFrame');
    if (!f.src) f.src = chrome.runtime.getURL('options/options.html?embed=1');
    setFooter('Settings', 'Back', () => switchView('media'));
  } else VIEWS[next].show?.();
}

export function setFooter(info, actionLabel = '', action = null) {
  $('footerInfo').textContent = info || '';
  const btn = $('footerAction');
  btn.textContent = actionLabel;
  btn.onclick = action;
}

// ---------------------------------------------------------------------------
// Header actions
// ---------------------------------------------------------------------------
async function openSidebar() {
  const win = ctx.tab ? { id: ctx.tab.windowId } : await chrome.windows.getCurrent();
  try {
    await chrome.sidePanel.open({ windowId: win.id });
    if (ctx.mode === 'popup') window.close();
  } catch (e) {
    toast(`Couldn't open the sidebar: ${e.message}`, true);
  }
}

async function openWindow(view = '') {
  await send({ type: 'open-window', view: view || ctx.view });
  if (ctx.mode === 'popup') window.close();
}

// Always-on-top via Document Picture-in-Picture. Only available from a window/tab/sidebar page.
async function pin() {
  if (!('documentPictureInPicture' in window)) {
    toast('Pinning needs Chrome 116+ (Picture-in-Picture for documents).', true);
    return;
  }
  if (ctx.mode === 'popup') {
    // The popup closes as soon as it loses focus, which would close its PiP window too.
    await send({ type: 'open-window', view: ctx.view });
    toast('Opened in a window — click 📌 there to pin it on top.');
    setTimeout(() => window.close(), 900);
    return;
  }
  try {
    const size = WINDOW_SIZES[ctx.settings.windowSize] || WINDOW_SIZES.M;
    pipWindow = await documentPictureInPicture.requestWindow({ width: size.width, height: size.height });
    const doc = pipWindow.document;
    doc.title = 'VidSnag (pinned)';
    doc.body.style.cssText = 'margin:0;height:100vh;overflow:hidden;';
    const frame = doc.createElement('iframe');
    frame.src = chrome.runtime.getURL(`popup/popup.html?mode=pip&view=${ctx.view}`);
    frame.style.cssText = 'border:0;width:100%;height:100%;display:block;';
    doc.body.append(frame);
    pipWindow.addEventListener('pagehide', () => {
      pipWindow = null;
      updatePinButton();
      if (ctx.mode === 'window') chrome.windows.getCurrent().then((w) => chrome.windows.update(w.id, { state: 'normal', focused: true })).catch(() => {});
    });
    updatePinButton();
    if (ctx.mode === 'window') {
      const w = await chrome.windows.getCurrent();
      chrome.windows.update(w.id, { state: 'minimized' }).catch(() => {});
    }
  } catch (e) {
    toast(`Couldn't pin: ${e.message}`, true);
  }
}
function unpin() {
  if (ctx.mode === 'pip') { try { window.parent.close(); } catch { window.close(); } return; }
  pipWindow?.close();
}
function updatePinButton() {
  $('btnPanel').replaceChildren(icon(ctx.mode === 'pip' || pipWindow ? 'unpin' : ctx.mode === 'sidebar' ? 'sidebar' : 'window'));
}

function panelMenu() {
  const pinned = ctx.mode === 'pip' || !!pipWindow;
  showMenu($('btnPanel'), [
    { header: 'Open VidSnag in' },
    { label: 'Popup', icon: 'list', checked: ctx.mode === 'popup', disabled: ctx.mode === 'popup', onClick: () => chrome.action.openPopup?.().catch(() => toast('Click the VidSnag toolbar icon to open the popup.')) },
    { label: 'Sidebar', icon: 'sidebar', checked: ctx.mode === 'sidebar', disabled: ctx.mode === 'sidebar', onClick: openSidebar },
    { label: 'Separate window', icon: 'window', checked: ctx.mode === 'window', disabled: ctx.mode === 'window', onClick: () => openWindow() },
    { label: 'New tab', icon: 'open', checked: ctx.mode === 'tab', disabled: ctx.mode === 'tab', onClick: () => send({ type: 'open-panel-tab', view: ctx.view }).then(() => ctx.mode === 'popup' && window.close()) },
    'sep',
    pinned
      ? { label: 'Stop keeping on top', icon: 'unpin', onClick: unpin }
      : { label: 'Keep on top of other windows (Picture-in-Picture)', icon: 'pin', onClick: pin },
    'sep',
    { header: 'Toolbar icon opens' },
    { label: 'Popup', checked: ctx.settings.defaultPanel === 'popup', onClick: () => saveSettings({ defaultPanel: 'popup' }).then(() => toast('The toolbar icon now opens the popup')) },
    { label: 'Sidebar', checked: ctx.settings.defaultPanel === 'sidebar', onClick: () => saveSettings({ defaultPanel: 'sidebar' }).then(() => toast('The toolbar icon now opens the sidebar')) }
  ]);
}

function openSettings() {
  if (ctx.settings.settingsOpenIn === 'panel' && ctx.mode !== 'tab') {
    switchView(ctx.view === 'settings' ? 'media' : 'settings');
    return;
  }
  chrome.runtime.openOptionsPage();
  if (ctx.mode === 'popup') window.close();
}

async function savePage() {
  if (!ctx.tab || !/^https?:/.test(ctx.tab.url || '')) { toast('Only web pages can be saved', true); return; }
  library.savePageDialog(ctx.tab);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
const MODE_PANELS = ['sidebar', 'window', 'pip'];
let started = false;
function applySettings(s) {
  ctx.settings = s;
  applyAppearance(s, { sizeBody: ctx.mode === 'popup' });
  const compact = ctx.mode === 'float' || (MODE_PANELS.includes(ctx.mode) && s.sidebarMode === 'mini');
  const changed = compact !== ctx.compact;
  ctx.compact = compact;
  document.body.classList.toggle('mini', compact);
  for (const b of document.querySelectorAll('#modeSwitch button')) {
    const on = b.dataset.mode === (s.sidebarMode === 'unpinned' ? s.lastPinnedMode : s.sidebarMode);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
  if (changed && started) switchView(compact ? 'media' : ctx.view);
}

// Max / Mini / Unpin. Chrome can't resize or float the side panel itself, so Unpin closes the
// panel and every page shows a small indicator at its edge that expands into the Mini panel on hover.
async function setPanelMode(mode) {
  if (mode === 'max' || mode === 'mini') {
    await saveSettings({ sidebarMode: mode, lastPinnedMode: mode });
    return;
  }
  await saveSettings({ sidebarMode: 'unpinned', lastPinnedMode: ctx.settings.sidebarMode === 'mini' ? 'mini' : 'max' });
  toast('Unpinned — hover the VidSnag tab at the edge of the page to open it');
  setTimeout(() => {
    if (ctx.mode === 'pip') { try { window.parent.close(); } catch { window.close(); } }
    else window.close(); // closes the side panel / VidSnag window
  }, 700);
}

async function pinBack() {
  const target = ctx.settings.lastPinnedMode || 'max';
  try {
    await chrome.sidePanel.open({ windowId: ctx.tab?.windowId ?? (await chrome.windows.getCurrent()).id });
  } catch {
    await send({ type: 'open-window' }).catch(() => {}); // side panel not available here: use the window
  }
  await saveSettings({ sidebarMode: target });
}

async function init() {
  document.body.dataset.mode = ctx.mode;
  applySettings(await getSettings());
  ctx.siteRules = await getSiteRules();

  $('btnSavePage').append(icon('bookmark'));
  $('btnHelp').append(icon('help'));
  $('btnOptions').append(icon('gear'));
  updatePinButton();
  $('btnPanel').title = ctx.mode === 'pip' ? 'Pinned on top — click to unpin or switch panel' : 'Sidebar, window or pin';
  $('btnPanel').addEventListener('click', panelMenu);
  $('btnHelp').addEventListener('click', () => switchView(ctx.view === 'help' ? 'media' : 'help'));
  $('btnOptions').addEventListener('click', openSettings);
  $('btnSavePage').addEventListener('click', savePage);
  for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => switchView(b.dataset.view));
  const modeIcons = { max: 'max', mini: 'mini', unpinned: 'unpin' };
  for (const b of document.querySelectorAll('#modeSwitch button')) {
    b.append(icon(modeIcons[b.dataset.mode]), document.createTextNode(` ${b.dataset.mode === 'unpinned' ? 'Unpin' : b.dataset.mode === 'max' ? 'Max' : 'Mini'}`));
    b.addEventListener('click', () => setPanelMode(b.dataset.mode));
  }
  $('modeSwitch').hidden = !MODE_PANELS.includes(ctx.mode);
  $('btnPinBack').hidden = ctx.mode !== 'float';
  $('btnPinBack').addEventListener('click', pinBack);
  // Opening the sidebar or window means the user wants VidSnag pinned again.
  if (MODE_PANELS.includes(ctx.mode) && ctx.settings.sidebarMode === 'unpinned') {
    await saveSettings({ sidebarMode: ctx.settings.lastPinnedMode || 'max' });
    applySettings(await getSettings());
  }

  for (const v of Object.values(VIEWS)) v.init?.();
  started = true;

  setTab(await resolveTab());
  watchTabs();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) getSettings().then((s) => { applySettings(s); for (const v of Object.values(VIEWS)) v.onSettings?.(); });
    if (area === 'local' && changes.siteRules) getSiteRules().then((r) => { ctx.siteRules = r; media.onSettings?.(); });
    for (const v of Object.values(VIEWS)) v.onStorage?.(changes, area);
  });

  // Start on the requested view; in the popup, jump to Downloads when only jobs are interesting.
  let start = ctx.initialView;
  if (!start) start = 'media';
  switchView(start);
  if (!ctx.initialView && ctx.mode === 'popup') {
    await media.ready;
    if (!media.count() && jobs.activeCount()) switchView('jobs');
  }
  if (ctx.mode === 'window' && new URLSearchParams(location.search).get('pinhint')) toast('Click 📌 to pin VidSnag on top');
}

init().catch((e) => { console.error(e); toast(e.message, true); });
