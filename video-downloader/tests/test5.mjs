// VidPull 3.0 suite: brand defaults, one sidebar at a time, Close in Mini, accent-coloured
// icons/handle, and the page sidebar not overlaying app-shell pages (fixed full-screen layouts).
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const HERE = path.dirname(new URL(import.meta.url).pathname);
const EXT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'out5');
const BASE = 'http://localhost:8765';
const VW = 1280, VH = 800;
fs.rmSync(OUT, { recursive: true, force: true });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 300) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function step(name, fn) { try { await fn(); } catch (e) { check(`${name} (threw)`, false, e.stack?.split('\n').slice(0, 3).join(' | ')); } }
async function waitFor(fn, timeout = 8000) { const end = Date.now() + timeout; while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await sleep(200); } return null; }

const ctx = await chromium.launchPersistentContext(path.join(OUT, 'profile'), { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`], viewport: { width: VW, height: VH } });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
await sleep(900);
const settings = () => sw.evaluate(async () => (await chrome.storage.sync.get('settings')).settings);
const setSettings = (p) => sw.evaluate(async (p) => { const { settings } = await chrome.storage.sync.get('settings'); await chrome.storage.sync.set({ settings: { ...settings, ...p } }); }, p);
const dockFrame = (page) => page.frames().find((f) => f.url().includes('mode=dock'));

await step('Brand defaults', async () => {
  const s = await settings();
  const m = await sw.evaluate(() => chrome.runtime.getManifest());
  check('Manifest is VidPull 3.x', m.name.startsWith('VidPull') && m.version.startsWith('3.'), `${m.name} ${m.version}`);
  check('Default colour is orange, folder VidPull', s.accent === 'orange' && s.subfolder === 'VidPull', `${s.accent} ${s.subfolder}`);
});

await step('Old VidSnag settings migrate', async () => {
  await sw.evaluate(async () => { const { settings } = await chrome.storage.sync.get('settings'); await chrome.storage.sync.set({ settings: { ...settings, subfolder: 'VidSnag', sidebarMode: 'unpinned' } }); });
  const pg = await ctx.newPage();
  await pg.goto(`chrome-extension://${extId}/popup/popup.html?mode=tab`);
  const v = await pg.evaluate(async () => (await import('../lib/settings.js')).getSettings());
  await pg.close();
  check('VidSnag folder → VidPull, unpinned → auto-hide', (v.subfolder === 'VidPull' && v.sidebarMode === 'autohide'), JSON.stringify(v && { f: v.subfolder, m: v.sidebarMode }));
  await setSettings({ subfolder: 'VidPull', sidebarMode: 'max', dockOpen: false });
});

await step('Header logo follows the theme colour', async () => {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${extId}/popup/popup.html?mode=tab`);
  await p.waitForSelector('.brand svg.logo');
  const fill = () => p.evaluate(() => getComputedStyle(document.querySelector('.brand svg.logo rect')).fill);
  const a = await fill();
  await setSettings({ accent: 'blue' });
  const b = await waitFor(async () => { const f = await fill(); return f !== a ? f : null; });
  check('Logo is orange by default and turns blue with the Blue colour', a === 'rgb(234, 88, 12)' && b === 'rgb(37, 99, 235)', `${a} → ${b}`);
  await setSettings({ accent: 'orange' });
  await p.close();
});

await step('Toolbar icon is redrawn in the theme colour', async () => {
  const err = await sw.evaluate(async () => {
    const c = new OffscreenCanvas(16, 16); const g = c.getContext('2d'); g.fillStyle = '#2563eb'; g.fillRect(0, 0, 16, 16);
    try { await chrome.action.setIcon({ imageData: { 16: g.getImageData(0, 0, 16, 16) } }); return ''; } catch (e) { return e.message; }
  });
  const src = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
  check('setIcon(imageData) works and runs on settings change', !err && /applyToolbarIcon\(\);\n\s+if \(changes\.settings\.newValue\?\.dockOpen/.test(src), err);
});

await step('App-shell page is pushed, not overlaid', async () => {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/page-app.html`);
  await sleep(600);
  await setSettings({ dockOpen: true, sidebarMode: 'mini', sidebarMiniPct: 7, dockLayout: 'push' });
  const host = p.locator('vidpull-sidebar');
  await waitFor(async () => (await host.getAttribute('data-mode')) === 'mini');
  await sleep(500);
  const w = Number(await host.getAttribute('data-width'));
  const r = await p.evaluate(() => document.getElementById('top').getBoundingClientRect().right);
  check('Mini width ≥ 100 px and the fixed app content ends before the sidebar', w >= 100 && r <= VW - w, `width ${w}, content right ${r}`);
  const hit = await p.evaluate((w) => [document.elementFromPoint(innerWidth - w / 2, 400)?.tagName, document.elementFromPoint(innerWidth - w - 20, 400)?.tagName], w);
  check('Sidebar sits at the window edge, beside (not over) the app', hit[0] === 'VIDPULL-SIDEBAR' && hit[1] !== 'VIDPULL-SIDEBAR', JSON.stringify(hit));
  await p.screenshot({ path: path.join(OUT, 'app-shell-mini.png') });
  await setSettings({ sidebarMode: 'max', sidebarMaxWidth: 400 });
  await waitFor(async () => (await host.getAttribute('data-mode')) === 'max');
  await sleep(500);
  const r2 = await p.evaluate(() => document.getElementById('top').getBoundingClientRect().right);
  check('Max also pushes the app shell', r2 <= VW - 400, `right ${r2}`);
  await setSettings({ dockOpen: false });
  await waitFor(async () => (await host.count()) === 0);
  await sleep(300);
  const r3 = await p.evaluate(() => [document.getElementById('top').getBoundingClientRect().right, document.documentElement.getAttribute('style') || '']);
  check('Closing restores the page', r3[0] === VW - 8 && !/width|transform/.test(r3[1]), JSON.stringify(r3));
  await p.close();
});

