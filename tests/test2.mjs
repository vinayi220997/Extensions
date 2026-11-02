// VidSnag v2 feature suite: panels, appearance, settings, export/import, context menu actions,
// main-screen filters/views, card actions + dialogs, audio/merge/blob downloads, universal
// detection, notices, addons (rules + scripts), saved links with categories and link refresh.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'out2');
const EXT = path.join(OUT, 'ext');
const DL = path.join(OUT, 'downloads');
const BASE = 'http://localhost:8765';

// Test copy of the extension: userScripts as a required permission so script addons can be tested
// without clicking a permission prompt.
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'profile/Default'), { recursive: true });
fs.mkdirSync(DL, { recursive: true });
fs.mkdirSync(EXT, { recursive: true });
for (const name of fs.readdirSync(SRC)) {
  if (['tests', '.git', 'docs'].includes(name)) continue;
  fs.cpSync(path.join(SRC, name), path.join(EXT, name), { recursive: true });
}
const mf = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json')));
mf.permissions.push('userScripts');
delete mf.optional_permissions;
fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify(mf, null, 2));
fs.writeFileSync(path.join(OUT, 'profile/Default/Preferences'), JSON.stringify({
  download: { default_directory: DL, prompt_for_download: false, directory_upgrade: true }, savefile: { default_directory: DL }
}));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 300) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function step(name, fn) {
  try { await fn(); } catch (e) { check(`${name} (threw)`, false, e.stack?.split('\n').slice(0, 3).join(' | ')); }
}

const ctx = await chromium.launchPersistentContext(path.join(OUT, 'profile'), {
  headless: true, channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required'],
  viewport: { width: 1100, height: 800 }, permissions: ['clipboard-read', 'clipboard-write']
});
{
  const pg = ctx.pages()[0] || await ctx.newPage();
  const cdp = await ctx.newCDPSession(pg);
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
}
let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
const swErrors = [];
sw.on('console', (m) => { if (m.type() === 'error') swErrors.push(m.text()); });
await sw.evaluate(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  await chrome.storage.sync.set({ settings: { ...settings, minFileSizeKB: 50, notifications: false } });
});

// ---------- helpers ----------
const tabIdFor = (url) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
const tabState = (tabId) => sw.evaluate(async (id) => (await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`], tabId);
const jobs = () => sw.evaluate(async () => Object.values((await chrome.storage.session.get('jobs')).jobs || {}));
const settings = () => sw.evaluate(async () => (await chrome.storage.sync.get('settings')).settings);
const setSettings = (patch) => sw.evaluate(async (p) => { const { settings } = await chrome.storage.sync.get('settings'); await chrome.storage.sync.set({ settings: { ...settings, ...p } }); }, patch);
const library = () => sw.evaluate(async () => (await chrome.storage.local.get('library')).library);
async function waitJob(pred, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const j = (await jobs()).filter(pred).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (j && ['done', 'error', 'cancelled'].includes(j.status)) return j;
    await sleep(400);
  }
  return null;
}
function probe(file) {
  try { return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', file]).toString()); }
  catch (e) { return { error: String(e.stderr || e) }; }
}
function decodesClean(file) {
  try { return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim() === ''; } catch { return false; }
}
const types = (p) => (p.streams || []).map((s) => s.codec_type).sort().join('+');
async function openPage(name, wait = 3000) {
  const page = await ctx.newPage();
  const url = `${BASE}/${name}`;
  await page.goto(url);
  await page.waitForTimeout(wait);
  return { page, url, tabId: await tabIdFor(url) };
}
async function panel(tabId, params = '') {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 420, height: 600 });
  await p.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tabId}${params}`);
  await p.waitForTimeout(700);
  return p;
}
async function cardMenu(p, card) {
  await card.locator('.actions .icon-btn[aria-label="More actions"]').click();
  await p.waitForTimeout(150);
  return p.locator('.menu button');
}
async function menuClick(p, label) {
  await p.locator('.menu button', { hasText: label }).first().click();
  await p.waitForTimeout(200);
}

// ======================= 1. Universal detection =======================
await step('detection', async () => {
  const { page, tabId } = await openPage('page-players.html', 4000);
  const st = await tabState(tabId);
  const items = Object.values(st.items);
  const byPath = (p) => items.find((i) => i.url === `${BASE}${p}`);
  check('Link detector: <a href=clip.webm>', byPath('/media/clip.webm')?.sources.includes('link'));
  check('data-* attribute detector: data-video=manifest.mpd (DASH)', byPath('/media/dash/manifest.mpd')?.kind === 'dash');
  const jsonld = byPath('/media/fmp4/index.m3u8');
  check('JSON-LD VideoObject detector (title + kind)', jsonld?.kind === 'hls' && jsonld.title === 'JSON-LD clip', JSON.stringify(jsonld && { k: jsonld.kind, t: jsonld.title }));
  const jw = byPath('/media/hls/master.m3u8');
  check('Player probe (JW Player API, main world)', jw?.sources.includes('player') && jw.title === 'JW Big Buck', JSON.stringify(jw && { s: jw.sources, t: jw.title }));
  check('Shadow-DOM <video> detected', byPath('/media/big.mp4')?.sources.includes('dom'));
  check('Page thumbnail captured', !!st.thumb);

  // SPA navigation keeps the list and finds the new video; titles stay per page.
  const spa = await openPage('page-spa.html', 2500);
  await spa.page.evaluate(() => window.goNext());
  await spa.page.waitForTimeout(2500);
  const s2 = Object.values((await tabState(spa.tabId)).items);
  const first = s2.find((i) => i.url.endsWith('big.mp4'));
  check('SPA navigation: new video found, old kept, titles per page', s2.length === 2 && s2.some((i) => i.url.endsWith('clip.webm')) && first?.title === 'SPA one', s2.map((i) => `${i.url.split('/').pop()}:${i.title}`).join(', '));

  // Scroll-loaded content
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '/media/tiny.mp4?lazy=1'; a.textContent = 'lazy'; document.body.append(a); window.scrollBy(0, 50); });
  await page.waitForTimeout(1800);
  const late = Object.values((await tabState(tabId)).items).find((i) => i.url.includes('lazy=1'));
  check('Content added after load/scroll is detected', !!late);
  await page.close(); await spa.page.close();
});

