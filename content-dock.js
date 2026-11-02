// VidSnag page sidebar (docked at the right edge of every page while open).
//   Max       full interface at the user's width (drag the left edge to resize)
//   Mini      narrow column, 5–10 % of the window width
//   Auto-Hide only a small drawer handle at the edge; hover or click it to slide the sidebar out
// The page is shrunk next to the sidebar ("push", default) or overlaid ("overlay").
// This has nothing to do with pinning VidSnag's icon in Chrome's toolbar, which only Chrome controls.
(() => {
  if (window !== window.top || window.__vidsnagDock) return;
  window.__vidsnagDock = true;

  const MIN_MAX_W = 280;
  const MIN_MINI_W = 92;
  const MAX_MINI_W = 180;

  let s = null;                 // settings subset
  let host = null, shadow = null, els = {};
  let expanded = false;         // Auto-Hide: sidebar slid out
  let collapseTimer = null, expandTimer = null;
  let count = 0;
  let handleY = 45;             // % from top
  let dragW = null;             // live width while resizing
  let marginApplied = null;     // page margin we set (to restore)
  let tokenPromise = null;

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const CSS = `
    :host { all: initial; position: fixed; inset: 0 0 0 auto; z-index: 2147483646; font: 13px system-ui, sans-serif; pointer-events: none; }
    .panel {
      position: fixed; top: 0; right: 0; bottom: 0; width: var(--w, 380px); pointer-events: auto;
      background: #f7f8f7; border-left: 1px solid rgba(0,0,0,.12); box-shadow: -6px 0 24px rgba(0,0,0,.08);
      transform: translateX(0); transition: transform .22s ease, width .22s ease, box-shadow .22s;
      display: flex;
    }
    :host([data-dark="true"]) .panel { background: #111614; border-left-color: rgba(255,255,255,.12); }
    :host([data-anim="off"]) .panel, :host([data-resizing="true"]) .panel { transition: none; }
    :host([data-mode="autohide"]) .panel { transform: translateX(calc(100% + 12px)); box-shadow: -10px 0 32px rgba(0,0,0,.28); }
    :host([data-mode="autohide"][data-expanded="true"]) .panel { transform: translateX(0); }
    iframe { border: 0; flex: 1; width: 100%; height: 100%; display: block; color-scheme: normal; }
    :host([data-resizing="true"]) iframe { pointer-events: none; }
    .resizer {
      position: absolute; left: -4px; top: 0; bottom: 0; width: 8px; cursor: ew-resize; z-index: 2;
      background: transparent; border: 0; padding: 0; outline: none;
    }
    .resizer::after { content: ""; position: absolute; left: 3px; top: 50%; width: 2px; height: 36px; margin-top: -18px; border-radius: 2px; background: rgba(0,0,0,.18); opacity: 0; transition: opacity .15s; }
    .resizer:hover::after, .resizer:focus-visible::after, :host([data-resizing="true"]) .resizer::after { opacity: 1; background: #0f766e; }
    :host([data-mode="autohide"]) .resizer { display: none; }
    .handle {
      all: unset; box-sizing: border-box; position: fixed; right: 0; top: var(--hy, 45%); width: 22px; height: 56px; margin-top: -28px;
      display: none; place-items: center; pointer-events: auto; cursor: pointer; touch-action: none;
      background: #0f766e; color: #fff; border-radius: 10px 0 0 10px; box-shadow: -2px 2px 10px rgba(0,0,0,.25);
      opacity: .78; transition: opacity .15s, width .15s;
    }
    .handle:hover, .handle:focus-visible { opacity: 1; width: 26px; }
    .handle:focus-visible { outline: 2px solid #fff; outline-offset: -4px; }
    .handle svg { width: 14px; height: 14px; }
    :host([data-mode="autohide"]) .handle { display: grid; }
    :host([data-mode="autohide"][data-expanded="true"]) .handle { opacity: 0; pointer-events: none; }
    .badge { position: absolute; top: -7px; left: -7px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 8px;
      background: #e11d48; color: #fff; font: 700 10px/16px system-ui, sans-serif; text-align: center; }
    .badge:empty { display: none; }
    :host([data-hidden="true"]) { display: none !important; }
  `;
  const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';

  // ---------------------------------------------------------------------------
  function widthFor(mode) {
    const vw = window.innerWidth;
    if (mode === 'mini') {
      const pct = dragW && s.sidebarMode === 'mini' ? (dragW / vw) * 100 : s.sidebarMiniPct;
      return Math.round(Math.min(MAX_MINI_W, Math.max(MIN_MINI_W, (vw * pct) / 100)));
    }
    const w = dragW && s.sidebarMode === 'max' ? dragW : s.sidebarMaxWidth;
    return Math.round(Math.min(Math.max(MIN_MAX_W, w), Math.max(MIN_MAX_W, vw * 0.7)));
  }

  function setPageMargin(px) {
    const html = document.documentElement;
    if (px && marginApplied === null) marginApplied = html.style.getPropertyValue('margin-right') || '';
    if (px) {
      if (!reduceMotion.matches && !dragW) {
        html.style.setProperty('transition', 'margin-right .22s ease');
        clearTimeout(setPageMargin.t);
        setPageMargin.t = setTimeout(() => html.style.removeProperty('transition'), 300);
      }
      html.style.setProperty('margin-right', `${px}px`, 'important');
    } else if (marginApplied !== null) {
      if (marginApplied) html.style.setProperty('margin-right', marginApplied); else html.style.removeProperty('margin-right');
      marginApplied = null;
    }
  }

  function build() {
    host = document.createElement('vidsnag-sidebar');
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', 'VidSnag sidebar');
    const resizer = document.createElement('button');
    resizer.className = 'resizer';
    resizer.title = 'Drag to resize · double-click to reset';
    resizer.setAttribute('aria-label', 'Resize the VidSnag sidebar (arrow keys)');
    const handle = document.createElement('button');
    handle.className = 'handle';
    handle.innerHTML = ARROW; // static markup
    const badge = document.createElement('span');
    badge.className = 'badge';
    handle.append(badge);
    panel.append(resizer);
    shadow.append(style, panel, handle);
    els = { panel, resizer, handle, badge };

    // ----- Auto-Hide handle: hover or click -----
    handle.addEventListener('mouseenter', () => {
      if (s.autoHideTrigger !== 'hover') return;
      clearTimeout(collapseTimer);
      expandTimer = setTimeout(() => setExpanded(true), 120);
    });
    panel.addEventListener('mouseenter', () => clearTimeout(collapseTimer));
    for (const el of [handle, panel]) {
      el.addEventListener('mouseleave', () => {
        clearTimeout(expandTimer);
        if (s.sidebarMode === 'autohide' && s.autoHideTrigger === 'hover') collapseTimer = setTimeout(() => setExpanded(false), 500);
      });
    }
    let hdrag = null;
    handle.addEventListener('pointerdown', (e) => { hdrag = { y: e.clientY, moved: false }; handle.setPointerCapture(e.pointerId); });
    handle.addEventListener('pointermove', (e) => {
      if (!hdrag) return;
      if (Math.abs(e.clientY - hdrag.y) > 4) hdrag.moved = true;
      if (hdrag.moved) { handleY = Math.min(94, Math.max(6, (e.clientY / window.innerHeight) * 100)); host.style.setProperty('--hy', `${handleY}%`); }
    });
    handle.addEventListener('pointerup', () => {
      if (hdrag?.moved) chrome.storage.local.set({ dockHandleY: handleY }).catch(() => {});
      else if (hdrag) setExpanded(!expanded);
      hdrag = null;
    });
    handle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); }
    });
    // Click mode: a click anywhere on the page outside the sidebar collapses it.
    document.addEventListener('pointerdown', (e) => {
      if (s?.sidebarMode === 'autohide' && expanded && !e.composedPath().includes(host)) setExpanded(false);
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && expanded) setExpanded(false); }, true);

    // ----- Resize (Max and Mini) -----
    resizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      resizer.setPointerCapture(e.pointerId);
      host.setAttribute('data-resizing', 'true');
      dragW = widthFor(s.sidebarMode);
    });
    resizer.addEventListener('pointermove', (e) => {
      if (!dragW) return;
      dragW = Math.max(40, window.innerWidth - e.clientX);
      layout();
    });
    const endResize = () => {
      if (!dragW) return;
      const w = widthFor(s.sidebarMode);
      dragW = null;
      host.removeAttribute('data-resizing');
      saveWidth(w);
    };
    resizer.addEventListener('pointerup', endResize);
    resizer.addEventListener('pointercancel', endResize);
    resizer.addEventListener('dblclick', () => save(s.sidebarMode === 'mini' ? { sidebarMiniPct: 7 } : { sidebarMaxWidth: 380 }));
    resizer.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      saveWidth(widthFor(s.sidebarMode) + (e.key === 'ArrowLeft' ? 20 : -20));
    });

    document.documentElement.append(host);
  }

  function saveWidth(w) {
    if (s.sidebarMode === 'mini') save({ sidebarMiniPct: Math.round((w / window.innerWidth) * 1000) / 10 });
    else save({ sidebarMaxWidth: Math.round(w) });
  }
  async function save(patch) {
    try {
      const { settings } = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({ settings: { ...(settings || {}), ...patch } });
    } catch { /* extension reloaded */ }
  }

  async function ensureFrame() {
    if (els.frame) return;
    tokenPromise = tokenPromise || chrome.runtime.sendMessage({ type: 'float-token' }).then((r) => r?.result || '').catch(() => '');
    const token = await tokenPromise;
    if (!host || els.frame) return;
    const f = document.createElement('iframe');
    f.src = chrome.runtime.getURL(`popup/popup.html?mode=dock#t=${encodeURIComponent(token)}`);
    f.title = 'VidSnag';
    f.allow = 'clipboard-write';
    els.panel.append(f);
    els.frame = f;
  }

  function setExpanded(v) {
    if (!host || s.sidebarMode !== 'autohide') v = false;
    expanded = !!v;
    if (!host) return;
    host.setAttribute('data-expanded', String(expanded));
    els.handle.setAttribute('aria-expanded', String(expanded));
    if (expanded) ensureFrame();
  }

  function layout() {
    const visible = !!s && s.dockOpen && !document.fullscreenElement;
    if (!visible) {
      if (host) { host.remove(); host = null; els = {}; expanded = false; }
      setPageMargin(0);
      return;
    }
    if (!host) build();
    const mode = s.sidebarMode;
    host.setAttribute('data-mode', mode);
    host.setAttribute('data-anim', reduceMotion.matches ? 'off' : 'on');
    host.setAttribute('data-dark', String(s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)));
    host.style.setProperty('--hy', `${handleY}%`);
    els.handle.title = s.autoHideTrigger === 'click' ? 'Show VidSnag (click)' : 'Show VidSnag (hover or click)';
    els.handle.setAttribute('aria-label', 'Show the VidSnag sidebar');
    els.handle.setAttribute('aria-expanded', String(expanded));
    els.badge.textContent = count ? String(count > 99 ? '99+' : count) : '';
    const w = widthFor(mode === 'autohide' ? s.lastPinnedMode : mode);
    els.panel.style.setProperty('--w', `${w}px`);
    host.setAttribute('data-width', String(w));
    if (mode === 'autohide') {
      setPageMargin(0);
      if (!expanded) host.setAttribute('data-expanded', 'false');
    } else {
      expanded = false;
      host.setAttribute('data-expanded', 'false');
      setPageMargin(s.dockLayout === 'push' ? w : 0);
      ensureFrame();
    }
  }

  async function load() {
    try {
      const [{ settings }, { dockHandleY }] = await Promise.all([chrome.storage.sync.get('settings'), chrome.storage.local.get('dockHandleY')]);
      const st = settings || {};
      const mode = st.sidebarMode === 'unpinned' ? 'autohide' : st.sidebarMode;
      s = {
        dockOpen: !!st.dockOpen || st.sidebarMode === 'unpinned',
        sidebarMode: ['max', 'mini', 'autohide'].includes(mode) ? mode : 'max',
        lastPinnedMode: st.lastPinnedMode === 'mini' ? 'mini' : 'max',
        sidebarMaxWidth: Number(st.sidebarMaxWidth) || 380,
        sidebarMiniPct: Math.min(10, Math.max(5, Number(st.sidebarMiniPct) || 7)),
        autoHideTrigger: st.autoHideTrigger === 'click' ? 'click' : 'hover',
        dockLayout: st.dockLayout === 'overlay' ? 'overlay' : 'push',
        theme: st.theme || 'system'
      };
      if (typeof dockHandleY === 'number') handleY = dockHandleY;
      layout();
      if (s.dockOpen) chrome.runtime.sendMessage({ type: 'float-hello' }).catch(() => {});
    } catch { /* extension reloaded */ }
  }

  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && changes.settings) load(); });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'vidsnag-count') { count = msg.count || 0; if (host) els.badge.textContent = count ? String(count > 99 ? '99+' : count) : ''; }
    return false;
  });
  window.addEventListener('resize', () => { if (s?.dockOpen) layout(); });
  document.addEventListener('fullscreenchange', () => s && layout());
  load();
})();
