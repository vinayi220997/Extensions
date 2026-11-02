// VidSnag 2.2 suite: page sidebar with Max / Mini / Auto-hide, icon-only controls, resizing,
// hover/click auto-hide, persistence, and independence from the toolbar (extension) pin.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const HERE = path.dirname(new URL(import.meta.url).pathname);
const EXT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'out4');
const BASE = 'http://localhost:8765';
const VW = 1280, VH = 800;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'downloads'), { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 300) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function step(name, fn) { try { await fn(); } catch (e) { check(`${name} (threw)`, false, e.stack?.split('\n').slice(0, 3).join(' | ')); } }
async function waitFor(fn, timeout = 8000, every = 200) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(every); }
  return null;
}

const ctx = await chromium.launchPersistentContext(path.join(OUT, 'profile'), {
  headless: true, channel: 'chromium', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: VW, height: VH }, acceptDownloads: true
});
{ const pg = ctx.pages()[0] || await ctx.newPage(); const cdp = await ctx.newCDPSession(pg); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.join(OUT, 'downloads') }); }
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
await sleep(800); // let onInstalled write defaults first
const settings = () => sw.evaluate(async () => (await chrome.storage.sync.get('settings')).settings);
const setSettings = (p) => sw.evaluate(async (p) => { const { settings } = await chrome.storage.sync.get('settings'); await chrome.storage.sync.set({ settings: { ...settings, ...p } }); }, p);
await setSettings({ minFileSizeKB: 50, notifications: false });
const toolbarPin = () => sw.evaluate(async () => (chrome.action.getUserSettings ? (await chrome.action.getUserSettings()).isOnToolbar : 'n/a'));

const page = await ctx.newPage();
await page.goto(`${BASE}/page-slow.html`);
await page.waitForTimeout(2500);
const host = page.locator('vidsnag-sidebar');
const attr = (n) => host.getAttribute(n);
const margin = () => page.evaluate(() => getComputedStyle(document.documentElement).marginRight);
const dockFrame = () => waitFor(async () => page.frames().find((f) => f.url().includes('mode=dock')) || null, 8000);
// Mode buttons are triggered inside the frame (real-mouse clicks are covered by pin-click.mjs).
const clickMode = async (f, m) => { await f.evaluate((m) => document.querySelector(`#modeSwitch button[data-mode="${m}"]`).click(), m); await page.waitForTimeout(700); };
const pinBefore = await toolbarPin();

await step('max', async () => {
  await setSettings({ defaultPanel: 'docked' });
  await sleep(500);
  const ap = await sw.evaluate(async () => ({ popup: await chrome.action.getPopup({}), beh: await chrome.sidePanel.getPanelBehavior() }));
  check('Default panel “Page sidebar”: toolbar icon toggles the page sidebar', ap.popup === '' && ap.beh.openPanelOnActionClick === false, JSON.stringify(ap));
  await sw.evaluate(() => globalThis.__vidsnag.openDock(true));
  await host.waitFor({ state: 'attached', timeout: 5000 });
  await page.waitForTimeout(500); // slide-in transition
  check('Page sidebar opens in Max at its default width (380 px)', (await attr('data-mode')) === 'max' && (await attr('data-width')) === '380');
  check('Page is shrunk next to the sidebar (doesn’t cover content)', (await margin()) === '380px', await margin());
  const f = await dockFrame();
  await waitFor(() => f.evaluate(() => !!document.querySelector('#modeSwitch button[title]') && document.querySelectorAll('#mediaList .card').length > 0).catch(() => false), 10000);
  const btns = await f.evaluate(() => [...document.querySelectorAll('#modeSwitch button')].map((b) => ({ m: b.dataset.mode, text: b.innerText.trim(), tip: b.title, aria: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), svg: !!b.querySelector('svg') })));
  check('Exactly three icon-only mode controls (no text labels)', btns.length === 3 && btns.every((b) => !b.text && b.svg), JSON.stringify(btns.map((b) => b.text)));
  check('Each control has a tooltip and an ARIA label', btns.every((b) => b.tip && b.aria && b.tip === b.aria), btns.map((b) => b.tip).join(' | '));
  check('Active mode highlighted (Max pressed)', btns.find((b) => b.m === 'max').pressed === 'true' && btns.filter((b) => b.pressed === 'true').length === 1);
  const full = await f.evaluate(() => ({ tabs: getComputedStyle(document.querySelector('.tabs')).display !== 'none', sort: !!document.querySelector('#mediaSort'), filters: !!document.querySelector('#mediaFilters'), cards: document.querySelectorAll('#mediaList .card').length }));
  check('Max shows the complete interface (tabs, filters, sort, cards)', full.tabs && full.sort && full.filters && full.cards === 2, JSON.stringify(full));
  await page.screenshot({ path: path.join(OUT, 'max.png') });

  // Resize by dragging the left edge
  const edge = VW - 380;
  await page.mouse.move(edge, 400);
  await page.mouse.down();
  await page.mouse.move(edge - 60, 400, { steps: 5 });
  await page.mouse.move(edge - 120, 400, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const s = await settings();
  check('Drag the edge to resize Max (width saved)', (await attr('data-width')) === '500' && s.sidebarMaxWidth === 500 && (await margin()) === '500px', `${await attr('data-width')} ${s.sidebarMaxWidth} ${await margin()}`);
});

