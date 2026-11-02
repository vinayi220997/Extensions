# VidSnag 2.2 – Video Downloader (Chrome, Manifest V3)

VidSnag finds the videos and audio on the page you're watching and saves them in the quality and format you choose. It's a from-scratch rebuild of the core ideas behind Video DownloadHelper, written in plain JavaScript with no build step.

## Install in Chrome (unpacked)

1. Unzip `vidsnag-extension.zip` to a folder you will keep, for example `Documents\VidSnag`. Chrome loads the extension from that folder, so don't delete it.
2. Open **chrome://extensions** and turn on **Developer mode** (top right).
3. If you had version 1 loaded, click **Remove** on the old VidSnag card first, or use the ↻ reload button if you unzipped over the same folder.
4. Click **Load unpacked** and select the folder that contains `manifest.json`.
5. Pin VidSnag from the puzzle-piece menu so the icon and its badge count stay visible.
6. Optional, for custom script addons only: on VidSnag's card click **Details** and turn on **Allow User Scripts**.

Requires Chrome 120 or newer. The same folder also loads in Edge and Brave.

## What's new in 2.2 — page sidebar with Max / Mini / Auto-hide

VidSnag now has its **own sidebar, docked at the right edge of web pages**. VidSnag controls its width, resizing, animation and edge handle; Chrome's built-in side panel doesn't let extensions change any of those. Chrome's side panel is still available.

| Mode | What you see |
|---|---|
| **Max** | The full sidebar with everything: cards, thumbnails, filters, sorting, downloads, saved links, history and settings. The default width is 380 px; **drag the left edge to resize** (double-click it to reset; arrow keys also work). |
| **Mini** | A narrow column at **5–10 % of the window width** (never narrower than 92 px). Each item shows a thumbnail with a **circular progress ring** that becomes a **square pause indicator** when paused, plus the duration, size, quality and a download/pause button. Text, menus and filters are hidden. |
| **Auto-hide** | Only a small arrow **handle** at the right edge. **Hover** or **click** it (your choice in Settings › Sidebar) to slide the sidebar out at its previous size. It collapses when the pointer leaves (hover mode) or when you click outside it (click mode). Click the Auto-hide button again to pin the sidebar back at its previous Max or Mini size. The handle can be dragged up or down. |

- **Icon-only controls:** three buttons at the top of the sidebar switch modes. There are no text labels. Each has a tooltip and an ARIA label, the active mode is highlighted, and arrow keys move between them. The same controls appear in Chrome's side panel and the VidSnag window. Choosing Auto-hide there hands over to the page edge handle, since Chrome's panel can't shrink.
- **Doesn't cover the page:** by default the page is shrunk next to the sidebar. You can switch to Overlay in Settings › Sidebar. The sidebar hides in fullscreen and animates smoothly, with motion reduced if your system asks for it.
- **Remembered across pages and browser restarts:** the mode, the Max width, the Mini width, the open/closed state, the Auto-hide trigger and the handle position.
- **Opening it:** use the panel menu › *Page sidebar*, the right-click menu › *Show the VidSnag page sidebar*, or make it what the toolbar icon does (Settings › Appearance › Default panel › *Page sidebar*). Close it with **×**.
- **Toolbar pin is separate:** pinning the VidSnag *icon* to Chrome's toolbar is done in Chrome's puzzle-piece menu. VidSnag never reads or changes it, and the sidebar modes are unrelated to it. Sidebar "pinning" only means Auto-hide off or on.

## What was new in 2.1

| Area | Features |
|---|---|
| **Sort by** | A new control next to the search box. Sort by date added (newest or oldest), name (A–Z or Z–A), duration (shortest or longest), file size (smallest or largest), quality (highest or lowest), website, or download status. Sorting combines with filters and search, and your choice is remembered. |
| **Media info** | Every card shows the duration. When the page doesn't say, VidSnag measures it, and `–:––` means it is still unknown. Every card also shows the file size: exact for files (asked from the server if needed) and estimated (`~`) for streams. Resolution, codecs (H.264/HEVC/VP9/AV1, AAC/Opus) and download status (percentage, Paused, Downloaded, Failed) are shown too. |
| **Global default action** | “Always download audio — all websites” and “Always copy link — all websites” set the main button everywhere. The same choice is in Settings › Behaviour › Default action, and choosing it again switches it off. The “— only on this site” options remain as per-site overrides. Where audio-only isn't possible (WebM, blob), the button falls back to Download. The Alt+Shift+D shortcut follows the default too. |
| **Pause / Resume** | Pause and resume browser-managed downloads and stream downloads (HLS/DASH). The buttons are in the Downloads tab, a card's ⋯ menu and the Mini view. Live recordings use *Stop & save*. |
| **Sidebar: Max / Mini / Unpin** (replaced in 2.2) | Controls at the top of the sidebar or window, and VidSnag remembers your last mode. **Max** shows the full interface. **Mini** is compact: a round thumbnail with a **circular progress ring** that turns into a **square pause indicator** when paused, a ✓ when finished, plus duration, size, quality and one download/pause button. **Unpin** closes the sidebar and leaves a small VidSnag tab, with the media count, at the right edge of every page. Hover it to open the Mini panel, move away to collapse it, drag it up or down, and press **Pin** to bring the sidebar back in your last mode. It hides in fullscreen. |

