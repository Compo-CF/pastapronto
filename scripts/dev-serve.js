/**
 * Minimal static file server for local development. The app is now a static
 * site, so this is only here to serve files over http:// (ES modules and
 * service workers do not work from file://).
 *
 * Run: node scripts/dev-serve.js  [--port 5173]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg > -1 ? process.argv[portArg + 1] : process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';

  const resolved = path.resolve(ROOT, rel);
  if (!resolved.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  PastaPresto! (static) served from ' + ROOT);
  console.log('  ------------------------------------------');
  console.log('  Guest     http://localhost:' + PORT + '/?t=table-12');
  console.log('  Kitchen   http://localhost:' + PORT + '/kitchen.html');
  console.log('  Expo      http://localhost:' + PORT + '/expo.html');
  console.log('  Manager   http://localhost:' + PORT + '/admin.html');
  console.log('');
});
