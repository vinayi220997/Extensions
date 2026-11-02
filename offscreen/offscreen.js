// Offscreen document: downloads HLS/DASH segments, decrypts AES-128, converts
// MPEG-TS → MP4 with mux.js, and hands a blob: URL back to the service worker.
import { parseM3U8, ivFromHex, ivFromSequence } from '../lib/hls.js';
import { parseMPD } from '../lib/dash.js';
import { mergeFragmented, extractAudio } from '../lib/mp4.js';

const active = new Map(); // jobId → { controller, stopRequested }
const MAX_LIVE_SECONDS = 4 * 3600;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  if (msg.type === 'start') {
    runJob(msg.job, msg.options || {});
    sendResponse({ ok: true });
  } else if (msg.type === 'cancel') {
    const j = active.get(msg.jobId);
    if (j) { j.cancelled = true; j.controller.abort(); }
    sendResponse({ ok: true });
  } else if (msg.type === 'stop') {
    const j = active.get(msg.jobId);
    if (j) j.stopRequested = true;
    sendResponse({ ok: true });
  } else if (msg.type === 'copy') {
    // Clipboard writes from the service worker (right-click "Copy media link").
    const ta = document.createElement('textarea');
    ta.value = msg.text || '';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    sendResponse({ ok });
  } else if (msg.type === 'revoke') {
    try { URL.revokeObjectURL(msg.url); } catch { /* ignore */ }
    sendResponse({ ok: true });
  }
  return false;
});

// Ask the service worker to send the page's Referer to every host the stream uses.
async function announceHosts(jobId, urls) {
  const hosts = new Set();
  for (const u of urls) { try { hosts.add(new URL(u).hostname); } catch { /* ignore */ } }
  if (hosts.size) await send('hosts', { jobId, hosts: [...hosts] });
}

function send(type, data) {
  return chrome.runtime.sendMessage({ target: 'background', from: 'offscreen', type, ...data }).catch(() => {});
}

class Cancelled extends Error {}
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Cancelled('cancelled')); }, { once: true });
});