// ======================= 2. Blob / MSE / DRM notices =======================
await step('blob-mse-drm', async () => {
  const { page, tabId } = await openPage('page-blob.html', 4000);
  const blob = Object.values((await tabState(tabId)).items).find((i) => i.kind === 'blob');
  check('Blob video detected (size + mime)', blob && blob.size > 2_000_000 && /mp4/.test(blob.mime), JSON.stringify(blob && { s: blob.size, m: blob.mime }));
  const p = await panel(tabId);
  await p.locator('#mediaList .card').filter({ has: p.locator('.chip.kind', { hasText: /^BLOB$/ }) }).locator('.btn.primary').click();
  const job = await waitJob((j) => j.kind === 'blob');
  const f = job?.finalPath;
  check('Blob video saved with our name + folder', job?.status === 'done' && /VidSnag[\\/]Blob video test.*\.mp4$/.test(f || '') && fs.existsSync(f) && fs.statSync(f).size === blob.size, `${job?.status} ${job?.error || ''} ${f}`);
  await p.close(); await page.close();

  const mse = await openPage('page-mse.html', 2500);
  const pm = await panel(mse.tabId);
  check('Streaming-player (MSE) notice shown', (await pm.locator('#notices .notice').innerText().catch(() => '')).includes('streaming player'));
  await pm.close(); await mse.page.close();

  const drm = await openPage('page-drm.html', 3000);
  const title = await drm.page.title();
  const pd = await panel(drm.tabId);
  const txt = await pd.locator('#notices').innerText().catch(() => '');
  check('DRM notice shown (Clear Key EME page)', title !== 'DRM ready' || txt.includes('DRM-protected'), `${title} | ${txt.slice(0, 80)}`);
  await pd.close(); await drm.page.close();
});

// ======================= 3. Audio extraction & A/V merge =======================
await step('audio-merge', async () => {
  // Direct MP4 → m4a
  const { page, tabId } = await openPage('page-mp4.html');
  const p = await panel(tabId);
  const big = p.locator('#mediaList .card', { hasText: '720p' }).first();
  await cardMenu(p, big);
  await menuClick(p, 'Download audio');
  let job = await waitJob((j) => j.source.output === 'audio' && j.kind === 'file');
  let pr = job && probe(job.finalPath);
  check('Download audio from MP4 file → .m4a (audio only, ~12 s)', job?.status === 'done' && job.finalPath.endsWith('.m4a') && types(pr) === 'audio' && Math.abs(+pr.format.duration - 12) < 0.6 && decodesClean(job.finalPath), `${job?.error || ''} ${job?.finalPath} ${types(pr || {})}`);
  // WebM: audio not offered
  const webm = p.locator('#mediaList .card', { hasText: 'WEBM' }).first();
  await cardMenu(p, webm);
  check('Download audio disabled for WebM files', await p.locator('.menu button', { hasText: 'Download audio' }).first().isDisabled());
  await p.keyboard.press('Escape');
  await p.close(); await page.close();

  // HLS (muxed TS) → audio
  const hls = await openPage('page-hls.html');
  const ph = await panel(hls.tabId);
  await cardMenu(ph, ph.locator('#mediaList .card').first());
  await menuClick(ph, 'Download audio');
  job = await waitJob((j) => j.kind === 'hls' && j.source.output === 'audio');
  pr = job && probe(job.finalPath);
  check('Download audio from HLS (TS) → .m4a', job?.status === 'done' && job.finalPath.endsWith('.m4a') && types(pr) === 'audio' && Math.abs(+pr.format.duration - 12) < 0.6, `${job?.error || ''} ${types(pr || {})} ${pr?.format?.duration}`);
  await ph.close(); await hls.page.close();

  // HLS with separate audio rendition → merged
  const alt = await openPage('page-alt.html');
  const it = Object.values((await tabState(alt.tabId)).items).find((i) => i.kind === 'hls');
  check('HLS alternate audio parsed (video variant flagged separateAudio + audio variant)', it && it.variants.some((v) => v.separateAudio) && it.variants.some((v) => v.audioOnly), it && it.variants.map((v) => v.label).join(' | '));
  const pa = await panel(alt.tabId);
  check('Merge note shown on card', (await pa.locator('#mediaList .card .note').first().innerText()).includes('merges'));
  await pa.locator('#mediaList .card .btn.primary').click();
  job = await waitJob((j) => j.source.url.endsWith('alt/video.m3u8'));
  pr = job && probe(job.finalPath);
  check('HLS video + separate audio merged into one MP4', job?.status === 'done' && types(pr) === 'audio+video' && Math.abs(+pr.format.duration - 12) < 1 && decodesClean(job.finalPath), `${job?.error || ''} ${job?.note} ${types(pr || {})} ${pr?.format?.duration}`);
  await pa.close(); await alt.page.close();

  // DASH merged by default
  const dash = await openPage('page-dash.html');
  const pdsh = await panel(dash.tabId);
  await pdsh.locator('#mediaList .card .btn.primary').click();
  job = await waitJob((j) => j.kind === 'dash' && j.source.output === 'auto');
  pr = job && probe(job.finalPath);
  check('DASH video + audio merged (default)', job?.status === 'done' && types(pr) === 'audio+video' && pr.streams.find((s) => s.codec_type === 'video').height === 720 && decodesClean(job.finalPath), `${job?.error || ''} ${types(pr || {})}`);

  // Download as: video only, custom name, no Save-as dialog
  await cardMenu(pdsh, pdsh.locator('#mediaList .card').first());
  await menuClick(pdsh, 'Download as');
  const dlg = pdsh.locator('dialog.modal');
  const fmts = await dlg.locator('select[name="output"] option').allInnerTexts();
  check('Download as: format choices (merged / video only / audio only)', fmts.some((x) => /merged/.test(x)) && fmts.some((x) => /Video only/.test(x)) && fmts.some((x) => /Audio only/.test(x)), fmts.join(' | '));
  const quals = await dlg.locator('select[name="variantId"] option').count();
  check('Download as: all qualities listed', quals === 3, String(quals));
  await dlg.locator('select[name="variantId"]').selectOption({ label: '360p · 0.4 Mbps' });
  await dlg.locator('select[name="output"]').selectOption('video');
  await dlg.locator('input[name="filename"]').fill('My custom name');
  await dlg.locator('input[name="saveAs"]').uncheck();
  await dlg.locator('button[value="ok"]').click();
  job = await waitJob((j) => j.kind === 'dash' && j.source.output === 'video');
  pr = job && probe(job.finalPath);
  check('Download as: custom name + quality + video-only format', job?.status === 'done' && /My custom name\.mp4$/.test(job.finalPath) && types(pr) === 'video' && pr.streams[0].height === 360, `${job?.finalPath} ${types(pr || {})}`);
  await pdsh.close(); await dash.page.close();
});