await step('Normal scrolling page still uses margin push', async () => {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: VW, height: 300 });
  await p.goto(`${BASE}/page-sort.html`);
  await p.evaluate(() => { document.body.style.minHeight = '2000px'; });
  await setSettings({ dockOpen: true, sidebarMode: 'max', sidebarMaxWidth: 380 });
  await waitFor(() => p.evaluate(() => document.documentElement.style.marginRight === '380px'));
  const st = await p.evaluate(() => [document.documentElement.style.marginRight, document.documentElement.style.transform]);
  check('Scrolling page gets margin-right, no transform', st[0] === '380px' && !st[1], JSON.stringify(st));
  await setSettings({ dockOpen: false });
  await p.close();
});

await step('Close button in Mini', async () => {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/page-mp4.html`);
  await setSettings({ dockOpen: true, sidebarMode: 'mini', sidebarMiniPct: 7 });
  const f = await waitFor(async () => { const fr = dockFrame(p); return fr && (await fr.$('#btnCloseDock')) ? fr : null; }, 10000);
  await f.waitForFunction(() => document.body.classList.contains('mini'));
  const vis = await f.evaluate(() => { const b = document.getElementById('btnCloseDock'); const r = b.getBoundingClientRect(); return { shown: !b.hidden && r.width > 0 && r.right <= innerWidth + 1, others: [...document.querySelectorAll('.top-actions > :not(#btnCloseDock)')].every((e) => !e.offsetWidth) }; });
  check('Mini shows a Close button (other header buttons hidden)', vis.shown && vis.others, JSON.stringify(vis));
  await f.evaluate(() => document.getElementById('btnCloseDock').click());
  const closed = await waitFor(async () => (await settings()).dockOpen === false && (await p.locator('vidpull-sidebar').count()) === 0);
  check('Close in Mini closes the page sidebar', !!closed);
  await p.close();
});

await step('Handle uses the theme colour', async () => {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/page-mp4.html`);
  await setSettings({ dockOpen: true, sidebarMode: 'autohide', lastPinnedMode: 'max', accent: 'violet' });
  const host = p.locator('vidpull-sidebar');
  await waitFor(async () => (await host.getAttribute('data-mode')) === 'autohide');
  const acc = await host.evaluate((h) => h.style.getPropertyValue('--accent'));
  check('Auto-hide handle colour = Violet', acc === '#7c3aed', acc);
  await setSettings({ accent: 'custom', accentCustom: '#123456' });
  const acc2 = await waitFor(async () => { const v = await host.evaluate((h) => h.style.getPropertyValue('--accent')); return v === '#123456' ? v : null; });
  check('Custom colour reaches the handle', acc2 === '#123456', acc2);
  await setSettings({ accent: 'orange', dockOpen: false, sidebarMode: 'max' });
  await p.close();
});

await step('Only one sidebar at a time', async () => {
  await setSettings({ dockOpen: true, sidebarMode: 'mini' });
  // Chrome's side panel page opens → the page sidebar closes.
  const side = await ctx.newPage();
  await side.goto(`chrome-extension://${extId}/popup/popup.html?mode=sidebar`);
  const off = await waitFor(async () => (await settings()).dockOpen === false);
  check('Opening Chrome\'s side panel closes the page sidebar', !!off);
  // Page sidebar opens again (toolbar/menu/Auto-hide) → the side panel page closes itself.
  const closedP = side.waitForEvent('close', { timeout: 6000 }).then(() => true).catch(() => false);
  await sw.evaluate(() => globalThis.__vidpull.openDock());
  check('Opening the page sidebar closes Chrome\'s side panel', await closedP);
  // Auto-hide clicked inside Chrome's side panel → moves to the page edge, side panel closes.
  await setSettings({ dockOpen: false, sidebarMode: 'max' });
  const side2 = await ctx.newPage();
  await side2.goto(`chrome-extension://${extId}/popup/popup.html?mode=sidebar`);
  await side2.waitForSelector('#modeSwitch button[data-mode="autohide"]');
  const closed2 = side2.waitForEvent('close', { timeout: 6000 }).then(() => true).catch(() => false);
  await side2.evaluate(() => document.querySelector('#modeSwitch button[data-mode="autohide"]').click());
  const s = await waitFor(async () => { const v = await settings(); return v.dockOpen && v.sidebarMode === 'autohide' ? v : null; });
  check('Auto-hide from the side panel leaves only the edge handle', !!s && await closed2);
  await setSettings({ dockOpen: false, sidebarMode: 'max' });
});

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
await ctx.close();
process.exit(pass === results.length ? 0 : 1);
