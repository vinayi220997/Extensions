// VidSnag 2.1 suite: sorting (+ with filters), duration/size info, global vs per-site default
// actions, pause/resume, sidebar Max/Mini/Unpinned modes with progress rings and the floating indicator.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const HERE = path.dirname(new URL(import.meta.url).pathname);
const EXT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'out3');
const DL = path.join(OUT, 'downloads');
const BASE = 'http://localhost:8765';
const ALT = 'http://127.0.0.1:8765'; // a different website (host) for global-vs-site tests
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'profile/Default'), { recursive: true });
fs.mkdirSync(DL, { recursive: true });
fs.writeFileSync(path.join(OUT, 'profile/Default/Preferences'), JSON.stringify({ download: { default_directory: DL, prompt_for_download: false } }));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 300) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ONLY = process.env.ONLY;
async function step(name, fn) { if (ONLY && ONLY !== name) return; try { await fn(); } catch (e) { check(`${name} (threw)`, false, e.stack?.split('\n').slice(0, 3).join(' | ')); } }

const ctx = await chromium.launchPersistentContext(path.join(OUT, 'profile'), {
  headless: true, channel: 'chromium', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1100, height: 800 }
});
{ const pg = ctx.pages()[0] || await ctx.newPage(); const cdp = await ctx.newCDPSession(pg); await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' }); }
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
const setSettings = (p) => sw.evaluate(async (p) => { const { settings } = await chrome.storage.sync.get('settings'); await chrome.storage.sync.set({ settings: { ...settings, ...p } }); }, p);
const settings = () => sw.evaluate(async () => (await chrome.storage.sync.get('settings')).settings);
await setSettings({ minFileSizeKB: 50, notifications: false });
const tabIdFor = (url) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
const tabState = (id) => sw.evaluate(async (id) => (await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`], id);
const jobs = () => sw.evaluate(async () => Object.values((await chrome.storage.session.get('jobs')).jobs || {}));
async function waitFor(fn, timeout = 30000, every = 300) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(every); }
  return null;
}
async function openPage(url, wait = 3000) {
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(wait);
  return { page, tabId: await tabIdFor(url) };
}
async function panel(tabId, extra = '', size = { width: 420, height: 600 }) {
  const p = await ctx.newPage();
  await p.setViewportSize(size);
  await p.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tabId}${extra}`);
  await p.waitForTimeout(800);
  return p;
}
const titles = (p) => p.locator('#mediaList .card .title').allInnerTexts();

// ======================= Sorting + media info =======================
await step('sorting', async () => {
  const { page, tabId } = await openPage(`${BASE}/page-sort.html`);
  const p = await panel(tabId);
  // durations of link-only files are measured by the panel
  const durs = await waitFor(async () => {
    const t = await p.locator('#mediaList .card .m-dur').allInnerTexts();
    return t.length === 3 && t.every((x) => /^\d+:\d\d$/.test(x)) ? t : null;
  }, 15000);
  check('Duration shown on every card (measured when the page didn’t say)', !!durs, JSON.stringify(durs || await p.locator('#mediaList .card .m-dur').allInnerTexts()));
  const sizes = await p.locator('#mediaList .card .m-size').allInnerTexts();
  check('Size on every card; streams show an estimate (~)', sizes.length === 3 && sizes.some((x) => x.startsWith('~')), sizes.join(' | '));
  const meta = await p.locator('#mediaList .card').filter({ hasText: 'HLS' }).locator('.meta').innerText();
  check('Codec info shown for streams', /H\.264\/AAC/.test(meta), meta.replace(/\s+/g, ' '));

  const sortBy = async (v) => { await p.selectOption('#mediaSort', v); await p.waitForTimeout(400); return titles(p); };
  let t = await sortBy('name-asc');
  check('Sort: Name A–Z', t.join('|') === 'apple short clip|Sort test|Zebra long video', t.join('|'));
  t = await sortBy('name-desc');
  check('Sort: Name Z–A', t.join('|') === 'Zebra long video|Sort test|apple short clip', t.join('|'));
  t = await sortBy('duration-asc');
  check('Sort: Duration shortest first', t[0] === 'apple short clip', t.join('|'));
  t = await sortBy('duration-desc');
  check('Sort: Duration longest first', t[2] === 'apple short clip', t.join('|'));
  t = await sortBy('size-asc');
  check('Sort: Size smallest first', t[0] === 'apple short clip', t.join('|'));
  t = await sortBy('size-desc');
  check('Sort: Size largest first (estimate counts)', t[0] === 'Sort test' && t[2] === 'apple short clip', t.join('|'));
  t = await sortBy('quality-desc');
  check('Sort: Quality highest first', t[2] === 'apple short clip', t.join('|'));
  t = await sortBy('quality-asc');
  check('Sort: Quality lowest first', t[0] === 'apple short clip', t.join('|'));
  t = await sortBy('added-desc');
  const tAsc = await sortBy('added-asc');
  check('Sort: Date added newest / oldest', t.join() === [...tAsc].reverse().join() && t.length === 3, `${t.join('|')} vs ${tAsc.join('|')}`);
  t = await sortBy('site-asc');
  check('Sort: Website / source', t.length === 3);
  check('Sort choice saved in settings', (await settings()).sortBy === 'site-asc');

  // Download one item, then sort by status
  await p.locator('#mediaList .card', { hasText: 'apple short clip' }).locator('.btn.primary').click();
  await waitFor(async () => (await jobs()).some((j) => j.status === 'done' && j.source.url.endsWith('clip.webm')), 20000);
  await p.waitForTimeout(800);
  t = await sortBy('status');
  const chip = await p.locator('#mediaList .card', { hasText: 'apple short clip' }).locator('.chip.good').count();
  check('Download status shown on the card + Sort by status (not downloaded first)', chip === 1 && t[2] === 'apple short clip', t.join('|'));

  // Sorting + filtering together
  await p.locator('#mediaFilters .chip-btn', { hasText: 'Files' }).click();
  t = await sortBy('size-desc');
  check('Sorting works together with filters', t.join('|') === 'Zebra long video|apple short clip', t.join('|'));
  await p.locator('#mediaFilters .chip-btn', { hasText: 'All' }).click();
  await p.fill('#mediaSearch', 'e');
  t = await sortBy('name-desc');
  check('Sorting works together with search', t[0] === 'Zebra long video' && t.length === 3, t.join('|'));
  await p.fill('#mediaSearch', '');
  await setSettings({ sortBy: 'added-asc' });
  await p.close(); await page.close();
});

// ======================= Global vs per-site default action =======================
await step('global-defaults', async () => {
  const a = await openPage(`${BASE}/page-mp4.html`);
  const b = await openPage(`${ALT}/page-mp4.html`);
  const pa = await panel(a.tabId);
  const big = pa.locator('#mediaList .card').filter({ hasText: 'big.mp4' }).first();
  await big.locator('.icon-btn[aria-label="More actions"]').click();
  await pa.locator('.menu button', { hasText: 'Always download audio — all websites' }).click();
  await pa.waitForTimeout(500);
  check('“Always download audio — all websites” saves the global default', (await settings()).defaultAction === 'audio');
  const pb = await panel(b.tabId);
  const labelB = await pb.locator('#mediaList .card').filter({ hasText: 'big.mp4' }).first().locator('.btn.primary').innerText();
  const webmB = await pb.locator('#mediaList .card').filter({ hasText: 'clip.webm' }).first().locator('.btn.primary').innerText();
  check('Global default applies on another website (main button = Audio)', /Audio/.test(labelB), labelB);
  check('Falls back to Download where audio-only isn’t possible (WebM)', /Download/.test(webmB), webmB);
  await pb.locator('#mediaList .card').filter({ hasText: 'big.mp4' }).first().locator('.btn.primary').click();
  const job = await waitFor(async () => (await jobs()).find((j) => j.status === 'done' && j.source.output === 'audio' && j.source.pageUrl.startsWith(ALT)), 20000);
  check('Main button downloads audio on the other website', !!job && job.finalPath.endsWith('.m4a'), job?.finalPath);

  // Per-site override (copy on localhost only)
  await pa.reload(); await pa.waitForTimeout(700);
  await pa.locator('#mediaList .card').filter({ hasText: 'big.mp4' }).first().locator('.icon-btn[aria-label="More actions"]').click();
  await pa.locator('.menu button', { hasText: 'Always copy link — only on localhost' }).click();
  await pa.waitForTimeout(500);
  await pb.reload(); await pb.waitForTimeout(700);
  const la = await pa.locator('#mediaList .card').filter({ hasText: 'big.mp4' }).first().locator('.btn.primary').innerText();
  const lb = await pb.locator('#mediaList .card').filter({ hasText: 'big.mp4' }).first().locator('.btn.primary').innerText();
  check('Per-site rule overrides the global default only on that site', /Copy link/.test(la) && /Audio/.test(lb), `${la} | ${lb}`);

  // Settings page shows + changes the global default
  const o = await ctx.newPage();
  await o.goto(`chrome-extension://${extId}/options/options.html`);
  await o.waitForTimeout(500);
  check('Settings › Default action reflects the choice', await o.locator('input[name="defaultAction"][value="audio"]').isChecked());
  await o.locator('label:has(input[name="defaultAction"][value="copy"])').click();
  await o.waitForTimeout(600);
  await pb.reload(); await pb.waitForTimeout(700);
  const lb2 = await pb.locator('#mediaList .card').filter({ hasText: 'big.mp4' }).first().locator('.btn.primary').innerText();
  check('Global default changed in Settings (Copy link everywhere)', (await settings()).defaultAction === 'copy' && /Copy link/.test(lb2), lb2);
  // Keyboard shortcut / "best media" honours the global default
  await o.locator('label:has(input[name="defaultAction"][value="audio"])').click();
  await o.waitForTimeout(500);
  const tabB = await sw.evaluate((id) => chrome.tabs.get(id), b.tabId);
  const before = (await jobs()).length;
  await sw.evaluate(([t]) => globalThis.__vidsnag.downloadBest(t, null), [tabB]);
  const j2 = await waitFor(async () => (await jobs()).length > before && (await jobs()).sort((x, y) => y.createdAt - x.createdAt)[0], 5000);
  check('Alt+Shift+D (best media) follows the global default (audio)', j2?.source.output === 'audio', j2?.source.output);
  // Disable: back to Download
  await o.locator('label:has(input[name="defaultAction"][value="download"])').click();
  await o.waitForTimeout(500);
  await sw.evaluate(async () => chrome.storage.local.set({ siteRules: { actions: {}, naming: {} } }));
  await pb.reload(); await pb.waitForTimeout(700);
  check('Defaults can be switched off again', /Download/.test(await pb.locator('#mediaList .card').filter({ hasText: 'big.mp4' }).first().locator('.btn.primary').innerText()));
  await o.close(); await pa.close(); await pb.close(); await a.page.close(); await b.page.close();
});

// ======================= Pause / resume =======================
await step('pause-resume', async () => {
  const { page, tabId } = await openPage(`${BASE}/page-slow.html`);
  const p = await panel(tabId);
  await p.locator('#mediaList .card', { hasText: 'Slow MP4' }).locator('.btn.primary').click();
  let job = await waitFor(async () => (await jobs()).find((j) => j.source.url.endsWith('/slow/big.mp4') && j.status === 'downloading' && j.bytes > 0), 15000);
  await p.evaluate((id) => chrome.runtime.sendMessage({ type: 'pause', jobId: id }), job.id);
  await sleep(1500);
  const a = (await jobs()).find((j) => j.id === job.id);
  await sleep(1500);
  const b = (await jobs()).find((j) => j.id === job.id);
  check('Pause a direct (browser) download: status paused, bytes stop', a.status === 'paused' && b.bytes === a.bytes && b.status === 'paused', `${a.status} ${a.bytes} → ${b.bytes}`);
  await p.click('button[data-view="jobs"]');
  await p.waitForTimeout(400);
  check('Downloads tab offers Resume for a paused job', (await p.locator('#jobsList .card', { hasText: 'Paused' }).locator('button', { hasText: 'Resume' }).count()) === 1);
  await p.locator('#jobsList .card', { hasText: 'Paused' }).locator('button', { hasText: 'Resume' }).click();
  job = await waitFor(async () => (await jobs()).find((j) => j.id === job.id && j.status === 'done'), 30000);
  check('Resume completes the file (full size)', job && fs.statSync(job.finalPath).size === fs.statSync(path.join(HERE, 'media/big.mp4')).size, job?.finalPath);

  // Stream (offscreen) download
  await setSettings({ maxConcurrentSegments: 1 });
  await p.click('button[data-view="media"]');
  await p.locator('#mediaList .card').filter({ has: p.locator('.chip.kind', { hasText: /^HLS$/ }) }).locator('.btn.primary').click();
  let hj = await waitFor(async () => (await jobs()).find((j) => j.kind === 'hls' && j.source.url.includes('/slowhls/') && j.segmentsDone >= 1 && j.status === 'downloading'), 20000);
  await p.evaluate((id) => chrome.runtime.sendMessage({ type: 'pause', jobId: id }), hj.id);
  await sleep(2000);
  const s1 = (await jobs()).find((j) => j.id === hj.id);
  await sleep(2500);
  const s2 = (await jobs()).find((j) => j.id === hj.id);
  check('Pause a stream download: no new segments while paused', s2.status === 'paused' && s2.segmentsDone === s1.segmentsDone && s2.segmentsDone < 6, `${s1.status} ${s1.segmentsDone} → ${s2.segmentsDone}`);
  await p.evaluate((id) => chrome.runtime.sendMessage({ type: 'resume', jobId: id }), hj.id);
  hj = await waitFor(async () => (await jobs()).find((j) => j.id === hj.id && j.status === 'done'), 40000);
  let ok = false;
  if (hj) { try { const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', hj.finalPath]).toString()); ok = Math.abs(+pr.format.duration - 12) < 1; } catch { ok = false; } }
  check('Resumed stream finishes with the full video', ok, hj?.finalPath);
  await setSettings({ maxConcurrentSegments: 4 });
  await p.close(); await page.close();
});

// ======================= Sidebar Max / Mini / Unpinned =======================
await step('sidebar-modes', async () => {
  const { page, tabId } = await openPage(`${BASE}/page-slow.html`);
  const sb = await panel(tabId, '&mode=sidebar', { width: 360, height: 640 });
  check('Sidebar shows Max / Mini / Unpin controls', (await sb.locator('#modeSwitch button').count()) === 3 && await sb.locator('#modeSwitch').isVisible());
  await sb.locator('#modeSwitch button[data-mode="mini"]').click();
  await sb.waitForTimeout(600);
  const mini = await sb.evaluate(() => ({ mini: document.body.classList.contains('mini'), cards: document.querySelectorAll('.mini-card').length, tabsHidden: getComputedStyle(document.querySelector('.tabs')).display === 'none' }));
  check('Mini mode: compact cards, extras hidden', mini.mini && mini.cards === 2 && mini.tabsHidden, JSON.stringify(mini));
  const info = await waitFor(async () => {
    const t = await sb.locator('.mini-card', { hasText: 'Slow MP4' }).locator('.mini-info').innerText();
    return /\d+:\d\d · 2\.3 MB · 720p/.test(t) ? t : null;
  }, 15000) || await sb.locator('.mini-card', { hasText: 'Slow MP4' }).locator('.mini-info').innerText();
  check('Mini card shows duration · size · quality', /\d+:\d\d · 2\.3 MB · 720p/.test(info), info);
  await sb.screenshot({ path: path.join(OUT, 'mini.png') });

  // Download from Mini: circular ring, then square when paused
  await setSettings({ maxConcurrentSegments: 1 });
  await sb.locator('.mini-card').filter({ hasText: 'HLS' }).locator('.mini-go').click();
  const ringOk = await waitFor(async () => sb.evaluate(() => {
    const bar = document.querySelector('.mini-frame.st-active .ring circle.bar');
    return bar && parseFloat(getComputedStyle(bar).strokeDashoffset) < 100 ? getComputedStyle(bar).strokeDashoffset : null;
  }), 20000, 400);
  check('Mini: circular progress ring around the thumbnail while downloading', !!ringOk, ringOk);
  await sb.screenshot({ path: path.join(OUT, 'mini-progress.png') });
  await sb.locator('.mini-card').filter({ hasText: 'HLS' }).locator('.icon-btn[aria-label="Pause download"]').click();
  const sq = await waitFor(async () => sb.evaluate(() => !!document.querySelector('.mini-frame.st-paused .ring.paused rect.bar') && !!document.querySelector('.mini-frame.st-paused .ring .glyph')), 5000);
  check('Mini: paused → square pause indicator', !!sq);
  await sb.screenshot({ path: path.join(OUT, 'mini-paused.png') });
  await sb.locator('.mini-card').filter({ hasText: 'HLS' }).locator('.icon-btn[aria-label="Resume download"]').click();
  const back = await waitFor(async () => sb.evaluate(() => !!document.querySelector('.mini-frame.st-active .ring circle.bar') || !!document.querySelector('.mini-badge.ok')), 5000);
  check('Mini: resume → circle again (or finished ✓)', !!back);
  await waitFor(async () => sb.evaluate(() => !!document.querySelector('.mini-badge.ok')), 30000);
  check('Mini: finished download shows ✓ badge', await sb.evaluate(() => !!document.querySelector('.mini-badge.ok')));
  await setSettings({ maxConcurrentSegments: 4 });

  // Mode remembered
  await sb.reload(); await sb.waitForTimeout(700);
  check('Last mode remembered (Mini after reopening)', await sb.evaluate(() => document.body.classList.contains('mini')) && (await sb.locator('#modeSwitch button[data-mode="mini"].active').count()) === 1);
  // Max again
  await sb.locator('#modeSwitch button[data-mode="max"]').click();
  await sb.waitForTimeout(500);
  check('Max mode: full interface back', !(await sb.evaluate(() => document.body.classList.contains('mini'))) && await sb.locator('.tabs').isVisible());
  await sb.locator('#modeSwitch button[data-mode="mini"]').click();
  await sb.waitForTimeout(300);

  // Unpin → floating indicator on pages
  await sb.locator('#modeSwitch button[data-mode="unpinned"]').click();
  await sleep(1200);
  const s = await settings();
  check('Unpin saves the mode (and remembers Mini for pinning back)', s.sidebarMode === 'unpinned' && s.lastPinnedMode === 'mini', JSON.stringify({ m: s.sidebarMode, l: s.lastPinnedMode }));
  if (!sb.isClosed()) await sb.close(); // Unpin closes the real side panel; the test tab stand-in closes here
  await page.bringToFront();
  const ind = page.locator('vidsnag-indicator');
  await ind.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
  check('Floating indicator appears at the page edge', (await ind.count()) === 1 && (await ind.evaluate((el) => getComputedStyle(el).position)) === 'fixed');
  const box = await ind.boundingBox();
  check('Indicator is small and at the right edge (doesn’t cover the page)', box && box.width <= 40 && box.x + box.width >= 1098, JSON.stringify(box));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1500);
  check('Hover expands the compact panel', (await ind.getAttribute('data-expanded')) === 'true');
  const frame = await waitFor(async () => page.frames().find((f) => f.url().includes('mode=float')), 5000);
  const fcards = frame ? await waitFor(async () => (await frame.locator('.mini-card').count()) || null, 6000) : 0;
  check('Expanded panel shows this page’s media in Mini layout', fcards >= 2, String(fcards));
  await page.screenshot({ path: path.join(OUT, 'float.png') });
  await page.mouse.move(200, 300);
  await page.waitForTimeout(900);
  check('Moving away collapses it again', (await ind.getAttribute('data-expanded')) === 'false');
  // Pin again from the indicator
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1200);
  // Real-mouse clicks into this extension frame are verified separately (headless input routing into
  // an iframe inside a closed shadow root is unreliable mid-session); here the button is triggered directly.
  await frame.evaluate(() => document.getElementById('btnPinBack').click());
  await waitFor(async () => (await settings()).sidebarMode !== 'unpinned', 8000);
  await sleep(500);
  const s2 = await settings();
  check('Pin restores the last mode and removes the indicator', s2.sidebarMode === 'mini' && (await page.locator('vidsnag-indicator').count()) === 0, s2.sidebarMode);
  await setSettings({ sidebarMode: 'max', lastPinnedMode: 'max' });
  await page.close();
});

await step('frame-guard', async () => {
  const { page } = await openPage(`${BASE}/page-mp4.html`, 1500);
  for (const q of ['mode=tab&view=library', 'mode=float']) {
    await page.evaluate(([id, q]) => { const f = document.createElement('iframe'); f.id = 'evil'; f.src = `chrome-extension://${id}/popup/popup.html?${q}`; document.body.append(f); }, [extId, q]);
    await page.waitForTimeout(1500);
    const fr = page.frames().find((f) => f.url().includes('popup.html'));
    const text = fr ? await fr.evaluate(() => document.body?.innerText || '').catch(() => '') : '';
    check(`A website can't embed VidSnag (${q})`, !fr || !/Media|Saved|Download/.test(text) || /only be opened/.test(text), fr ? text.slice(0, 80) : 'blocked by Chrome');
    await page.evaluate(() => document.getElementById('evil')?.remove());
  }
  await page.close();
});

await ctx.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
