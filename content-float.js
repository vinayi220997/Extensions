// VidSnag "Unpinned" mode: a small indicator at the edge of the page. Hovering it expands the
// compact (Mini) VidSnag panel; moving away collapses it again. Only active when the user chose
// Unpin, only in the top frame, hidden in fullscreen. Drag it up/down to move it.
(() => {
  if (window !== window.top || window.__vidsnagFloat) return;
  window.__vidsnagFloat = true;

  let host = null;
  let shadow = null;
  let els = {};
  let enabled = false;
  let expanded = false;
  let collapseTimer = null;
  let expandTimer = null;
  let posY = 40; // % from top
  let count = 0;

  const CSS = `
    :host { all: initial; position: fixed; right: 0; top: 40%; z-index: 2147483646; font: 13px system-ui, sans-serif; }
    .tab {
      all: unset; box-sizing: border-box; position: relative; width: 38px; height: 40px; display: grid; place-items: center;
      background: #0f766e; border-radius: 12px 0 0 12px; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,.28);
      transform: translateX(10px); transition: transform .18s ease, opacity .18s; opacity: .82; touch-action: none;
    }
    :host([data-expanded="true"]) .tab, .tab:hover, .tab:focus-visible { transform: none; opacity: 1; }
    .tab:focus-visible { outline: 2px solid #fff; outline-offset: -4px; }
    .tab img { width: 22px; height: 22px; border-radius: 5px; pointer-events: none; }
    .badge {
      position: absolute; top: -5px; left: -5px; min-width: 18px; height: 18px; padding: 0 4px; box-sizing: border-box;
      border-radius: 9px; background: #e11d48; color: #fff; font: 700 11px/18px system-ui, sans-serif; text-align: center;
    }
    .badge:empty { display: none; }
    :host([data-empty="true"]) .tab { opacity: .5; }
    .panel {
      position: absolute; right: 40px; width: 330px; height: 440px; max-height: calc(100vh - 16px); border-radius: 12px; overflow: hidden;
      box-shadow: 0 12px 36px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.08); background: #fff; display: none;
    }
    :host([data-expanded="true"]) .panel { display: block; }
    iframe { border: 0; width: 100%; height: 100%; display: block; color-scheme: normal; }
    :host([data-hidden="true"]) { display: none !important; }
  `;

  function build() {
    host = document.createElement('vidsnag-indicator');
    host.setAttribute('data-expanded', 'false');
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.title = 'VidSnag — hover to open, drag to move';
    tab.setAttribute('aria-label', 'VidSnag');
    const img = document.createElement('img');
    img.alt = '';
    img.src = chrome.runtime.getURL('icons/icon32.png');
    const badge = document.createElement('span');
    badge.className = 'badge';
    tab.append(img, badge);
    const panel = document.createElement('div');
    panel.className = 'panel';
    shadow.append(style, tab, panel);
    els = { tab, badge, panel };

    host.addEventListener('mouseenter', () => { clearTimeout(collapseTimer); expandTimer = setTimeout(expand, 120); });
    host.addEventListener('mouseleave', () => { clearTimeout(expandTimer); collapseTimer = setTimeout(collapse, 450); });
    tab.addEventListener('keydown', (e) => { if (e.key === 'Escape') collapse(); });
    shadow.addEventListener('focusin', () => clearTimeout(collapseTimer));

    // Click toggles (touch / keyboard); drag moves vertically.
    let drag = null;
    tab.addEventListener('pointerdown', (e) => { drag = { y: e.clientY, moved: false }; tab.setPointerCapture(e.pointerId); });
    tab.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
      if (drag.moved) {
        posY = Math.min(92, Math.max(2, (e.clientY / window.innerHeight) * 100));
        host.style.top = `${posY}%`;
        placePanel();
      }
    });
    tab.addEventListener('pointerup', () => {
      if (drag && drag.moved) chrome.storage.local.set({ floatPos: posY }).catch(() => {});
      else if (drag) (expanded ? collapse() : expand());
      drag = null;
    });
    document.addEventListener('fullscreenchange', applyVisibility);
    document.documentElement.append(host);
    host.style.top = `${posY}%`;
  }

  function placePanel() {
    if (!els.panel) return;
    // Keep the panel inside the viewport, aligned with the tab.
    const h = Math.min(440, window.innerHeight - 16);
    const tabTop = (posY / 100) * window.innerHeight;
    let top = -Math.min(h / 2, tabTop - 8);
    if (tabTop + top + h > window.innerHeight - 8) top = window.innerHeight - 8 - h - tabTop;
    els.panel.style.top = `${top}px`;
  }

  function expand() {
    if (!host || expanded) return;
    if (!els.frame) {
      const f = document.createElement('iframe');
      f.src = chrome.runtime.getURL('popup/popup.html?mode=float');
      f.title = 'VidSnag';
      f.allow = 'clipboard-write';
      els.panel.append(f);
      els.frame = f;
    }
    expanded = true;
    placePanel();
    host.setAttribute('data-expanded', 'true');
  }
  function collapse() {
    if (!host || !expanded) return;
    if (shadow.activeElement === els.frame && els.frame.matches(':hover')) return;
    expanded = false;
    host.setAttribute('data-expanded', 'false');
  }

  function applyVisibility() {
    if (!enabled) { host?.remove(); host = null; els = {}; expanded = false; return; }
    if (!host) build();
    host.setAttribute('data-hidden', document.fullscreenElement ? 'true' : 'false');
    host.setAttribute('data-empty', count ? 'false' : 'true');
    els.badge.textContent = count ? String(count > 99 ? '99+' : count) : '';
  }

  async function load() {
    try {
      const [{ settings }, { floatPos }] = await Promise.all([chrome.storage.sync.get('settings'), chrome.storage.local.get('floatPos')]);
      if (typeof floatPos === 'number') posY = floatPos;
      enabled = !!settings && settings.sidebarMode === 'unpinned';
      if (host) host.style.top = `${posY}%`;
      applyVisibility();
      if (enabled) chrome.runtime.sendMessage({ type: 'float-hello' }).catch(() => {});
    } catch { /* extension reloaded */ }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) load();
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'vidsnag-count') { count = msg.count || 0; if (enabled) applyVisibility(); }
    return false;
  });
  load();
})();
