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
http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  log.push({ path: url.pathname, referer: req.headers.referer || '', origin: req.headers.origin || '' });
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
