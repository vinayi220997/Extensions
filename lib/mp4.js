// ISO-BMFF (MP4) helpers, dependency-free:
//  - mergeFragmented(video, audio): merge two fragmented MP4s (DASH reps, fMP4 HLS,
//    or mux.js output) into one fMP4 with both tracks. No re-encoding.
//  - extractAudio(mp4): turn a regular (progressive) MP4 into an audio-only .m4a.
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf', 'edts', 'dinf']);

function u32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
function u64(b, o) { return u32(b, o) * 2 ** 32 + u32(b, o + 4); }
function w32(b, o, v) { b[o] = (v >>> 24) & 255; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255; }
function w64(b, o, v) { w32(b, o, Math.floor(v / 2 ** 32)); w32(b, o + 4, v >>> 0); }
function type(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }

export function readBoxes(b, start = 0, end = b.length) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = u32(b, p);
    const t = type(b, p + 4);
    let header = 8;
    if (size === 1) { size = u64(b, p + 8); header = 16; } else if (size === 0) size = end - p;
    if (size < header || p + size > end) break; // truncated / garbage
    out.push({ type: t, start: p, size, header, end: p + size });
    p += size;
  }
  return out;
}

const children = (b, box) => readBoxes(b, box.start + box.header, box.end);
function child(b, box, t) { return children(b, box).find((c) => c.type === t) || null; }
function path(b, box, ...types) {
  let cur = box;
  for (const t of types) { cur = cur && child(b, cur, t); if (!cur) return null; }
  return cur;
}
const slice = (b, box) => b.slice(box.start, box.end);