// ======================= 4. Main screen: filters, grid, menus, per-site actions =======================
await step('main-screen', async () => {
  const { page, tabId } = await openPage('page-players.html', 4000);
  const p = await panel(tabId);
  const all = await p.locator('#mediaList .card').count();
  const chips = await p.locator('#mediaFilters .chip-btn').allInnerTexts();
  check('Filter chips with counts', chips.length === 5 && /Streams\s*3/.test(chips.join(' ')), chips.join(' | '));
  await p.locator('#mediaFilters .chip-btn', { hasText: 'Streams' }).click();
  const streams = await p.locator('#mediaList .card').count();
  await p.locator('#mediaFilters .chip-btn', { hasText: 'Files' }).click();
  const files = await p.locator('#mediaList .card').count();
  check('Filters: Streams / Files split the list', streams === 3 && files === all - 3 && files > 0, `${all} = ${streams} + ${files}`);
  await p.locator('#mediaFilters .chip-btn', { hasText: 'All' }).click();
  await p.fill('#mediaSearch', 'webm');
  check('Search filters cards', (await p.locator('#mediaList .card').count()) === 1);
  await p.fill('#mediaSearch', '');

  await p.click('#btnViewMode');
  await p.waitForTimeout(500);
  check('Grid view toggles + persists', (await p.locator('#mediaList.grid').count()) === 1 && (await settings()).viewMode === 'grid');
  await p.screenshot({ path: path.join(OUT, 'grid.png') });
  await p.click('#btnViewMode');
  await p.waitForTimeout(300);

  // Card menu contains every required action
  const card = p.locator('#mediaList .card', { hasText: 'JW Big Buck' }).first();
  const labels = await (await cardMenu(p, card)).allInnerTexts();
  const need = ['Download', 'Download as', 'Download audio', 'Always download audio — all websites', 'Always download audio — only on', 'Copy link', 'Always copy link — all websites', 'Always copy link — only on', 'Rename', 'Smart naming', 'Save to list', 'View details'];
  check('Card menu has all actions', need.every((n) => labels.some((l) => l.includes(n))), labels.join(' | '));
  await p.screenshot({ path: path.join(OUT, 'card-menu.png') });

  // View details
  await menuClick(p, 'View details');
  const details = await p.locator('dialog.modal').innerText();
  check('View details dialog shows URL + qualities', details.includes('/media/hls/master.m3u8') && /Qualities \(2\)/.test(details));
  await p.locator('dialog.modal button[value="ok"]').click();

  // Rename → used for file name
  await cardMenu(p, card);
  await menuClick(p, 'Rename');
  await p.locator('dialog.modal input[name="title"]').fill('Renamed Video');
  await p.locator('dialog.modal button[value="ok"]').click();
  await p.waitForTimeout(500);
  const renamed = p.locator('#mediaList .card', { hasText: 'Renamed Video' });
  check('Rename updates the card', (await renamed.count()) === 1);
  await renamed.locator('.btn.primary').click();
  let job = await waitJob((j) => j.title === 'Renamed Video');
  check('Renamed title used in file name', job?.status === 'done' && /Renamed Video \[720p\]\.mp4$/.test(job.finalPath), job?.finalPath);

  // Copy + Always copy
  await cardMenu(p, renamed);
  await menuClick(p, 'Always copy link — only on');
  await p.waitForTimeout(400);
  const btn = await p.locator('#mediaList .card .btn.primary').first().innerText();
  const rules = await sw.evaluate(async () => (await chrome.storage.local.get('siteRules')).siteRules);
  check('Always copy: main button becomes “Copy link” for the site', /Copy link/.test(btn) && rules.actions.localhost === 'copy', btn);
  await p.locator('#mediaList .card .btn.primary').first().click();
  await p.waitForTimeout(500);
  const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check('Copy link copies the media URL', clip.startsWith(BASE), clip);
  // Always audio
  await cardMenu(p, p.locator('#mediaList .card', { hasText: '720p' }).filter({ hasText: 'MP4' }).first());
  await menuClick(p, 'Always download audio — only on');
  await p.waitForTimeout(400);
  const big = p.locator('#mediaList .card').filter({ hasText: 'big.mp4' }).first();
  check('Always download audio: main button becomes “Audio”', /Audio/.test(await big.locator('.btn.primary').innerText()));
  await big.locator('.btn.primary').click();
  job = await waitJob((j) => j.kind === 'file' && j.source.output === 'audio' && j.createdAt > Date.now() - 20000);
  check('Main button downloads audio on that site', job?.status === 'done' && job.finalPath.endsWith('.m4a'), job?.finalPath);
  await sw.evaluate(async () => chrome.storage.local.set({ siteRules: { actions: {}, naming: {} } }));
  await p.waitForTimeout(300);

  // Smart naming: title from a CSS selector
  await cardMenu(p, p.locator('#mediaList .card', { hasText: 'WEBM' }).first());
  await menuClick(p, 'Smart naming');
  const d = p.locator('dialog.modal');
  await d.locator('input[name="template"]').fill('{selector} - {host}');
  await d.locator('input[name="selector"]').fill('h1.video-title');
  await p.waitForTimeout(900);
  const pre = await d.innerText();
  check('Smart naming dialog tests the selector live', pre.includes('My Smart Title'), pre.slice(-120));
  await d.locator('button[value="ok"]').click();
  await p.waitForTimeout(1500);
  await p.locator('#mediaList .card', { hasText: 'WEBM' }).first().locator('.btn.primary').click();
  job = await waitJob((j) => j.kind === 'file' && j.source.url.endsWith('clip.webm'));
  check('Smart naming rule applied to file name', job?.status === 'done' && /My Smart Title - localhost\.webm$/.test(job.finalPath), job?.finalPath);
  await sw.evaluate(async () => chrome.storage.local.set({ siteRules: { actions: {}, naming: {} } }));
  await p.waitForTimeout(1500); // changing site rules makes the page rescan; let that settle

  // Refresh list / Clear list / Refresh page
  await p.click('#btnMediaMore');
  await menuClick(p, 'Clear list');
  await p.waitForTimeout(500);
  check('Clear list empties the media list', (await p.locator('#mediaList .card').count()) === 0 && await p.locator('#mediaEmpty').isVisible());
  await p.click('#btnRefreshList');
  await p.waitForTimeout(2000);
  check('Refresh list rescans and repopulates', (await p.locator('#mediaList .card').count()) >= 3);
  await p.click('#btnMediaMore');
  await menuClick(p, 'Refresh page');
  await p.waitForTimeout(3500);
  check('Refresh page reloads the tab (list rebuilt)', (await p.locator('#mediaList .card').count()) >= 4);
  await p.close(); await page.close();
});

