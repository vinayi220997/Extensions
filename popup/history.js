// History view: finished and failed downloads.
import { h, iconButton } from '../ui/dom.js';
import { confirmDialog } from '../ui/dialog.js';
import { formatBytes } from '../lib/util.js';
import { ctx, send, toast, copyText } from './ctx.js';
import { setFooter } from './app.js';
import { openDownload } from './jobs.js';

const $ = (id) => document.getElementById(id);
let history = [];

export function init() {
  $('historySearch').addEventListener('input', render);
}
export async function show() {
  history = await send({ type: 'get-history' });
  render();
}
export function onStorage(changes, area) {
  if (area === 'local' && changes.history) {
    history = changes.history.newValue || [];
    if (ctx.view === 'history') render();
  }
}

function card(entry) {
  const date = new Date(entry.finishedAt);
  const fileName = (entry.filename || '').split(/[\\/]/).pop();
  const ok = entry.status === 'done';
  return h('article', { class: 'card' },
    h('div', { class: 'title', text: entry.title, title: entry.title }),
    h('div', { class: 'meta' },
      h('span', { class: `chip ${ok ? 'kind' : 'live'}`, text: ok ? 'Saved' : 'Failed' }),
      h('span', { text: `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` }),
      entry.label ? h('span', { text: entry.label }) : null,
      entry.size ? h('span', { text: formatBytes(entry.size) }) : null),
    fileName ? h('div', { class: 'muted ellipsis', style: { marginTop: '4px', fontSize: '.92em' }, text: fileName, title: entry.filename }) : null,
    !ok && entry.error ? h('div', { class: 'note error' }, h('span', { text: entry.error })) : null,
    h('div', { class: 'actions' },
      ok && entry.downloadId != null ? iconButton('open', 'Open file', () => openDownload(entry.downloadId, false)) : null,
      ok && entry.downloadId != null ? iconButton('folder', 'Show in folder', () => openDownload(entry.downloadId, true)) : null,
      h('span', { class: 'spacer' }),
      iconButton('copy', 'Copy source link', () => copyText(entry.url)),
      entry.pageUrl ? iconButton('globe', 'Open the page', () => chrome.tabs.create({ url: entry.pageUrl })) : null,
      iconButton('retry', 'Download again', () => send({ type: 'redownload', source: entry.source }).then(() => toast('Download started')).catch((e) => toast(e.message, true))),
      iconButton('trash', 'Remove from history', () => send({ type: 'remove-history', id: entry.id }))));
}

function render() {
  const q = $('historySearch').value.trim().toLowerCase();
  const items = q ? history.filter((e) => `${e.title} ${e.filename} ${e.pageUrl}`.toLowerCase().includes(q)) : history;
  $('historyList').replaceChildren(...items.slice(0, 200).map(card));
  $('historyEmpty').hidden = items.length > 0;
  $('historyEmptyText').textContent = ctx.settings && !ctx.settings.historyEnabled
    ? 'History is turned off in Settings.'
    : q ? 'No matches.' : 'Finished downloads are listed here.';
  if (ctx.view === 'history') {
    setFooter(`${history.length} item${history.length === 1 ? '' : 's'}`, history.length ? 'Clear history' : '', async () => {
      if (await confirmDialog('Clear history', 'Remove all entries from the download history? Files on disk are kept.', 'Clear history', true)) {
        await send({ type: 'clear-history' });
      }
    });
  }
}