await step('mini', async () => {
  const f = await dockFrame();
  await clickMode(f, 'mini');
  const exp = String(Math.max(92, Math.round(VW * 0.07)));
  check('Mini: narrow sidebar ≈ 5–10 % of the window (min usable width)', (await attr('data-mode')) === 'mini' && (await attr('data-width')) === exp && (await margin()) === `${exp}px`, `${await attr('data-width')} vs ${exp}`);
  const pressed = await f.evaluate(() => document.querySelector('#modeSwitch button[aria-pressed="true"]').dataset.mode);
  check('Immediate feedback: Mini highlighted', pressed === 'mini');
  await setSettings({ sidebarMiniPct: 10 });
  await page.waitForTimeout(500);
  check('Mini width follows the setting (10 % → 128 px)', (await attr('data-width')) === '128', await attr('data-width'));
  const ui = await f.evaluate(() => ({
    cards: document.querySelectorAll('.mini-card').length,
    stacked: getComputedStyle(document.querySelector('.mini-card')).flexDirection,
    info: [...document.querySelectorAll('.mini-info')].map((x) => x.innerText),
    buttons: document.querySelectorAll('.mini-card .mini-go').length,
    hiddenExtras: ['.tabs', '#view-media .toolbar', '.bottom', '.brand'].every((sel) => getComputedStyle(document.querySelector(sel)).display === 'none'),
    modesVisible: getComputedStyle(document.querySelector('#modeSwitch')).display !== 'none',
    width: innerWidth
  }));
  check('Mini shows only essentials: thumbnail, duration, size, download button', ui.cards === 2 && ui.stacked === 'column' && ui.buttons === 2 && ui.hiddenExtras, JSON.stringify(ui));
  const info = await waitFor(async () => {
    const t = await f.evaluate(() => [...document.querySelectorAll('.mini-info')].map((x) => x.innerText));
    return t.some((x) => /\d+:\d\d/.test(x) && /MB/.test(x)) ? t : null;
  }, 15000);
  check('Mini info includes duration and size', !!info, (info || ui.info).join(' / '));
  check('Mode controls stay accessible in Mini (Max one click away)', ui.modesVisible);
  await page.screenshot({ path: path.join(OUT, 'mini.png') });

  // Progress ring in the narrow column: circle while downloading, square while paused
  await setSettings({ maxConcurrentSegments: 1 });
  await f.evaluate(() => [...document.querySelectorAll('.mini-card')].find((c) => /HLS/.test(c.innerText)).querySelector('.mini-go').click());
  const ring = await waitFor(() => f.evaluate(() => !!document.querySelector('.mini-frame.st-active .ring circle.bar')), 15000);
  check('Mini: circular progress ring while downloading', !!ring);
  await page.screenshot({ path: path.join(OUT, 'mini-progress.png') });
  await waitFor(() => f.evaluate(() => !!document.querySelector('.mini-card .icon-btn[aria-label="Pause download"]')), 8000);
  await f.evaluate(() => document.querySelector('.mini-card .icon-btn[aria-label="Pause download"]').click());
  const sq = await waitFor(() => f.evaluate(() => !!document.querySelector('.mini-frame.st-paused .ring.paused rect.bar')), 6000);
  check('Mini: square pause indicator while paused', !!sq);
  await page.screenshot({ path: path.join(OUT, 'mini-paused.png') });
  await f.evaluate(() => document.querySelector('.mini-card .icon-btn[aria-label="Resume download"]')?.click());
  await setSettings({ maxConcurrentSegments: 4 });
});