function concat(parts) {
  const len = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

function makeBox(t, payloadParts) {
  const len = 8 + payloadParts.reduce((s, p) => s + p.byteLength, 0);
  const head = new Uint8Array(8);
  w32(head, 0, len);
  for (let i = 0; i < 4; i++) head[4 + i] = t.charCodeAt(i);
  return concat([head, ...payloadParts]);
}

// --- track helpers (offsets are relative to the start of the given box bytes) ---
function tkhdIdOffset(b, tkhd) { return tkhd.start + tkhd.header + (b[tkhd.start + tkhd.header] === 1 ? 20 : 12); }
function trackId(b, trak) { const t = child(b, trak, 'tkhd'); return t ? u32(b, tkhdIdOffset(b, t)) : 0; }
function handler(b, trak) { const h = path(b, trak, 'mdia', 'hdlr'); return h ? type(b, h.start + h.header + 8) : ''; }
function timescale(b, trak) {
  const m = path(b, trak, 'mdia', 'mdhd');
  if (!m) return 0;
  return u32(b, m.start + m.header + (b[m.start + m.header] === 1 ? 20 : 12));
}

export function describe(bytes) {
  const top = readBoxes(bytes);
  const moov = top.find((x) => x.type === 'moov');
  if (!moov) return { tracks: [], fragmented: false };
  const tracks = children(bytes, moov).filter((c) => c.type === 'trak')
    .map((t) => ({ id: trackId(bytes, t), handler: handler(bytes, t), timescale: timescale(bytes, t) }));
  return { tracks, fragmented: !!child(bytes, moov, 'mvex') || top.some((x) => x.type === 'moof') };
}

// Split the top level into init info + fragments [{moof, parts:[boxes...]}].
function fragmentsOf(b) {
  const top = readBoxes(b);
  const frags = [];
  let cur = null;
  for (const box of top) {
    if (box.type === 'moof') { cur = { moof: box, parts: [box] }; frags.push(cur); }
    else if (box.type === 'mdat' && cur) cur.parts.push(box);
    // ftyp/moov are read separately; styp/sidx/emsg/free are dropped
  }
  return { top, frags };
}

function fragTime(b, frag, timescales) {
  const traf = child(b, frag.moof, 'traf');
  if (!traf) return NaN;
  const tfhd = child(b, traf, 'tfhd');
  const tfdt = child(b, traf, 'tfdt');
  if (!tfhd || !tfdt) return NaN;
  const id = u32(b, tfhd.start + tfhd.header + 4);
  const v = b[tfdt.start + tfdt.header];
  const t = v === 1 ? u64(b, tfdt.start + tfdt.header + 4) : u32(b, tfdt.start + tfdt.header + 4);
  return t / (timescales.get(id) || 1);
}

// Copy a fragment, remapping tfhd track ids. Returns { bytes, baseFixups: [[offsetInBytes, oldBase]] }.
function copyFragment(b, frag, idMap) {
  const parts = frag.parts.map((p) => slice(b, p));
  const moofBytes = parts[0];
  const fix = [];
  const moofBox = { start: 0, size: moofBytes.length, header: frag.moof.header, end: moofBytes.length };
  for (const traf of children(moofBytes, moofBox).filter((c) => c.type === 'traf')) {
    const tfhd = child(moofBytes, traf, 'tfhd');
    if (!tfhd) continue;
    const base = tfhd.start + tfhd.header;
    const flags = (moofBytes[base + 1] << 16) | (moofBytes[base + 2] << 8) | moofBytes[base + 3];
    const id = u32(moofBytes, base + 4);
    if (idMap.has(id)) w32(moofBytes, base + 4, idMap.get(id));
    if (flags & 1) fix.push(base + 8); // explicit base_data_offset (absolute file offset)
  }
  return { parts, moofBytes, fix, oldPos: frag.moof.start };
}

/**
 * Merge two fragmented MP4 files (e.g. a video-only and an audio-only rendition) into one.
 * Throws if either input isn't fragmented MP4.
 */
export function mergeFragmented(videoBytes, audioBytes) {
  const V = fragmentsOf(videoBytes);
  const A = fragmentsOf(audioBytes);
  const vMoov = V.top.find((x) => x.type === 'moov');
  const aMoov = A.top.find((x) => x.type === 'moov');
  if (!vMoov || !aMoov) throw new Error('Missing MP4 header (moov) in one of the tracks');
  const vMvex = child(videoBytes, vMoov, 'mvex');
  const aMvex = child(audioBytes, aMoov, 'mvex');
  if (!vMvex || !aMvex) throw new Error('Tracks are not fragmented MP4');

  const vKids = children(videoBytes, vMoov);
  const vTraks = vKids.filter((c) => c.type === 'trak');
  let aTraks = children(audioBytes, aMoov).filter((c) => c.type === 'trak');
  const soun = aTraks.filter((t) => handler(audioBytes, t) === 'soun');
  if (soun.length) aTraks = soun;
  if (!aTraks.length || !vTraks.length) throw new Error('No tracks to merge');

  const timescales = new Map();
  const vIds = vTraks.map((t) => trackId(videoBytes, t));
  vTraks.forEach((t, i) => timescales.set(vIds[i], timescale(videoBytes, t)));
  let nextId = Math.max(...vIds) + 1;
  const idMap = new Map();
  const newATraks = [];
  const aTimescales = new Map();
  for (const t of aTraks) {
    const old = trackId(audioBytes, t);
    const nid = nextId++;
    idMap.set(old, nid);
    aTimescales.set(old, timescale(audioBytes, t));
    timescales.set(nid, timescale(audioBytes, t));
    const copy = slice(audioBytes, t);
    const tk = child(copy, { start: 0, header: 8, end: copy.length, size: copy.length }, 'tkhd');
    w32(copy, tkhdIdOffset(copy, tk), nid);
    newATraks.push(copy);
  }
  const aTrex = children(audioBytes, aMvex).filter((c) => c.type === 'trex' && idMap.has(u32(audioBytes, c.start + 12)))
    .map((c) => { const x = slice(audioBytes, c); w32(x, 12, idMap.get(u32(x, 12))); return x; });

  const mvhd = vKids.find((c) => c.type === 'mvhd');
  const mvhdBytes = slice(videoBytes, mvhd);
  w32(mvhdBytes, mvhdBytes.length - 4, nextId);
  const mvex = makeBox('mvex', [...children(videoBytes, vMvex).map((c) => slice(videoBytes, c)), ...aTrex]);
  const others = vKids.filter((c) => !['mvhd', 'trak', 'mvex', 'pssh'].includes(c.type)).map((c) => slice(videoBytes, c));
  const moov = makeBox('moov', [mvhdBytes, ...vTraks.map((t) => slice(videoBytes, t)), ...newATraks, ...others, mvex]);
  const ftypBox = V.top.find((x) => x.type === 'ftyp');
  const ftyp = ftypBox ? slice(videoBytes, ftypBox) : makeBox('ftyp', [new TextEncoder().encode('isom'), new Uint8Array([0, 0, 2, 0]), new TextEncoder().encode('isomiso6mp41')]);

  const frags = [
    ...V.frags.map((f, i) => ({ f, src: videoBytes, map: new Map(), t: fragTime(videoBytes, f, timescales), i, s: 0 })),
    ...A.frags.map((f, i) => ({ f, src: audioBytes, map: idMap, t: fragTime(audioBytes, f, aTimescales), i, s: 1 }))
  ];
  const timed = frags.every((x) => Number.isFinite(x.t));
  if (timed) frags.sort((x, y) => x.t - y.t || x.s - y.s || x.i - y.i);

  const out = [ftyp, moov];
  let pos = ftyp.length + moov.length;
  let seq = 1;
  for (const x of frags) {
    const c = copyFragment(x.src, x.f, x.map);
    const mfhd = child(c.moofBytes, { start: 0, header: 8, end: c.moofBytes.length, size: c.moofBytes.length }, 'mfhd');
    if (mfhd) w32(c.moofBytes, mfhd.start + 12, seq++);
    for (const off of c.fix) w64(c.moofBytes, off, u64(c.moofBytes, off) - c.oldPos + pos);
    for (const p of c.parts) { out.push(p); pos += p.byteLength; }
  }
  return concat(out);
}

/**
 * Extract the first audio track of a progressive (non-fragmented) MP4 into an .m4a.
 * Rebuilds mdat with only the audio chunks and rewrites the chunk offset table.
 */
export function extractAudio(bytes) {
  const top = readBoxes(bytes);
  const moov = top.find((x) => x.type === 'moov');
  if (!moov) throw new Error('Not an MP4 file');
  if (child(bytes, moov, 'mvex')) throw new Error('Audio extraction is not supported for fragmented MP4 files');
  const traks = children(bytes, moov).filter((c) => c.type === 'trak');
  const trak = traks.find((t) => handler(bytes, t) === 'soun');
  if (!trak) throw new Error('This video has no audio track');
  const stbl = path(bytes, trak, 'mdia', 'minf', 'stbl');
  const stsz = stbl && child(bytes, stbl, 'stsz');
  const stsc = stbl && child(bytes, stbl, 'stsc');
  const stco = stbl && (child(bytes, stbl, 'stco') || child(bytes, stbl, 'co64'));
  if (!stsz || !stsc || !stco) throw new Error('Unsupported MP4 layout');

  // sample sizes
  let p = stsz.start + stsz.header + 4;
  const fixedSize = u32(bytes, p);
  const sampleCount = u32(bytes, p + 4);
  const sizeAt = fixedSize ? () => fixedSize : (i) => u32(bytes, p + 8 + i * 4);
  // chunk offsets
  const is64 = stco.type === 'co64';
  const cp = stco.start + stco.header + 4;
  const chunkCount = u32(bytes, cp);
  const offsets = Array.from({ length: chunkCount }, (_, i) => (is64 ? u64(bytes, cp + 4 + i * 8) : u32(bytes, cp + 4 + i * 4)));
  // samples per chunk (stsc runs)
  const sp = stsc.start + stsc.header + 4;
  const runs = Array.from({ length: u32(bytes, sp) }, (_, i) => ({ first: u32(bytes, sp + 4 + i * 12), n: u32(bytes, sp + 8 + i * 12) }));
  const chunkSizes = [];
  let sample = 0;
  for (let c = 1; c <= chunkCount; c++) {
    let n = 0;
    for (const r of runs) if (r.first <= c) n = r.n;
    let size = 0;
    for (let k = 0; k < n && sample < sampleCount; k++) size += sizeAt(sample++);
    chunkSizes.push(size);
  }

  const mvhd = children(bytes, moov).find((c) => c.type === 'mvhd');
  const trakBytes = slice(bytes, trak);
  const moovLen = 8 + mvhd.size + trakBytes.length;
  const ftypBox = top.find((x) => x.type === 'ftyp');
  const ftyp = ftypBox ? slice(bytes, ftypBox) : new Uint8Array(0);
  const payload = chunkSizes.reduce((s, x) => s + x, 0);
  const large = payload + 8 > 0xffffffff;
  const mdatHeader = new Uint8Array(large ? 16 : 8);
  if (large) { w32(mdatHeader, 0, 1); w64(mdatHeader, 8, payload + 16); } else w32(mdatHeader, 0, payload + 8);
  mdatHeader.set([0x6d, 0x64, 0x61, 0x74], 4);
  let dataPos = ftyp.length + moovLen + mdatHeader.length;
  if (!is64 && dataPos + payload > 0xffffffff) throw new Error('File too large');

  // Patch chunk offsets inside the copied trak (same relative position as in the source).
  const rel = cp - trak.start;
  const chunks = [];
  for (let i = 0; i < chunkCount; i++) {
    if (is64) w64(trakBytes, rel + 4 + i * 8, dataPos); else w32(trakBytes, rel + 4 + i * 4, dataPos);
    chunks.push(bytes.subarray(offsets[i], offsets[i] + chunkSizes[i]));
    dataPos += chunkSizes[i];
  }
  const newMoov = makeBox('moov', [slice(bytes, mvhd), trakBytes]);
  return concat([ftyp, newMoov, mdatHeader, ...chunks]);
}