// ---------------------------------------------------------------------------
// Networking with retries
// ---------------------------------------------------------------------------
async function fetchWithRetry(url, { signal, range, retries = 4, timeout = 30000, as = 'bytes' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new Cancelled('cancelled');
    const timer = new AbortController();
    const t = setTimeout(() => timer.abort(), timeout);
    try {
      const headers = {};
      if (range) headers.Range = range;
      const res = await fetch(url, {
        credentials: 'include',
        headers,
        signal: signal ? AbortSignal.any([signal, timer.signal]) : timer.signal
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${shortUrl(url)}`);
        err.status = res.status;
        throw err;
      }
      return as === 'text' ? await res.text() : new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (signal?.aborted) throw new Cancelled('cancelled');
      lastErr = e;
      if (e.status && [400, 401, 404, 410].includes(e.status)) break; // won't fix itself
      await sleep(Math.min(8000, 500 * 2 ** attempt), signal);
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr || new Error('Download failed');
}

function shortUrl(u) {
  try { const x = new URL(u); return x.hostname + x.pathname.slice(-40); } catch { return u; }
}

function byteRange(br) {
  if (!br) return undefined;
  if (typeof br === 'string') return `bytes=${br}`;
  return `bytes=${br.offset}-${br.offset + br.length - 1}`;
}

// ---------------------------------------------------------------------------
// Output sinks
// ---------------------------------------------------------------------------
// Raw concatenation (fMP4, DASH, packed audio, or original MPEG-TS).
function rawSink(type) {
  const parts = [];
  let size = 0;
  return {
    push(u8) { parts.push(new Blob([u8])); size += u8.byteLength; },
    get size() { return size; },
    finish() { return { blob: new Blob(parts, { type }), note: '' }; }
  };
}

// MPEG-TS / ADTS-AAC → fragmented MP4 using mux.js.
//  audioOnly=false: one fMP4 with all tracks; falls back to the raw .ts when conversion fails.
//  audioOnly=true:  keeps only the audio track (.m4a); no fallback.
function transmuxSink({ audioOnly = false } = {}) {
  const raw = rawSink('video/mp2t');
  const out = [];
  let outSize = 0;
  let initWritten = false;
  let failed = typeof muxjs === 'undefined';
  let transmuxer = null;
  let inSize = 0;
  if (!failed) {
    transmuxer = new muxjs.mp4.Transmuxer({ remux: !audioOnly, keepOriginalTimestamps: false });
    transmuxer.on('data', (seg) => {
      if (audioOnly && seg.type !== 'audio') return;
      if (!initWritten && seg.initSegment?.byteLength) { out.push(new Blob([seg.initSegment])); outSize += seg.initSegment.byteLength; initWritten = true; }
      if (seg.data?.byteLength) { out.push(new Blob([seg.data])); outSize += seg.data.byteLength; }
    });
  }
  return {
    push(u8) {
      inSize += u8.byteLength;
      if (!audioOnly) raw.push(u8);
      if (failed) return;
      try { transmuxer.push(u8); transmuxer.flush(); } catch (e) { console.warn('transmux failed', e); failed = true; }
    },
    get size() { return inSize; },
    finish() {
      if (audioOnly) {
        if (failed || !initWritten) throw new Error('No audio track could be extracted from this stream.');
        return { blob: new Blob(out, { type: 'audio/mp4' }), ext: 'm4a', note: '', fmp4: true };
      }
      // Sanity check: a successful remux keeps roughly the same payload size.
      if (!failed && initWritten && outSize > raw.size * 0.5) {
        return { blob: new Blob(out, { type: 'video/mp4' }), ext: 'mp4', note: '', fmp4: true };
      }
      const r = raw.finish();
      return { blob: r.blob, ext: 'ts', note: 'Saved as .ts (could not convert this stream to MP4)', fmp4: false };
    }
  };
}

// Feed out-of-order results to a sink in playback order. An entry may carry an
// init segment (fMP4 EXT-X-MAP); it is written whenever it changes.
function orderedFeeder(sink) {
  const pending = new Map();
  let next = 0;
  let lastInit = null;
  return (index, entry) => {
    pending.set(index, entry);
    while (pending.has(next)) {
      const e = pending.get(next);
      pending.delete(next);
      if (e) {
        if (e.init && e.init !== lastInit) { sink.push(e.init); lastInit = e.init; }
        sink.push(e.data);
      }
      next++;
    }
  };
}

async function runPool(count, concurrency, worker, signal) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, count) }, async () => {
    while (cursor < count) {
      if (signal.aborted) throw new Cancelled('cancelled');
      const i = cursor++;
      await worker(i);
    }
  });
  await Promise.all(runners);
}

// Progress reporter. `part(from, to)` returns a reporter whose 0..1 progress maps into [from, to]
// so multi-track jobs (video + audio) show one smooth bar.
function progressReporter(jobId) {
  let last = 0;
  let bytesBefore = 0;
  const base = (data, force = false) => {
    const now = Date.now();
    if (!force && now - last < 400) return;
    last = now;
    send('progress', { jobId, ...data });
  };
  base.part = (from, to, label = '') => {
    const r = (data, force) => base({
      ...data,
      progress: from + (to - from) * (data.progress || 0),
      bytes: bytesBefore + (data.bytes || 0),
      note: data.note || label
    }, force);
    r.done = (bytes) => { bytesBefore += bytes || 0; };
    return r;
  };
  return base;
}

// ---------------------------------------------------------------------------
// AES-128 (HLS clear-key encryption)
// ---------------------------------------------------------------------------
function keyCache(signal) {
  const cache = new Map();
  return (uri) => {
    if (!cache.has(uri)) {
      cache.set(uri, fetchWithRetry(uri, { signal }).then((raw) =>
        crypto.subtle.importKey('raw', raw, { name: 'AES-CBC' }, false, ['decrypt'])));
    }
    return cache.get(uri);
  };
}
async function decryptSegment(data, key, sequence, getKey) {
  const cryptoKey = await getKey(key.uri);
  const iv = key.iv ? ivFromHex(key.iv) : ivFromSequence(sequence);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, data));
}

// ---------------------------------------------------------------------------
// Jobs
//   source.kind   'hls' | 'dash' | 'file'
//   source.output 'auto' | 'video' (no merge) | 'audio' | 'ts'
//   source.audio  { url } (HLS alternate audio) or { repId } (DASH) → merged when output is 'auto'
// ---------------------------------------------------------------------------
async function runJob(job, options) {
  const state = { controller: new AbortController(), stopRequested: false, cancelled: false };
  active.set(job.id, state);
  try {
    const src = job.source;
    let result;
    if (src.kind === 'dash') result = await runDash(job, options, state);
    else if (src.kind === 'file') result = await runFileAudio(job, state);
    else result = await runHls(job, options, state);
    if (state.cancelled) return;
    const url = URL.createObjectURL(result.blob);
    await send('finished', { jobId: job.id, url, ext: result.ext, size: result.blob.size, note: result.note || '' });
  } catch (e) {
    state.controller.abort(); // stop the other parallel segment fetches
    if (e instanceof Cancelled || state.cancelled) return;
    console.error('[VidSnag offscreen]', e);
    await send('failed', { jobId: job.id, error: e.message || String(e) });
  } finally {
    active.delete(job.id);
  }
}

async function loadMediaPlaylist(url, signal) {
  let pl = parseM3U8(await fetchWithRetry(url, { signal, as: 'text' }), url);
  let finalUrl = url;
  if (pl.type === 'master') {
    // Context-menu downloads can point at a master playlist: take the best variant.
    const best = [...pl.variants].sort((a, b) => b.bandwidth - a.bandwidth)[0];
    if (!best) throw new Error('Playlist has no variants');
    finalUrl = best.url;
    pl = parseM3U8(await fetchWithRetry(best.url, { signal, as: 'text' }), best.url);
  }
  return { pl, url: finalUrl };
}

// mode: 'video' (user's HLS output setting), 'ts', 'audio' (audio only), 'fmp4' (for merging)
function makeHlsSink(pl, mode, options) {
  const packed = (pl.segments[0]?.url.match(/\.(aac|mp3|ac3|ec3)(?:\?|$)/i) || [])[1];
  if (pl.fmp4) {
    return { sink: rawSink(mode === 'audio' ? 'audio/mp4' : 'video/mp4'), ext: mode === 'audio' ? 'm4a' : 'mp4', fmp4: true };
  }
  if (packed) {
    if (/^aac$/i.test(packed) && (mode === 'fmp4' || mode === 'audio')) return { sink: transmuxSink({ audioOnly: true }), ext: 'm4a' };
    return { sink: rawSink(`audio/${packed}`), ext: packed.toLowerCase(), fmp4: false };
  }
  if (mode === 'audio') return { sink: transmuxSink({ audioOnly: true }), ext: 'm4a' };
  if (mode === 'ts' || (mode === 'video' && options.hlsOutput === 'ts')) return { sink: rawSink('video/mp2t'), ext: 'ts', fmp4: false };
  return { sink: transmuxSink(), ext: 'mp4' };
}

async function hlsTrack(job, url0, mode, options, state, report) {
  const { signal } = state.controller;
  const { pl, url } = await loadMediaPlaylist(url0, signal);
  if (pl.drm) throw new Error('This stream is DRM-protected and cannot be downloaded.');
  if (!pl.segments.length) throw new Error('The playlist has no segments');
  await announceHosts(job.id, [url, ...pl.segments.flatMap((x) => [x.url, x.key?.uri, x.map?.url]).filter(Boolean)]);
  const { sink, ext } = makeHlsSink(pl, mode, options);
  const getKey = keyCache(signal);

  const fetchSegment = async (seg) => {
    let data = await fetchWithRetry(seg.url, { signal, range: byteRange(seg.byterange) });
    if (seg.key) data = await decryptSegment(data, seg.key, seg.sequence, getKey);
    return data;
  };
  const initCache = new Map();
  const fetchInit = (map) => {
    const k = `${map.url}|${map.byterange ? map.byterange.offset : ''}`;
    if (!initCache.has(k)) initCache.set(k, fetchWithRetry(map.url, { signal, range: byteRange(map.byterange) }));
    return initCache.get(k);
  };

  if (pl.live) return { ...(await recordLive({ job, url, pl, sink, ext, state, fetchSegment, fetchInit, report })), live: true };

  const segs = pl.segments;
  const feed = orderedFeeder(sink);
  let done = 0;
  let failed = 0;
  const maxFailures = Math.floor(segs.length * 0.02); // tolerate a couple of dead segments in long VODs

  await runPool(segs.length, options.concurrency || 4, async (i) => {
    const seg = segs[i];
    let data;
    try {
      data = await fetchSegment(seg);
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      if (++failed > maxFailures) throw new Error(`Segment ${i + 1}/${segs.length} failed: ${e.message}`);
      data = null;
    }
    const init = data && seg.map ? await fetchInit(seg.map) : null;
    feed(i, data ? { data, init } : null);
    done++;
    report({ progress: done / segs.length, segmentsDone: done, segmentsTotal: segs.length, bytes: sink.size });
  }, signal);

  const res = sink.finish();
  report.done?.(sink.size);
  return {
    blob: res.blob,
    ext: res.ext || ext,
    fmp4: res.fmp4 ?? pl.fmp4,
    note: [res.note, failed ? `${failed} segment(s) skipped` : ''].filter(Boolean).join(' · ')
  };
}

async function runHls(job, options, state) {
  const src = job.source;
  const report = progressReporter(job.id);
  const output = src.output || 'auto';
  if (output === 'audio') {
    const r = await hlsTrack(job, src.url, 'audio', options, state, report.part(0, 1));
    report({ progress: 1, bytes: r.blob.size, finalizing: true }, true);
    return r;
  }
  if (output === 'auto' && src.audio && src.audio.url) {
    // Video rendition without sound + separate audio rendition → merge into one MP4.
    const v = await hlsTrack(job, src.url, 'fmp4', options, state, report.part(0, 0.8, 'Video track'));
    if (v.live) return v;
    const a = await hlsTrack(job, src.audio.url, 'fmp4', options, state, report.part(0.8, 0.98, 'Audio track'));
    report({ progress: 1, bytes: v.blob.size + a.blob.size, finalizing: true, note: 'Merging audio + video' }, true);
    return mergeTracks(v, a);
  }
  const mode = output === 'ts' ? 'ts' : 'video';
  const r = await hlsTrack(job, src.url, mode, options, state, report.part(0, 1));
  report({ progress: 1, bytes: r.blob.size, finalizing: true }, true);
  return r;
}

async function mergeTracks(v, a) {
  if (!v.fmp4 || !a.fmp4) {
    return { blob: v.blob, ext: v.ext, note: 'Saved the video track only (its audio format can’t be merged)' };
  }
  try {
    const merged = mergeFragmented(new Uint8Array(await v.blob.arrayBuffer()), new Uint8Array(await a.blob.arrayBuffer()));
    return { blob: new Blob([merged], { type: 'video/mp4' }), ext: 'mp4', note: 'Audio + video merged' };
  } catch (e) {
    console.warn('merge failed', e);
    return { blob: v.blob, ext: v.ext, note: `Saved the video track only (merge failed: ${e.message})` };
  }
}

async function recordLive({ job, url, pl, sink, ext, state, fetchSegment, fetchInit, report }) {
  const { signal } = state.controller;
  const started = Date.now();
  let lastSeq = -1;
  let lastMap = null;
  let recorded = 0;
  let current = pl;
  while (!state.stopRequested) {
    for (const seg of current.segments) {
      if (seg.sequence <= lastSeq) continue;
      if (state.stopRequested) break;
      let data;
      try { data = await fetchSegment(seg); } catch (e) { if (e instanceof Cancelled) throw e; continue; }
      if (seg.map && seg.map !== lastMap && (!lastMap || lastMap.url !== seg.map.url)) {
        sink.push(await fetchInit(seg.map));
        lastMap = seg.map;
      }
      sink.push(data);
      lastSeq = seg.sequence;
      recorded += seg.duration;
      report({ progress: 0, segmentsDone: lastSeq + 1, segmentsTotal: 0, bytes: sink.size, note: `Recording · ${Math.round(recorded)}s` });
    }
    if (current.endList || (Date.now() - started) / 1000 > MAX_LIVE_SECONDS) break;
    await sleep(Math.max(1000, (current.targetDuration || 4) * 500), signal);
    try {
      current = parseM3U8(await fetchWithRetry(url, { signal, as: 'text', retries: 2 }), url);
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      break; // stream ended / went away: keep what we have
    }
  }
  if (!sink.size) throw new Error('No live segments were recorded');
  report({ progress: 1, bytes: sink.size, finalizing: true }, true);
  const res = sink.finish();
  return { blob: res.blob, ext: res.ext || ext, note: `Live recording · ${Math.round(recorded)}s${res.note ? ' · ' + res.note : ''}` };
}

async function dashTrack(job, rep, options, state, report) {
  const { signal } = state.controller;
  const type = rep.ext === 'webm' ? 'video/webm' : rep.ext === 'weba' ? 'audio/webm' : rep.audioOnly ? 'audio/mp4' : 'video/mp4';
  const sink = rawSink(type);
  const plan = rep.plan;
  await announceHosts(job.id, plan.type === 'single' ? [plan.url]
    : [typeof plan.init === 'string' ? plan.init : plan.init?.url, ...plan.segments.map((x) => x.url)].filter(Boolean));

  if (plan.type === 'single') {
    const res = await fetch(plan.url, { credentials: 'include', signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sink.push(value);
      got += value.byteLength;
      report({ progress: total ? got / total : 0, bytes: got, total, segmentsDone: 0, segmentsTotal: 0 });
    }
  } else {
    const { init, segments } = plan;
    if (init) {
      const initUrl = typeof init === 'string' ? init : init.url;
      sink.push(await fetchWithRetry(initUrl, { signal, range: typeof init === 'string' ? undefined : byteRange(init.range) }));
    }
    const feed = orderedFeeder(sink);
    let done = 0;
    await runPool(segments.length, options.concurrency || 4, async (i) => {
      const seg = segments[i];
      const data = await fetchWithRetry(seg.url, { signal, range: byteRange(seg.range) });
      feed(i, { data });
      done++;
      report({ progress: done / segments.length, segmentsDone: done, segmentsTotal: segments.length, bytes: sink.size });
    }, signal);
  }
  const res = sink.finish();
  report.done?.(sink.size);
  return { blob: res.blob, ext: rep.ext, fmp4: !/webm|weba/.test(rep.ext) };
}

async function runDash(job, options, state) {
  const { signal } = state.controller;
  const src = job.source;
  const report = progressReporter(job.id);
  const mpd = parseMPD(await fetchWithRetry(src.url, { signal, as: 'text' }), src.url);
  if (mpd.drm) throw new Error('This stream is DRM-protected and cannot be downloaded.');
  if (mpd.live) throw new Error('Live DASH streams are not supported.');
  if (mpd.multiPeriod) throw new Error('Multi-period DASH (e.g. with ad breaks) is not supported.');
  const reps = mpd.representations;
  const audioReps = reps.filter((r) => r.audioOnly).sort((a, b) => b.bandwidth - a.bandwidth);
  const output = src.output || 'auto';

  if (output === 'audio') {
    const rep = reps.find((r) => r.id === src.repId && r.audioOnly) || audioReps[0];
    if (!rep) throw new Error('This stream has no separate audio track.');
    const r = await dashTrack(job, rep, options, state, report.part(0, 1));
    report({ progress: 1, bytes: r.blob.size, finalizing: true }, true);
    return { ...r, note: 'Audio track' };
  }
  const rep = reps.find((r) => r.id === src.repId)
    || [...reps].filter((r) => !r.audioOnly).sort((a, b) => b.bandwidth - a.bandwidth)[0]
    || reps[0];
  if (!rep) throw new Error('No representation found in the manifest');
  if (rep.audioOnly) {
    const r = await dashTrack(job, rep, options, state, report.part(0, 1));
    report({ progress: 1, bytes: r.blob.size, finalizing: true }, true);
    return { ...r, note: 'Audio track' };
  }
  const audioRep = output === 'auto' && src.audio
    ? (reps.find((r) => r.id === src.audio.repId && r.audioOnly) || audioReps.find((r) => r.ext === (rep.ext === 'webm' ? 'weba' : 'm4a')) || null)
    : null;
  if (audioRep) {
    const v = await dashTrack(job, rep, options, state, report.part(0, 0.85, 'Video track'));
    const a = await dashTrack(job, audioRep, options, state, report.part(0.85, 0.98, 'Audio track'));
    report({ progress: 1, bytes: v.blob.size + a.blob.size, finalizing: true, note: 'Merging audio + video' }, true);
    return mergeTracks(v, a);
  }
  const r = await dashTrack(job, rep, options, state, report.part(0, 1));
  report({ progress: 1, bytes: r.blob.size, finalizing: true }, true);
  return { ...r, note: audioReps.length ? 'Video track only (audio is a separate track)' : '' };
}

// Direct MP4/MOV file → audio-only .m4a (downloads the whole file, keeps only the audio samples).
async function runFileAudio(job, state) {
  const { signal } = state.controller;
  const report = progressReporter(job.id);
  await announceHosts(job.id, [job.source.url]);
  const res = await fetch(job.source.url, { credentials: 'include', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    report({ progress: total ? (got / total) * 0.95 : 0, bytes: got, total, segmentsDone: 0, segmentsTotal: 0, note: 'Downloading video to extract audio' });
  }
  report({ progress: 0.97, bytes: got, total, finalizing: true, note: 'Extracting audio' }, true);
  const bytes = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { bytes.set(c, o); o += c.byteLength; }
  let audio;
  try {
    audio = extractAudio(bytes);
  } catch (e) {
    throw new Error(`${e.message}. Audio extraction works for MP4/M4V/MOV files.`);
  }
  return { blob: new Blob([audio], { type: 'audio/mp4' }), ext: 'm4a', note: 'Audio extracted' };
}
