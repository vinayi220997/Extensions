// Real-mouse check of the page sidebar: hover the Auto-hide handle, then click the Auto-hide icon
// inside the sidebar (with the mouse, at its screen position) to pin it back at its previous size.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const EXT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const VW = 1200, VH = 800;
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync('/tmp/vs-pin-'), { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`], viewport: { width: VW, height: VH } });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
await new Promise((r) => setTimeout(r, 800));
await sw.evaluate(async () => { const { settings } = await chrome.storage.sync.get('settings'); await chrome.storage.sync.set({ settings: { ...settings, dockOpen: true, sidebarMode: 'autohide', lastPinnedMode: 'max', sidebarMaxWidth: 420 } }); });
const page = await ctx.newPage();
await page.goto('http://localhost:8765/page-mp4.html');
await page.waitForTimeout(2500);
const host = page.locator('vidpull-sidebar');
await page.mouse.move(VW - 8, VH * 0.45);
await page.waitForTimeout(900);
const expanded = await host.getAttribute('data-expanded');
const frame = page.frames().find((f) => f.url().includes('mode=dock'));
await frame.waitForSelector('#modeSwitch button[title]');
const fbox = await (await frame.frameElement()).boundingBox();
const b = await frame.evaluate(() => { const r = document.querySelector('#modeSwitch button[data-mode="autohide"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.move(fbox.x + b.x, fbox.y + b.y, { steps: 3 });
await page.mouse.click(fbox.x + b.x, fbox.y + b.y);
await page.waitForTimeout(1200);
const mode = await host.getAttribute('data-mode');
const width = await host.getAttribute('data-width');
const ok = expanded === 'true' && mode === 'max' && width === '420';
console.log(`${ok ? 'PASS' : 'FAIL'}  Real mouse: hover handle opens, clicking Auto-hide pins back to Max at 420 px  — ${expanded} ${mode} ${width}`);
await ctx.close();
process.exit(ok ? 0 : 1);
