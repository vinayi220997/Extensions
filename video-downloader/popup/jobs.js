// Downloads view: live progress of queued/running/finished jobs.
import { h, icon } from '../ui/dom.js';
import { formatBytes } from '../lib/util.js';
import { ctx, send, toast, ACTIVE } from './ctx.js';
import { setFooter } from './app.js';
import { onJobs as mediaOnJobs } from './media.js';

const $ = (id) => document.getElementById(id);
let jobs = [];
let signature = '';

export const activeCount = () => jobs.filter((j) => ACTIVE.includes(j.status)).length;
function setJobs(list) {
  jobs = list;
  ctx.jobs = list;
}

export async function init() {
  await refresh();
  // Direct (browser-managed) downloads report progress by polling: nudge the worker while any run.
  setInterval(() => {
    if (jobs.some((j) => j.engine !== 'offscreen' && ['downloading', 'paused'].includes(j.status))) refresh().catch(() => {});
  }, 1000);
}

export function show() { refresh(); }

export function onStorage(changes, area) {
  if (area === 'session' && changes.jobs) {
    setJobs(Object.values(changes.jobs.newValue || {}).sort((a, b) => b.createdAt - a.createdAt));
    render();
  }
}

async function refresh() {
  setJobs(await send({ type: 'get-jobs' }));
  render();
  mediaOnJobs();
}

function status(job) {
  const pct = Math.round((job.progress || 0) * 100);
  switch (job.status) {
    case 'queued': return ['Waiting…', ''];
    case 'starting': return ['Starting…', ''];
    case 'downloading':
      if (job.live) return [job.note || 'Recording…', formatBytes(job.bytes)];
      if (job.engine === 'browser' || job.engine === 'page') {
        return [job.total ? `${pct}%` : 'Downloading…', job.total ? `${formatBytes(job.bytes)} of ${formatBytes(job.total)}` : formatBytes(job.bytes)];
      }
      return [`${pct}%${job.segmentsTotal ? ` · ${job.segmentsDone || 0}/${job.segmentsTotal} segments` : ''}${job.note ? ` · ${job.note}` : ''}`, formatBytes(job.bytes)];
    case 'paused': return [`Paused · ${pct}%`, job.total ? `${formatBytes(job.bytes)} of ${formatBytes(job.total)}` : formatBytes(job.bytes)];
    case 'finalizing': return [job.note && /Merg|Extract/.test(job.note) ? `${job.note}…` : 'Saving file…', formatBytes(job.bytes)];
    case 'done': return ['Completed', formatBytes(job.total || job.bytes)];
    case 'error': return [job.error || 'Failed', ''];
    case 'cancelled': return ['Cancelled', ''];
    default: return [job.status, ''];
  }
}

async function openDownload(downloadId, showInFolder) {
  const exists = await send({ type: 'download-exists', downloadId }).catch(() => false);
  if (!exists) { toast('The file was moved or deleted', true); return; }
  await send({ type: 'open-download', downloadId, show: showInFolder }).catch((e) => toast(e.message, true));
}
export { openDownload };

function card(job) {
  const [left, right] = status(job);
  const indeterminate = ['queued', 'starting', 'finalizing'].includes(job.status) && job.status !== 'paused' || (job.live && job.status === 'downloading')
    || (job.status === 'downloading' && !job.progress && job.engine !== 'offscreen' && !job.total);
  const width = job.status === 'done' ? 100 : Math.round((job.progress || 0) * 100);
  const fileName = (job.finalPath || job.filename || job.baseName || '').split(/[\\/]/).pop();

  const actions = h('div', { class: 'actions' }, h('span', { class: 'spacer' }));
  if (ACTIVE.includes(job.status)) {
    if (job.live && job.status === 'downloading') {
      actions.append(h('button', { class: 'btn primary', onclick: () => send({ type: 'stop-live', jobId: job.id }).then(() => toast('Saving recording…')) }, icon('stop'), 'Stop & save'));
    }
    if (job.status === 'downloading' && !job.live && job.engine !== 'page') {
      actions.append(h('button', { class: 'btn', onclick: () => send({ type: 'pause', jobId: job.id }).catch((e) => toast(e.message, true)) }, icon('pause'), 'Pause'));
    } else if (job.status === 'paused') {
      actions.append(h('button', { class: 'btn primary', onclick: () => send({ type: 'resume', jobId: job.id }).catch((e) => toast(e.message, true)) }, icon('resume'), 'Resume'));
    }
    actions.append(h('button', { class: 'btn danger', onclick: () => send({ type: 'cancel', jobId: job.id }).catch((e) => toast(e.message, true)) }, 'Cancel'));
  } else if (job.status === 'done' && job.downloadId != null) {
    actions.append(
      h('button', { class: 'btn', onclick: () => openDownload(job.downloadId, false) }, icon('open'), 'Open'),
      h('button', { class: 'btn', onclick: () => openDownload(job.downloadId, true) }, icon('folder'), 'Show in folder'));
  } else if (job.status === 'error' || job.status === 'cancelled') {
    actions.append(h('button', { class: 'btn', onclick: () => send({ type: 'redownload', source: job.source }).then(() => toast('Retrying…')).catch((e) => toast(e.message, true)) }, icon('retry'), 'Retry'));
  }
  const statusClass = job.status === 'done' ? 'status-done' : job.status === 'error' ? 'status-error' : '';
  return h('article', { class: 'card' },
    h('div', { class: 'title', text: job.title, title: job.title }),
    h('div', { class: 'meta' },
      h('span', { class: 'chip kind', text: job.source.output === 'audio' ? 'audio' : job.kind === 'file' ? (job.source.ext || 'file') : job.kind }),
      job.label ? h('span', { text: job.label }) : null,
      fileName ? h('span', { class: 'ellipsis', text: fileName, title: job.finalPath || job.filename, style: { maxWidth: '210px' } }) : null),
    ACTIVE.includes(job.status) || job.status === 'done'
      ? h('div', { class: `progress${indeterminate ? ' indeterminate' : ''}` }, h('div', { style: { width: `${width}%` } }))
      : null,
    h('div', { class: 'status-line' }, h('span', { class: statusClass, text: left }), h('span', { text: right })),
    job.note && job.status === 'done' ? h('div', { class: `note ${/merged|extracted/i.test(job.note) ? 'info' : ''}` }, icon(/merged|extracted/i.test(job.note) ? 'check' : 'alert'), h('span', { text: job.note })) : null,
    actions);
}

function render() {
  $('jobsCount').textContent = activeCount() || '';
  const sig = JSON.stringify(jobs.map((j) => [j.id, j.status, j.engine, Math.round((j.progress || 0) * 200), j.bytes, j.note, j.segmentsDone]));
  if (sig !== signature) {
    signature = sig;
    $('jobsList').replaceChildren(...jobs.map(card));
    $('jobsEmpty').hidden = jobs.length > 0;
  }
  if (ctx.view === 'jobs') {
    const active = activeCount();
    setFooter(active ? `${active} active` : `${jobs.length} download${jobs.length === 1 ? '' : 's'}`,
      jobs.some((j) => !ACTIVE.includes(j.status)) ? 'Clear finished' : '',
      () => send({ type: 'clear-finished-jobs' }).then(refresh));
  }
}