await step('autohide', async () => {
  const f = await dockFrame();
  await clickMode(f, 'autohide');
  const s = await settings();
  check('Auto-hide: sidebar collapses to an edge handle; page uses full width', (await attr('data-mode')) === 'autohide' && (await attr('data-expanded')) === 'false' && (await margin()) === '0px' && s.lastPinnedMode === 'mini', `${await attr('data-mode')} ${await margin()} ${s.lastPinnedMode}`);
  await page.waitForTimeout(400);
  // The handle is the only visible part (closed shadow DOM → probe the screen)
  const atEdge = await page.evaluate(([w, h]) => document.elementFromPoint(w - 8, h * 0.45)?.tagName, [VW, VH]);
  const offEdge = await page.evaluate(([w, h]) => document.elementFromPoint(w - 60, h * 0.45)?.tagName, [VW, VH]);
  check('Only a small handle at the right edge is visible', atEdge === 'VIDSNAG-SIDEBAR' && offEdge !== 'VIDSNAG-SIDEBAR', `${atEdge} / ${offEdge}`);
  await page.screenshot({ path: path.join(OUT, 'autohide.png') });

  // Hover trigger
  await page.mouse.move(VW - 8, VH * 0.45);
  await page.waitForTimeout(700);
  check('Hover the handle → sidebar slides out (at the remembered Mini width)', (await attr('data-expanded')) === 'true' && (await attr('data-width')) === '128' && (await margin()) === '0px');
  await page.screenshot({ path: path.join(OUT, 'autohide-open.png') });
  await page.mouse.move(300, 400);
  await page.waitForTimeout(900);
  check('Pointer leaves → collapses again', (await attr('data-expanded')) === 'false');

  // Click trigger
  await setSettings({ autoHideTrigger: 'click' });
  await page.waitForTimeout(400);
  await page.mouse.move(VW - 8, VH * 0.45);
  await page.waitForTimeout(700);
  check('Click mode: hovering does not open it', (await attr('data-expanded')) === 'false');
  await page.mouse.click(VW - 8, VH * 0.45);
  await page.waitForTimeout(500);
  check('Click mode: click the handle → opens', (await attr('data-expanded')) === 'true');
  await page.mouse.move(VW - 60, 300);
  await page.waitForTimeout(800);
  check('Click mode: stays open when the pointer moves away', (await attr('data-expanded')) === 'true');
  await page.mouse.click(200, 300);
  await page.waitForTimeout(500);
  check('Click mode: click outside → collapses', (await attr('data-expanded')) === 'false');
  // Keyboard: handle is a button
  await page.keyboard.press('Tab');
  await setSettings({ autoHideTrigger: 'hover' });

  // Pin again: Auto-hide button toggles back to the previous size
  await page.mouse.move(VW - 8, VH * 0.45);
  await page.waitForTimeout(800);
  const fr = await dockFrame();
  const tip = await fr.evaluate(() => document.querySelector('#modeSwitch button[data-mode="autohide"]').title);
  check('Auto-hide button explains how to pin again', /pin the sidebar again/i.test(tip), tip);
  await clickMode(fr, 'autohide');
  check('Pin again → previous Mini size restored and docked', (await attr('data-mode')) === 'mini' && (await attr('data-width')) === '128' && (await margin()) === '128px');
  await clickMode(fr, 'max');
  check('Max restores the previously resized width (500 px)', (await attr('data-mode')) === 'max' && (await attr('data-width')) === '500');
});

