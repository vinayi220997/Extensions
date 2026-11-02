// DRM detection and reporting — one place that turns manifest signalling (DASH ContentProtection,
// HLS EXT-X-KEY / EXT-X-SESSION-KEY), PSSH boxes and EME activity into a readable summary.
//
// The DRM system ID table and the PSSH box layout follow Shaka Player
// (lib/drm/drm_utils.js getUuidMap, lib/util/pssh.js; Apache-2.0, © Google LLC),
// extended with the DASH-IF registered IDs for Adobe Primetime, Marlin and Nagra.
//
// VidPull only *reports* protection. It never requests licences, extracts keys or decrypts
// DRM-protected media: the keys stay inside the browser's content decryption module (CDM).

export const DRM_SYSTEMS = {
  'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed': { name: 'Widevine', keySystem: 'com.widevine.alpha' },
  '9a04f079-9840-4286-ab92-e65be0885f95': { name: 'PlayReady', keySystem: 'com.microsoft.playready' },
  '79f0049a-4098-8642-ab92-e65be0885f95': { name: 'PlayReady', keySystem: 'com.microsoft.playready' },
  '94ce86fb-07ff-4f43-adb8-93d2fa968ca2': { name: 'FairPlay', keySystem: 'com.apple.fps' },
  'f239e769-efa3-4850-9c16-a903c6932efb': { name: 'Adobe Primetime', keySystem: 'com.adobe.primetime' },
  '1077efec-c0b2-4d02-ace3-3c1e52e2fb4b': { name: 'ClearKey', keySystem: 'org.w3.clearkey' },
  'e2719d58-a985-b3c9-781a-b030af78d30e': { name: 'ClearKey', keySystem: 'org.w3.clearkey' },
  '5e629af5-38da-4063-8977-97ffbd9902d4': { name: 'Marlin', keySystem: 'com.marlin-drm' },
  'adb41c24-2dbf-4a6d-958b-4457c0d27b95': { name: 'Nagra', keySystem: 'com.nagra' },
  '3d5e6d35-9b9a-41e8-b843-dd3c6e72c42c': { name: 'WisePlay', keySystem: 'com.huawei.wiseplay' }
};
export const MP4_PROTECTION_SCHEME = 'urn:mpeg:dash:mp4protection:2011';