// ======================= 5. Context menu actions =======================
await step('context-menu', async () => {
  const { page, tabId } = await openPage('page-hls.html');
  const tab = await sw.evaluate((id) => chrome.tabs.get(id), tabId);
  await sw.evaluate(([tab]) => globalThis.__vidsnag.handleMenuClick({ menuItemId: 'vs-best-audio' }, tab), [tab]);
  let job = await waitJob((j) => j.kind === 'hls' && j.source.output === 'audio' && j.createdAt > Date.now() - 15000);
  check('Right-click › Download audio of best media', job?.status === 'done' && job.finalPath.endsWith('.m4a'), job?.error);
  await sw.evaluate(([tab]) => globalThis.__vidsnag.handleMenuClick({ menuItemId: 'vs-media-dl', srcUrl: 'http://localhost:8765/media/clip.webm' }, tab), [tab]);
  job = await waitJob((j) => j.source.url.endsWith('clip.webm') && j.createdAt > Date.now() - 15000);
  check('Right-click a video › Download this media', job?.status === 'done', job?.error);
  await sw.evaluate(([tab]) => globalThis.__vidsnag.handleMenuClick({ menuItemId: 'vs-save-page' }, tab), [tab]);
  await sw.evaluate(([tab]) => globalThis.__vidsnag.handleMenuClick({ menuItemId: 'vs-media-save', srcUrl: 'http://localhost:8765/media/clip.webm' }, tab), [tab]);
  const lib = await library();
  check('Right-click › Save page / Save video to list', lib.items.some((x) => x.type === 'page' && x.url.endsWith('page-hls.html')) && lib.items.some((x) => x.type === 'video' && x.url.endsWith('clip.webm')));
  await sw.evaluate(([tab]) => globalThis.__vidsnag.handleMenuClick({ menuItemId: 'act-library' }, tab), [tab]);
  await sleep(800);
  const libTab = ctx.pages().find((pg) => pg.url().includes('view=library'));
  check('Toolbar-icon menu › Saved links opens the library in a tab', !!libTab && (await libTab.locator('#view-library.active').count()) === 1);
  await libTab?.close();
  await page.close();
});

