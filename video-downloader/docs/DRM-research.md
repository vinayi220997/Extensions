# DRM detection in VidPull 3.1 — research notes (REA)

## What was examined

REA 6.8.0 (`rea analyze-javascript-application`, static, nothing executed) was run on the DRM modules of three open-source players, fetched from npm:

| Project | Version | Files analysed | Licence |
|---|---|---|---|
| Shaka Player (Google) | 5.3.3 | `lib/drm/drm_engine.js`, `drm_utils.js`, `fairplay.js`, `playready.js`, `lib/util/pssh.js` (588 semantic nodes, complete within view) | Apache-2.0 |
| hls.js | 1.7.4 | `src/controller/eme-controller.ts`, `src/utils/mediakeys-helper.ts` | Apache-2.0 |
| dash.js | 5.2.1 | protection controller (bundle) | BSD-3 |

REA's evidence for Shaka confirmed the key-system strings (`com.widevine.alpha`, `com.microsoft.playready[.recommendation|.hardware]`, `com.apple.fps[.1_0]`, `org.w3.clearkey`), the DRM system UUIDs, and the Common Encryption schemes (`cenc`, `cbcs`, `cens`, `cbc1`).

## What was reused

- **DRM system ID table** (`lib/drm.js` `DRM_SYSTEMS`): Shaka's `DrmUtils.getUuidMap()`, plus the DASH-IF registered IDs for Adobe Primetime (`f239e769-…`), Marlin and Nagra.
- **PSSH box layout** (`lib/drm.js` `parsePssh`, `content-eme.js` `readPssh`): follows Shaka's `shaka.util.Pssh` (version 0/1, key-ID list). VidPull's parser is a few lines without the Mp4Parser dependency.
- **HLS key formats** (`systemFromHlsKey`): hls.js `KeySystemFormats` (`com.apple.streamingkeydelivery`, `com.microsoft.playready`, `urn:uuid:edef8ba9-…`, `org.w3.clearkey`), plus `skd://` and `faxs://` URIs.
- **Where players learn about protection.** VidPull hooks the same points:
  - `requestMediaKeySystemAccess`
  - `createMediaKeys`
  - `createSession`
  - `generateRequest`
  - the `encrypted` event
  - the licence request

Nothing was added as a dependency. The useful logic is a table and a box parser, so it was folded into the existing `lib/` modules.

## Engines that were not adopted, and why

- **Key extraction or decryption tools**, such as Widevine CDM dumpers and "L3" key tools. These circumvent copy protection, so none were used or ported.
- **Shaka Player offline storage.** Persistent licences can only be requested by the site's own player with its licence server and credentials. Chrome desktop's Widevine CDM does not grant them, and VidPull reports `persistentLicense: false` there. The stored result only plays inside that origin's player, so it is not a file an extension can offer.
- **Provider SDKs** (Netflix, Prime Video, Disney+ and others) are not available to browser extensions. Official offline viewing lives in the providers' apps, so VidPull links to it.

## How detection works

1. **Manifests.**
   - DASH: `ContentProtection` (mp4protection `value`, `cenc:default_KID`, `urn:uuid` systems, `cenc:pssh`, `dashif:Laurl`/`laurl`).
   - HLS: `EXT-X-KEY` and `EXT-X-SESSION-KEY` (`METHOD`, `KEYFORMAT`, `KEYID`, `skd://`, data-URI PSSH).
   - Plain AES-128 HLS is not DRM, and it still downloads.
2. **EME (`content-eme.js`, MAIN world, `document_start`).** This records:
   - the key systems that were requested, available and actually used;
   - robustness, `encryptionScheme`, session and init-data types;
   - PSSH system IDs and key IDs;
   - the licence server address (origin and path only), taken from the request whose body is the CDM's licence message;
   - a one-off check, through the browser's own API, of whether the CDM supports `persistent-license`.

   Capability checks alone don't count as protected playback. Many sites probe for Widevine on every page.
3. **Encrypted MP4 files.** On pages with active EME, the first 256 KB of each MP4 is checked for `encv`/`enca`, `schm`, `tenc` and `pssh` boxes.

Protected videos always stay in the list with these statuses:

- DRM detected
- DRM protected
- DRM type identified
- Official download, where the provider offers one
- Offline licences
- Download unavailable, with the technical reason

## Verification

`tests/test6.mjs` (49 checks) runs against real encrypted media:

- **Packaged fixtures.** Shaka Packager v3.4.2 produced CENC DASH with Widevine and PlayReady PSSH, and cbcs HLS with FairPlay and Widevine keys. Both are encrypted from the first frame.
- **Real playback.** Chromium's ClearKey CDM plays a CENC file through MSE, with a licence served by the local test server.

Widevine resolves `requestMediaKeySystemAccess` in the test Chromium, but it isn't used for playback there. Netflix, YouTube and other live platforms couldn't be reached from the test environment, so they are untested.
