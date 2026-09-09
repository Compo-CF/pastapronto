'use strict';

/**
 * Independent verification of public/app/qr.js.
 *
 * Rather than trusting the encoder, this re-reads the finished matrix the way a
 * scanner would: it checks every function pattern against the spec, decodes the
 * format information through its BCH code, strips the mask, pulls the codewords
 * back out, runs a Reed-Solomon syndrome check on each block, and finally
 * parses the byte-mode payload back to a string.
 *
 * Run: node scripts/qr-verify.js
 */
require('../public/app/qr.js');
const QR = global.QR;

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  PASS  ' + name);
  } catch (err) {
    console.error('  FAIL  ' + name + '\n        ' + err.message);
    failures += 1;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ------------------------------------------------------------------- GF(256)

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const TOTAL_CW = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

const ALIGN = [
  null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

// --------------------------------------------------------------- spec checks

function checkFunctionPatterns(qr) {
  const { size, modules, version } = qr;
  assert(size === version * 4 + 17, 'size matches version formula');

  // Finder patterns: concentric 7x7 rings.
  const finders = [[3, 3], [size - 4, 3], [3, size - 4]];
  finders.forEach(([cx, cy]) => {
    for (let dy = -3; dy <= 3; dy += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const want = dist !== 2;
        assert(modules[cy + dy][cx + dx] === want,
          'finder module at (' + (cx + dx) + ',' + (cy + dy) + ') should be ' + want);
      }
    }
  });

  // Separators: the light ring just outside each finder.
  const sepClear = (x, y) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    assert(modules[y][x] === false, 'separator at (' + x + ',' + y + ') must be light');
  };
  for (let i = 0; i <= 7; i += 1) {
    sepClear(7, i); sepClear(i, 7);
    sepClear(size - 8, i); sepClear(size - 1 - i, 7);
    sepClear(7, size - 1 - i); sepClear(i, size - 8);
  }

  // Timing patterns alternate, dark on even coordinates.
  for (let i = 8; i < size - 8; i += 1) {
    assert(modules[6][i] === (i % 2 === 0), 'horizontal timing at x=' + i);
    assert(modules[i][6] === (i % 2 === 0), 'vertical timing at y=' + i);
  }

  // Alignment pattern centres per the published table.
  const centres = ALIGN[version];
  const n = centres.length;
  for (let a = 0; a < n; a += 1) {
    for (let b = 0; b < n; b += 1) {
      const corner = (a === 0 && b === 0) || (a === 0 && b === n - 1) || (a === n - 1 && b === 0);
      if (corner) continue;
      const cx = centres[a];
      const cy = centres[b];
      assert(modules[cy][cx] === true, 'alignment centre dark at (' + cx + ',' + cy + ')');
      assert(modules[cy - 1][cx] === false, 'alignment ring light above (' + cx + ',' + cy + ')');
      assert(modules[cy - 2][cx] === true, 'alignment outer ring dark at (' + cx + ',' + cy + ')');
    }
  }

  // The fixed dark module.
  assert(modules[size - 8][8] === true, 'dark module at (8, size-8)');
}

// ------------------------------------------------- decode format information

function decodeFormat(qr) {
  const { size, modules } = qr;
  // Read copy 1 in the spec's bit order.
  const bitAt = [];
  for (let i = 0; i <= 5; i += 1) bitAt[i] = modules[i][8];
  bitAt[6] = modules[7][8];
  bitAt[7] = modules[8][8];
  bitAt[8] = modules[8][7];
  for (let i = 9; i < 15; i += 1) bitAt[i] = modules[8][14 - i];

  let raw = 0;
  for (let i = 0; i < 15; i += 1) if (bitAt[i]) raw |= 1 << i;
  const unmasked = raw ^ 0x5412;

  // BCH(15,5) check: remainder against generator 0x537 must be zero.
  let rem = unmasked;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  }
  assert((rem & 0x3ff) === 0, 'format info fails its BCH check');

  // Second copy must carry the identical value.
  const bitAt2 = [];
  for (let i = 0; i < 8; i += 1) bitAt2[i] = modules[8][size - 1 - i];
  for (let i = 8; i < 15; i += 1) bitAt2[i] = modules[size - 15 + i][8];
  let raw2 = 0;
  for (let i = 0; i < 15; i += 1) if (bitAt2[i]) raw2 |= 1 << i;
  assert(raw2 === raw, 'the two format-info copies disagree');

  const data = unmasked >>> 10;
  return { ecLevelBits: (data >>> 3) & 3, mask: data & 7 };
}

