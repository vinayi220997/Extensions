// End-to-end test: loads VidPull into Chromium, visits test pages, checks detection,
// drives the popup, downloads each kind of media and verifies files with ffprobe.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const EXT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'out');
const DL = path.join(OUT, 'downloads');
const BASE = 'http://localhost:8765';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'profile/Default'), { recursive: true });
fs.mkdirSync(DL, { recursive: true });
fs.writeFileSync(path.join(OUT, 'profile/Default/Preferences'), JSON.stringify({
  download: { default_directory: DL, prompt_for_download: false, directory_upgrade: true },
  savefile: { default_directory: DL }
}));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(path.join(OUT, 'profile'), {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required'],
  viewport: { width: 1100, height: 800 }
});
// Playwright renames downloads to GUIDs; restore Chrome's normal download behaviour.
{
  const pg = ctx.pages()[0] || await ctx.newPage();
  const cdp = await ctx.newCDPSession(pg);
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
}
let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
console.log('extension id', extId);
const swErrors = [];
sw.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') swErrors.push(m.text()); });

// Faster tests: allow small files through the size filter except tiny.mp4 (10 KB)
await sw.evaluate(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  await chrome.storage.sync.set({ settings: { ...settings, minFileSizeKB: 50, notifications: false } });
});

async function tabIdFor(url) {
  return sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
}
async function tabState(tabId) {
  return sw.evaluate(async (id) => (await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`], tabId);
}
async function jobs() {
  return sw.evaluate(async () => Object.values((await chrome.storage.session.get('jobs')).jobs || {}));
}
async function waitJob(predicate, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const js = await jobs();
    const j = js.find(predicate);
    if (j && ['done', 'error', 'cancelled'].includes(j.status)) return j;
    await sleep(500);
  }
  return null;
}
function probe(file) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', file]).toString();
    return JSON.parse(out);
  } catch (e) { return { error: String(e.stderr || e) }; }
}
function findFile(fragment) {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  return walk(DL).filter((f) => f.includes(fragment) && !f.endsWith('.crdownload'));
}

async function openPage(name) {
  const page = await ctx.newPage();
  const url = `${BASE}/${name}`;
  await page.goto(url);
  await page.waitForTimeout(3000);
  const tabId = await tabIdFor(url);
  return { page, tabId, url };
}

async function popupFor(tabId) {
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 400, height: 600 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tabId}`);
  await popup.waitForTimeout(600);
  return popup;
}

// ---------- 1. Direct files (DOM + network) ----------
{
  const { page, tabId } = await openPage('page-mp4.html');
  await page.waitForTimeout(1500); // late <audio> insertion
  const st = await tabState(tabId);
  const items = Object.values(st?.items || {});
  const urls = items.map((i) => i.url.replace(BASE, ''));
  check('Detects <video src> mp4', urls.includes('/media/big.mp4'), urls.join(', '));
  check('Detects <source> webm', urls.includes('/media/clip.webm'));
  check('Filters files below min size (even when found in DOM)', !items.some((i) => i.url.endsWith('tiny.mp4')), urls.join(', '));
  check('Late-inserted <audio> handled (merged, no duplicate)', items.length === 2, String(items.length));
  const big = items.find((i) => i.url.endsWith('big.mp4'));
  check('Merges DOM metadata (resolution/duration)', big && big.height === 720 && big.duration > 11, big && `${big.width}x${big.height} ${big.duration}s size=${big.size}`);
  check('Network size captured', big && big.size === fs.statSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), 'media/big.mp4')).size, String(big?.size));
  const badge = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  check('Badge shows count', badge === String(items.length), `badge=${badge}`);

  const popup = await popupFor(tabId);
  const cards = await popup.locator('#mediaList .card').count();
  check('Popup lists detected media', cards === items.length, `${cards} cards`);
  await popup.screenshot({ path: path.join(OUT, 'popup-media.png') });
  // download big.mp4 via the popup
  await popup.locator(`#mediaList .card[data-id="${big.id}"] button.btn.primary`).click();
  const job = await waitJob((j) => j.source.url.endsWith('big.mp4'));
  check('Direct MP4 download completes', job?.status === 'done', job?.error || job?.finalPath);
  const f = findFile('Direct files');
  const p = f[0] && probe(f[0]);
  check('Direct MP4 file valid', p && !p.error && p.streams.length === 2 && fs.statSync(f[0]).size === big.size, f[0]);
  await popup.click('button[data-view="jobs"]');
  await popup.waitForTimeout(400);
  await popup.screenshot({ path: path.join(OUT, 'popup-jobs.png') });
  await popup.close();
  await page.close();
}

