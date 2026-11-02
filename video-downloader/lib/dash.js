// Minimal MPEG-DASH (MPD) parser. Works in the service worker, which has no DOMParser,
// so it ships its own tiny XML reader.
import { resolveUrl, resolutionLabel } from './util.js';
import { DRM_SYSTEMS, MP4_PROTECTION_SCHEME, normalizeUuid, systemFromUuid, parsePssh, base64ToBytes } from './drm.js';

// ---------- tiny XML reader ----------
function decodeEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
    const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (map[e]) return map[e];
    if (e[1] === 'x' || e[1] === 'X') return String.fromCodePoint(parseInt(e.slice(2), 16));
    return String.fromCodePoint(parseInt(e.slice(1), 10));
  });
}

export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/\s*([\w:.-]+)\s*>|<\s*([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const node = { name: m[3].replace(/^.*:/, ''), attrs: {}, children: [], text: '' };
      const ar = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a;
      while ((a = ar.exec(m[4]))) node.attrs[a[1].replace(/^.*:/, '')] = decodeEntities(a[3] ?? a[4] ?? '');
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6]) top.text += decodeEntities(m[6]);
  }
  return root;
}

const kids = (n, name) => (n ? n.children.filter((c) => c.name === name) : []);
const kid = (n, name) => kids(n, name)[0] || null;

export function parseIsoDuration(s) {
  if (!s) return 0;
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s.trim());
  if (!m) return 0;
  return (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Number(m[4] || 0);
}

// ---------- MPD → representations ----------
export function parseMPD(xml, manifestUrl) {
  const doc = parseXml(xml);
  const mpd = kid(doc, 'MPD');
  if (!mpd) throw new Error('Not a DASH manifest');
  const live = (mpd.attrs.type || 'static') === 'dynamic';
  const duration = parseIsoDuration(mpd.attrs.mediaPresentationDuration);
  let base = manifestUrl;
  const mpdBase = kid(mpd, 'BaseURL');
  if (mpdBase) base = resolveUrl(mpdBase.text.trim(), base);

  const period = kid(mpd, 'Period');
  if (!period) throw new Error('DASH manifest has no Period');
  const periodBase = kid(period, 'BaseURL') ? resolveUrl(kid(period, 'BaseURL').text.trim(), base) : base;
  const periodDuration = parseIsoDuration(period.attrs.duration) || duration;

  const reps = [];
  let drm = false;
  const drmInfo = { systems: [], keySystems: [], schemes: [], kids: [], licenseUrls: [], protocols: ['DASH'], sources: ['manifest'] };
  const addProtection = (cps) => {
    for (const cp of cps) {
      drm = true;
      const scheme = (cp.attrs.schemeIdUri || '').toLowerCase();
      if (scheme === MP4_PROTECTION_SCHEME) {
        if (cp.attrs.value) drmInfo.schemes.push(cp.attrs.value.toLowerCase());
        if (cp.attrs.default_KID) drmInfo.kids.push(cp.attrs.default_KID.toLowerCase().replace(/-/g, ''));
      } else if (scheme.startsWith('urn:uuid:')) {
        drmInfo.systems.push(systemFromUuid(scheme));
        const ks = DRM_SYSTEMS[normalizeUuid(scheme)]?.keySystem;
        if (ks) drmInfo.keySystems.push(ks);
      }
      for (const c of cp.children) {
        if (c.name === 'pssh' && c.text.trim()) {
          for (const p of parsePssh(base64ToBytes(c.text))) { drmInfo.systems.push(p.system); drmInfo.kids.push(...p.kids); }
        }
        if (/^(laurl|la_url)$/i.test(c.name)) {
          const u = (c.attrs.licenseUrl || c.text || '').trim();
          if (/^https?:/i.test(u)) drmInfo.licenseUrls.push(u.split('?')[0]);
        }
      }
      for (const k of ['licenseAcquisitionUrl', 'laUrl', 'Laurl']) if (/^https?:/i.test(cp.attrs[k] || '')) drmInfo.licenseUrls.push(cp.attrs[k].split('?')[0]);
    }
  };
  for (const set of kids(period, 'AdaptationSet')) {
    addProtection(kids(set, 'ContentProtection'));
    const setBase = kid(set, 'BaseURL') ? resolveUrl(kid(set, 'BaseURL').text.trim(), periodBase) : periodBase;
    const setMime = set.attrs.mimeType || '';
    const setType = set.attrs.contentType || setMime.split('/')[0];
    if (setType === 'text' || setType === 'image' || /text|ttml|vtt|image/.test(setMime)) continue;
    for (const rep of kids(set, 'Representation')) {
      addProtection(kids(rep, 'ContentProtection'));
      const mime = rep.attrs.mimeType || setMime;
      const type = (rep.attrs.contentType || setType || mime.split('/')[0] || '').toLowerCase();
      const repBase = kid(rep, 'BaseURL') ? resolveUrl(kid(rep, 'BaseURL').text.trim(), setBase) : setBase;
      const width = Number(rep.attrs.width || set.attrs.width) || 0;
      const height = Number(rep.attrs.height || set.attrs.height) || 0;
      const codecs = rep.attrs.codecs || set.attrs.codecs || '';
      const audioOnly = type === 'audio' || (!height && /mp4a|opus|vorbis|ac-3|ec-3/.test(codecs));
      const plan = segmentPlan({ rep, set, period, repBase, duration: periodDuration });
      reps.push({
        id: rep.attrs.id || String(reps.length),
        bandwidth: Number(rep.attrs.bandwidth) || 0,
        width, height, codecs, mimeType: mime,
        audioOnly,
        lang: set.attrs.lang || '',
        ext: /webm/.test(mime) ? (audioOnly ? 'weba' : 'webm') : (audioOnly ? 'm4a' : 'mp4'),
        plan
      });
    }
  }
  const multiPeriod = kids(mpd, 'Period').length > 1;
  for (const k of Object.keys(drmInfo)) drmInfo[k] = [...new Set(drmInfo[k].filter(Boolean))];
  return { live, duration: periodDuration, drm, drmInfo: drm ? drmInfo : null, multiPeriod, representations: reps };
}