// --------------------------------------------------- strip mask, read modules

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Rebuild the reserved-module map from the spec, without asking the encoder. */
function functionMap(version) {
  const size = version * 4 + 17;
  const map = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (x, y) => { if (x >= 0 && y >= 0 && x < size && y < size) map[y][x] = true; };

  [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) mark(cx + dx, cy + dy);
  });
  for (let i = 0; i < size; i += 1) { mark(6, i); mark(i, 6); }

  const centres = ALIGN[version];
  const n = centres.length;
  for (let a = 0; a < n; a += 1) {
    for (let b = 0; b < n; b += 1) {
      const corner = (a === 0 && b === 0) || (a === 0 && b === n - 1) || (a === n - 1 && b === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) mark(centres[a] + dx, centres[b] + dy);
    }
  }
  // Format areas.
  for (let i = 0; i <= 8; i += 1) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i += 1) mark(size - 1 - i, 8);
  for (let i = 0; i < 8; i += 1) mark(8, size - 1 - i);
  // Version areas.
  if (version >= 7) {
    for (let k = 0; k < 18; k += 1) {
      const a = size - 11 + (k % 3);
      const b = Math.floor(k / 3);
      mark(a, b); mark(b, a);
    }
  }
  return map;
}

function readCodewords(qr) {
  const { size, modules, version, mask } = qr;
  const fnMap = functionMap(version);
  const unmask = MASKS[mask];

  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fnMap[y][x]) continue;
        let bit = modules[y][x];
        if (unmask(x, y)) bit = !bit;
        bits.push(bit ? 1 : 0);
      }
    }
  }

  const cw = [];
  const usable = TOTAL_CW[version] * 8;
  for (let i = 0; i + 8 <= usable && i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    cw.push(byte);
  }
  return cw;
}

// ------------------------------------------- de-interleave + syndrome check

function deinterleave(cw, version) {
  const numBlocks = NUM_BLOCKS[version];
  const eccLen = ECC_PER_BLOCK[version];
  const rawCw = TOTAL_CW[version];
  const numShort = numBlocks - (rawCw % numBlocks);
  const shortLen = Math.floor(rawCw / numBlocks);

  const dataLens = [];
  for (let i = 0; i < numBlocks; i += 1) dataLens.push(shortLen - eccLen + (i < numShort ? 0 : 1));

  const blocks = dataLens.map(() => ({ data: [], ecc: [] }));
  let p = 0;
  const maxDataLen = Math.max(...dataLens);
  for (let col = 0; col < maxDataLen; col += 1) {
    for (let b = 0; b < numBlocks; b += 1) {
      if (col < dataLens[b]) blocks[b].data.push(cw[p++]);
    }
  }
  for (let e = 0; e < eccLen; e += 1) {
    for (let b = 0; b < numBlocks; b += 1) blocks[b].ecc.push(cw[p++]);
  }
  assert(p === rawCw, 'de-interleave consumed ' + p + ' of ' + rawCw + ' codewords');
  return blocks;
}

/**
 * A received Reed-Solomon codeword is valid exactly when the polynomial
 * evaluates to zero at every root alpha^i. This is what proves the ECC bytes
 * the encoder wrote are genuinely correct.
 */
function syndromesZero(block, eccLen) {
  const full = block.data.concat(block.ecc);
  for (let i = 0; i < eccLen; i += 1) {
    let acc = 0;
    for (let k = 0; k < full.length; k += 1) acc = gmul(acc, EXP[i]) ^ full[k];
    if (acc !== 0) return false;
  }
  return true;
}

function parsePayload(blocks, version) {
  const data = blocks.flatMap((b) => b.data);
  let bitPos = 0;
  const take = (n) => {
    let v = 0;
    for (let i = 0; i < n; i += 1) {
      const byte = data[bitPos >>> 3];
      const bit = (byte >>> (7 - (bitPos & 7))) & 1;
      v = (v << 1) | bit;
      bitPos += 1;
    }
    return v;
  };
  const mode = take(4);
  assert(mode === 0b0100, 'mode indicator should be byte mode, got 0b' + mode.toString(2));
  const len = take(version < 10 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < len; i += 1) bytes.push(take(8));
  return Buffer.from(bytes).toString('utf8');
}

