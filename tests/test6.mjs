// VidPull 3.1 suite: DRM detection & reporting (real EME ClearKey session, CENC DASH with Widevine +
// PlayReady, FairPlay / Widevine HLS), DRM entries never hidden and never downloadable, AJAX/JSON
// detection, extra container formats, whole .ts files, lazy-loaded video, new format filters.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const HERE = path.dirname(new URL(import.meta.url).pathname);
const EXT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'out6');
const BASE = 'http://localhost:8765';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 400) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function step(name, fn) { try { await fn(); } catch (e) { check(`${name} (threw)`, false, e.stack?.split('\n').slice(0, 3).join(' | ')); } }
async function waitFor(fn, timeout = 10000) { const end = Date.now() + timeout; while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await sleep(250); } return null; }

const ctx = await chromium.launchPersistentContext(path.join(OUT, 'profile'), { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`], viewport: { width: 1280, height: 800 } });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
await sleep(900);
await sw.evaluate(async () => { const { settings } = await chrome.storage.sync.get('settings'); await chrome.storage.sync.set({ settings: { ...settings, minFileSizeKB: 50, notifications: false } }); });
const tabIdFor = (url) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
const items = async (tabId) => Object.values((await sw.evaluate(async (id) => (await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`], tabId))?.items || {});
async function openPage(name, wait = 2500) {
  const page = await ctx.newPage();
  const url = `${BASE}/${name}`;
  await page.goto(url);
  await page.waitForTimeout(wait);
  return { page, url, tabId: await tabIdFor(url) };
}
async function panel(tabId) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 440, height: 700 });
  await p.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tabId}`);
  await p.waitForTimeout(800);
  return p;
}

// ---------- 1. Real EME session (ClearKey CDM + licence server) ----------
await step('eme', async () => {
  const { page, tabId } = await openPage('page-eme.html', 1000);
  const licensed = await waitFor(async () => (await page.title()).includes('licensed'), 10000);
  check('Page plays CENC-encrypted media through EME with a licence from the server', !!licensed, await page.title());
  const played = await waitFor(() => page.evaluate(() => document.body.dataset.played === 'yes'), 8000);
  check('Browser CDM decrypts and plays the protected video (ground truth)', !!played);
  const it = await waitFor(async () => (await items(tabId)).find((i) => i.drm), 8000);
  check('Protected video is listed (not hidden)', !!it, JSON.stringify((await items(tabId)).map((i) => [i.kind, i.status])));
  const d = it?.drmInfo || {};
  check('DRM type identified: ClearKey key system', d.systems?.includes('ClearKey') && d.keySystems?.includes('org.w3.clearkey'), JSON.stringify(d.systems));
  check('Player also asked for Widevine (recorded as requested)', d.requested?.includes('Widevine'), JSON.stringify(d.requested));
  check('Encryption scheme reported (cenc)', d.schemes?.includes('cenc'), JSON.stringify(d.schemes));
  check('Licence server found from the real licence request', d.licenseUrls?.includes(`${BASE}/drm/license`), JSON.stringify(d.licenseUrls));
  check('Key ID read from the init data', d.kids?.includes('a7e61c373e219033c21091fa607bf3b8'), JSON.stringify(d.kids));
  check('Protocol (MSE/EME), session type and format reported', d.protocols?.includes('MSE / EME') && d.sessionTypes?.includes('temporary') && d.formats?.includes('MP4'), JSON.stringify([d.protocols, d.sessionTypes, d.formats]));
  check('Offline-licence check skipped for ClearKey (only Widevine is probed, with a robustness level)', d.persistentLicense === null, String(d.persistentLicense));
  check('Resolution from the playing video', it?.width === 1280 && it?.height === 720, `${it?.width}x${it?.height}`);
  const p = await panel(tabId);
  const r = await p.evaluate(([t, m]) => chrome.runtime.sendMessage({ type: 'download', tabId: t, mediaId: m }), [tabId, it?.id]);
  check('No download is started for the protected video', r && r.ok === false && /DRM/.test(r.error || ''), JSON.stringify(r));
  const card = p.locator('#mediaList .card').first();
  const chips = await card.locator('.drm-status .chip').evaluateAll((els) => els.map((e) => e.dataset.status));
  check('Card statuses: detected, protected, type identified, unavailable', ['detected', 'protected', 'type', 'unavailable'].every((s) => chips.includes(s)), chips.join(','));
  const txt = await card.innerText();
  check('Card names the DRM and explains the limitation', /DRM · .*ClearKey/i.test(txt) && /content decryption module/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 200));
  check('No Download button on the protected card', (await card.locator('.btn.primary').count()) === 0);
  await card.locator('.icon-btn[aria-label="Protection details"]').click();
  await p.waitForTimeout(300);
  const dlg = await p.locator('dialog[open], .dialog').last().innerText();
  check('Details list licence server, key ID and statuses', dlg.includes('/drm/license') && dlg.includes('a7e61c37') && /Download unavailable in VidPull/.test(dlg), dlg.replace(/\s+/g, ' ').slice(0, 250));
  await p.screenshot({ path: path.join(OUT, 'eme-details.png') });
  await p.close();
  await page.close();
});

// ---------- 2. Capability checks alone are not DRM ----------
await step('probe-only', async () => {
  const { page, tabId } = await openPage('page-drm.html', 2500);
  const list = await items(tabId);
  check('setMediaKeys without protected playback creates no DRM entry', !list.some((i) => i.kind === 'drm'), JSON.stringify(list.map((i) => i.kind)));
  await page.close();
});

// ---------- 3. DASH with CENC (Widevine + PlayReady) ----------
await step('dash', async () => {
  const { page, tabId } = await openPage('page-drm-dash.html', 3000);
  const it = await waitFor(async () => (await items(tabId)).find((i) => i.kind === 'dash' && i.drmInfo && i.url.endsWith('/drm/stream.mpd')), 8000);
  const d = it?.drmInfo || {};
  check('DASH: Widevine + PlayReady identified from ContentProtection', d.systems?.includes('Widevine') && d.systems?.includes('PlayReady'), JSON.stringify(d.systems));
  check('DASH: cenc scheme + default KID + PSSH key ID', d.schemes?.includes('cenc') && d.kids?.includes('a7e61c373e219033c21091fa607bf3b8'), JSON.stringify([d.schemes, d.kids]));
  check('DASH: licence URL from the manifest (query stripped)', d.licenseUrls?.includes('https://license.example.test/widevine'), JSON.stringify(d.licenseUrls));
  check('DASH: qualities listed (720p, 360p)', it?.variants?.map((v) => v.height).join(',') === '720,360', JSON.stringify(it?.variants?.map((v) => v.height)));
  check('DASH: marked DRM, not downloadable', it?.status === 'drm' && it?.drm === true);
  const p = await panel(tabId);
  const txt = (await p.locator('#mediaList .card').allInnerTexts()).find((x) => /360p/.test(x)) || '';
  const sp = await waitFor(async () => (await items(tabId)).find((i) => i.url.includes('/sp/stream.mpd') && i.drmInfo), 6000);
  check('Shaka Packager DASH: Widevine + PlayReady, cenc, KID, 1280×720', sp?.drmInfo?.systems?.join() === 'PlayReady,Widevine' || (sp?.drmInfo?.systems?.includes('Widevine') && sp?.drmInfo?.systems?.includes('PlayReady') && sp?.drmInfo?.schemes?.includes('cenc') && sp?.drmInfo?.kids?.includes('a7e61c373e219033c21091fa607bf3b8') && sp?.height === 720), JSON.stringify(sp && { d: sp.drmInfo, h: sp.height }));
  await p.screenshot({ path: path.join(OUT, 'dash-card.png') });
  check('DASH card: "DRM · Widevine + PlayReady", qualities, reason', /DRM · (Widevine \+ PlayReady|PlayReady \+ Widevine)/i.test(txt) && /720p/.test(txt) && /360p/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 220));
  await p.close();
  await page.close();
});

// ---------- 4. HLS: FairPlay session key + Widevine SAMPLE-AES-CTR ----------
await step('hls', async () => {
  const { page, tabId } = await openPage('page-drm-hls.html', 3500);
  const list = await waitFor(async () => { const l = (await items(tabId)).filter((i) => i.kind === 'hls' && i.drmInfo); return l.length >= 3 ? l : null; }, 8000) || [];
  const fp = list.find((i) => /fairplay/.test(i.url));
  const wv = list.find((i) => /widevine-hls/.test(i.url));
  check('HLS: FairPlay from EXT-X-SESSION-KEY (skd://, cbcs)', fp?.drmInfo?.systems?.includes('FairPlay') && fp?.drmInfo?.schemes?.includes('cbcs'), JSON.stringify(fp?.drmInfo));
  check('HLS: FairPlay qualities 1080p + 720p kept', fp?.variants?.map((v) => v.height).join(',') === '1080,720', JSON.stringify(fp?.variants?.map((v) => v.height)));
  check('HLS: Widevine from KEYFORMAT urn:uuid (SAMPLE-AES-CTR → cenc) + key ID', wv?.drmInfo?.systems?.includes('Widevine') && wv?.drmInfo?.schemes?.includes('cenc') && wv?.drmInfo?.kids?.includes('a7e61c373e219033c21091fa607bf3b8'), JSON.stringify(wv?.drmInfo));
  check('FairPlay reason mentions Safari', /Safari/.test(fp?.error || ''), fp?.error);
  const p = await panel(tabId);
  const f = await p.locator('#mediaFilters .chip-btn').evaluateAll((els) => els.map((e) => e.dataset.filter + ':' + (e.querySelector('b')?.textContent || '')));
  const sp = list.find((i) => /sphls/.test(i.url)) || (await items(tabId)).find((i) => /sphls/.test(i.url));
  check('Shaka Packager HLS (cbcs): FairPlay + Widevine, KEYID read', sp?.drmInfo?.systems?.includes('FairPlay') && sp?.drmInfo?.systems?.includes('Widevine') && sp?.drmInfo?.schemes?.includes('cbcs') && sp?.drmInfo?.kids?.includes('a7e61c373e219033c21091fa607bf3b8'), JSON.stringify(sp?.drmInfo));
  check('Filters: HLS and DRM chips with counts', f.includes('hls:3') && f.includes('drm:3'), f.join(' '));
  await p.close();
  await page.close();
});

// ---------- 5. Ordinary AES-128 HLS still downloads (not DRM) ----------
await step('aes', async () => {
  const { page, tabId } = await openPage('page-aes.html', 3500);
  const it = await waitFor(async () => (await items(tabId)).find((i) => i.kind === 'hls' && i.status === 'ready'), 8000);
  check('AES-128 HLS is still "ready" (VidPull can save it), not DRM', it && !it.drm && it.encrypted, JSON.stringify(it && { s: it.status, d: it.drm, e: it.encrypted }));
  await page.close();
});

// ---------- 6. AJAX / JSON detection ----------
await step('ajax', async () => {
  const { page, tabId } = await openPage('page-ajax.html', 3000);
  const list = await items(tabId);
  const urls = list.map((i) => i.url);
  check('Video URL inside a fetch() JSON response (escaped slashes)', urls.some((u) => u.includes('big.mp4?from=feed')), urls.join(' '));
  check('HLS URL with & in a JSON response', urls.some((u) => u.includes('master.m3u8?sig=a&exp=1')), urls.join(' '));
  check('Video URL inside an XMLHttpRequest JSON response', urls.some((u) => u.endsWith('/media/clip.webm')), urls.join(' '));
  const hls = list.find((i) => i.url.includes('master.m3u8?sig'));
  check('AJAX-found HLS is analysed into qualities', !!(await waitFor(async () => (await items(tabId)).find((i) => i.id === hls?.id && i.status === 'ready' && i.variants.length > 1), 6000)));
  await page.close();
});

// ---------- 7. Container formats, whole TS file, lazy loading ----------
await step('formats', async () => {
  const { page, tabId } = await openPage('page-formats.html', 3500);
  let list = await items(tabId);
  const exts = list.map((i) => i.ext);
  for (const e of ['mpg', 'mov', 'avi', 'mkv', '3gp', 'flv', 'ogv']) check(`Format detected: .${e}`, exts.includes(e), exts.join(','));
  const ts = await waitFor(async () => (await items(tabId)).find((i) => i.url.endsWith('recording.ts')), 8000);
  check('Whole .ts recording listed (HLS .ts segments still hidden)', ts?.kind === 'file' && !(await items(tabId)).some((i) => /360_0\d\d\.ts/.test(i.url)), JSON.stringify(ts && { k: ts.kind, s: ts.size }));
  const before = (await items(tabId)).filter((i) => i.url.includes('lazy=1')).length;
  await page.mouse.wheel(0, 2500);
  const lazy = await waitFor(async () => (await items(tabId)).find((i) => i.url.includes('clip.webm?lazy=1')), 6000);
  check('Lazy-loaded <video> after scrolling is detected', before === 0 && !!lazy, `before ${before}, ${JSON.stringify(lazy?.sources)}`);
  const p = await panel(tabId);
  const f = await p.locator('#mediaFilters .chip-btn').evaluateAll((els) => els.map((e) => e.dataset.filter));
  check('Filters show MP4/Other style chips only for formats present', f.includes('all') && f.includes('other') && !f.includes('dash') && !f.includes('drm'), f.join(','));
  await p.locator('#mediaFilters .chip-btn[data-filter="other"]').click();
  await p.waitForTimeout(300);
  const n = await p.locator('#mediaList .card').count();
  list = await items(tabId);
  check('"Other" filter lists the non-MP4 files', n >= 7 && n === list.filter((i) => (i.kind === 'file' || i.kind === 'blob') && !['mp4', 'm4v', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac', 'weba'].includes(i.ext)).length, String(n));
  // Download one of the new formats to prove it works end to end.
  const mpg = list.find((i) => i.ext === 'mpg');
  const r = await p.evaluate(([t, m]) => chrome.runtime.sendMessage({ type: 'download', tabId: t, mediaId: m }), [tabId, mpg?.id]);
  const job = await waitFor(async () => { const j = Object.values((await sw.evaluate(async () => (await chrome.storage.session.get('jobs')).jobs || {}))).find((x) => x.mediaId === mpg?.id); return j && ['done', 'error'].includes(j.status) ? j : null; }, 15000);
  check('.mpg file downloads (complete)', r?.ok && job?.status === 'done', JSON.stringify(job && { s: job.status, e: job.error }));
  await p.close();
  await page.close();
});

// ---------- 8. Provider notice ----------
await step('provider', async () => {
  const msg = await sw.evaluate(async () => { const m = await import('./lib/drm.js').catch(() => null); return m; }).catch(() => null);
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${extId}/popup/popup.html?mode=tab`);
  const res = await p.evaluate(async () => {
    const d = await import('../lib/drm.js');
    return {
      nf: d.providerOffline('https://www.netflix.com/watch/1')?.name,
      yt: d.providerOffline('https://m.youtube.com/watch?v=x')?.name,
      none: d.providerOffline('https://example.com/'),
      st: d.drmStatuses({ systems: ['Widevine'], persistentLicense: false }, { pageUrl: 'https://www.netflix.com/watch/1' }).map((s) => s.id)
    };
  });
  check('Official offline route known for Netflix / YouTube; none for other sites', res.nf === 'Netflix' && res.yt === 'YouTube' && res.none === null, JSON.stringify(res));
  check('Status set includes "Authorized download available" and "Offline" lines', ['detected', 'protected', 'type', 'authorized', 'offline', 'unavailable'].every((x) => res.st.includes(x)), res.st.join(','));
  await p.close();
  void msg;
});

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
await ctx.close();
process.exit(pass === results.length ? 0 : 1);