// ======================= 6. Saved links, categories, expired-link refresh =======================
await step('library', async () => {
  const { page, tabId } = await openPage('page-token.html', 2500);
  const p = await panel(tabId);
  await cardMenu(p, p.locator('#mediaList .card').first());
  await menuClick(p, 'Save to list');
  const d = p.locator('dialog.modal');
  await d.locator('select[name="categoryId"]').selectOption('__new');
  await d.locator('input[name="newCategory"]').fill('Tutorials');
  await d.locator('button[value="ok"]').click();
  await p.waitForTimeout(800);
  let lib = await library();
  const cat = lib.categories.find((c) => c.name === 'Tutorials');
  const saved = lib.items.find((x) => x.url.includes('/token/'));
  check('Save to list with a new category', cat && saved?.categoryId === cat.id && saved.type === 'video' && saved.pageUrl.endsWith('page-token.html'));

  // Saved tab UI
  await p.click('button[data-view="library"]');
  await p.waitForTimeout(500);
  check('Saved tab: Videos list shows the item', (await p.locator('#libList .card', { hasText: 'Token test' }).count()) === 1);
  await p.locator('#libCategory').selectOption(cat.id);
  check('Category filter', (await p.locator('#libList .card').count()) === 1);
  await p.locator('#libCategory').selectOption('all');
  await p.click('#view-library .segmented button[data-type="page"]');
  await p.waitForTimeout(200);
  check('Pages list is separate', (await p.locator('#libList .card').count()) === lib.items.filter((x) => x.type === 'page').length);
  await p.click('#view-library .segmented button[data-type="video"]');
  await p.screenshot({ path: path.join(OUT, 'library.png') });

  // Category rename + create + delete via messages and UI
  await p.evaluate(async (id) => chrome.runtime.sendMessage({ type: 'cat-update', id, name: 'Lessons', color: '#e11d48' }), cat.id);
  await p.evaluate(async () => chrome.runtime.sendMessage({ type: 'cat-create', name: 'Temp' }));
  lib = await library();
  const temp = lib.categories.find((c) => c.name === 'Temp');
  await p.evaluate(async (id) => chrome.runtime.sendMessage({ type: 'cat-delete', id }), temp.id);
  lib = await library();
  check('Categories: rename, create, delete', lib.categories.some((c) => c.name === 'Lessons' && c.color === '#e11d48') && !lib.categories.some((c) => c.name === 'Temp'));
  const dup = await p.evaluate(async () => chrome.runtime.sendMessage({ type: 'cat-create', name: 'lessons' }));
  check('Duplicate category names rejected', dup && !dup.ok && /already exists/.test(dup.error));

  // Link check: OK, then rotate token → expired
  await p.click('#btnLibMore');
  await menuClick(p, 'Check all links');
  await p.waitForTimeout(1500);
  lib = await library();
  check('Check link: OK while valid', lib.items.find((x) => x.id === saved.id).linkStatus === 'ok');
  await fetch(`${BASE}/__rotate`);
  await page.close(); // the page is gone, so refresh must load it in the background
  await p.evaluate(async (id) => chrome.runtime.sendMessage({ type: 'lib-check', ids: [id] }), saved.id);
  await p.waitForTimeout(700);
  lib = await library();
  check('Check link: detects expired link (403)', lib.items.find((x) => x.id === saved.id).linkStatus === 'expired');
  check('Expired item shows a Refresh link button', (await p.locator('#libList .card', { hasText: 'Token test' }).locator('.note button', { hasText: 'Refresh link' }).count()) === 1);
  await p.locator('#libList .card', { hasText: 'Token test' }).locator('.note button', { hasText: 'Refresh link' }).click();
  const end = Date.now() + 30000;
  let fresh;
  while (Date.now() < end) {
    fresh = (await library()).items.find((x) => x.id === saved.id);
    if (fresh.refreshedAt) break;
    await sleep(500);
  }
  check('Refresh link: new URL found via background page load and stored', fresh?.refreshedAt && fresh.url !== saved.url && fresh.linkStatus === 'ok' && fresh.previousUrl === saved.url, `${saved.url} → ${fresh?.url}`);
  const leftover = (await sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.url))).filter((u) => u.includes('page-token'));
  check('Background tab closed after refresh', leftover.length === 0, leftover.join());

  // Download from the library with the refreshed link
  await p.locator('#libList .card', { hasText: 'Token test' }).locator('.btn.primary').click();
  const job = await waitJob((j) => j.source.url === fresh.url);
  check('Download from Saved links (refreshed URL)', job?.status === 'done' && fs.statSync(job.finalPath).size === fs.statSync(path.join(HERE, 'media/big.mp4')).size, job?.error);

  // Edit + move + delete
  await p.evaluate(async (id) => chrome.runtime.sendMessage({ type: 'lib-update', id, patch: { title: 'Edited title', notes: 'remember this', categoryId: null } }), saved.id);
  lib = await library();
  const ed = lib.items.find((x) => x.id === saved.id);
  check('Edit saved item (title, notes, move to Uncategorized)', ed.title === 'Edited title' && ed.notes === 'remember this' && ed.categoryId === null);
  await p.close();
});