**About Unpin:** Chrome doesn't let extensions float, shrink or move the real sidebar. So Unpin uses the closest practical option: an indicator inside the page. It is hidden in fullscreen, only half-visible until you hover it, and can be dragged out of the way. The floating panel only opens from VidSnag's own indicator, and websites cannot embed the VidSnag interface themselves.

## What was new in 2.0

| Area | Features |
|---|---|
| **Panels** | Open VidSnag as a **popup**, in the **sidebar**, in a **separate window** or in a **tab**. **Pin on top** keeps it above other windows (Chrome Picture-in-Picture); click again to unpin. You choose whether the toolbar icon opens the popup or the sidebar. |
| **Main screen** | Filters (All / Video / Audio / Streams / Files) with counts, search, **List** and **Grid** views, **Refresh list**, **Refresh page** and **Clear list**. Cards show thumbnails and durations. Notices appear for DRM-protected and streaming-player pages. |
| **Card actions** | Download, Download as… (quality, format, file name, folder), Download audio, Always download audio on this site, Copy link, Always copy link on this site, Rename, Smart naming, Save to list, View details, Remove. |
| **Downloads** | **Audio only** (`.m4a`) from MP4 files, HLS and DASH. **Separate audio and video tracks are merged into one MP4** (DASH, and HLS with alternate audio), with no re-encoding. In-page (blob) videos can be saved. Formats: MP4, original `.ts`, video only, audio only. |
| **Detection** | HTML5 video and audio, including inside web components (shadow DOM). Also: media links and `data-*` attributes, `og:video`, JSON-LD `VideoObject`, `<link rel=preload>`, embedded players in iframes, and player APIs (JW Player, Video.js, Flowplayer, hls.js, dash.js, Shaka, Clappr). Network detection covers MP4, WebM, HLS, DASH and more. Pages that change without reloading and videos loaded later (scroll, clicks) are caught too. |
| **Saved links** | Separate **Videos** and **Pages** lists, organised in **categories** you can create, rename, recolour and delete. Each item can be opened, downloaded, copied, edited or moved. **Check link** shows whether an address still works. **Refresh link** reloads the video's page in the background, finds the same video and replaces the expired address. |
| **Settings** | A new **Appearance** section: video preview (icon / image / short video), theme (light / dark / system), accent colour plus a custom colour, window size S/M/L, text size, list or grid layout, and default panel. Settings can open **in the current window** or **in a new tab**. **Site rules** list your per-site choices. **Backup & restore** exports and imports settings, site rules, addons, saved links and history, with merge or replace. |
| **Addons** | **Rule addons** (`.json`): URL patterns and CSS selectors for sites VidSnag doesn't know yet. **Script addons** (`.js`): your own detection code, which calls `VidSnag.report([...])`. Upload, enable/disable, export or delete them. Samples of both are in Settings. |
| **Right-click menu** | On a video: download it, download its audio, copy its link, save it. On a link: download linked media, save the link. On a page: download the best media or its audio, save the page, rescan, open the sidebar or window, open saved links. On the toolbar icon: sidebar, window, saved links, history, help, settings. |
| **Help** | A Help view inside the panel covers every feature, what each label means, and step-by-step troubleshooting. |

Everything from 1.0 still works the same way. This includes AES-128 HLS, fMP4, live recording with *Stop & save*, Referer-protected and cross-CDN streams, the download queue, history and the Alt+Shift+D shortcut.

## Using it

- Open a page with a video and **press play**. Streaming players load their stream only after playback starts.
- The badge shows how many media were found. Pick a quality and click **Download**, or use **⋯** for all other actions.
- Files go to `Downloads/VidSnag/` by default. You can change this in Settings › Saving files.
- Live streams: Download starts recording. Open the **Downloads** tab and press **Stop & save**.
- Shortcuts: **Alt+Shift+V** opens VidSnag and **Alt+Shift+D** downloads the best media. You can change both at `chrome://extensions/shortcuts`.

## Addon formats

**Rule addon (.json)**

