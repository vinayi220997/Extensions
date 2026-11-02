// User settings live in chrome.storage.sync (small, synced between devices).
// Larger per-site data (site actions, smart naming rules) lives in storage.local, see siteRules below.

export const DEFAULT_SETTINGS = Object.freeze({
  // Format & quality
  preferredFormat: 'mp4',        // 'mp4' | 'webm' | 'any'
  hlsOutput: 'mp4',              // 'mp4' (convert MPEG-TS → MP4) | 'ts' (keep original segments)
  defaultResolution: '1080',     // 'highest' | '2160' | '1440' | '1080' | '720' | '480' | '360' | 'lowest'
  mergeAudio: true,              // merge separate audio/video tracks (DASH, HLS alt audio) into one MP4
  // Saving
  filenameTemplate: '{title} [{res}]',
  subfolder: 'VidPull',
  saveAs: false,
  maxConcurrentSegments: 4,
  // Detection
  minFileSizeKB: 300,
  detectDomMedia: true,
  detectPlayers: true,           // read sources from page players (JW Player, Video.js, …)
  detectLinks: true,             // <a href="…mp4"> and data-* attributes
  // Notifications & menus
  notifications: true,
  contextMenu: true,
  showBadge: true,
  // History
  historyEnabled: true,
  historyDays: 30,
  // Appearance
  theme: 'system',               // 'system' | 'light' | 'dark'
  accent: 'orange',              // palette name or 'custom' (orange = VidPull brand)
  accentCustom: '#ea580c',
  windowSize: 'M',               // 'S' | 'M' | 'L'
  textSize: 'M',                 // 'S' | 'M' | 'L'
  previewMode: 'image',          // 'none' | 'image' | 'video'
  viewMode: 'list',              // 'list' | 'grid'
  sortBy: 'added-asc',           // see SORT_OPTIONS
  // Default action of the main button on every site (site rules can override it)
  defaultAction: 'download',     // 'download' | 'audio' | 'copy'
  // Panels
  defaultPanel: 'popup',         // 'popup' | 'sidebar' (Chrome side panel) | 'docked' (VidPull page sidebar)
  settingsOpenIn: 'tab',         // 'tab' | 'panel'
  // Sidebar display (independent from pinning the extension icon in Chrome's toolbar)
  sidebarMode: 'max',            // 'max' | 'mini' | 'autohide'
  lastPinnedMode: 'max',         // Max or Mini, restored when the sidebar is pinned again
  dockOpen: false,               // VidPull page sidebar shown on pages
  sidebarMaxWidth: 380,          // px, Max width of the page sidebar (user-resizable)
  sidebarMiniPct: 7,             // % of the window width for Mini (5–10)
  autoHideTrigger: 'hover',      // 'hover' | 'click'
  dockLayout: 'push'             // 'push' (page shrinks) | 'overlay'
});

export const SORT_OPTIONS = [
  ['added-asc', 'Date added (oldest first)'], ['added-desc', 'Date added (newest first)'],
  ['name-asc', 'Name (A–Z)'], ['name-desc', 'Name (Z–A)'],
  ['duration-asc', 'Duration (shortest)'], ['duration-desc', 'Duration (longest)'],
  ['size-asc', 'File size (smallest)'], ['size-desc', 'File size (largest)'],
  ['quality-desc', 'Quality (highest)'], ['quality-asc', 'Quality (lowest)'],
  ['site-asc', 'Website / source'], ['status', 'Download status']
];

const ENUMS = {
  preferredFormat: ['mp4', 'webm', 'any'],
  hlsOutput: ['mp4', 'ts'],
  defaultResolution: ['highest', '2160', '1440', '1080', '720', '480', '360', 'lowest'],
  theme: ['system', 'light', 'dark'],
  accent: ['orange', 'teal', 'blue', 'violet', 'rose', 'green', 'slate', 'custom'],
  windowSize: ['S', 'M', 'L'],
  textSize: ['S', 'M', 'L'],
  previewMode: ['none', 'image', 'video'],
  viewMode: ['list', 'grid'],
  defaultPanel: ['popup', 'sidebar', 'docked'],
  settingsOpenIn: ['tab', 'panel'],
  sortBy: ['added-asc', 'added-desc', 'name-asc', 'name-desc', 'duration-asc', 'duration-desc', 'size-asc', 'size-desc', 'quality-desc', 'quality-asc', 'site-asc', 'status'],
  defaultAction: ['download', 'audio', 'copy'],
  sidebarMode: ['max', 'mini', 'autohide'],
  lastPinnedMode: ['max', 'mini'],
  autoHideTrigger: ['hover', 'click'],
  dockLayout: ['push', 'overlay']
};

