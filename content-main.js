// VidSnag player probe — runs in the page's own JavaScript world (MAIN) so it can read the
// source lists of common web players. It only reads; it never changes the page.
// Results go to content.js via a DOM event as a JSON string.
(() => {
  if (window.__vidsnagProbe) return;
  window.__vidsnagProbe = true;
  const seen = new Set();

  function out(list, x) {
    if (!x || typeof x.url !== 'string' || !x.url || x.url.startsWith('blob:') || x.url.startsWith('data:')) return;
    list.push(x);
  }

  const PROBES = [
    // JW Player
    (list) => {
      const jw = window.jwplayer;
      if (typeof jw !== 'function') return;
      for (let i = 0; i < 10; i++) {
        let p;
        try { p = jw(i); } catch { break; }
        if (!p || typeof p.getPlaylist !== 'function') break;
        for (const item of p.getPlaylist() || []) {
          for (const s of item.sources || [{ file: item.file, type: item.type }]) {
            out(list, { url: s.file, kind: /m3u8|hls/i.test(s.type || s.file) ? 'hls' : /mpd|dash/i.test(s.type || s.file) ? 'dash' : '',
              title: item.title, poster: item.image, label: s.label, height: parseInt(s.label, 10) || s.height || 0 });
          }
        }
      }
    },
    // Video.js
    (list) => {
      const vjs = window.videojs;
      if (!vjs || typeof vjs.getPlayers !== 'function') return;
      for (const p of Object.values(vjs.getPlayers() || {})) {
        if (!p) continue;
        const sources = (typeof p.currentSources === 'function' && p.currentSources()) || [];
        for (const s of sources) out(list, { url: s.src, mime: s.type, kind: /mpegurl/i.test(s.type || '') ? 'hls' : /dash/i.test(s.type || '') ? 'dash' : '', poster: typeof p.poster === 'function' ? p.poster() : '' });
        if (!sources.length && typeof p.currentSrc === 'function') out(list, { url: p.currentSrc() });
      }
    },
    // Flowplayer
    (list) => {
      const fp = window.flowplayer;
      const instances = fp && (fp.instances || (typeof fp === 'function' && fp.instances));
      for (const p of instances || []) {
        const v = p.video || p.opts?.src || {};
        for (const s of v.sources || [].concat(v.src || p.opts?.src || [])) {
          out(list, typeof s === 'string' ? { url: s } : { url: s.src, mime: s.type });
        }
      }
    },
    // Common globals holding hls.js / dash.js / Shaka / Clappr instances
    (list) => {
      for (const name of ['hls', 'player', 'videoPlayer', 'mediaPlayer', 'shakaPlayer', 'clappr', 'dashPlayer']) {
        const o = window[name];
        if (!o || typeof o !== 'object') continue;
        try {
          if (typeof o.url === 'string' && Array.isArray(o.levels)) out(list, { url: o.url, kind: 'hls' });                 // hls.js
          else if (typeof o.getSource === 'function' && typeof o.getSource() === 'string') out(list, { url: o.getSource(), kind: 'dash' }); // dash.js
          else if (typeof o.getAssetUri === 'function') out(list, { url: o.getAssetUri() });                                // Shaka
          else if (o.options && typeof o.options.source === 'string') out(list, { url: o.options.source });                 // Clappr
        } catch { /* player API threw */ }
      }
    }
  ];

  function probe() {
    const list = [];
    for (const p of PROBES) {
      try { p(list); } catch { /* ignore broken players */ }
    }
    const fresh = list.filter((x) => {
      const key = `${x.url}|${x.kind || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length) document.dispatchEvent(new CustomEvent('vidsnag:probe', { detail: JSON.stringify(fresh) }));
  }

  probe();
  setTimeout(probe, 1500);
  setTimeout(probe, 5000);
  for (const ev of ['play', 'loadedmetadata']) document.addEventListener(ev, () => setTimeout(probe, 300), true);
  document.addEventListener('vidsnag:rescan', () => { seen.clear(); probe(); });
})();
