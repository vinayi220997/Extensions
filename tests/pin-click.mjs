// Verifies the floating indicator's Pin button with a real mouse click in a fresh session.
import { createRequire } from 'module';
import path from 'path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const EXT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ctx = await chromium.launchPersistentContext(require('fs').mkdtempSync('/tmp/vs-pin-'), { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`], viewport: { width: 1100, height: 800 } });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
await new Promise((r) => setTimeout(r, 800));
await sw.evaluate(async () => { const { settings } = await chrome.storage.sync.get('settings'); await chrome.storage.sync.set({ settings: { ...settings, sidebarMode: 'unpinned', lastPinnedMode: 'mini' } }); });
const page = await ctx.newPage();
await page.goto('http://localhost:8765/page-mp4.html');
await page.waitForTimeout(2500);
const box = await page.locator('vidsnag-indicator').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(1500);
const frame = page.frames().find((f) => f.url().includes('mode=float'));
await frame.waitForSelector('#btnPinBack');
const fbox = await (await frame.frameElement()).boundingBox();
const b = await frame.evaluate(() => { const r = document.getElementById('btnPinBack').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.click(fbox.x + b.x, fbox.y + b.y);
await page.waitForTimeout(1500);
const mode = await sw.evaluate(async () => (await chrome.storage.sync.get('settings')).settings.sidebarMode);
const gone = (await page.locator('vidsnag-indicator').count()) === 0;
console.log(`${mode === 'mini' && gone ? 'PASS' : 'FAIL'}  Real mouse click on Pin restores Mini and removes the indicator  — ${mode} ${gone}`);
await ctx.close();
process.exit(mode === 'mini' && gone ? 0 : 1);