await step('persistence', async () => {
  const f = await dockFrame();
  await clickMode(f, 'mini');
  await page.reload();
  await page.waitForTimeout(2500);
  check('After reload: sidebar shown again in the last mode and size', (await attr('data-mode')) === 'mini' && (await attr('data-width')) === '128');
  const p2 = await ctx.newPage();
  await p2.goto(`${BASE}/page-mp4.html`);
  await p2.waitForTimeout(2500);
  check('Other pages show the same sidebar state', (await p2.locator('vidsnag-sidebar').getAttribute('data-mode')) === 'mini');
  await p2.close();
  const s = await settings();
  check('Preferences stored: mode, Max width, Mini width, trigger, open state', s.sidebarMode === 'mini' && s.sidebarMaxWidth === 500 && s.sidebarMiniPct === 10 && s.autoHideTrigger === 'hover' && s.dockOpen === true && s.lastPinnedMode === 'mini', JSON.stringify({ m: s.sidebarMode, w: s.sidebarMaxWidth, p: s.sidebarMiniPct, t: s.autoHideTrigger, o: s.dockOpen }));
  // Overlay layout
  await setSettings({ dockLayout: 'overlay' });
  await page.waitForTimeout(500);
  check('Overlay layout: page keeps its full width', (await margin()) === '0px');
  await setSettings({ dockLayout: 'push' });
});

await step('chrome-side-panel-handoff', async () => {
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url.includes('page-slow')).id);
  const sp = await ctx.newPage();
  await sp.setViewportSize({ width: 360, height: 640 });
  await sp.goto(`chrome-extension://${extId}/popup/popup.html?mode=sidebar&tabId=${tabId}`);
  await sp.waitForTimeout(800);
  check('Chrome side panel shows the same three icon controls', (await sp.locator('#modeSwitch button').count()) === 3 && (await sp.locator('#modeSwitch').isVisible()));
  await sp.evaluate(() => document.querySelector('#modeSwitch button[data-mode="autohide"]').click());
  await sleep(1200);
  const s = await settings();
  check('Auto-hide from Chrome’s side panel hands over to the page edge handle', s.sidebarMode === 'autohide' && s.dockOpen === true);
  if (!sp.isClosed()) await sp.close();
  await page.bringToFront();
  await page.waitForTimeout(500);
  check('Page now shows the edge handle', (await attr('data-mode')) === 'autohide');
});

await step('close-and-toolbar-pin', async () => {
  await setSettings({ sidebarMode: 'max', lastPinnedMode: 'max' });
  await page.waitForTimeout(400);
  const f = await dockFrame();
  await f.evaluate(() => document.getElementById('btnCloseDock').click());
  await page.waitForTimeout(600);
  check('Close (×) removes the sidebar and restores the page', (await page.locator('vidsnag-sidebar').count()) === 0 && (await margin()) === '0px' && (await settings()).dockOpen === false);
  const after = await toolbarPin();
  check('Extension toolbar pin untouched by all sidebar changes', after === pinBefore, `before ${pinBefore}, after ${after}`);
  const code = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8') + fs.readFileSync(path.join(EXT, 'content-dock.js'), 'utf8') + fs.readFileSync(path.join(EXT, 'popup/app.js'), 'utf8');
  check('No code tries to change the toolbar pin (setUserSettings / isOnToolbar writes)', !/setUserSettings|isOnToolbar\s*=/.test(code));
});

await ctx.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