export const RESOLUTION_OPTIONS = ENUMS.defaultResolution;

export async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return validate({ ...DEFAULT_SETTINGS, ...(settings || {}) });
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

export function validate(s) {
  if (s && s.sidebarMode === 'unpinned') s = { ...s, sidebarMode: 'autohide', dockOpen: true }; // 2.1 → 2.2
  if (s && s.subfolder === 'VidSnag') s = { ...s, subfolder: 'VidPull' };                      // rebrand (3.0)
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const def = DEFAULT_SETTINGS[key];
    const v = s ? s[key] : undefined;
    if (typeof def === 'boolean') out[key] = typeof v === 'boolean' ? v : def;
    else if (typeof def === 'number') {
      const n = Number(v);
      out[key] = v !== '' && v != null && Number.isFinite(n) && n >= 0 ? n : def;
    } else out[key] = typeof v === 'string' ? v : def;
    if (ENUMS[key] && !ENUMS[key].includes(out[key])) out[key] = def;
  }
  out.maxConcurrentSegments = Math.min(16, Math.max(1, Math.round(out.maxConcurrentSegments)));
  out.historyDays = Math.min(3650, Math.round(out.historyDays));
  out.minFileSizeKB = Math.min(1024 * 1024, Math.round(out.minFileSizeKB));
  out.sidebarMaxWidth = Math.min(1200, Math.max(280, Math.round(out.sidebarMaxWidth)));
  out.sidebarMiniPct = Math.min(10, Math.max(5, Math.round(out.sidebarMiniPct * 10) / 10));
  if (!out.filenameTemplate.trim()) out.filenameTemplate = DEFAULT_SETTINGS.filenameTemplate;
  if (!/^#[0-9a-f]{6}$/i.test(out.accentCustom)) out.accentCustom = DEFAULT_SETTINGS.accentCustom;
  return out;
}

// ---------------------------------------------------------------------------
// Site rules (storage.local): per-site default action + smart naming rules.
//   actions: { 'example.com': 'audio' | 'copy' }
//   naming:  { 'example.com': { template: '{selector} [{res}]', selector: 'h1.title' } }
// ---------------------------------------------------------------------------
export const SITE_ACTIONS = ['download', 'audio', 'copy'];

export async function getSiteRules() {
  const { siteRules } = await chrome.storage.local.get('siteRules');
  return normalizeSiteRules(siteRules);
}

export function normalizeSiteRules(r) {
  const out = { actions: {}, naming: {} };
  if (r && typeof r === 'object') {
    for (const [host, a] of Object.entries(r.actions || {})) {
      if (typeof host === 'string' && host && ['audio', 'copy'].includes(a)) out.actions[host.toLowerCase()] = a;
    }
    for (const [host, n] of Object.entries(r.naming || {})) {
      if (typeof host !== 'string' || !host || !n || typeof n !== 'object') continue;
      const template = typeof n.template === 'string' ? n.template.slice(0, 200) : '';
      const selector = typeof n.selector === 'string' ? n.selector.slice(0, 300) : '';
      if (template || selector) out.naming[host.toLowerCase()] = { template, selector };
    }
  }
  return out;
}

export async function saveSiteRules(rules) {
  const clean = normalizeSiteRules(rules);
  await chrome.storage.local.set({ siteRules: clean });
  return clean;
}

// Effective main-button action: a per-site rule wins, otherwise the global default.
export function siteActionFor(rules, host, settings) {
  return (rules && rules.actions && rules.actions[(host || '').toLowerCase()]) || (settings && settings.defaultAction) || 'download';
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
    return atOrBelow.filter((v) => shortSide(v) === best).pop();
  }
  return byQuality.find((v) => v.height) || byQuality[0];
}

// Best audio-only variant (highest bitrate), if the media has one.
export function pickAudioVariant(variants) {
  const audio = (variants || []).filter((v) => v.audioOnly);
  if (!audio.length) return null;
  return [...audio].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || (b.bandwidth || 0) - (a.bandwidth || 0))[0];
}

function shortSide(v) { return Math.min(v.height || 0, v.width || v.height || 0); }

export function formatOf(v) {
  const ext = (v.ext || '').toLowerCase();
  const codecs = (v.codecs || '').toLowerCase();
  if (ext === 'webm' || /vp0?[89]|opus|vorbis/.test(codecs)) return 'webm';
  return 'mp4';
}