```json
{
  "type": "vidsnag-addon",
  "name": "My site",
  "version": "1.0",
  "matches": ["*://*.example.com/*"],
  "detect": {
    "networkUrlPatterns": ["/api/stream/\\d+/play$"],
    "selectors": [{ "selector": "div.player", "attribute": "data-src", "kind": "hls" }],
    "titleSelector": "h1.title"
  }
}
```

**Script addon (.js)**

The script runs in Chrome's isolated *user-script* world and needs "Allow User Scripts" turned on.

```js
// ==VidSnagScript==
// @name    My site
// @match   *://*.example.com/*
// ==/VidSnagScript==
const find = () => VidSnag.report([{ url: document.querySelector('[data-src]')?.dataset.src, title: document.title }]);
find();
VidSnag.onRescan(find);
```

## Project layout

```
manifest.json            MV3 manifest (permissions, side panel, content scripts, commands)
background.js            service worker: detection, probing, queue, library, menus, panels, addons
content.js               detectors (HTML5/shadow DOM, links, metadata/JSON-LD, blob, addon rules, notices)
content-main.js          player probe in the page's own JS world (JW Player, Video.js, …)
content-dock.js          page sidebar: Max / Mini / Auto-hide, resizing, edge handle (top frame, closed shadow DOM)
offscreen/               stream downloader: HLS/DASH, AES-128, TS→MP4, audio-only, A/V merge, MP4 audio
popup/                   panel app (popup / sidebar / window / PiP / tab):
  app.js ctx.js            shell, modes, tab tracking, pin, settings opening
  media.js                 main screen, filters, list/grid, card menu + dialogs
  jobs.js history.js       downloads + history
  library.js help.js       saved links + categories, help
options/                 settings page (also embeddable in the panel)
lib/                     util, settings, hls, dash, mp4 (merge + audio extraction), addons
lib/vendor/mux.min.js    mux.js 7.1.1 (Apache-2.0) for MPEG-TS → MP4
ui/                      theme, appearance, DOM helpers, menus, dialogs
docs/VDH-analysis.md     REA findings on Video DownloadHelper's architecture
tests/                   local test site + two Playwright end-to-end suites
```

## Tests

```bash
cd tests
./make-fixtures.sh            # needs ffmpeg + openssl
node server.js &              # http://localhost:8765
npm i playwright && npx playwright install chromium
node test.mjs                 # 41 checks — the original 1.0 behaviour
node test2.mjs                # 81 checks — every 2.0 feature
node test3.mjs                # 33 checks — sorting, defaults, pause/resume, frame lock
node test4.mjs                # 37 checks — page sidebar Max/Mini/Auto-hide, icon controls, resize, persistence
node pin-click.mjs            # real-mouse check: hover the handle, click the Auto-hide icon to pin back
```

Both suites load the extension in Chromium and verify every saved file with ffprobe/ffmpeg. The last run passed **41/41**, **81/81**, **33/33**, **37/37** and the real-mouse check.

The 2.0 suite covers:
- detection
- blob, streaming-player (MSE) and DRM pages
- audio extraction and A/V merging
- every card action and dialog, filters and grid, per-site rules and smart naming
- the right-click menu
- saved links with categories, link check, and refresh (both with the page closed and with it open on an old address)
- appearance, panels, sidebar, window and pin
- export and import
- rule and script addons
- a fresh install

## Limitations (by design)

- **DRM** (Widevine/PlayReady/FairPlay, SAMPLE-AES) is detected and shown with a clear message. VidSnag never bypasses copy protection.
- **Streaming players (MSE)** can't be read back from the page. VidSnag captures the underlying HLS/DASH stream from the network instead and tells you when it can't.
- **YouTube** is not supported: its streams are deliberately ignored.
- Audio-only download works for MP4/MOV/M4V files, HLS and DASH. WebM files have to be downloaded whole.
- Live DASH and multi-period DASH (for example with ad breaks) are rejected with a message. Some sites stitch ads into HLS, which can leave wrong timestamps after MP4 conversion; use *HLS output › Original (.ts)* for those.
- Streams are assembled in memory, and merging needs roughly three times the file size in free RAM. Very long 4K downloads may need the "video only" format.
- **Refresh link** works when the page loads its video without a click. Otherwise, open the page, play the video and save it again.
- **Keep on top** (Picture-in-Picture) needs Chrome's Document Picture-in-Picture, so the popup opens a window first.
- The **page sidebar** can't appear on Chrome's own pages (new tab, settings, Web Store), where extensions can't run; use the popup or Chrome's side panel there. Chrome's side panel itself can't be resized by extensions, so Mini width and Auto-hide use the page sidebar.
- **Stream sizes** are estimates (`~`) when the stream gives a bitrate. Plain media playlists without a bitrate show no size until downloaded.

Only download content you have the right to save.
