// Addons: user-installed detection extensions.
//  • Rule addons (JSON, no code): extra URL patterns to treat as media, and CSS selectors
//    whose attribute/text holds a media URL. Work everywhere, no special permission.
//  • Script addons (JavaScript): run on matching pages through chrome.userScripts and call
//    VidSnag.report([...]). Chrome requires the user to enable "Allow User Scripts" for that.
//
// Rule addon format:
// {
//   "type": "vidsnag-addon", "name": "My site", "version": "1.0", "description": "…",
//   "matches": ["*://*.example.com/*"],
//   "detect": {
//     "networkUrlPatterns": ["/api/stream/\\d+/play"],          // regex strings
//     "selectors": [{ "selector": "div.player", "attribute": "data-src", "kind": "file" }],
//     "titleSelector": "h1.title"
//   }
// }
//
// Script addon format (.js) with an optional header:
// // ==VidSnagScript==
// // @name   My site
// // @match  *://*.example.com/*
// // @version 1.0
// // ==/VidSnagScript==
// VidSnag.report([{ url: '…/video.mp4', title: '…' }]);

const MAX_CODE = 200_000;

export function makeId(prefix = 'a') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// Chrome match pattern → RegExp. Supports <all_urls>, scheme *, host wildcards and path globs.
export function matchPatternToRegExp(pattern) {
  if (pattern === '<all_urls>') return /^(https?|file|ftp):\/\//;
  const m = /^(\*|https?|file|ftp):\/\/(\*|\*\.[^/*]+|[^/*]+)?(\/.*)$/.exec(pattern);
  if (!m) throw new Error(`Invalid match pattern: ${pattern}`);
  const [, scheme, host = '', path] = m;
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const schemeRe = scheme === '*' ? 'https?' : esc(scheme);
  let hostRe = '';
  if (host === '*') hostRe = '[^/]*';
  else if (host.startsWith('*.')) hostRe = `(?:[^/]*\\.)?${esc(host.slice(2))}`;
  else hostRe = esc(host);
  const pathRe = path.split('*').map(esc).join('.*');
  return new RegExp(`^${schemeRe}://${hostRe}(?::\\d+)?${pathRe}$`);
}

export function urlMatches(patterns, url) {
  return (patterns || []).some((p) => { try { return matchPatternToRegExp(p).test(url); } catch { return false; } });
}

function cleanMatches(list) {
  const out = [];
  for (const p of Array.isArray(list) ? list : [list]) {
    if (typeof p !== 'string' || !p.trim()) continue;
    matchPatternToRegExp(p.trim()); // throws on invalid
    out.push(p.trim());
  }
  return out.length ? out.slice(0, 50) : ['<all_urls>'];
}

export function parseScriptHeader(code) {
  const meta = { name: '', version: '', description: '', matches: [] };
  const block = /\/\/\s*==VidSnagScript==([\s\S]*?)\/\/\s*==\/VidSnagScript==/.exec(code);
  if (!block) return meta;
  for (const line of block[1].split('\n')) {
    const m = /^\s*\/\/\s*@(\w+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'match' || key === 'include') meta.matches.push(value);
    else if (key in meta) meta[key] = value;
  }
  return meta;
}

// Parse an uploaded file into an addon object. Throws with a readable message.
export function parseAddonFile(text, filename = '') {
  if (typeof text !== 'string' || !text.trim()) throw new Error('The file is empty');
  const trimmed = text.trim();
  if (/\.json$/i.test(filename) || trimmed.startsWith('{')) {
    let data;
    try { data = JSON.parse(trimmed); } catch (e) { throw new Error(`Not valid JSON: ${e.message}`); }
    return normalizeAddon({ ...data, kind: 'rules' });
  }
  if (text.length > MAX_CODE) throw new Error('Script is too large (max 200 KB)');
  const meta = parseScriptHeader(text);
  return normalizeAddon({
    kind: 'script',
    name: meta.name || filename.replace(/\.js$/i, '') || 'Custom script',
    version: meta.version || '1.0',
    description: meta.description || '',
    matches: meta.matches.length ? meta.matches : ['<all_urls>'],
    code: text
  });
}

export function normalizeAddon(a) {
  if (!a || typeof a !== 'object') throw new Error('Invalid addon');
  const kind = a.kind === 'script' || typeof a.code === 'string' ? 'script' : 'rules';
  const base = {
    id: typeof a.id === 'string' && /^[\w-]{1,40}$/.test(a.id) ? a.id : makeId(),
    kind,
    name: String(a.name || 'Untitled addon').slice(0, 80),
    version: String(a.version || '1.0').slice(0, 20),
    description: String(a.description || '').slice(0, 300),
    matches: cleanMatches(a.matches),
    enabled: a.enabled !== false,
    installedAt: Number(a.installedAt) || Date.now()
  };
  if (kind === 'script') {
    if (typeof a.code !== 'string' || !a.code.trim()) throw new Error('Script addon has no code');
    if (a.code.length > MAX_CODE) throw new Error('Script is too large (max 200 KB)');
    return { ...base, code: a.code };
  }
  if (a.type && a.type !== 'vidsnag-addon') throw new Error('Not a VidSnag addon (expected "type": "vidsnag-addon")');
  const d = a.detect || {};
  const networkUrlPatterns = (Array.isArray(d.networkUrlPatterns) ? d.networkUrlPatterns : []).filter((x) => typeof x === 'string').slice(0, 30);
  for (const re of networkUrlPatterns) {
    try { new RegExp(re); } catch (e) { throw new Error(`Invalid regex "${re}": ${e.message}`); }
  }
  const selectors = (Array.isArray(d.selectors) ? d.selectors : [])
    .filter((x) => x && typeof x.selector === 'string')
    .slice(0, 30)
    .map((x) => ({
      selector: x.selector.slice(0, 300),
      attribute: typeof x.attribute === 'string' ? x.attribute.slice(0, 60) : '',
      kind: ['file', 'hls', 'dash'].includes(x.kind) ? x.kind : ''
    }));
  if (!networkUrlPatterns.length && !selectors.length && !d.titleSelector) {
    throw new Error('Addon has no detection rules (detect.networkUrlPatterns, detect.selectors or detect.titleSelector)');
  }
  return {
    ...base,
    detect: { networkUrlPatterns, selectors, titleSelector: typeof d.titleSelector === 'string' ? d.titleSelector.slice(0, 300) : '' }
  };
}

export async function getAddons() {
  const { addons } = await chrome.storage.local.get('addons');
  return Array.isArray(addons) ? addons : [];
}

export async function saveAddons(list) {
  await chrome.storage.local.set({ addons: list.map(normalizeAddon) });
}

// Code injected before every script addon (runs in the USER_SCRIPT world).
export const SCRIPT_PRELUDE = `
(() => {
  if (globalThis.VidSnag) return;
  const listeners = [];
  const send = (items) => {
    const list = (Array.isArray(items) ? items : [items]).filter((x) => x && typeof x.url === 'string').slice(0, 50)
      .map((x) => ({ url: String(new URL(x.url, location.href)), title: x.title ? String(x.title) : '',
        mime: x.mime ? String(x.mime) : '', kind: x.kind ? String(x.kind) : '',
        width: +x.width || 0, height: +x.height || 0, duration: +x.duration || 0,
        poster: x.poster ? String(new URL(x.poster, location.href)) : '' }));
    if (list.length) chrome.runtime.sendMessage({ type: 'script-media', items: list, page: location.href });
  };
  globalThis.VidSnag = Object.freeze({
    report: send,
    onRescan: (fn) => { if (typeof fn === 'function') listeners.push(fn); },
    _rescan: () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.warn('[VidSnag addon]', e); } })
  });
  document.addEventListener('vidsnag:rescan', () => globalThis.VidSnag._rescan());
})();
`;

export const SAMPLE_RULE_ADDON = {
  type: 'vidsnag-addon',
  name: 'Example: data-video attributes',
  version: '1.0',
  description: 'Finds media URLs stored in data-video / data-stream attributes on example.com.',
  matches: ['*://*.example.com/*'],
  detect: {
    networkUrlPatterns: ['/api/media/\\d+/stream$'],
    selectors: [
      { selector: '[data-video]', attribute: 'data-video' },
      { selector: '[data-stream]', attribute: 'data-stream', kind: 'hls' }
    ],
    titleSelector: 'h1'
  }
};

export const SAMPLE_SCRIPT_ADDON = `// ==VidSnagScript==
// @name    Example: player config
// @match   *://*.example.com/*
// @version 1.0
// ==/VidSnagScript==
// Runs on matching pages. Find media URLs however the site exposes them, then report them.
const find = () => {
  const urls = [...document.querySelectorAll('[data-config]')]
    .map((el) => { try { return JSON.parse(el.dataset.config).src; } catch { return null; } })
    .filter(Boolean);
  VidSnag.report(urls.map((url) => ({ url, title: document.title })));
};
find();
VidSnag.onRescan(find);
`;
