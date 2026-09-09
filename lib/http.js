'use strict';

const MAX_BODY_BYTES = 64 * 1024;

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function fail(res, status, message, extra = {}) {
  json(res, status, { ok: false, error: message, ...extra });
}

/** Read and parse a JSON body, with a hard size cap. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(Object.assign(new Error('Body is not valid JSON'), { code: 'BAD_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

/** Best-effort LAN addresses, so the admin screen can print a scannable QR. */
function lanAddresses() {
  const os = require('os');
  const out = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((net) => {
      if (net.family === 'IPv4' && !net.internal) out.push({ iface: name, address: net.address });
    });
  });
  return out;
}

module.exports = { json, fail, readJson, lanAddresses, MAX_BODY_BYTES };