// ---------- 2. HLS master (2 qualities), select 360p ----------
{
  const { page, tabId } = await openPage('page-hls.html');
  await page.waitForTimeout(1000);
  const items = Object.values((await tabState(tabId))?.items || {});
  const hls = items.filter((i) => i.kind === 'hls');
  check('HLS: one entry for master (variant playlist merged)', hls.length === 1, hls.map((i) => i.url).join(', '));
  const m = hls[0];
  check('HLS: two qualities parsed', m && m.variants.length === 2, m && m.variants.map((v) => v.label).join(' | '));
  check('HLS: segments not listed', !items.some((i) => i.url.endsWith('.ts')));
  const popup = await popupFor(tabId);
  const sel = popup.locator('#mediaList .card select');
  const selected = await sel.inputValue();
  const v720 = m.variants.find((v) => v.height === 720);
  check('HLS: default resolution (1080 pref) pre-selects 720p', selected === v720.id, selected);
  const v360 = m.variants.find((v) => v.height === 360);
  await sel.selectOption(v360.id);
  await popup.screenshot({ path: path.join(OUT, 'popup-hls.png') });
  await popup.locator('#mediaList .card button.btn.primary').click();
  const job = await waitJob((j) => j.kind === 'hls' && j.source.url.endsWith('360.m3u8'));
  check('HLS download completes', job?.status === 'done', job?.error || job?.finalPath);
  const f = findFile('HLS master test');
  const p = f[0] && probe(f[0]);
  check('HLS → MP4 converted, 360p, audio+video, ~12s', p && !p.error && f[0].endsWith('.mp4') && p.streams.some((s) => s.height === 360) && p.streams.some((s) => s.codec_type === 'audio') && Math.abs(Number(p.format.duration) - 12) < 1, `${f[0]} ${JSON.stringify(p)}`);
  await popup.close(); await page.close();
}

// ---------- 3. AES-128 HLS ----------
{
  const { page, tabId } = await openPage('page-aes.html');
  const it = Object.values((await tabState(tabId))?.items || {}).find((i) => i.kind === 'hls');
  check('AES HLS detected + flagged encrypted', it && it.encrypted && !it.drm, JSON.stringify(it && { e: it.encrypted, s: it.status }));
  const popup = await popupFor(tabId);
  await popup.locator('#mediaList .card button.btn.primary').click();
  const job = await waitJob((j) => j.source.url.endsWith('enc/index.m3u8'));
  const f = findFile('AES HLS test');
  const p = f[0] && probe(f[0]);
  check('AES HLS decrypted + playable', job?.status === 'done' && p && !p.error && p.streams.length === 2, `${job?.status} ${job?.error || ''} ${f[0]}`);
  await popup.close(); await page.close();
}

// ---------- 4. fMP4 HLS ----------
{
  const { page, tabId } = await openPage('page-fmp4.html');
  const popup = await popupFor(tabId);
  await popup.locator('#mediaList .card button.btn.primary').click();
  const job = await waitJob((j) => j.source.url.endsWith('fmp4/index.m3u8'));
  const f = findFile('fMP4 HLS test');
  const p = f[0] && probe(f[0]);
  check('fMP4 HLS (EXT-X-MAP) download valid', job?.status === 'done' && p && !p.error && p.streams.length === 2 && Math.abs(Number(p.format.duration) - 12) < 1, `${job?.error || ''} ${f[0]} ${p && p.format && p.format.duration}`);
  await popup.close(); await page.close();
}

// ---------- 5. DASH ----------
{
  const { page, tabId } = await openPage('page-dash.html');
  const it = Object.values((await tabState(tabId))?.items || {}).find((i) => i.kind === 'dash');
  check('DASH detected with 2 video + 1 audio reps', it && it.variants.filter((v) => !v.audioOnly).length === 2 && it.variants.filter((v) => v.audioOnly).length === 1, it && it.variants.map((v) => v.label).join(' | '));
  const popup = await popupFor(tabId);
  const note = await popup.locator('#mediaList .card .note').count();
  check('DASH: separate-audio warning shown', note === 1);
  await popup.locator('#mediaList .card button.btn.primary').click();
  let job = await waitJob((j) => j.kind === 'dash' && j.source.repId === '0');
  let f = findFile('DASH test');
  let p = f[0] && probe(f[0]);
  check('DASH video rep (720p) download valid', job?.status === 'done' && p && !p.error && p.streams[0].height === 720 && Math.abs(Number(p.format.duration) - 12) < 1, `${job?.error || ''} ${f.join(',')} ${p && p.format && p.format.duration}`);
  const audio = it.variants.find((v) => v.audioOnly);
  await popup.locator('#mediaList .card select').selectOption(audio.id);
  await popup.locator('#mediaList .card button.btn.primary').click();
  job = await waitJob((j) => j.kind === 'dash' && j.source.repId === '2');
  f = findFile('DASH test').filter((x) => x.endsWith('.m4a'));
  p = f[0] && probe(f[0]);
  check('DASH audio-only rep download valid (.m4a)', job?.status === 'done' && p && !p.error && p.streams[0].codec_type === 'audio', `${job?.error || ''} ${f.join(',')}`);
  await popup.close(); await page.close();
}

