'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const { config } = require('./lib/config');
const { store } = require('./lib/store');
const { seedDemo } = require('./lib/seed');
const api = require('./lib/api');
const { fail, lanAddresses } = require('./lib/http');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Screen routes. Everything a person opens is one of these; the QR codes all
 * point at /t/<tag>, which is just the guest app with the table pre-filled.
 */
const SCREENS = {
  '/': 'index.html',
  '/order': 'index.html',
  '/kitchen': 'kitchen.html',
  '/expo': 'expo.html',
  '/admin': 'admin.html',
};

function serveFile(res, filePath, status = 200) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(status, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Screens must never be cached during service; assets are versioned by
      // hand during development, so keep them fresh too.
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  } catch {
    return fail(res, 400, 'Bad request URL');
  }

  try {
    if (url.pathname.startsWith('/api/')) {
      const handled = await api.handle(req, res, url);
      if (handled === false) return fail(res, 404, 'No such API route: ' + url.pathname);
      return undefined;
    }

    // QR landing: /t/table-12 -> guest app, table pre-selected by the client.
    if (/^\/t\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
      return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    const screen = SCREENS[url.pathname.replace(/\/$/, '') || '/'];
    if (screen) return serveFile(res, path.join(PUBLIC_DIR, screen));

    // Static assets, with traversal blocked.
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const resolved = path.resolve(PUBLIC_DIR, rel);
    if (!resolved.startsWith(PUBLIC_DIR)) return fail(res, 403, 'Forbidden');
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return serveFile(res, resolved);

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  } catch (err) {
    console.error('[server]', req.method, url.pathname, '->', err.stack || err.message);
    if (!res.headersSent) return fail(res, 500, 'Something broke on our side.');
    return res.end();
  }
});

// --fresh means exactly that: ignore the saved snapshot AND skip demo seeding,
// then overwrite the snapshot so a later normal boot does not resurrect today.
const fresh = process.argv.includes('--fresh');
store.load({ fresh });
if (fresh) {
  store.save();
  console.log('[store] starting a clean service (no restore, no demo data)');
} else if (config.demo.seedWhenEmpty && store.live().length === 0) {
  const n = seedDemo(store);
  console.log('[seed] created ' + n + ' live demo chits (POST /api/demo/reset to clear)');
}

server.listen(config.port, config.host, () => {
  const lan = lanAddresses();
  console.log('');
  console.log('  ' + config.venue.name + ' is up');
  console.log('  ------------------------------------------');
  console.log('  Guest     http://localhost:' + config.port + '/t/table-12');
  console.log('  Kitchen   http://localhost:' + config.port + '/kitchen');
  console.log('  Expo      http://localhost:' + config.port + '/expo');
  console.log('  Admin/QR  http://localhost:' + config.port + '/admin');
  lan.forEach((n) => {
    console.log('  Phone     http://' + n.address + ':' + config.port + '/admin   (scan QRs from here)');
  });
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n[server] shutting down');
  server.close(() => process.exit(0));
});
