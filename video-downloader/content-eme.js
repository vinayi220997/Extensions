// VidPull EME observer — runs in the page's own world (MAIN) at document_start so it sees the
// player set up Encrypted Media Extensions. It only records *which* protection is used
// (key system, encryption scheme, robustness, PSSH system IDs, licence server address) so the
// panel can explain why a video can't be saved. It never touches keys, licences or media data:
// every wrapped call passes straight through to the browser unchanged.
(() => {
  if (window.__vidpullEme) return;
  const state = window.__vidpullEme = {
    requested: [], available: [], keySystems: [], schemes: [], robustness: [], sessionTypes: [], initDataTypes: [],
    psshSystems: [], kids: [], licenseUrls: [], contentTypes: [], active: false, persistentLicense: null
  };
  const MAX = 12;
  const push = (arr, v) => { if (v && typeof v === 'string' && !arr.includes(v) && arr.length < MAX) arr.push(v.slice(0, 200)); };
  let timer = null;
  const emit = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { document.dispatchEvent(new CustomEvent('vidpull:eme', { detail: JSON.stringify(snapshot()) })); } catch { /* ignore */ }
    }, 150);
  };
  function snapshot() {
    const v = [...document.querySelectorAll('video')].find((x) => x.mediaKeys) || document.querySelector('video');
    return {
      ...state,
      video: v ? { width: v.videoWidth || 0, height: v.videoHeight || 0, duration: isFinite(v.duration) ? v.duration : 0, poster: v.poster || '' } : null,
      title: document.title || ''
    };
  }
  document.addEventListener('vidpull:eme-pull', emit);

  const UUIDS = {
    'edef8ba979d64acea3c827dcd51d21ed': 'Widevine', '9a04f07998404286ab92e65be0885f95': 'PlayReady',
    '79f0049a40988642ab92e65be0885f95': 'PlayReady', '94ce86fb07ff4f43adb893d2fa968ca2': 'FairPlay',
    'f239e769efa348509c16a903c6932efb': 'Adobe Primetime', '1077efecc0b24d02ace33c1e52e2fb4b': 'ClearKey',
    'e2719d58a985b3c9781ab030af78d30e': 'ClearKey', '5e629af538da4063897797ffbd9902d4': 'Marlin',
    'adb41c242dbf4a6d958b4457c0d27b95': 'Nagra', '3d5e6d359b9a41e8b843dd3c6e72c42c': 'WisePlay'
  };
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
  // PSSH boxes in "cenc" init data: size, 'pssh', version, flags, system ID, [KIDs], data.
  function readPssh(buf) {
    try {
      const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      for (let off = 0; off + 32 <= u8.length;) {
        const size = dv.getUint32(off);
        if (size < 32 || off + size > u8.length) break;
        if (String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]) === 'pssh') {
          const id = hex(u8.subarray(off + 12, off + 28));
          push(state.psshSystems, UUIDS[id] || `Unknown DRM (${id})`);
          if (u8[off + 8] === 1) {
            const n = dv.getUint32(off + 28);
            for (let i = 0; i < n && i < 4; i++) push(state.kids, hex(u8.subarray(off + 32 + i * 16, off + 48 + i * 16)));
          }
        }
        off += size;
      }
    } catch { /* malformed init data */ }
  }
  // Key-ID init data ("keyids"): JSON {"kids":[base64url…]}.
  function readKeyIds(buf) {
    try {
      const json = JSON.parse(new TextDecoder().decode(buf));
      for (const k of (json.kids || []).slice(0, 4)) {
        const bin = atob(k.replace(/-/g, '+').replace(/_/g, '/'));
        push(state.kids, hex(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
      }
    } catch { /* ignore */ }
  }

  // 1) Which key systems / schemes / robustness the player asks for.
  const nav = navigator;
  const origRMKSA = nav.requestMediaKeySystemAccess && nav.requestMediaKeySystemAccess.bind(nav);
  if (origRMKSA) {
    const wrapped = function requestMediaKeySystemAccess(keySystem, configs) {
      push(state.requested, String(keySystem));
      const p = origRMKSA(keySystem, configs);
      p.then((access) => {
        push(state.available, access.keySystem);
        try {
          const c = access.getConfiguration();
          for (const cap of [...(c.videoCapabilities || []), ...(c.audioCapabilities || [])]) {
            push(state.robustness, cap.robustness);
            push(state.schemes, cap.encryptionScheme);
            push(state.contentTypes, cap.contentType);
          }
          for (const t of c.sessionTypes || []) push(state.sessionTypes, t);
          for (const t of c.initDataTypes || []) push(state.initDataTypes, t);
        } catch { /* ignore */ }
        emit();
      }, () => emit());
      return p;
    };
    try { Object.defineProperty(nav, 'requestMediaKeySystemAccess', { value: wrapped, configurable: true, writable: true }); } catch { /* frozen */ }
  }

  // The key system actually used: the one whose MediaKeys the player creates.
  const MKSA = window.MediaKeySystemAccess && MediaKeySystemAccess.prototype;
  if (MKSA && MKSA.createMediaKeys) {
    const orig = MKSA.createMediaKeys;
    MKSA.createMediaKeys = function createMediaKeys() {
      try { push(state.keySystems, this.keySystem); emit(); } catch { /* ignore */ }
      return orig.apply(this, arguments);
    };
  }

  // 2) Real protected playback: sessions + license requests.
  const KS = window.MediaKeySession && MediaKeySession.prototype;
  if (KS && KS.generateRequest) {
    const orig = KS.generateRequest;
    KS.generateRequest = function generateRequest(initDataType, initData) {
      state.active = true;
      push(state.initDataTypes, initDataType);
      if (initDataType === 'cenc') readPssh(initData);
      else if (initDataType === 'keyids') readKeyIds(initData);
      probePersistent();
      emit();
      return orig.apply(this, arguments);
    };
  }
  const MK = window.MediaKeys && MediaKeys.prototype;
  if (MK && MK.createSession) {
    const orig = MK.createSession;
    MK.createSession = function createSession(type) {
      push(state.sessionTypes, type || 'temporary');
      const session = orig.apply(this, arguments);
      // Registered before the player's own listener, so the size is known when it sends the request.
      try {
        session.addEventListener('message', (e) => {
          const len = e.message?.byteLength || 0;
          if (!len) return;
          state.licenseMessages = [...(state.licenseMessages || []), { len, at: Date.now() }].slice(-6);
          emit();
        });
      } catch { /* ignore */ }
      return session;
    };
  }
  // Report the picture size once the protected video has loaded.
  for (const ev of ['loadedmetadata', 'resize']) document.addEventListener(ev, () => { if (state.active) emit(); }, true);
  document.addEventListener('encrypted', (e) => {
    state.active = true;
    push(state.initDataTypes, e.initDataType);
    if (e.initDataType === 'cenc' && e.initData) readPssh(e.initData);
    emit();
  }, true);

  // 3) Licence server address: VidPull's service worker matches the size of the CDM's licence
  // message (recorded below) against POST requests it sees on the network. Nothing here touches
  // the page's own fetch()/XHR calls, so a request the site's own security policy blocks is never
  // blamed on VidPull.
  // 5) Videos named in AJAX/JSON responses (SPAs, feeds, "load more", players that fetch their
  // config): media URLs inside JSON are reported before the video ever plays. Read-only.
  const MEDIA_RE = /https?:(?:\\?\/){2}[^"'\s<>]+?\.(?:mp4|m4v|webm|mov|mkv|m3u8|mpd|ogv|flv|3gp|mpe?g)(?:\?[^"'\s<>]*)?(?=["'\s<>,\]}]|\\u0026|$)/gi;
  const sniffed = new Set();
  const allFound = []; // replayed when VidPull's content script (document_idle) starts listening
  let sniffCount = 0;
  document.addEventListener('vidpull:eme-pull', () => {
    if (allFound.length) { try { document.dispatchEvent(new CustomEvent('vidpull:probe', { detail: JSON.stringify(allFound) })); } catch { /* ignore */ } }
  });
  function sniffText(text) {
    if (!text || text.length > 3e6 || sniffCount > 400) return;
    const found = [];
    for (const m of text.matchAll(MEDIA_RE)) {
      let u = m[0].replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
      if (sniffed.has(u) || u.length > 2000) continue;
      sniffed.add(u);
      sniffCount++;
      found.push({ url: u, source: 'ajax' });
      if (allFound.length < 200) allFound.push({ url: u, source: 'ajax' });
      if (found.length >= 40) break;
    }
    if (found.length) {
      try { document.dispatchEvent(new CustomEvent('vidpull:probe', { detail: JSON.stringify(found) })); } catch { /* ignore */ }
    }
  }
  const isJsonType = (ct) => /json|javascript|text\/plain/i.test(ct || '');
  // Read JSON *after* the page asks for it (Response.text/json), never inside fetch() itself.
  const RP = window.Response && Response.prototype;
  const looksJson = (r) => { try { return r.ok && isJsonType(r.headers.get('content-type')); } catch { return false; } };
  if (RP && RP.text) {
    const origText = RP.text;
    RP.text = function text() {
      const p = origText.apply(this, arguments);
      if (looksJson(this)) p.then(sniffText, () => {});
      return p;
    };
  }
  if (RP && RP.json) {
    const origJson = RP.json;
    RP.json = function json() {
      const p = origJson.apply(this, arguments);
      if (looksJson(this)) p.then((o) => { try { sniffText(JSON.stringify(o)); } catch { /* ignore */ } }, () => {});
      return p;
    };
  }
  // XHR: watch the response from open() (send(), where the network request starts, is untouched).
  const XO = XMLHttpRequest.prototype;
  const origOpen = XO.open;
  XO.open = function open() {
    try {
      if (!this.__vpWatch) {
        this.__vpWatch = true;
        this.addEventListener('load', () => {
          try {
            if (this.status >= 200 && this.status < 300 && isJsonType(this.getResponseHeader('content-type'))) {
              if (this.responseType === '' || this.responseType === 'text') sniffText(this.responseText);
              else if (this.responseType === 'json' && this.response) sniffText(JSON.stringify(this.response));
            }
          } catch { /* ignore */ }
        });
      }
    } catch { /* ignore */ }
    return origOpen.apply(this, arguments);
  };

  // 4) Can this browser's CDM keep licences offline? (asked once, with the browser's own API)
  let probed = false;
  function probePersistent() {
    if (probed || !origRMKSA) return;
    const ks = state.keySystems[0] || state.available[0];
    // Only Widevine has a standard robustness level to ask with; asking without one makes Chrome log
    // a warning, and ClearKey/others don't keep offline licences in desktop browsers anyway.
    if (!ks || !/^com\.widevine\./.test(ks)) return;
    probed = true;
    try {
      Promise.resolve(origRMKSA(ks, [{
        initDataTypes: ['cenc'],
        videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"', robustness: 'SW_SECURE_CRYPTO' }],
        persistentState: 'required', sessionTypes: ['persistent-license']
      }])).then(() => { state.persistentLicense = true; }, () => { state.persistentLicense = false; }).then(emit, emit);
    } catch { state.persistentLicense = false; emit(); }
  }
})();