// ---------- 6. Referer-protected stream ----------
{
  const { page, tabId } = await openPage('page-protected.html');
  const popup = await popupFor(tabId);
  const status = await popup.locator('#mediaList .card').innerText();
  check('Protected HLS probed using page Referer (DNR rule)', !/Could not|HTTP 403/.test(status), status.replace(/\s+/g, ' ').slice(0, 120));
  await popup.locator('#mediaList .card button.btn.primary').click();
  const job = await waitJob((j) => j.source.url.includes('/protected/'));
  check('Protected HLS download succeeds', job?.status === 'done', job?.error);
  const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
  check('Temporary header rules cleaned up', rules.length === 0, `${rules.length} left`);
  await popup.close(); await page.close();
}

// ---------- 6b. Segments on another (Referer-checked) host ----------
{
  const { page, tabId } = await openPage('page-crosshost.html');
  const popup = await popupFor(tabId);
  await popup.locator('#mediaList .card button.btn.primary').click();
  const job = await waitJob((j) => j.source.url.endsWith('xhost.m3u8'));
  check('Cross-host segments get page Referer', job?.status === 'done', job?.error);
  const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
  check('All per-host rules cleaned up', rules.length === 0, `${rules.length} left`);
  await popup.close(); await page.close();
}

// ---------- 6c. Queue: 5 stream jobs at once, max 3 in parallel ----------
{
  const { page, tabId } = await openPage('page-hls.html');
  const popup = await popupFor(tabId);
  const t0 = Date.now();
  const mid = Object.values((await tabState(tabId)).items).find((i) => i.kind === 'hls').id;
  // The button debounces double clicks, so queue the jobs through the same message the button sends.
  await popup.evaluate(async ([tabId, mediaId]) => {
    await Promise.all([0, 1, 2, 3, 4].map(() => chrome.runtime.sendMessage({ type: 'download', tabId, mediaId, variantId: 'v1' })));
  }, [tabId, mid]);
  let maxParallel = 0;
  let mine = [];
  for (let k = 0; k < 120; k++) {
    mine = (await jobs()).filter((j) => j.title === 'HLS master test' && j.createdAt >= t0);
    maxParallel = Math.max(maxParallel, mine.filter((j) => ['starting', 'downloading', 'finalizing'].includes(j.status)).length);
    if (mine.length && mine.every((j) => ['done', 'error', 'cancelled'].includes(j.status))) break;
    await sleep(100);
  }
  check('Queue runs all jobs, ≤3 streams in parallel', mine.length >= 2 && mine.every((j) => j.status === 'done') && maxParallel <= 3, `${mine.length} jobs, max parallel ${maxParallel}, ${mine.map((j) => j.status + (j.error ? ':' + j.error : '')).join(',')}`);
  await popup.close(); await page.close();
}

// ---------- 7. Live HLS: record then stop ----------
{
  const { page, tabId } = await openPage('page-live.html');
  const it = Object.values((await tabState(tabId))?.items || {}).find((i) => i.kind === 'hls');
  check('Live HLS flagged as live', it && it.live, JSON.stringify(it && { live: it.live, status: it.status }));
  const popup = await popupFor(tabId);
  await popup.locator('#mediaList .card button.btn.primary').click();
  await popup.waitForTimeout(7000);
  await popup.click('button[data-view="jobs"]');
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: path.join(OUT, 'popup-live.png') });
  await popup.locator('#jobsList .card button.btn.primary', { hasText: 'Stop' }).first().click();
  const job = await waitJob((j) => j.source.url.endsWith('live.m3u8'), 30000);
  const f = findFile('Live test');
  const p = f[0] && probe(f[0]);
  check('Live recording stops and saves playable file', job?.status === 'done' && p && !p.error && Number(p.format.duration) >= 4, `${job?.status} ${job?.note || ''} ${job?.error || ''} dur=${p?.format?.duration}`);
  await popup.close(); await page.close();
}