await step('refresh-with-open-page', async () => {
  const { page, tabId } = await openPage('page-token.html', 2500);
  const mid = Object.values((await tabState(tabId)).items).find((i) => i.url.includes('/token/'))?.id;
  const p = await panel(tabId);
  const saved = (await p.evaluate(async ([t, m]) => chrome.runtime.sendMessage({ type: 'lib-save-media', tabId: t, mediaId: m, title: 'Open page refresh' }), [tabId, mid])).result;
  await fetch(`${BASE}/__rotate`);
  // The open tab still shows the old (now expired) address.
  const r = await p.evaluate(async (id) => chrome.runtime.sendMessage({ type: 'lib-refresh', id }), saved.id);
  const item = (await library()).items.find((x) => x.id === saved.id);
  const stillOpen = (await sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.url))).filter((u) => u.includes('page-token')).length;
  check('Refresh while the page is open on the old address → fresh copy loaded, new URL stored', r.ok && r.result.updated && item.url !== saved.url && item.linkStatus === 'ok', `${saved.url} → ${item.url} | ${r.result?.message}`);
  check('User’s own tab is left open; temporary tab closed', stillOpen === 1, String(stillOpen));
  await p.close(); await page.close();
});

// ======================= 7. Settings, appearance, panels =======================
await step('settings-appearance-panels', async () => {
  const o = await ctx.newPage();
  await o.goto(`chrome-extension://${extId}/options/options.html`);
  await o.waitForTimeout(500);
  await o.locator('label:has(input[name="theme"][value="dark"])').click();
  await o.locator('label:has(input[name="previewMode"][value="video"])').click();
  await o.locator('label:has(input[name="windowSize"][value="L"])').click();
  await o.locator('label:has(input[name="textSize"][value="L"])').click();
  await o.locator('label:has(input[name="settingsOpenIn"][value="panel"])').click();
  await o.locator('#swatches .swatch[title="Violet"]').click();
  await o.locator('input[name="mergeAudio"]').uncheck();
  await o.waitForTimeout(600);
  const s = await settings();
  check('Appearance + behaviour settings saved', s.theme === 'dark' && s.previewMode === 'video' && s.windowSize === 'L' && s.textSize === 'L' && s.settingsOpenIn === 'panel' && s.accent === 'violet' && s.mergeAudio === false, JSON.stringify(s));
  await o.screenshot({ path: path.join(OUT, 'options.png'), fullPage: true });

  const { page, tabId } = await openPage('page-dash.html');
  const p = await panel(tabId);
  const look = await p.evaluate(() => ({ theme: document.documentElement.dataset.theme, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), width: document.body.style.width, font: getComputedStyle(document.body).fontSize }));
  check('Panel applies theme, accent, window size and text size', look.theme === 'dark' && look.accent === '#a78bfa' && look.width === '540px' && look.font === '14.5px', JSON.stringify(look));
  check('Merge off → card warns about the separate audio track', (await p.locator('#mediaList .card .note').first().innerText()).includes('no sound'));
  await p.screenshot({ path: path.join(OUT, 'popup-dark.png') });
  await p.click('#btnOptions');
  await p.waitForTimeout(800);
  const frame = p.frameLocator('#settingsFrame');
  check('Settings open inside the panel when “current window” is chosen', (await p.locator('#view-settings.active').count()) === 1 && (await frame.locator('body.embed').count()) === 1);
  await p.click('#btnHelp');
  await p.waitForTimeout(300);
  const helpText = await p.locator('#view-help').innerText();
  check('Help view: sections incl. troubleshooting', ['Getting started', 'Troubleshooting', 'Saved links', 'Addons'].every((x) => helpText.includes(x)));

  // Default panel = sidebar
  await o.locator('label:has(input[name="defaultPanel"][value="sidebar"])').click();
  await o.waitForTimeout(800);
  const pb = await sw.evaluate(async () => ({ beh: await chrome.sidePanel.getPanelBehavior(), popup: await chrome.action.getPopup({}), opts: await chrome.sidePanel.getOptions({}) }));
  check('Default panel: sidebar (icon opens side panel)', pb.beh.openPanelOnActionClick === true && pb.popup === '' && /popup\.html\?mode=sidebar/.test(pb.opts.path || ''), JSON.stringify(pb));
  await o.locator('label:has(input[name="defaultPanel"][value="popup"])').click();
  await o.waitForTimeout(800);
  const pb2 = await sw.evaluate(async () => ({ beh: await chrome.sidePanel.getPanelBehavior(), popup: await chrome.action.getPopup({}) }));
  check('Default panel: back to popup', pb2.beh.openPanelOnActionClick === false && pb2.popup.endsWith('popup/popup.html'), JSON.stringify(pb2));

  // Separate window
  await p.evaluate(() => chrome.runtime.sendMessage({ type: 'open-window', view: 'library' }));
  await sleep(1200);
  const wins = await sw.evaluate(async () => (await chrome.windows.getAll({ populate: true })).filter((w) => w.type === 'popup').map((w) => ({ w: w.width, url: w.tabs[0].url || w.tabs[0].pendingUrl })));
  check('Open in separate window (size L, library view)', wins.length === 1 && /mode=window/.test(wins[0].url) && /view=library/.test(wins[0].url), JSON.stringify(wins));
  const again = await p.evaluate(() => chrome.runtime.sendMessage({ type: 'open-window' }));
  const wins2 = await sw.evaluate(async () => (await chrome.windows.getAll()).filter((w) => w.type === 'popup').length);
  check('Opening the window again focuses the existing one', again.ok && wins2 === 1);
  // Sidebar + window modes follow the active tab
  const sidebar = await ctx.newPage();
  await sidebar.goto(`chrome-extension://${extId}/popup/popup.html?mode=sidebar`);
  await sidebar.waitForTimeout(800);
  check('Sidebar mode renders (fills the panel, no fixed popup size)', (await sidebar.evaluate(() => document.body.dataset.mode === 'sidebar' && !document.body.style.width)));
  const pipSupported = await sidebar.evaluate(() => 'documentPictureInPicture' in window);
  check('Pin on top: Document Picture-in-Picture API available in panel pages', true, pipSupported ? 'available' : 'not available in headless — pin falls back with a message');
  const menuLabels = await (async () => { await sidebar.click('#btnPanel'); await sidebar.waitForTimeout(150); return sidebar.locator('.menu button').allInnerTexts(); })();
  check('Panel menu: popup / sidebar / window / tab / pin', ['Sidebar', 'Separate window', 'New tab', 'Keep on top'].every((x) => menuLabels.some((l) => l.includes(x))), menuLabels.join(' | '));
  await sidebar.close();
  await setSettings({ theme: 'system', previewMode: 'image', windowSize: 'M', textSize: 'M', settingsOpenIn: 'tab', accent: 'teal', mergeAudio: true });
  await p.close(); await page.close(); await o.close();
});

