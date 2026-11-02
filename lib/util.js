// Shared helpers used by the service worker, offscreen document and popup.

export const VIDEO_EXTS = ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'flv', 'ogv', '3gp', 'avi', 'wmv'];
export const AUDIO_EXTS = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'weba'];
// Pieces of a stream: never shown as standalone media.
export const SEGMENT_EXTS = ['ts', 'm4s', 'm2ts', 'cmfv', 'cmfa', 'aac_seg', 'vtt', 'key'];

const MIME_TO_EXT = {
  'video/mp4': 'mp4', 'video/x-m4v': 'm4v', 'video/webm': 'webm', 'video/x-matroska': 'mkv',
  'video/quicktime': 'mov', 'video/x-flv': 'flv', 'video/ogg': 'ogv', 'video/3gpp': '3gp',
  'video/x-msvideo': 'avi', 'video/x-ms-wmv': 'wmv',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
  'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/flac': 'flac', 'audio/webm': 'weba'
};

export function extFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const m = /\.([a-z0-9_]{2,6})$/i.exec(path);
    return m ? m[1].toLowerCase() : '';
  } catch { return ''; }
}

export function extFromMime(mime) {
  if (!mime) return '';
  return MIME_TO_EXT[mime.split(';')[0].trim().toLowerCase()] || '';
}

export function isAudioExt(ext) { return AUDIO_EXTS.includes(ext); }

// Classify a URL + Content-Type into hls / dash / file / segment / null.
export function classify(url, contentType = '') {
  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  const ext = extFromUrl(url);
  if (ct.includes('mpegurl') || ext === 'm3u8') return { kind: 'hls', ext: 'm3u8' };
  if (ct === 'application/dash+xml' || ext === 'mpd') return { kind: 'dash', ext: 'mpd' };
  if (ct === 'video/mp2t' || ct === 'video/iso.segment' || SEGMENT_EXTS.includes(ext)) return { kind: 'segment' };
  const mimeExt = extFromMime(ct);
  if (mimeExt) return { kind: 'file', ext: mimeExt, audio: isAudioExt(mimeExt) };
  if (VIDEO_EXTS.includes(ext) || AUDIO_EXTS.includes(ext)) {
    // octet-stream / missing type but a media extension
    if (!ct || ct === 'application/octet-stream' || ct === 'binary/octet-stream' || ct.startsWith('video/') || ct.startsWith('audio/')) {
      return { kind: 'file', ext, audio: isAudioExt(ext) };
    }
  }
  if (ct.startsWith('video/') || ct.startsWith('audio/')) {
    return { kind: 'file', ext: ext || (ct.startsWith('audio/') ? 'mp3' : 'mp4'), audio: ct.startsWith('audio/') };
  }
  return null;
}

// Strip byte-range style query params so the same file requested in chunks dedupes.
export function normalizeMediaUrl(url) {
  try {
    const u = new URL(url);
    for (const k of ['range', 'bytestart', 'byteend', 'rn', 'rbuf', '_', 'cb']) u.searchParams.delete(k);
    u.hash = '';
    return u.toString();
  } catch { return url; }
}

// Small, stable, synchronous string hash (FNV-1a 32 bit) → base36 id.
export function hashId(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function resolveUrl(rel, base) {
  try { return new URL(rel, base).toString(); } catch { return rel; }
}

export function formatBytes(n) {
  if (n == null || isNaN(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(sec) {
  if (!sec || !isFinite(sec)) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function resolutionLabel(height, width) {
  if (!height) return '';
  const h = Math.min(height, width || height); // portrait videos: use the short side
  if (h >= 2160) return '4K';
  if (h >= 1440) return '1440p';
  return `${h}p`;
}

// Make a string safe for use as a file name on Windows/macOS/Linux.
export function sanitizeFilename(name, maxLen = 120) {
  let s = String(name || '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`;
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s || 'video';
}

export function sanitizeFolder(folder) {
  return String(folder || '')
    .split(/[\\/]+/)
    .map((p) => sanitizeFilename(p, 60))
    .filter((p) => p && p !== 'video' && p !== '..')
    .join('/');
}

export function buildFilename(template, ctx) {
  const d = new Date(ctx.date || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const tokens = {
    title: ctx.title || 'video',
    host: ctx.host || '',
    res: ctx.res || '',
    quality: ctx.res || '',
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
    id: ctx.id || '',
    selector: ctx.selector || ctx.title || ''
  };
  let base = String(template || '{title}').replace(/\{(\w+)\}/g, (m, k) => (k in tokens ? tokens[k] : m));
  base = base.replace(/\s*[-_ ]\s*$/g, '').replace(/\(\s*\)|\[\s*\]/g, '');
  return sanitizeFilename(base);
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