// ---------- 8. Cancel ----------
{
  const { page, tabId } = await openPage('page-live.html');
  const popup = await popupFor(tabId);
  await popup.locator('#mediaList .card button.btn.primary').click();
  await popup.waitForTimeout(2500);
  await popup.click('button[data-view="jobs"]');
  await popup.locator('#jobsList .card button', { hasText: 'Cancel' }).first().click();
  await popup.waitForTimeout(1000);
  const js = await jobs();
  const j = js.filter((x) => x.source.url.endsWith('live.m3u8')).sort((a, b) => b.createdAt - a.createdAt)[0];
  check('Cancel stops a running job', j?.status === 'cancelled', j?.status);
  await popup.close(); await page.close();
}

// ---------- 9. History + settings ----------
{
  const hist = await sw.evaluate(async () => (await chrome.storage.local.get('history')).history || []);
  check('History records finished downloads', hist.filter((h) => h.status === 'done').length >= 7, `${hist.length} entries`);
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 400, height: 600 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${await tabIdFor('about:blank') || 1}`);
  await popup.click('button[data-view="history"]');
  await popup.waitForTimeout(400);
  const n = await popup.locator('#historyList .card').count();
  check('History tab renders entries', n === hist.length, `${n}`);
  await popup.fill('#historySearch', 'DASH');
  const filtered = await popup.locator('#historyList .card').count();
  check('History search filters', filtered === hist.filter((h) => h.title.includes('DASH')).length, `${filtered}`);
  await popup.fill('#historySearch', '');
  await popup.screenshot({ path: path.join(OUT, 'popup-history.png') });

  const opts = await ctx.newPage();
  await opts.goto(`chrome-extension://${extId}/options/options.html`);
  await opts.selectOption('select[name="defaultResolution"]', '360');
  await opts.fill('input[name="filenameTemplate"]', '{host} - {title} {res}');
  await opts.fill('input[name="subfolder"]', 'My Videos');
  await opts.waitForTimeout(800);
  const s = await sw.evaluate(async () => (await chrome.storage.sync.get('settings')).settings);
  check('Options page saves settings', s.defaultResolution === '360' && s.filenameTemplate === '{host} - {title} {res}' && s.subfolder === 'My Videos', JSON.stringify(s));
  await opts.screenshot({ path: path.join(OUT, 'options.png'), fullPage: true });

  // New settings apply: 360p preselected + new name/folder
  const { page, tabId } = await openPage('page-hls.html');
  const pop2 = await popupFor(tabId);
  const it = Object.values((await tabState(tabId)).items).find((i) => i.kind === 'hls');
  const sel = await pop2.locator('#mediaList .card select').inputValue();
  check('Default resolution setting preselects 360p', sel === it.variants.find((v) => v.height === 360).id, sel);
  await pop2.locator('#mediaList .card button.btn.primary').click();
  const job = await waitJob((j) => j.title === 'HLS master test' && j.folder === 'My Videos');
  check('Filename template + subfolder applied', job?.status === 'done' && /My Videos[\\/]localhost - HLS master test 360p\.mp4$/.test(job.finalPath || ''), job?.finalPath);

  // history off → nothing recorded
  await sw.evaluate(async () => { const { settings } = await chrome.storage.sync.get('settings'); await chrome.storage.sync.set({ settings: { ...settings, historyEnabled: false } }); });
  const before = (await sw.evaluate(async () => (await chrome.storage.local.get('history')).history || [])).length;
  await pop2.locator('#mediaList .card button.btn.primary').click();
  await waitJob((j) => j.title === 'HLS master test' && j.createdAt > Date.now() - 5000);
  await sleep(1000);
  const after = (await sw.evaluate(async () => (await chrome.storage.local.get('history')).history || [])).length;
  check('History disabled → not recorded', before === after, `${before} → ${after}`);
  await pop2.close(); await page.close(); await popup.close(); await opts.close();
}

// ---------- 10. Navigation clears tab media ----------
{
  const { page, tabId } = await openPage('page-mp4.html');
  await page.goto(`${BASE}/page-dash.html`);
  await page.waitForTimeout(2500);
  const items = Object.values((await tabState(tabId)).items);
  check('Navigation resets the media list', items.length === 1 && items[0].kind === 'dash', items.map((i) => i.url).join(', '));
  await page.close();
}

const log = await (await fetch(`${BASE}/__log`)).json();
check('Server saw Referer on extension segment fetches', log.filter((l) => l.path.startsWith('/media/protected/') && l.referer.startsWith(BASE)).length > 3);
console.log('SW warnings/errors:', swErrors.slice(0, 10));
await ctx.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
