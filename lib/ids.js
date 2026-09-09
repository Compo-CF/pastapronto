'use strict';

const crypto = require('crypto');

/** Opaque order id. Not guessable, so a guest cannot browse other tickets. */
function orderId() {
  return 'ord_' + crypto.randomBytes(9).toString('base64url');
}

/** Short claim code shown to the guest so a server can find their ticket. */
function claimCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    out += alphabet[crypto.randomInt(alphabet.length)];
  }
  return out;
}

function lineId(n) {
  return 'ln' + String(n).padStart(2, '0');
}

module.exports = { orderId, claimCode, lineId };
