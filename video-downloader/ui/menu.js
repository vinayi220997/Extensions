// Lightweight dropdown menu. items: [{label, icon, onClick, checked, danger, disabled} | 'sep' | {header}]
import { h, icon } from './dom.js';

let open = null;

export function closeMenu() {
  if (!open) return;
  open.el.remove();
  document.removeEventListener('mousedown', open.outside, true);
  document.removeEventListener('keydown', open.key, true);
  window.removeEventListener('blur', closeMenu);
  const anchor = open.anchor;
  open = null;
  anchor?.setAttribute('aria-expanded', 'false');
}

export function showMenu(anchor, items) {
  const wasOpenHere = open && open.anchor === anchor;
  closeMenu();
  if (wasOpenHere) return;
  const el = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') { el.append(h('hr')); continue; }
    if (it.header) { el.append(h('div', { class: 'menu-label', text: it.header })); continue; }
    const btn = h('button', { role: 'menuitem', class: it.danger ? 'danger' : '', disabled: !!it.disabled, title: it.title || null },
      it.icon ? icon(it.icon) : h('span', { style: { width: '15px' } }),
      h('span', { text: it.label }),
      it.checked ? h('span', { class: 'check', text: '✓' }) : null);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
      it.onClick?.();
    });
    el.append(btn);
  }
  document.body.append(el);
  // Position below (or above) the anchor, kept inside the viewport.
  const r = anchor.getBoundingClientRect();
  const mw = el.offsetWidth, mh = el.offsetHeight;
  let left = Math.min(r.right - mw, window.innerWidth - mw - 8);
  left = Math.max(8, left);
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  anchor.setAttribute('aria-expanded', 'true');
  const outside = (e) => { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeMenu(); };
  const key = (e) => {
    if (e.key === 'Escape') { closeMenu(); anchor.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const btns = [...el.querySelectorAll('button:not(:disabled)')];
      const i = btns.indexOf(document.activeElement);
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
    }
  };
  open = { el, anchor, outside, key };
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', key, true);
  window.addEventListener('blur', closeMenu);
  el.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}
