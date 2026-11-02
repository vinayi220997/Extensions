// VidSnag content script: finds <video>/<audio>/<source>/<embed> media and
// og:video tags on the page and reports them to the service worker.
(() => {
  if (window.__vidsnagLoaded) return;
  window.__vidsnagLoaded = true;

  const MEDIA_EXT = /\.(mp4|m4v|webm|mkv|mov|ogv|flv|3gp|mp3|m4a|aac|ogg|oga|opus|wav|flac|m3u8|mpd)(\?|#|$)/i;
  let lastSignature = '';
  let timer = null;
  let enabled = true;

  const abs = (u) => {
    try { return new URL(u, document.baseURI).href; } catch { return ''; }
  };
  const isHttp = (u) => /^https?:/i.test(u);

  function collect() {
    const found = new Map();
    const add = (url, info) => {
      url = abs(url);
      if (!url || !isHttp(url)) return; // blob:/data:/MediaSource → caught by network detection
      const prev = found.get(url) || {};
      found.set(url, { ...prev, ...Object.fromEntries(Object.entries(info).filter(([, v]) => v)), url });
    };

    for (const el of document.querySelectorAll('video, audio')) {
      const tag = el.tagName.toLowerCase();
      const meta = {
        tag,
        width: el.videoWidth || 0,
        height: el.videoHeight || 0,
        duration: isFinite(el.duration) ? el.duration : 0,
        poster: el.poster ? abs(el.poster) : ''
      };
      if (el.currentSrc) add(el.currentSrc, meta);
      if (el.getAttribute('src')) add(el.getAttribute('src'), meta);
      for (const s of el.querySelectorAll('source[src]')) {
        // <source> alternatives: only the playing one has known dimensions
        const isCurrent = abs(s.getAttribute('src')) === el.currentSrc;
        add(s.getAttribute('src'), {
          tag, mime: s.type || '', poster: meta.poster,
          width: isCurrent ? meta.width : 0, height: isCurrent ? meta.height : 0, duration: meta.duration,
          label: s.getAttribute('label') || s.getAttribute('size') || s.getAttribute('res') || ''
        });
      }
    }
    for (const el of document.querySelectorAll('embed[src], object[data]')) {
      const u = el.getAttribute('src') || el.getAttribute('data');
      if (MEDIA_EXT.test(u)) add(u, { tag: 'embed' });
    }
    for (const m of document.querySelectorAll('meta[property^="og:video"], meta[name^="twitter:player:stream"]')) {
      const prop = m.getAttribute('property') || m.getAttribute('name');
      if (/(og:video(:url|:secure_url)?|twitter:player:stream)$/.test(prop) && MEDIA_EXT.test(m.content)) {
        add(m.content, { tag: 'meta' });
      }
    }
    return [...found.values()];
  }

  // Thumbnail for the page: a player poster (even for blob:/MSE players) or og:image.
  function pageThumb() {
    for (const v of document.querySelectorAll('video[poster]')) {
      const u = abs(v.getAttribute('poster'));
      if (isHttp(u)) return u;
    }
    const og = document.querySelector('meta[property="og:image"], meta[name="twitter:image"]');
    const u = og && abs(og.content);
    return u && isHttp(u) ? u : '';
  }

  function report() {
    timer = null;
    if (!enabled) return;
    const items = collect();
    const thumb = window === window.top ? pageThumb() : '';
    const signature = JSON.stringify([thumb, items.map((i) => [i.url, i.width, i.height, Math.round(i.duration || 0)])]);
    if ((!items.length && !thumb) || signature === lastSignature) return;
    lastSignature = signature;
    chrome.runtime.sendMessage({ type: 'dom-media', items, thumb }).catch(() => {});
  }

  function schedule(delay = 600) {
    if (!timer) timer = setTimeout(report, delay);
  }

  chrome.storage.sync.get('settings').then(({ settings }) => {
    enabled = !settings || settings.detectDomMedia !== false;
    if (enabled) schedule(300);
  }).catch(() => schedule(300));

  // Players often attach or swap sources late: watch the DOM and media events.
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') { schedule(); return; }
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && (/^(VIDEO|AUDIO|SOURCE|EMBED|OBJECT)$/.test(n.nodeName) || n.querySelector?.('video, audio'))) {
          schedule();
          return;
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  for (const ev of ['loadedmetadata', 'play', 'durationchange']) {
    document.addEventListener(ev, () => schedule(200), true);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'vidsnag-scan') {
      lastSignature = '';
      report();
      sendResponse({ ok: true });
    }
    return false;
  });
})();
