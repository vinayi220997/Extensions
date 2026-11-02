// Shared state + helpers for the panel app (popup, sidebar, window, PiP, tab).
import { hostOf } from '../lib/util.js';

const params = new URLSearchParams(location.search);

export const ctx = {
  mode: ['popup', 'sidebar', 'window', 'pip', 'tab', 'float'].includes(params.get('mode')) ? params.get('mode') : 'popup',
  forcedTabId: Number(params.get('tabId')) || null,
  initialView: params.get('view') || '',
  tab: null,            // the browser tab whose media is shown
  settings: null,
  siteRules: { actions: {}, naming: {} },
  view: 'media',
  jobs: [],             // latest download jobs (kept by jobs.js)
  compact: false,       // Mini layout (sidebar/window "Mini" mode, and the floating panel)
  listeners: new Set()  // called when ctx.tab changes
};

export const ACTIVE = ['queued', 'starting', 'downloading', 'paused', 'finalizing'];

export async function send(msg) {
  const res = await chrome.runtime.sendMessage(msg);
  if (!res || !res.ok) throw new Error(res?.error || 'Something went wrong');
  return res.result;
}

let toastTimer = null;
export function toast(text, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, isError ? 4500 : 2200);
}

export async function copyText(text, label = 'Link copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    // Panels opened without focus (e.g. PiP) may block the async clipboard API.
    try { const ok = await send({ type: 'copy-text', text }); toast(ok ? label : 'Could not copy', !ok); } catch { toast('Could not copy the link', true); }
  }
}

export function fileNameOf(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop()) || hostOf(url); } catch { return hostOf(url); }
}

export function store(key, value) {
  try { if (value === undefined) return JSON.parse(localStorage.getItem(`vs:${key}`)); localStorage.setItem(`vs:${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ }
  return undefined;
}

export function onTabChange(fn) { ctx.listeners.add(fn); }

// Main-button action: a per-site rule wins over the global default (Settings › Default action).
export function siteAction(host) {
  return ctx.siteRules.actions[(host || '').toLowerCase()] || ctx.settings?.defaultAction || 'download';
}
export function siteRuleFor(host) {
  return ctx.siteRules.actions[(host || '').toLowerCase()] || null;
}

export function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