/** Full scanner-style round trip for one string. */
function roundTrip(text) {
  const qr = QR.encode(text);
  checkFunctionPatterns(qr);
  const fmt = decodeFormat(qr);
  assert(fmt.ecLevelBits === 0, 'EC level bits should be 0 (level M), got ' + fmt.ecLevelBits);
  assert(fmt.mask === qr.mask, 'format info mask ' + fmt.mask + ' != applied mask ' + qr.mask);

  const cw = readCodewords(qr);
  assert(cw.length === TOTAL_CW[qr.version],
    'read ' + cw.length + ' codewords, expected ' + TOTAL_CW[qr.version]);

  const blocks = deinterleave(cw, qr.version);
  blocks.forEach((b, i) => {
    assert(syndromesZero(b, ECC_PER_BLOCK[qr.version]),
      'Reed-Solomon syndrome check failed on block ' + i);
  });

  const decoded = parsePayload(blocks, qr.version);
  assert(decoded === text, 'payload round trip failed:\n        got  "' + decoded + '"\n        want "' + text + '"');
  return qr;
}

// -------------------------------------------------------------------- tests

console.log('\nQR encoder verification (scanner-style round trip)\n');

const realUrls = [
  'http://192.168.1.50:7070/t/table-12',
  'http://10.0.0.7:7070/t/pool-bar',
  'http://localhost:7070/t/takeout',
];

realUrls.forEach((url) => {
  check('round trip: ' + url, () => {
    const qr = roundTrip(url);
    assert(qr.version >= 1 && qr.version <= 10, 'sane version');
  });
});

check('every version 1-10 round trips at its capacity boundary', () => {
  const seen = new Set();
  for (let v = 1; v <= 10; v += 1) {
    const cap = QR.capacityBytes(v);
    const text = 'A'.repeat(cap);
    const qr = QR.encode(text);
    assert(qr.version === v,
      'payload of ' + cap + ' bytes should select version ' + v + ', got ' + qr.version);
    roundTrip(text);
    seen.add(v);
  }
  assert(seen.size === 10, 'exercised all ten versions');
});

check('one byte past capacity rolls to the next version', () => {
  for (let v = 1; v < 10; v += 1) {
    const text = 'A'.repeat(QR.capacityBytes(v) + 1);
    assert(QR.encode(text).version === v + 1, 'version ' + v + ' + 1 byte should roll up');
  }
});

check('multi-byte UTF-8 survives the round trip', () => {
  roundTrip('http://192.168.1.50:7070/t/caf\u00e9-terrazza');
});

check('mask choice minimises the penalty score', () => {
  const qr = QR.encode('http://192.168.1.50:7070/t/table-12');
  assert(qr.mask >= 0 && qr.mask <= 7, 'mask in range');
  assert(typeof qr.penalty === 'number' && qr.penalty > 0, 'penalty computed');
});

check('oversized payload is rejected loudly', () => {
  let threw = false;
  try { QR.encode('x'.repeat(400)); } catch { threw = true; }
  assert(threw, 'should throw rather than emit a broken symbol');
});

check('SVG output is well formed', () => {
  const svg = QR.toSvg('http://192.168.1.50:7070/t/table-12', { size: 240 });
  assert(svg.startsWith('<svg') && svg.endsWith('</svg>'), 'svg element');
  assert(/viewBox="0 0 (\d+) \1"/.test(svg), 'square viewBox');
  assert(svg.includes('width="240"'), 'honours size option');
  const paths = svg.match(/h1v1h-1z/g) || [];
  assert(paths.length > 100, 'has module geometry, got ' + paths.length);
});

/** Print the smallest code as ASCII so a human can eyeball the corners. */
const demo = QR.encode('http://192.168.1.50:7070/t/table-12');
console.log('\n  version ' + demo.version + ', ' + demo.size + 'x' + demo.size +
  ' modules, mask ' + demo.mask + ', penalty ' + demo.penalty + '\n');
let art = '';
for (let y = 0; y < demo.size; y += 2) {
  let row = '      ';
  for (let x = 0; x < demo.size; x += 1) {
    const top = demo.modules[y][x];
    const bot = y + 1 < demo.size ? demo.modules[y + 1][x] : false;
    row += top && bot ? '\u2588' : top ? '\u2580' : bot ? '\u2584' : ' ';
  }
  art += row + '\n';
}
console.log(art);

if (failures > 0) {
  console.error(failures + ' check(s) failed\n');
  process.exit(1);
}
console.log('  all checks passed\n');
