// VidPull content script (isolated world). Runs a set of independent detectors over the page
// and reports media to the service worker. Detectors are plain functions in DETECTORS, so new
// technologies can be added without touching the rest.
(() => {
  if (window.__vidpullLoaded) return;
  window.__vidpullLoaded = true;

  const MEDIA_EXT = /\.(mp4|m4v|webm|mkv|mov|ogv|flv|3gp|avi|wmv|mp3|m4a|aac|ogg|oga|opus|wav|flac|weba|m3u8|mpd)(\?|#|$)/i;
  const DATA_ATTRS = ['data-src', 'data-video', 'data-video-src', 'data-video-url', 'data-url', 'data-mp4', 'data-webm',
    'data-hls', 'data-hls-url', 'data-dash', 'data-stream', 'data-stream-url', 'data-file', 'data-source', 'data-media', 'data-href'];

  let settings = { detectDomMedia: true, detectLinks: true, detectPlayers: true };
  let siteRules = { naming: {} };
  let addonRules = [];
  let lastSignature = '';
  let timer = null;
  const playerItems = new Map();   // url → item reported by the main-world player probe
  const blobInfo = new Map();      // blob URL → { ok, size, mime } | 'pending'

  const abs = (u) => { try { return new URL(u, document.baseURI).href; } catch { return ''; } };
  const isHttp = (u) => /^https?:/i.test(u);
  const host = location.hostname.replace(/^www\./, '').toLowerCase();

  // ----- helpers -----
  function* allRoots(root = document) {
    yield root;
    // Open shadow roots (web-component players). Bounded walk.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let n = 0;
    for (let el = walker.nextNode(); el && n < 20000; el = walker.nextNode(), n++) {
      if (el.shadowRoot) yield* allRoots(el.shadowRoot);
    }
  }
  function queryAll(selector) {
    const out = [];
    for (const r of allRoots()) {
      try { out.push(...r.querySelectorAll(selector)); } catch { return out; }
    }
    return out;
  }
  function matchPatternToRegExp(pattern) {
    if (pattern === '<all_urls>') return /^(https?|file|ftp):\/\//;
    const m = /^(\*|https?|file|ftp):\/\/(\*|\*\.[^/*]+|[^/*]+)?(\/.*)$/.exec(pattern);
    if (!m) return /^$/;
    const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const [, scheme, h = '', path] = m;
    const hostRe = h === '*' ? '[^/]*' : h.startsWith('*.') ? `(?:[^/]*\\.)?${esc(h.slice(2))}` : esc(h);
    return new RegExp(`^${scheme === '*' ? 'https?' : esc(scheme)}://${hostRe}(?::\\d+)?${path.split('*').map(esc).join('.*')}$`);
  }
  const matches = (patterns) => (patterns || []).some((p) => matchPatternToRegExp(p).test(location.href));
  function kindFromUrl(u) {
    if (/\.m3u8(\?|#|$)/i.test(u)) return 'hls';
    if (/\.mpd(\?|#|$)/i.test(u)) return 'dash';
    return '';
  }

  // ----- detectors: each returns an array of { url, ...meta } -----
  const DETECTORS = {
    // <video>/<audio>/<source>, including players inside open shadow roots
    html5() {
      if (!settings.detectDomMedia) return [];
      const out = [];
      for (const el of queryAll('video, audio')) {
        const tag = el.tagName.toLowerCase();
        const meta = {
          tag,
          width: el.videoWidth || 0,
          height: el.videoHeight || 0,
          duration: isFinite(el.duration) ? el.duration : 0,
          poster: el.poster && isHttp(abs(el.poster)) ? abs(el.poster) : ''
        };
        const srcs = new Set([el.currentSrc, el.getAttribute('src')].filter(Boolean));
        for (const s of srcs) out.push({ url: abs(s), ...meta });
        for (const s of el.querySelectorAll('source[src]')) {
          const isCurrent = abs(s.getAttribute('src')) === el.currentSrc;
          out.push({
            url: abs(s.getAttribute('src')), tag, mime: s.type || '', poster: meta.poster,
            width: isCurrent ? meta.width : 0, height: isCurrent ? meta.height : 0, duration: meta.duration,
            label: s.getAttribute('label') || s.getAttribute('size') || s.getAttribute('res') || ''
          });
        }
      }
      for (const el of queryAll('embed[src], object[data]')) {
        const u = el.getAttribute('src') || el.getAttribute('data');
        if (MEDIA_EXT.test(u)) out.push({ url: abs(u), tag: 'embed', source: 'embed' });
      }
      return out;
    },

    // <a href="…mp4">, data-* attributes, <link rel=preload as=video>
    links() {
      if (!settings.detectLinks) return [];
      const out = [];
      for (const a of document.querySelectorAll('a[href]')) {
        const u = a.getAttribute('href');
        if (u && MEDIA_EXT.test(u.split('#')[0])) {
          out.push({ url: abs(u), tag: /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba)(\?|$)/i.test(u) ? 'audio' : 'link', title: (a.textContent || '').trim().slice(0, 150), source: 'link' });
        }
        if (out.length > 60) break;
      }
      const sel = DATA_ATTRS.map((x) => `[${x}]`).join(',');
      for (const el of document.querySelectorAll(sel)) {
        for (const attr of DATA_ATTRS) {
          const v = el.getAttribute(attr);
          if (v && MEDIA_EXT.test(v) && !/^data:/i.test(v)) out.push({ url: abs(v), tag: 'data', kind: kindFromUrl(v), source: 'link' });
        }
      }
      for (const l of document.querySelectorAll('link[rel="preload"][as="video"][href], link[rel="preload"][as="fetch"][href]')) {
        const u = l.getAttribute('href');
        if (MEDIA_EXT.test(u)) out.push({ url: abs(u), tag: 'preload', kind: kindFromUrl(u), source: 'link' });
      }
      return out;
    },

    // og:video, twitter:player:stream, JSON-LD VideoObject/AudioObject
    metadata() {
      const out = [];
      for (const m of document.querySelectorAll('meta[property^="og:video"], meta[name^="og:video"], meta[name^="twitter:player:stream"], meta[property^="og:audio"]')) {
        const prop = m.getAttribute('property') || m.getAttribute('name');
        if (/(og:video(:url|:secure_url)?|og:audio(:url|:secure_url)?|twitter:player:stream)$/.test(prop) && MEDIA_EXT.test(m.content)) {
          out.push({ url: abs(m.content), tag: prop.includes('audio') ? 'audio' : 'meta', source: 'meta' });
        }
      }
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        let data;
        try { data = JSON.parse(s.textContent); } catch { continue; }
        const stack = [data];
        let guard = 0;
        while (stack.length && guard++ < 500) {
          const o = stack.pop();
          if (!o || typeof o !== 'object') continue;
          if (Array.isArray(o)) { stack.push(...o); continue; }
          const type = [].concat(o['@type'] || []).join(' ');
          if (/VideoObject|AudioObject|MediaObject/.test(type) && typeof o.contentUrl === 'string' && isHttp(abs(o.contentUrl))) {
            const thumb = [].concat(o.thumbnailUrl || [])[0];
            out.push({
              url: abs(o.contentUrl), tag: /Audio/.test(type) ? 'audio' : 'jsonld', title: typeof o.name === 'string' ? o.name.slice(0, 200) : '',
              poster: typeof thumb === 'string' && isHttp(abs(thumb)) ? abs(thumb) : '', duration: isoDuration(o.duration), kind: kindFromUrl(o.contentUrl), source: 'meta'
            });
          }
          for (const v of Object.values(o)) if (v && typeof v === 'object') stack.push(v);
        }
      }
      return out;
    },

    // Sources read from page players (JW Player, Video.js, Flowplayer, …) by content-main.js
    players() {
      return settings.detectPlayers ? [...playerItems.values()] : [];
    },

    // Rule addons: CSS selectors whose attribute or text holds a media URL
    addons() {
      const out = [];
      for (const a of addonRules) {
        for (const r of a.detect.selectors || []) {
          let els = [];
          try { els = queryAll(r.selector); } catch { continue; }
          for (const el of els.slice(0, 50)) {
            const v = r.attribute ? el.getAttribute(r.attribute) : (el.getAttribute('href') || el.getAttribute('src') || el.textContent || '').trim();
            if (v && isHttp(abs(v))) out.push({ url: abs(v), kind: r.kind || kindFromUrl(v), tag: 'addon', source: 'addon' });
          }
        }
      }
      return out;
    }
  };

  function isoDuration(s) {
    const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)$/.exec(String(s || ''));
    return m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : 0;
  }

  // blob: sources. A blob created from a real file can be saved; a MediaSource (MSE) stream can't
  // be read back – VidPull catches its underlying HLS/DASH stream on the network instead.
  function inspectBlobs(notices) {
    const out = [];
    for (const el of queryAll('video, audio')) {
      if (el.mediaKeys) notices.drm = true;
      const u = el.currentSrc || el.src || '';
      if (!u.startsWith('blob:')) continue;
      const info = blobInfo.get(u);
      if (info === undefined) {
        blobInfo.set(u, 'pending');
        fetch(u).then((r) => {
          const size = Number(r.headers.get('content-length')) || 0;
          const mime = (r.headers.get('content-type') || '').split(';')[0];
          try { r.body?.cancel(); } catch { /* ignore */ }
          blobInfo.set(u, { ok: true, size, mime });
        }).catch(() => blobInfo.set(u, { ok: false })).finally(() => schedule(50));
        continue;
      }
      if (info === 'pending') continue;
      if (!info.ok) { notices.mse = (notices.mse || 0) + 1; continue; }
      const ext = /webm/.test(info.mime) ? 'webm' : /ogg/.test(info.mime) ? 'ogv' : /mpeg$/.test(info.mime) ? 'mp3' : el.tagName === 'AUDIO' ? 'm4a' : 'mp4';
      out.push({
        url: u, kind: 'blob', ext, mime: info.mime, size: info.size, tag: el.tagName.toLowerCase(),
        width: el.videoWidth || 0, height: el.videoHeight || 0, duration: isFinite(el.duration) ? el.duration : 0,
        poster: el.poster && isHttp(abs(el.poster)) ? abs(el.poster) : '', source: 'blob'
      });
    }
    return out;
  }

  // ----- page info -----
  function pageThumb() {
    for (const v of queryAll('video[poster]')) {
      const u = abs(v.getAttribute('poster'));
      if (isHttp(u)) return u;
    }
    const og = document.querySelector('meta[property="og:image"], meta[name="twitter:image"]');
    const u = og && abs(og.content);
    return u && isHttp(u) ? u : '';
  }
  function selectorText() {
    const rule = siteRules.naming && siteRules.naming[host];
    const sels = [rule && rule.selector, ...addonRules.map((a) => a.detect.titleSelector)].filter(Boolean);
    for (const sel of sels) {
      try {
        const el = document.querySelector(sel);
        const text = el && (el.getAttribute('content') || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) return text.slice(0, 200);
      } catch { /* invalid selector */ }
    }
    return '';
  }

  function collect() {
    const found = new Map();
    const notices = { mse: 0, drm: false };
    const add = (item) => {
      if (!item || !item.url) return;
      const url = item.url;
      if (!isHttp(url) && !(item.kind === 'blob' && url.startsWith('blob:'))) return;
      const prev = found.get(url) || {};
      found.set(url, { ...prev, ...Object.fromEntries(Object.entries(item).filter(([, v]) => v)), url });
    };
    for (const [name, fn] of Object.entries(DETECTORS)) {
      try { fn().forEach(add); } catch (e) { console.debug('[VidPull] detector failed:', name, e); }
    }
    try { inspectBlobs(notices).forEach(add); } catch { /* ignore */ }
    // Plain blob: srcs from html5() were dropped by add(); blob items come from inspectBlobs only.
    return { items: [...found.values()].slice(0, 80), notices };
  }

  function report(force = false) {
    timer = null;
    const { items, notices } = collect();
    const top = window === window.top;
    // Page thumbnail: player poster / og:image, else the first poster any detector found.
    const thumb = top ? (pageThumb() || (items.find((i) => i.poster && isHttp(i.poster)) || {}).poster || '') : '';
    const sel = top ? selectorText() : '';
    const signature = JSON.stringify([thumb, sel, notices, items.map((i) => [i.url, i.width, i.height, Math.round(i.duration || 0), i.size])]);
    if (!force && signature === lastSignature) return;
    if (!items.length && !thumb && !sel && !notices.mse && !notices.drm && !force) return;
    lastSignature = signature;
    const msg = { type: 'dom-media', items, notices: top || notices.mse || notices.drm ? notices : undefined };
    if (top) { msg.thumb = thumb; msg.selectorText = sel; }
    chrome.runtime.sendMessage(msg).catch(() => {});
  }

  function schedule(delay = 600) {
    if (!timer) timer = setTimeout(() => report(), delay);
  }

  // ----- settings / rules / addons -----
  function loadConfig() {
    return Promise.all([
      chrome.storage.sync.get('settings').then(({ settings: s }) => {
        settings = { detectDomMedia: s?.detectDomMedia !== false, detectLinks: s?.detectLinks !== false, detectPlayers: s?.detectPlayers !== false };
      }),
      chrome.storage.local.get(['siteRules', 'addons']).then(({ siteRules: r, addons }) => {
        siteRules = r && typeof r === 'object' ? r : { naming: {} };
        addonRules = (Array.isArray(addons) ? addons : []).filter((a) => a && a.enabled && a.kind === 'rules' && a.detect && matches(a.matches));
      })
    ]).catch(() => {});
  }
  loadConfig().then(() => schedule(300));
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings || changes.siteRules || changes.addons) loadConfig().then(() => { lastSignature = ''; schedule(100); });
  });

  // ----- player probe (main world) → items -----
  document.addEventListener('vidpull:probe', (e) => {
    let list;
    try { list = JSON.parse(e.detail); } catch { return; }
    if (!Array.isArray(list)) return;
    let changed = false;
    for (const x of list.slice(0, 50)) {
      if (!x || typeof x.url !== 'string') continue;
      const url = abs(x.url);
      if (!isHttp(url) || playerItems.has(url)) continue;
      playerItems.set(url, {
        url, source: 'player', tag: 'player',
        title: typeof x.title === 'string' ? x.title.slice(0, 200) : '',
        poster: typeof x.poster === 'string' && isHttp(abs(x.poster)) ? abs(x.poster) : '',
        kind: ['hls', 'dash'].includes(x.kind) ? x.kind : kindFromUrl(url),
        mime: typeof x.mime === 'string' ? x.mime.slice(0, 60) : '',
        height: +x.height || 0, width: +x.width || 0, label: typeof x.label === 'string' ? x.label.slice(0, 40) : ''
      });
      changed = true;
    }
    if (changed) schedule(100);
  });

  // ----- DOM changes, media events, scrolling (lazy players) -----
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') { schedule(); return; }
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && (/^(VIDEO|AUDIO|SOURCE|EMBED|OBJECT|IFRAME|A)$/.test(n.nodeName) || n.querySelector?.('video, audio, source, a[href], [data-src], [data-video]'))) {
          schedule();
          return;
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href', 'data-src', 'data-video'] });
  for (const ev of ['loadedmetadata', 'play', 'durationchange', 'emptied']) document.addEventListener(ev, () => schedule(200), true);
  let scrollTimer = null;
  window.addEventListener('scroll', () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => schedule(100), 700); }, { passive: true });

  // ----- messages from the service worker -----
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'vidpull-scan') {
      lastSignature = '';
      document.dispatchEvent(new CustomEvent('vidpull:rescan')); // player probe + script addons
      setTimeout(() => report(true), 250);
      sendResponse({ ok: true });
    } else if (msg?.type === 'vidpull-eval-selector') {
      if (window !== window.top) return false;
      try {
        const el = document.querySelector(msg.selector);
        const text = el ? (el.getAttribute('content') || el.textContent || '').replace(/\s+/g, ' ').trim() : '';
        sendResponse({ ok: true, text: text.slice(0, 200), found: !!el });
      } catch (e) {
        sendResponse({ ok: false, error: `Invalid selector: ${e.message}` });
      }
    } else if (msg?.type === 'vidpull-save-blob') {
      // Save an in-page blob video through a normal browser download.
      if (!blobInfo.get(msg.url)?.ok) { sendResponse({ ok: false, error: 'This in-page video is no longer available. Play it again and retry.' }); return false; }
      const a = document.createElement('a');
      a.href = msg.url;
      a.download = msg.filename || 'video.mp4';
      a.style.display = 'none';
      document.documentElement.append(a);
      a.click();
      setTimeout(() => a.remove(), 1000);
      sendResponse({ ok: true });
    }
    return false;
  });
})();
