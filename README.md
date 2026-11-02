# VidSnag – Video Downloader (Chrome, Manifest V3)

VidSnag finds the videos and audio on the page you're watching and saves them in the quality you pick. It's a from-scratch rebuild of the core ideas behind Video DownloadHelper, written in plain JavaScript with no build step.

## Features

| Area | What it does |
|---|---|
| **Popup** | Lists every detected media for the current tab, with type chips (MP4 / WEBM / HLS / DASH / LIVE / AES / DRM), resolution, duration and size. Each entry has a quality picker, a one-click **Download** button, copy-link and remove. **Downloads** tab: live progress, Cancel, *Stop & save* for live streams, Open / Show in folder, Retry. **History** tab: searchable, with open, re-download and delete. |
| **Service worker** | Sniffs network traffic (`webRequest`), classifies responses by MIME type, extension and size, and skips segment files. It parses HLS master playlists and DASH manifests into qualities, keeps per-tab state in `storage.session`, shows a badge count, runs a download queue (max 3 streams in parallel) and tracks state (queued → starting → downloading → finalizing → done / error / cancelled). |
| **Content script** | Scans `<video>`, `<audio>`, `<source>`, `<embed>`/`<object>` and `og:video` tags. A `MutationObserver` and media events catch players that load late. It reads the real resolution and duration, and picks up a poster or og:image as the thumbnail. |
| **Stream downloader** | Runs in an offscreen document. It fetches segments in parallel with retries and timeouts, decrypts AES-128 HLS (WebCrypto) and converts MPEG-TS to MP4 with mux.js. It handles fMP4 HLS (`EXT-X-MAP`), byte ranges and DASH SegmentTemplate/SegmentTimeline/SegmentList. Live HLS can be recorded until you press *Stop & save*. |
| **Protected sources** | Temporary `declarativeNetRequest` session rules give the extension's own requests the page's `Referer`/`Origin`, including segments served from other CDN hosts. The rules are removed when the job ends. |
| **Settings** (`storage.sync`) | Default resolution, preferred format (MP4/WebM), HLS output (MP4 or original .ts), file-name template (`{title} {res} {host} {date} {time}`), subfolder, Save-As prompt, parallel segments, minimum file size, DOM scanning, badge, context menu, notifications, and history on/off with retention days. |
| **History** (`storage.local`) | Records finished and failed downloads (up to 500), pruned after *N* days. |
| **Extras** | A right-click menu on videos, audio and media links. **Alt+Shift+D** downloads the best media on the tab. Desktop notifications. Dark mode. |

## Install in Chrome (unpacked)

1. Unzip `vidsnag-extension.zip` to a folder you will keep, for example `Documents\VidSnag`. Chrome loads the extension from that folder, so don't delete it.
2. Open **chrome://extensions**.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the folder that contains `manifest.json`.
5. Pin VidSnag from the puzzle-piece menu so the icon and its badge count stay visible.
6. Optional: right-click the icon and choose **Options** to set your default resolution, file names and folder.

To update after editing the code, click the ↻ reload button on VidSnag's card in chrome://extensions. Requires Chrome 116 or newer. The same folder also loads in Edge (edge://extensions) and Brave.

## Using it

- Open a page with a video and **press play**. Streaming players load the stream only when playback starts, so VidSnag can't see it before that.
- The badge shows how many media were found. Open the popup, pick a quality and click **Download**.
- Files go to `Downloads/VidSnag/` by default.
- Live streams: download starts recording. Open the **Downloads** tab and press **Stop & save**.
- If nothing appears, click **Scan page again**, reload the page and play the video, or lower *Ignore files smaller than* in Options.

## Project layout

```
manifest.json           MV3 manifest (permissions, content script, popup, options, command)
background.js           service worker: detection, manifest probing, queue, history, menus
content.js              DOM scanner for <video>/<audio>/<source>/og:video
offscreen/              HLS/DASH segment downloader, AES-128, TS→MP4 (mux.js)
popup/                  popup UI (Media / Downloads / History)
options/                settings page
lib/util.js             classification, file names, formatting
lib/settings.js         defaults, validation, quality picking
lib/hls.js, lib/dash.js manifest parsers (the DASH one has its own XML reader; service workers have no DOMParser)
lib/vendor/mux.min.js   mux.js 7.1.1 (Apache-2.0) for MPEG-TS → MP4
ui/                     shared theme + DOM helpers
docs/VDH-analysis.md    REA findings on Video DownloadHelper's architecture
tests/                  local test site + Playwright end-to-end suite
```

## Tests

`tests/` contains a small Node test server (with Range requests, a Referer-protected folder and a simulated live HLS stream), test pages, and a Playwright suite that loads the extension in Chromium.

```bash
cd tests
./make-fixtures.sh            # needs ffmpeg + openssl; generates MP4/WebM/HLS/AES/fMP4/DASH media
node server.js &              # http://localhost:8765
npm i playwright && npx playwright install chromium
node test.mjs                 # 41 checks; prints PASS/FAIL and verifies every file with ffprobe
```

The last run passed 41/41: detection (DOM and network), size filtering, badge, popup rendering, direct MP4, HLS with quality selection, AES-128, fMP4, DASH video and audio, Referer-protected and cross-host streams, live record → stop, cancel, queue concurrency, history and search, settings (resolution, template, subfolder, history off), and navigation reset.

## Limitations (by design)

- **DRM** (Widevine/PlayReady/FairPlay, SAMPLE-AES) is detected and flagged, never downloaded.
- **Separate audio/video tracks** (most DASH, some HLS) can't be merged into one file without bundling an ffmpeg build. VidSnag warns you and lets you save the audio track separately. Video DownloadHelper ships libav.js (≈5 MB WASM) for this.
- **YouTube** streams are not offered. They arrive as range-chunked fragments from googlevideo.com, and downloading from YouTube is against its Terms of Service.
- HLS streams with discontinuities (e.g. stitched-in ads) can get wrong timestamps when converted to MP4. If a file plays oddly, set *HLS stream output* to *Original (.ts)*.
- Live DASH and multi-period DASH (ad breaks) are rejected with a clear message.
- Streams are assembled in memory (as Blobs) before saving, so very long videos need enough RAM and disk space.

Only download content you have the right to save.
