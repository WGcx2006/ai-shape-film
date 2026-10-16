import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { root, settings } from './runtime.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.otf': 'font/otf', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (pathname === '/__film_health') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ project: 'ai-shape-film', root, duration: settings.duration })); return; }
  const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  const relative = path.relative(root, filename);
  if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403).end(); return; }
  let stat;
  try { stat = fs.statSync(filename); if (!stat.isFile()) throw new Error('not a file'); } catch { res.writeHead(404).end('Not found'); return; }
  const headers = { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
  let start = 0, end = stat.size - 1, status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
    if (match[1]) { start = Number(match[1]); if (match[2]) end = Number(match[2]); }
    else start = Math.max(0, stat.size - Number(match[2]));
    if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
    end = Math.min(end, stat.size - 1); status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = Math.max(0, end - start + 1);
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || stat.size === 0) { res.end(); return; }
  fs.createReadStream(filename, { start, end }).on('error', () => res.destroy()).pipe(res);
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(settings.port, '127.0.0.1', () => console.log(`Film preview: http://127.0.0.1:${settings.port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