export function normalizeUuid(s) {
  const hex = String(s || '').toLowerCase().replace(/^urn:uuid:/, '').replace(/[^0-9a-f]/g, '');
  if (hex.length !== 32) return '';
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function systemFromUuid(s) {
  const id = normalizeUuid(s);
  return id ? (DRM_SYSTEMS[id]?.name || `Unknown DRM (${id})`) : '';
}

export function systemFromKeySystem(ks) {
  const k = String(ks || '').toLowerCase();
  if (k.startsWith('com.widevine')) return 'Widevine';
  if (k.startsWith('com.microsoft.playready') || k.startsWith('com.youtube.playready')) return 'PlayReady';
  if (k.startsWith('com.apple.fps') || k === 'com.apple.streamingkeydelivery') return 'FairPlay';
  if (k.includes('primetime') || k.includes('adobe')) return 'Adobe Primetime';
  if (k === 'org.w3.clearkey' || k === 'webkit-org.w3.clearkey') return 'ClearKey';
  if (k.includes('wiseplay')) return 'WisePlay';
  return ks ? String(ks) : '';
}

// HLS EXT-X-KEY: METHOD + KEYFORMAT (+ URI scheme) → DRM system. AES-128 with the default
// "identity" key format is plain HLS encryption, not DRM (VidPull downloads that).
export function systemFromHlsKey({ method = '', keyFormat = '', uri = '' }) {
  const f = String(keyFormat || 'identity').toLowerCase();
  const m = String(method || '').toUpperCase();
  if (m === 'NONE') return '';
  if (f === 'com.apple.streamingkeydelivery' || /^skd:/i.test(uri)) return 'FairPlay';
  if (f.startsWith('urn:uuid:')) return systemFromUuid(f);
  if (f === 'com.microsoft.playready') return 'PlayReady';
  if (f === 'org.w3.clearkey') return 'ClearKey';
  if (/^faxs:/i.test(uri) || f.includes('adobe') || f.includes('primetime')) return 'Adobe Primetime';
  if (f === 'identity') return m === 'AES-128' ? '' : `${m} (identity key)`;
  return f;
}

export function hlsScheme(method) {
  const m = String(method || '').toUpperCase();
  if (m === 'SAMPLE-AES-CTR') return 'cenc';
  if (m === 'SAMPLE-AES') return 'cbcs';
  if (m === 'AES-128') return 'AES-128';
  return m.toLowerCase();
}

// Walk concatenated PSSH boxes (EME "cenc" init data / DASH <cenc:pssh>).
// Layout: size(4) 'pssh'(4) version(1) flags(3) systemID(16) [KID count(4) KIDs(16·n) if v1] dataSize(4) data.
export function parsePssh(bytes) {
  const out = [];
  if (!bytes || !bytes.length) return out;
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 0;
  while (off + 32 <= u8.length) {
    const size = dv.getUint32(off);
    const type = String.fromCharCode(...u8.subarray(off + 4, off + 8));
    if (size < 32 || off + size > u8.length) break;
    if (type === 'pssh') {
      const version = u8[off + 8];
      const sys = hex(u8.subarray(off + 12, off + 28));
      const kids = [];
      if (version === 1) {
        const n = dv.getUint32(off + 28);
        for (let i = 0; i < n && off + 32 + i * 16 + 16 <= off + size; i++) kids.push(hex(u8.subarray(off + 32 + i * 16, off + 48 + i * 16)));
      }
      out.push({ systemId: normalizeUuid(sys), system: systemFromUuid(sys), version, kids });
    }
    off += size;
  }
  return out;
}

export function base64ToBytes(b64) {
  try {
    const bin = atob(String(b64 || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/'));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  } catch { return new Uint8Array(0); }
}

function hex(u8) { return [...u8].map((b) => b.toString(16).padStart(2, '0')).join(''); }

// Merge partial DRM facts (from manifests, PSSH, EME) into one record.
export function mergeDrm(...parts) {
  const out = { systems: [], keySystems: [], schemes: [], protocols: [], licenseUrls: [], kids: [], robustness: [], sources: [], persistentLicense: null, sessionTypes: [], requested: [], formats: [], codecs: [] };
  for (const p of parts) {
    if (!p) continue;
    for (const k of ['systems', 'keySystems', 'schemes', 'protocols', 'licenseUrls', 'kids', 'robustness', 'sources', 'sessionTypes', 'requested', 'formats', 'codecs']) {
      for (const v of p[k] || []) if (v && !out[k].includes(v)) out[k].push(v);
    }
    if (typeof p.persistentLicense === 'boolean') out.persistentLicense = out.persistentLicense || p.persistentLicense;
  }
  out.systems = out.systems.slice(0, 8);
  out.licenseUrls = out.licenseUrls.slice(0, 4);
  out.kids = out.kids.slice(0, 6);
  return out;
}

export function isDrmEmpty(d) { return !d || (!d.systems?.length && !d.keySystems?.length && !d.schemes?.length); }

// Official offline downloads offered by the provider itself (in its own apps or site).
const PROVIDERS = [
  [/(^|\.)netflix\.com$/, 'Netflix', 'Download titles in the Netflix app for Windows, iOS or Android (Download button on the title page).', 'https://help.netflix.com/en/node/54816'],
  [/(^|\.)(primevideo\.com|amazon\.[a-z.]+)$/, 'Prime Video', 'Download titles in the Prime Video app for Windows, Mac, iOS, Android or Fire devices.', 'https://www.primevideo.com/help'],
  [/(^|\.)disneyplus\.com$/, 'Disney+', 'Download titles in the Disney+ mobile or tablet app.', 'https://help.disneyplus.com/'],
  [/(^|\.)(max\.com|hbomax\.com)$/, 'Max', 'Download titles in the Max mobile app (ad-free plans).', 'https://help.max.com/'],
  [/(^|\.)hulu\.com$/, 'Hulu', 'Download titles in the Hulu mobile app (ad-free plans).', 'https://help.hulu.com/'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube', 'With YouTube Premium, use the Download button under the video (YouTube app, and youtube.com where offered). Downloads play only inside YouTube.', 'https://support.google.com/youtube/answer/11977233'],
  [/(^|\.)tv\.apple\.com$/, 'Apple TV', 'Download titles in the Apple TV app.', 'https://support.apple.com/guide/tvapp/'],
  [/(^|\.)(hotstar\.com|jiohotstar\.com|jiocinema\.com)$/, 'JioHotstar', 'Download titles in the JioHotstar mobile app.', 'https://www.hotstar.com/in/help'],
  [/(^|\.)sonyliv\.com$/, 'SonyLIV', 'Download titles in the SonyLIV mobile app.', 'https://www.sonyliv.com/'],
  [/(^|\.)zee5\.com$/, 'ZEE5', 'Download titles in the ZEE5 mobile app.', 'https://www.zee5.com/'],
  [/(^|\.)paramountplus\.com$/, 'Paramount+', 'Download titles in the Paramount+ mobile app.', 'https://help.paramountplus.com/'],
  [/(^|\.)peacocktv\.com$/, 'Peacock', 'Download titles in the Peacock mobile app (Premium Plus).', 'https://www.peacocktv.com/help'],
  [/(^|\.)crunchyroll\.com$/, 'Crunchyroll', 'Download episodes in the Crunchyroll mobile app (premium plans).', 'https://help.crunchyroll.com/'],
  [/(^|\.)(udemy\.com)$/, 'Udemy', 'Download lectures in the Udemy mobile app (where the instructor allows it).', 'https://support.udemy.com/'],
  [/(^|\.)(coursera\.org)$/, 'Coursera', 'Download lectures in the Coursera mobile app, or use the lecture\'s Download button where offered.', 'https://www.coursera.support/'],
  [/(^|\.)spotify\.com$/, 'Spotify', 'Download in the Spotify app (Premium).', 'https://support.spotify.com/']
];

export function providerOffline(pageUrl) {
  let host = '';
  try { host = new URL(pageUrl).hostname.toLowerCase(); } catch { return null; }
  const p = PROVIDERS.find(([re]) => re.test(host));
  return p ? { name: p[1], how: p[2], url: p[3] } : null;
}

// Plain-language reason why VidPull can't save this video.
export function drmReason(d) {
  const sys = d?.systems?.length ? d.systems.join(' + ') : 'DRM';
  const scheme = d?.schemes?.length ? ` (${d.schemes.join(', ')})` : '';
  if (d?.systems?.length === 1 && d.systems[0] === 'FairPlay') {
    return `Protected with FairPlay${scheme}. The keys are released only to Safari's built-in decryption module for playback, so the stream can't be saved as a file.`;
  }
  return `Protected with ${sys}${scheme}. The decryption keys are released only to the browser's content decryption module (CDM) for playback and never reach the page or extensions, so the encrypted stream can't be turned into a playable file. VidPull does not extract keys or bypass protection.`;
}

// The status list shown in the details view (drives the chips too).
export function drmStatuses(d, { pageUrl = '' } = {}) {
  const provider = providerOffline(pageUrl);
  const st = [{ id: 'detected', label: 'DRM detected', ok: true }];
  st.push({ id: 'protected', label: 'DRM protected', ok: true });
  if (d?.systems?.length) st.push({ id: 'type', label: `DRM type identified: ${d.systems.join(', ')}`, ok: true });
  if (provider) st.push({ id: 'authorized', label: `Authorized download available in ${provider.name}`, ok: true, detail: provider.how, url: provider.url });
  if (d?.persistentLicense === true) st.push({ id: 'offline', label: 'Offline playback supported by this browser\'s CDM (for the site\'s own player)', ok: true });
  else if (d?.persistentLicense === false) st.push({ id: 'offline', label: 'Offline licences not supported by this browser\'s CDM', ok: false });
  st.push({ id: 'unavailable', label: 'Download unavailable in VidPull', ok: false, detail: drmReason(d) });
  return st;
}
