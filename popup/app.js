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
  if (ctx.mode === 'dock') return (await chrome.tabs.getCurrent()) || null; // the page hosting the sidebar
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
  if (ctx.forcedTabId || ctx.mode === 'popup' || ctx.mode === 'dock') return;
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
    { label: 'Page sidebar (Max / Mini / Auto-hide)', icon: 'sidebar', checked: ctx.mode === 'dock', disabled: ctx.mode === 'dock', onClick: openDock },
    { label: 'Chrome side panel', icon: 'sidebar', checked: ctx.mode === 'sidebar', disabled: ctx.mode === 'sidebar', onClick: openSidebar },
    { label: 'Separate window', icon: 'window', checked: ctx.mode === 'window', disabled: ctx.mode === 'window', onClick: () => openWindow() },
    { label: 'New tab', icon: 'open', checked: ctx.mode === 'tab', disabled: ctx.mode === 'tab', onClick: () => send({ type: 'open-panel-tab', view: ctx.view }).then(() => ctx.mode === 'popup' && window.close()) },
    'sep',
    pinned
      ? { label: 'Stop keeping on top', icon: 'unpin', onClick: unpin }
      : { label: 'Keep on top of other windows (Picture-in-Picture)', icon: 'pin', onClick: pin },
    'sep',
    { header: 'Toolbar icon opens' },
    { label: 'Popup', checked: ctx.settings.defaultPanel === 'popup', onClick: () => saveSettings({ defaultPanel: 'popup' }).then(() => toast('The toolbar icon now opens the popup')) },
    { label: 'Page sidebar', checked: ctx.settings.defaultPanel === 'docked', onClick: () => saveSettings({ defaultPanel: 'docked' }).then(() => toast('The toolbar icon now shows/hides the page sidebar')) },
    { label: 'Chrome side panel', checked: ctx.settings.defaultPanel === 'sidebar', onClick: () => saveSettings({ defaultPanel: 'sidebar' }).then(() => toast('The toolbar icon now opens Chrome\u2019s side panel')) }
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
// Panels that show the Max / Mini / Auto-Hide controls.
const MODE_PANELS = ['dock', 'sidebar', 'window', 'pip'];
const MODE_INFO = {
  max: { icon: 'panelMax', tip: 'Max — full sidebar' },
  mini: { icon: 'panelMini', tip: 'Mini — compact sidebar' },
  autohide: { icon: 'panelHide', tip: 'Auto-hide — collapse to an edge handle' }
};
let started = false;
function applySettings(s) {
  ctx.settings = s;
  applyAppearance(s, { sizeBody: ctx.mode === 'popup' });
  const size = s.sidebarMode === 'autohide' ? s.lastPinnedMode : s.sidebarMode;
  const compact = MODE_PANELS.includes(ctx.mode) && size === 'mini';
  const changed = compact !== ctx.compact;
  ctx.compact = compact;
  document.body.classList.toggle('mini', compact);
  document.body.dataset.sidebar = s.sidebarMode;
  for (const b of document.querySelectorAll('#modeSwitch button')) {
    const m = b.dataset.mode;
    const on = m === s.sidebarMode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
    const tip = m === 'autohide' && on ? 'Auto-hide is on — click to pin the sidebar again' : MODE_INFO[m].tip;
    b.title = tip;
    b.setAttribute('aria-label', tip);
  }
  if (changed && started) switchView(compact ? 'media' : ctx.view);
}

// Max / Mini / Auto-hide. These only change VidSnag's sidebar — never the toolbar pin of the
// extension icon, which Chrome alone controls (puzzle-piece menu).
async function setPanelMode(mode) {
  const s = ctx.settings;
  if (mode === 'autohide' && s.sidebarMode === 'autohide') mode = s.lastPinnedMode || 'max'; // click again = pin
  if (mode === 'max' || mode === 'mini') {
    await saveSettings({ sidebarMode: mode, lastPinnedMode: mode });
    toast(mode === 'max' ? 'Max sidebar' : 'Mini sidebar');
    return;
  }
  const lastPinnedMode = s.sidebarMode === 'mini' ? 'mini' : s.sidebarMode === 'max' ? 'max' : s.lastPinnedMode;
  if (ctx.mode === 'dock') {
    await saveSettings({ sidebarMode: 'autohide', lastPinnedMode });
    return; // the page sidebar slides away to its edge handle
  }
  // Chrome's side panel / a window can't shrink to a handle: hand over to the page sidebar.
  await saveSettings({ sidebarMode: 'autohide', lastPinnedMode, dockOpen: true });
  toast('Auto-hide on — use the handle at the right edge of the page');
  setTimeout(() => {
    if (ctx.mode === 'pip') { try { window.parent.close(); } catch { window.close(); } }
    else if (ctx.mode !== 'tab') window.close(); // closes the side panel / VidSnag window
  }, 700);
}

async function openDock() {
  await send({ type: 'open-dock' });
  toast('Page sidebar shown on web pages');
  if (ctx.mode === 'popup') setTimeout(() => window.close(), 400);
}

async function closeDock() {
  await saveSettings({ dockOpen: false });
}

// Refuse to run inside a web page, except as the floating panel opened by VidSnag's own content
// script (verified with a per-session secret). Stops other sites from framing the VidSnag UI.
async function allowedToRun() {
  let framed = false;
  try { framed = window.top !== window && window.top.location.origin !== location.origin; } catch { framed = true; }
  if (!framed) return true;
  if (ctx.mode !== 'dock') return false;
  const token = new URLSearchParams(location.hash.slice(1)).get('t') || '';
  window.history.replaceState(null, '', location.pathname + location.search); // don't leave the secret in the URL
  try { return await send({ type: 'check-float-token', token }); } catch { return false; }
}

async function init() {
  if (!(await allowedToRun())) {
    document.body.replaceChildren();
    document.body.textContent = 'VidSnag can only be opened from its own button or panel.';
    return;
  }
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
  for (const b of document.querySelectorAll('#modeSwitch button')) {
    b.append(icon(MODE_INFO[b.dataset.mode].icon));
    b.addEventListener('click', () => setPanelMode(b.dataset.mode));
  }
  // Arrow keys move between the three mode buttons.
  $('modeSwitch').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const btns = [...document.querySelectorAll('#modeSwitch button')];
    const i = btns.indexOf(document.activeElement);
    btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length]?.focus();
  });
  $('modeSwitch').hidden = !MODE_PANELS.includes(ctx.mode);
  $('btnCloseDock').hidden = ctx.mode !== 'dock';
  $('btnCloseDock').append(icon('close'));
  $('btnCloseDock').addEventListener('click', closeDock);
  applySettings(ctx.settings); // tooltips/active state now that the buttons exist
  // Opening Chrome's side panel or a window means the user wants the sidebar pinned again.
  if (['sidebar', 'window', 'pip'].includes(ctx.mode) && ctx.settings.sidebarMode === 'autohide') {
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