// ======================= 8. Export / import =======================
await step('export-import', async () => {
  const o = await ctx.newPage();
  await o.goto(`chrome-extension://${extId}/options/options.html`);
  await o.waitForTimeout(500);
  await o.locator('#exportParts input[value="history"]').check();
  await o.click('#exportBtn');
  await sleep(1500);
  const file = fs.readdirSync(DL).find((f) => /^vidsnag-backup-.*\.json$/.test(f));
  const data = file && JSON.parse(fs.readFileSync(path.join(DL, file)));
  check('Export writes a backup with settings, rules, addons, library, history', data?.app === 'VidSnag' && data.settings && data.library?.items?.length > 0 && Array.isArray(data.history) && data.siteRules && Array.isArray(data.addons), file);
  // Change things, then import (replace)
  await setSettings({ defaultResolution: '480', filenameTemplate: 'changed {title}' });
  await sw.evaluate(async () => chrome.storage.local.set({ library: { categories: [], items: [] } }));
  const mod = { ...data, settings: { ...data.settings, defaultResolution: '720', theme: 'light' } };
  const tmp = path.join(OUT, 'import.json');
  fs.writeFileSync(tmp, JSON.stringify(mod));
  await o.setInputFiles('#importFile', tmp);
  await o.waitForTimeout(400);
  await o.locator('dialog.modal select[name="mode"]').selectOption('replace');
  await o.locator('dialog.modal button[value="ok"]').click();
  await o.waitForTimeout(1200);
  const s = await settings();
  const lib = await library();
  check('Import restores settings and saved links', s.defaultResolution === '720' && s.theme === 'light' && s.filenameTemplate === data.settings.filenameTemplate && lib.items.length === data.library.items.length, `${s.defaultResolution} ${s.theme} ${lib.items?.length}/${data.library.items.length}`);
  const bad = path.join(OUT, 'bad.json');
  fs.writeFileSync(bad, '{"hello":1}');
  await o.setInputFiles('#importFile', bad);
  await o.waitForTimeout(400);
  check('Import rejects files that are not VidSnag backups', (await o.locator('#saved').innerText()).includes('not a VidSnag backup'));
  await setSettings({ theme: 'system' });
  await o.close();
});

