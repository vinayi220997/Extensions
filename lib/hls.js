// Minimal HLS (m3u8) parser: master playlists → variants, media playlists → segments.
import { systemFromHlsKey, hlsScheme, parsePssh, base64ToBytes } from './drm.js';
import { resolveUrl, resolutionLabel } from './util.js';

function parseAttrs(str) {
  const attrs = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(str))) attrs[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1) : m[2];
  return attrs;
}

function parseByteRange(spec, lastEnd) {
  const [len, off] = spec.split('@');
  const length = parseInt(len, 10);
  const offset = off !== undefined ? parseInt(off, 10) : lastEnd;
  return { offset, length };
}

export function isPlaylist(text) {
  return typeof text === 'string' && text.trimStart().startsWith('#EXTM3U');
}

export function parseM3U8(text, baseUrl) {
  if (!isPlaylist(text)) throw new Error('Not an HLS playlist');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'))) return parseMaster(lines, baseUrl);
  return parseMedia(lines, baseUrl);
}

function parseMaster(lines, baseUrl) {
  const variants = [];
  const audios = [];
  const sessionKeys = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-SESSION-KEY:')) {
      const a = parseAttrs(line.slice(19));
      sessionKeys.push({ method: (a.METHOD || '').toUpperCase(), keyFormat: a.KEYFORMAT || 'identity', uri: a.URI || '', keyId: a.KEYID || '' });
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const a = parseAttrs(line.slice(18));
      let j = i + 1;
      while (j < lines.length && lines[j].startsWith('#')) j++;
      if (j >= lines.length) break;
      const [w, h] = (a.RESOLUTION || '').split('x').map(Number);
      variants.push({
        url: resolveUrl(lines[j], baseUrl),
        bandwidth: Number(a['AVERAGE-BANDWIDTH'] || a.BANDWIDTH) || 0,
        width: w || 0,
        height: h || 0,
        codecs: a.CODECS || '',
        frameRate: Number(a['FRAME-RATE']) || 0,
        audioGroup: a.AUDIO || ''
      });
      i = j;
    } else if (line.startsWith('#EXT-X-MEDIA:')) {
      const a = parseAttrs(line.slice(13));
      if (a.TYPE === 'AUDIO' && a.URI) {
        audios.push({
          url: resolveUrl(a.URI, baseUrl),
          groupId: a['GROUP-ID'] || '',
          name: a.NAME || a.LANGUAGE || 'Audio',
          language: a.LANGUAGE || '',
          isDefault: a.DEFAULT === 'YES'
        });
      }
    }
  }
  // Drop duplicate variant URLs (some masters repeat entries for redundancy)
  const seen = new Set();
  const unique = variants.filter((v) => (seen.has(v.url) ? false : seen.add(v.url)));
  return { type: 'master', variants: unique, audios, keys: sessionKeys };
}

function parseMedia(lines, baseUrl) {
  const segments = [];
  let mediaSequence = 0;
  let targetDuration = 0;
  let endList = false;
  let playlistType = '';
  let key = null;
  let map = null;
  let duration = 0;
  let byterange = null;
  let lastEnd = 0;
  let mapLastEnd = 0;
  let drm = false;
  let encrypted = false;
  const keys = [];

  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) mediaSequence = parseInt(line.slice(22), 10) || 0;
    else if (line.startsWith('#EXT-X-TARGETDURATION:')) targetDuration = Number(line.slice(22)) || 0;
    else if (line.startsWith('#EXT-X-PLAYLIST-TYPE:')) playlistType = line.slice(21);
    else if (line === '#EXT-X-ENDLIST') endList = true;
    else if (line.startsWith('#EXTINF:')) duration = parseFloat(line.slice(8)) || 0;
    else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      byterange = parseByteRange(line.slice(17), lastEnd);
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const a = parseAttrs(line.slice(11));
      const method = (a.METHOD || 'NONE').toUpperCase();
      const keyFormat = (a.KEYFORMAT || 'identity').toLowerCase();
      if (method !== 'NONE' && keys.length < 12) keys.push({ method, keyFormat, uri: a.URI || '', keyId: a.KEYID || '' });
      if (method === 'NONE') key = null;
      else if (method === 'AES-128' && keyFormat === 'identity') {
        key = { method, uri: resolveUrl(a.URI, baseUrl), iv: a.IV || null };
        encrypted = true;
      } else { drm = true; key = { method, uri: a.URI ? resolveUrl(a.URI, baseUrl) : '', iv: a.IV || null }; }
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const a = parseAttrs(line.slice(11));
      let br = null;
      if (a.BYTERANGE) { br = parseByteRange(a.BYTERANGE, mapLastEnd); mapLastEnd = br.offset + br.length; }
      map = { url: resolveUrl(a.URI, baseUrl), byterange: br };
    } else if (!line.startsWith('#')) {
      const url = resolveUrl(line, baseUrl);
      const seg = { url, duration, sequence: mediaSequence + segments.length, key, map, byterange };
      if (byterange) lastEnd = byterange.offset + byterange.length;
      segments.push(seg);
      duration = 0;
      byterange = null;
    }
  }
  const totalDuration = segments.reduce((s, x) => s + x.duration, 0);
  return {
    type: 'media',
    segments,
    mediaSequence,
    targetDuration,
    endList,
    live: !endList && playlistType !== 'VOD',
    totalDuration,
    encrypted,
    drm,
    keys,
    fmp4: segments.some((s) => s.map)
  };
}

export function hlsVariantLabel(v) {
  const parts = [];
  const res = resolutionLabel(v.height, v.width);
  if (res) parts.push(res);
  if (v.bandwidth) parts.push(`${(v.bandwidth / 1e6).toFixed(v.bandwidth >= 1e7 ? 0 : 1)} Mbps`);
  return parts.join(' · ') || 'Default';
}

// IV for AES-128 when the playlist doesn't specify one: the media sequence number, big endian.
export function ivFromSequence(seq) {
  const iv = new Uint8Array(16);
  const view = new DataView(iv.buffer);
  view.setUint32(8, Math.floor(seq / 2 ** 32));
  view.setUint32(12, seq >>> 0);
  return iv;
}

export function ivFromHex(hex) {
  const h = hex.replace(/^0x/i, '').padStart(32, '0');
  const iv = new Uint8Array(16);
  for (let i = 0; i < 16; i++) iv[i] = parseInt(h.substr(i * 2, 2), 16);
  return iv;
}

// DRM summary for an HLS playlist's keys (EXT-X-KEY / EXT-X-SESSION-KEY).
export function hlsDrmInfo(keyList) {
  const info = { systems: [], keySystems: [], schemes: [], kids: [], licenseUrls: [], protocols: ['HLS'], sources: ['manifest'] };
  for (const k of keyList || []) {
    const sys = systemFromHlsKey(k);
    if (!sys) continue;
    info.systems.push(sys);
    info.schemes.push(hlsScheme(k.method));
    if (/^https?:/i.test(k.uri) && sys !== 'FairPlay') info.licenseUrls.push(k.uri.split('?')[0]);
    if (/^0x[0-9a-f]{32}$/i.test(k.keyId || '')) info.kids.push(k.keyId.slice(2).toLowerCase());
    const pssh = /^data:[^,]*;base64,(.+)$/i.exec(k.uri || '');
    if (pssh) for (const p of parsePssh(base64ToBytes(pssh[1]))) info.kids.push(...p.kids);
  }
  for (const key of Object.keys(info)) info[key] = [...new Set(info[key].filter(Boolean))];
  return info.systems.length ? info : null;
}