function fillTemplate(tpl, vars) {
  return tpl.replace(/\$(RepresentationID|Number|Time|Bandwidth)(?:%0(\d+)d)?\$/g, (m, name, width) => {
    const v = String(vars[name] ?? '');
    return width ? v.padStart(Number(width), '0') : v;
  }).replace(/\$\$/g, '$');
}

// Merge SegmentTemplate attributes from Period → AdaptationSet → Representation.
function mergedTemplate(period, set, rep) {
  const nodes = [kid(period, 'SegmentTemplate'), kid(set, 'SegmentTemplate'), kid(rep, 'SegmentTemplate')].filter(Boolean);
  if (!nodes.length) return null;
  const attrs = Object.assign({}, ...nodes.map((n) => n.attrs));
  const timeline = nodes.map((n) => kid(n, 'SegmentTimeline')).filter(Boolean).pop() || null;
  return { attrs, timeline };
}

function segmentPlan({ rep, set, period, repBase, duration }) {
  const vars = { RepresentationID: rep.attrs.id, Bandwidth: rep.attrs.bandwidth };
  const tpl = mergedTemplate(period, set, rep);
  if (tpl && tpl.attrs.media) {
    const a = tpl.attrs;
    const timescale = Number(a.timescale) || 1;
    const startNumber = a.startNumber !== undefined ? Number(a.startNumber) : 1;
    const init = a.initialization ? resolveUrl(fillTemplate(a.initialization, vars), repBase) : null;
    const segments = [];
    if (tpl.timeline) {
      let t = 0;
      let n = startNumber;
      for (const s of kids(tpl.timeline, 'S')) {
        if (s.attrs.t !== undefined) t = Number(s.attrs.t);
        const d = Number(s.attrs.d);
        let r = Number(s.attrs.r || 0);
        if (r < 0) r = Math.max(0, Math.ceil((duration * timescale - t) / d) - 1);
        for (let i = 0; i <= r; i++) {
          segments.push({ url: resolveUrl(fillTemplate(a.media, { ...vars, Number: n, Time: t }), repBase) });
          t += d; n++;
        }
      }
    } else if (a.duration) {
      const segDur = Number(a.duration) / timescale;
      const count = Math.max(1, Math.ceil(duration / segDur - 1e-6));
      for (let i = 0; i < count; i++) {
        const n = startNumber + i;
        segments.push({ url: resolveUrl(fillTemplate(a.media, { ...vars, Number: n, Time: Math.round(i * Number(a.duration)) }), repBase) });
      }
    }
    return { type: 'segments', init, segments };
  }
  const list = kid(rep, 'SegmentList') || kid(set, 'SegmentList');
  if (list) {
    const initNode = kid(list, 'Initialization');
    const init = initNode
      ? { url: resolveUrl(initNode.attrs.sourceURL || '', repBase), range: initNode.attrs.range || null }
      : null;
    const segments = kids(list, 'SegmentURL').map((s) => ({
      url: resolveUrl(s.attrs.media || '', repBase),
      range: s.attrs.mediaRange || null
    }));
    return { type: 'segments', init: init && init.range ? init : init && init.url, segments };
  }
  // SegmentBase / plain BaseURL: the whole representation is one file
  return { type: 'single', url: repBase };
}

export function dashRepLabel(r) {
  if (r.audioOnly) {
    return `Audio only${r.lang ? ` (${r.lang})` : ''}${r.bandwidth ? ` · ${Math.round(r.bandwidth / 1000)} kbps` : ''}`;
  }
  const parts = [];
  const res = resolutionLabel(r.height, r.width);
  if (res) parts.push(res);
  if (r.bandwidth) parts.push(`${(r.bandwidth / 1e6).toFixed(1)} Mbps`);
  return parts.join(' · ') || r.id;
}