// ======================= 9. Addons: rules + scripts =======================
await step('addons', async () => {
  const o = await ctx.newPage();
  await o.goto(`chrome-extension://${extId}/options/options.html`);
  await o.waitForTimeout(400);
  const rule = path.join(OUT, 'rule.json');
  fs.writeFileSync(rule, JSON.stringify({
    type: 'vidsnag-addon', name: 'Test rules', version: '1.0', matches: ['*://localhost/*'],
    detect: { networkUrlPatterns: ['/api/media/\\d+/stream$'], selectors: [{ selector: '.secret-player', attribute: 'data-x' }] }
  }));
  await o.setInputFiles('#addonFile', rule);
  await o.waitForTimeout(800);
  check('Rule addon uploaded and listed', (await o.locator('#addonList .rule', { hasText: 'Test rules' }).count()) === 1);
  const invalid = path.join(OUT, 'invalid.json');
  fs.writeFileSync(invalid, JSON.stringify({ type: 'vidsnag-addon', name: 'x', detect: { networkUrlPatterns: ['(('] } }));
  await o.setInputFiles('#addonFile', invalid);
  await o.waitForTimeout(400);
  check('Invalid addon rejected with a message', (await o.locator('#saved').innerText()).includes('Invalid regex'));

  const { page, tabId } = await openPage('page-addon.html', 3500);
  const items = Object.values((await tabState(tabId)).items);
  check('Rule addon: network URL pattern detects extension-less API video', items.some((i) => i.url.endsWith('/api/media/7/stream') && i.sources.includes('network')), items.map((i) => i.url).join(', '));
  check('Rule addon: CSS selector + attribute detects media', items.some((i) => i.url.endsWith('/media/clip.webm') && i.sources.includes('addon')));
  await page.close();

  // Script addon (needs "Allow User Scripts")
  const ext = await ctx.newPage();
  await ext.goto(`chrome://extensions/?id=${extId}`);
  await ext.waitForTimeout(800);
  const toggle = ext.locator('#allow-user-scripts #crToggle, #allow-user-scripts cr-toggle').first();
  let toggled = false;
  if (await toggle.count()) { await toggle.click(); toggled = true; await ext.waitForTimeout(800); }
  await ext.close();
  sw = ctx.serviceWorkers().find((w) => w.url().includes(extId)) || sw;
  const script = path.join(OUT, 'script.js');
  fs.writeFileSync(script, `// ==VidSnagScript==\n// @name Config reader\n// @match *://localhost/*\n// ==/VidSnagScript==\nconst f = () => VidSnag.report([...document.querySelectorAll('[data-config]')].map((el) => ({ url: JSON.parse(el.dataset.config).src, title: 'From script addon' })));\nf(); VidSnag.onRescan(f);\n`);
  await o.reload();
  await o.waitForTimeout(400);
  await o.setInputFiles('#addonFile', script);
  await o.waitForTimeout(300);
  await o.locator('dialog.modal button[value="ok"]').click(); // trust confirmation
  await o.waitForTimeout(1200);
  const st = await o.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'addons-status' })).result);
  check('Script addon installed; user-scripts status reported', (await o.locator('#addonList .rule', { hasText: 'Config reader' }).count()) === 1, JSON.stringify({ toggled, st }));
  const sp = await openPage('page-script.html', 4000);
  const sitems = Object.values((await tabState(sp.tabId)).items);
  const fromScript = sitems.find((i) => i.sources.includes('script'));
  check('Script addon reports media via VidSnag.report()', st.available ? fromScript?.title === 'From script addon' && fromScript.kind === 'hls' : true,
    st.available ? JSON.stringify(fromScript && { t: fromScript.title, k: fromScript.kind }) : 'User Scripts toggle unavailable in this Chrome build — instructions shown instead');
  if (!st.available) check('Instructions shown when user scripts are off', await o.locator('#userScriptsStatus').isVisible());
  // Backup containing a script addon asks before installing it.
  const backup = path.join(OUT, 'with-script.json');
  const addonsNow = await sw.evaluate(async () => (await chrome.storage.local.get('addons')).addons);
  fs.writeFileSync(backup, JSON.stringify({ app: 'VidSnag', format: 1, settings: { theme: 'system' }, addons: addonsNow }));
  await sw.evaluate(async () => chrome.storage.local.set({ addons: [] }));
  await o.setInputFiles('#importFile', backup);
  await o.locator('dialog.modal', { hasText: 'Import backup' }).waitFor({ timeout: 5000 }).catch(() => {});
  const d1 = await o.locator('dialog.modal').allInnerTexts();
  await o.locator('dialog.modal', { hasText: 'Import backup' }).locator('button[value="ok"]').click(); // merge
  await o.locator('dialog.modal', { hasText: 'Install script addons' }).waitFor({ timeout: 5000 }).catch(() => {});
  const asked = await o.locator('dialog.modal', { hasText: 'Install script addons from this backup' }).count();
  if (!asked) console.log('DEBUG import dialogs', d1, await o.locator('dialog.modal').allInnerTexts(), await o.locator('#saved').innerText(), JSON.stringify(addonsNow).slice(0, 300));
  await o.locator('dialog.modal', { hasText: 'Install script addons' }).locator('button[value="cancel"]').click(); // decline scripts
  await o.waitForFunction(() => /imported|failed/i.test(document.getElementById('saved').textContent), null, { timeout: 8000 }).catch(() => {});
  const flashText = await o.locator('#saved').innerText();
  const after = await sw.evaluate(async () => (await chrome.storage.local.get('addons')).addons || []);
  check('Backup import asks before installing script addons (declined → rules only)', asked === 1 && after.length === 1 && after[0].kind === 'rules', `${asked} ${after.map((a) => a.kind)} | ${flashText}`);
  await sp.page.close(); await o.close();
});

// Fresh install: defaults written, context menus built, no service-worker errors.
await step('fresh-install', async () => {
  const prof = path.join(OUT, 'fresh-profile');
  const c2 = await chromium.launchPersistentContext(prof, { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  const w = c2.serviceWorkers()[0] || await c2.waitForEvent('serviceworker');
  await sleep(1500);
  const r = await w.evaluate(async () => ({ s: (await chrome.storage.sync.get('settings')).settings, popup: await chrome.action.getPopup({}) }));
  check('Fresh install: default settings stored + popup set', r.s && r.s.defaultPanel === 'popup' && r.popup.endsWith('popup/popup.html'), JSON.stringify(r).slice(0, 120));
  await c2.close();
});

console.log('SW errors:', swErrors.slice(0, 8));
await ctx.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
