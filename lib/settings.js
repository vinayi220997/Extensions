// User settings: stored in chrome.storage.sync so they follow the user's profile.

export const DEFAULT_SETTINGS = Object.freeze({
  preferredFormat: 'mp4',        // 'mp4' | 'webm' | 'any'  – which container to prefer when several exist
  hlsOutput: 'mp4',              // 'mp4' (convert MPEG-TS → MP4) | 'ts' (keep original segments)
  defaultResolution: '1080',     // 'highest' | '2160' | '1440' | '1080' | '720' | '480' | '360' | 'lowest'
  minFileSizeKB: 300,            // ignore direct media files smaller than this (ads, previews, sounds)
  filenameTemplate: '{title} [{res}]',
  subfolder: 'VidSnag',
  saveAs: false,                 // show the "Save as" dialog for every download
  maxConcurrentSegments: 4,      // parallel segment fetches for HLS/DASH
  detectDomMedia: true,          // scan <video>/<audio> tags on pages
  historyEnabled: true,
  historyDays: 30,               // 0 = keep forever
  notifications: true,
  contextMenu: true,
  showBadge: true
});

export const RESOLUTION_OPTIONS = ['highest', '2160', '1440', '1080', '720', '480', '360', 'lowest'];

export async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = validate({ ...current, ...patch });
  await chrome.storage.sync.set({ settings: next });
  return next;
}

export async function resetSettings() {
  await chrome.storage.sync.set({ settings: { ...DEFAULT_SETTINGS } });
  return { ...DEFAULT_SETTINGS };
}

function validate(s) {
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const def = DEFAULT_SETTINGS[key];
    const v = s[key];
    if (typeof def === 'boolean') out[key] = typeof v === 'boolean' ? v : def;
    else if (typeof def === 'number') {
      const n = Number(v);
      out[key] = Number.isFinite(n) && n >= 0 ? n : def;
    } else out[key] = typeof v === 'string' ? v : def;
  }
  if (!['mp4', 'webm', 'any'].includes(out.preferredFormat)) out.preferredFormat = 'mp4';
  if (!['mp4', 'ts'].includes(out.hlsOutput)) out.hlsOutput = 'mp4';
  if (!RESOLUTION_OPTIONS.includes(out.defaultResolution)) out.defaultResolution = '1080';
  out.maxConcurrentSegments = Math.min(16, Math.max(1, Math.round(out.maxConcurrentSegments)));
  out.historyDays = Math.min(3650, Math.round(out.historyDays));
  out.minFileSizeKB = Math.min(1024 * 1024, Math.round(out.minFileSizeKB));
  if (!out.filenameTemplate.trim()) out.filenameTemplate = DEFAULT_SETTINGS.filenameTemplate;
  return out;
}

// Pick the variant that best matches the user's resolution + format preferences.
export function pickVariant(variants, settings) {
  if (!variants || !variants.length) return null;
  const video = variants.filter((v) => !v.audioOnly);
  let pool = video.length ? video : variants;

  if (settings.preferredFormat !== 'any') {
    const fmt = pool.filter((v) => formatOf(v) === settings.preferredFormat);
    if (fmt.length) pool = fmt;
  }
  const byQuality = [...pool].sort((a, b) => (a.height || 0) - (b.height || 0) || (a.bandwidth || 0) - (b.bandwidth || 0));
  const pref = settings.defaultResolution;
  if (pref === 'lowest') return byQuality[0];
  if (pref === 'highest' || byQuality.every((v) => !v.height)) return byQuality[byQuality.length - 1];
  const target = Number(pref);
  const atOrBelow = byQuality.filter((v) => v.height && shortSide(v) <= target);
  if (atOrBelow.length) {
    const best = shortSide(atOrBelow[atOrBelow.length - 1]);
    // highest bitrate among the best matching resolution
    return atOrBelow.filter((v) => shortSide(v) === best).pop();
  }
  return byQuality.find((v) => v.height) || byQuality[0];
}

function shortSide(v) { return Math.min(v.height || 0, v.width || v.height || 0); }

export function formatOf(v) {
  const ext = (v.ext || '').toLowerCase();
  const codecs = (v.codecs || '').toLowerCase();
  if (ext === 'webm' || /vp0?[89]|opus|vorbis/.test(codecs)) return 'webm';
  return 'mp4';
}
