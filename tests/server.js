// Local test site for VidSnag: Range support, Referer-protected folder, simulated live HLS.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8765;
const TYPES = { '.html': 'text/html', '.mp4': 'video/mp4', '.webm': 'video/webm', '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t', '.mpd': 'application/dash+xml', '.m4s': 'video/iso.segment', '.bin': 'application/octet-stream', '.js': 'text/javascript' };
// Simulated live stream: starts at the first playlist request, 2 s per segment, 30 segments.
let START = 0;
const LIVE_DIR = path.join(ROOT, 'media/live');
const LIVE_SEGS = fs.readdirSync(LIVE_DIR).filter((f) => /^l_\d+\.ts$/.test(f)).sort();
const log = [];
let TOKEN = 'tok1';
http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  log.push({ path: url.pathname, referer: req.headers.referer || '', origin: req.headers.origin || '' });
  // Expiring links: /token/<t>/big.mp4 only works for the current token; /__rotate issues a new one.
  if (url.pathname === '/__rotate') { TOKEN = Math.random().toString(36).slice(2, 10); res.writeHead(200); return res.end(TOKEN); }
  if (url.pathname === '/page-token.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Token test</title></head><body><h1>Expiring video</h1><video controls src="/token/${TOKEN}/big.mp4" preload="metadata"></video></body></html>`);
  }
  let tm;
  if ((tm = /^\/token\/([a-z0-9]+)\/big\.mp4$/.exec(url.pathname))) {
    if (tm[1] !== TOKEN) { res.writeHead(403); return res.end('expired'); }
    req.url = '/media/big.mp4';
    url.pathname = '/media/big.mp4';
  }
  // Throttled routes so downloads can be paused in tests.
  if (url.pathname === '/slow/big.mp4') {
    const f = path.join(ROOT, 'media/big.mp4');
    const size = fs.statSync(f).size;
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': size, 'accept-ranges': 'bytes' });
    const data = fs.readFileSync(f);
    let off = 0;
    const tick = () => {
      if (res.destroyed) return;
      if (off >= size) return res.end();
      const chunk = data.subarray(off, off + 64 * 1024);
      off += chunk.length;
      if (res.write(chunk)) setTimeout(tick, 120); else res.once('drain', () => setTimeout(tick, 120));
    };
    tick();
    return;
  }
  let sm;
  if ((sm = /^\/slowhls\/(360(?:_\d+\.ts|\.m3u8))$/.exec(url.pathname))) {
    const f = path.join(ROOT, 'media/hls', sm[1]);
    return setTimeout(() => {
      res.writeHead(200, { 'content-type': sm[1].endsWith('.ts') ? 'video/mp2t' : 'application/vnd.apple.mpegurl' });
      fs.createReadStream(f).pipe(res);
    }, sm[1].endsWith('.ts') ? 900 : 0);
  }
  // Extension-less API endpoint that serves a video (only a rule addon can recognise it).
  if (url.pathname === '/api/media/7/stream') {
    const f = path.join(ROOT, 'media/big.mp4');
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': fs.statSync(f).size });
    return fs.createReadStream(f).pipe(res);
  }
  if (url.pathname === '/__log') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(log)); }
  if (url.pathname === '/live/live.m3u8') {
    if (!START || Date.now() - START > 50000) START = Date.now();
    const n = Math.floor((Date.now() - START) / 2000);
    let body = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:' + n + '\n';
    for (let i = n; i < n + 3; i++) body += `#EXTINF:2.0,\n/live/seg${i}.ts\n`;
    res.writeHead(200, { 'content-type': TYPES['.m3u8'], 'cache-control': 'no-store' });
    return res.end(body);
  }
  let m;
  if ((m = /^\/live\/seg(\d+)\.ts$/.exec(url.pathname))) {
    const f = path.join(LIVE_DIR, LIVE_SEGS[Number(m[1]) % LIVE_SEGS.length]);
    res.writeHead(200, { 'content-type': TYPES['.ts'] });
    return fs.createReadStream(f).pipe(res);
  }
  if (url.pathname.startsWith('/media/protected/') && !(req.headers.referer || '').startsWith(`http://localhost:${PORT}/`)) {
    res.writeHead(403); return res.end('forbidden: bad referer');
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  const size = fs.statSync(file).size;
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('test site on', PORT));
