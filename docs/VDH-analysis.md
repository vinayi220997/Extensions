# Video DownloadHelper 10.6.7.2 — architecture notes (REA analysis)

**Method.** The add-on package (`video_downloadhelper-10.6.7.2.xpi`, 3,884,443 bytes, from addons.mozilla.org) was unpacked and analyzed statically with REA 6.8.0 (`rea analyze-javascript-application`, scoped to `service/main.js`, `download_worker/main.js`, `content/panel.js`, `factory/factory.js`, plus sample injected scripts). The REA run parsed 6 JS files, visited 262k AST nodes and recorded 210 findings. Static reading of the minified bundles followed. Nothing was executed. The Chrome Web Store build shares this MV3 codebase; the analyzed build is the Firefox one.

## Tech stack
- Manifest V3, background as an ES module (Firefox `scripts`; Chrome uses a service worker plus an offscreen document).
- UI: no framework. Hand-written custom elements (`com-*`) with shadow DOM and `<template>` cloning, and XUL-like `hbox`/`vbox` layout. Zod v4 for schema validation. highlight.js and TOML for the smart-naming editor.
- Media: libav.js 6.5.7.1 (ffmpeg compiled to WASM, h264/aac/mp3 build, ≈4.9 MB) for remuxing and MP3 extraction. OPFS holds temporary files.

## Permissions
`tabs, downloads, webRequest, webNavigation, scripting, declarativeNetRequest, storage, notifications, contextMenus, unlimitedStorage` plus `<all_urls>`. Optional: `browsingData`, `downloads.open`.

## Detection
- **Network (primary):**
  - `webRequest.onSendHeaders` caches request headers; entries are swept after 600 s.
  - `onResponseStarted` classifies 2xx responses on xmlhttprequest/media/main_frame/sub_frame/other: HLS by `mpegurl` or `m3u8`, DASH by `.mpd` or a `dash` MIME, direct files by a MIME regex.
  - It skips `.ts`/`.m4s`/`.m2ts`, files under 500 KB, page-initiated files under 20 MB, and initiators handled by site scripts (YouTube, Vimeo, Instagram…).
- **Site scripts:** MAIN-world `*_untrusted.js` stubs read page globals (`playerConfig`, `__INITIAL_STATE__`, `ytcfg`) or hook XHR/fetch. They talk to ISOLATED-world bundles over `BroadcastChannel("injected-<hash>")`, which forward to the service worker with `runtime.sendMessage({msg, channel})`.
- **No generic `<video>` scanning.** `scripting.executeScript` is used only for thumbnails, titles, the DRM check (`video.mediaKeys`) and clipboard.
- **Manifests are fetched by the extension itself.** It sets Referer/Origin/Cookie with random-id `declarativeNetRequest` session rules that are removed right after each fetch.

## State
- `storage.session["global_session_state"]` holds `discovered` (Map tab → media by URL hash), `downloading`, `transient_history` and `notifications`.
- The list is cleared on main-frame `onBeforeNavigate` and on `tabs.onRemoved`.
- `storage.local["global_persistent_state"]` holds settings and history. Defaults include `preferred_quality` 1080, `preferred_av_muxer` mp4|mkv, `max_concurrent_downloads` 6, `default_action` download, `history_days` 0 (off), `ui_theme` and `dockmode` popup|sidebar. History is stored in the `downloaded` Map.
- Badge: colour or grey icon. Count priority is notifications (red), then active downloads (blue).

## Downloads
- The `do_download` message goes through a gate: TOS accepted, a free tier of one YouTube download per 2 h, and DRM.
- Queue class with `max_concurrent_downloads`. Status runs queuing → downloading → finalizing.
- A module Worker (`download_worker/main.js`) runs inside an offscreen document (`factory.html`, reason WORKERS) and talks over `BroadcastChannel("worker_service")`.
- Segments are fetched 4 at a time with retry and timeout, and the job aborts if more than 35% of segments are bad. AES-128 is decrypted with WebCrypto; SAMPLE-AES and Widevine/PlayReady/FairPlay are flagged.
- libav remuxes with `-c copy` to mp4/mkv/webm, or `libmp3lame` for audio, into OPFS. The result is exposed as a blob URL, saved with `chrome.downloads.download`, then revoked.

## UI
- The popup and sidebar share one bundle with these sections: discovered media (quality selector, tags HLS/MPD/HTTP, DRM warning), downloading (progress, bitrate, stop), downloaded (retry, play, delete), settings, history page, and smart-naming editor.
- Actions: Download, Download as…, Audio only, Copy URL, and per-site default action.
- Messaging: `mut-settings`, `do_download`, `abort_download`, `retry_download` and others. The UI re-renders on `storage.onChanged`.

## What VidSnag kept, simplified or dropped (v2.0)
| VDH | VidSnag 2.0 |
|---|---|
| webRequest sniffing + manifest probing | Kept (`onSendHeaders` + `onResponseStarted`, HLS/DASH parsers) plus rule-addon URL patterns |
| DNR header replay | Kept, with per-job rules for every CDN host and cleanup on start |
| Offscreen document + worker | Offscreen document only (no worker needed without WASM) |
| libav.js remux / merge A+V (≈5 MB WASM) | Own dependency-free fMP4 merger + MP4 audio extractor (`lib/mp4.js`) and mux.js TS→MP4 (≈118 KB). Separate audio/video tracks are merged; audio-only gives `.m4a` (no MP3 transcode) |
| Site-specific extractors (MAIN/ISOLATED pairs) | Generic detectors (HTML5 + shadow DOM, links/data-attrs, og/JSON-LD, blob) + a generic player probe in the MAIN world + user addons (JSON rules, `chrome.userScripts` scripts) |
| Popup + sidebar (`dockmode`) | Popup, side panel, separate window, tab, and Document-PiP "pin on top"; default panel setting |
| Custom elements UI | Plain DOM-builder UI: filters, list/grid, card menus, dialogs, Saved links, Help |
| Smart naming (TOML rules) | Per-site naming rule: template + CSS selector, tested live |
| `default_action_per_hostname` | "Always download audio / Always copy link" per site |
| History (`history_days`) | History with retention days + Saved links library with categories, link check and refresh |
| Premium/TOS gating, remote config | Not included |
