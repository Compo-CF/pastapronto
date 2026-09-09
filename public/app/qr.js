/**
 * Minimal QR Code encoder - byte mode, error-correction level M, versions 1-10
 * (up to 216 bytes, which covers any LAN URL we print).
 *
 * Written from scratch so the admin screen can print table tents with no CDN
 * and no build step. Implements ISO/IEC 18004: data encoding, Reed-Solomon
 * error correction over GF(256), block interleaving, function-pattern layout,
 * and the full 4-rule mask penalty evaluation.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- GF(256)

  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function buildTables() {
    var x = 1;
    for (var i = 0; i < 255; i += 1) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d; // primitive polynomial for QR
    }
    for (var j = 255; j < 512; j += 1) EXP[j] = EXP[j - 255];
  })();

  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /** Generator polynomial of the given degree, highest coefficient first. */
  function generatorPoly(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i += 1) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j += 1) {
        next[j] ^= poly[j];
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  /** Reed-Solomon remainder: the EC codewords for one data block. */
  function eccBlock(data, eccLen) {
    var gen = generatorPoly(eccLen);
    var buf = new Array(data.length + eccLen).fill(0);
    for (var i = 0; i < data.length; i += 1) buf[i] = data[i];
    for (var k = 0; k < data.length; k += 1) {
      var coeff = buf[k];
      if (coeff === 0) continue;
      for (var j = 0; j < gen.length; j += 1) buf[k + j] ^= gmul(gen[j], coeff);
    }
    return buf.slice(data.length);
  }

  // ------------------------------------------------------------ version tables

  // Error-correction level M only. Index = version (1-based).
  var ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var NUM_BLOCKS =    [0,  1,  1,  1,  2,  2,  4,  4,  4,  5,  5];
  var MAX_VERSION = 10;
  var EC_LEVEL_BITS = 0; // 'M'

  /** Total data-module bits for a version, before splitting into codewords. */
  function rawDataModules(version) {
    var result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      var numAlign = Math.floor(version / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (version >= 7) result -= 36;
    }
    return result;
  }

  function totalCodewords(version) {
    return Math.floor(rawDataModules(version) / 8);
  }

  function dataCodewords(version) {
    return totalCodewords(version) - ECC_PER_BLOCK[version] * NUM_BLOCKS[version];
  }

  function alignmentPositions(version) {
    if (version === 1) return [];
    var numAlign = Math.floor(version / 7) + 2;
    var size = version * 4 + 17;
    var step = Math.floor((version * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2)) * 2;
    var result = new Array(numAlign);
    result[0] = 6;
    var pos = size - 7;
    for (var i = numAlign - 1; i >= 1; i -= 1) {
      result[i] = pos;
      pos -= step;
    }
    return result;
  }

  // ------------------------------------------------------------- data encoding

  function utf8Bytes(str) {
    var out = [];
    var encoded = unescape(encodeURIComponent(str));
    for (var i = 0; i < encoded.length; i += 1) out.push(encoded.charCodeAt(i));
    return out;
  }

  function chooseVersion(byteLen) {
    for (var v = 1; v <= MAX_VERSION; v += 1) {
      var countBits = v < 10 ? 8 : 16;
      var needed = 4 + countBits + byteLen * 8;
      if (needed <= dataCodewords(v) * 8) return v;
    }
    throw new Error('Data too long for QR versions 1-' + MAX_VERSION + ' (' + byteLen + ' bytes)');
  }

  /** Build the padded data codeword array for a version. */
  function buildDataCodewords(bytes, version) {
    var bits = [];
    var push = function (value, len) {
      for (var i = len - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
    };

    push(0b0100, 4); // byte mode
    push(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach(function (b) { push(b, 8); });

    var capacityBits = dataCodewords(version) * 8;
    // Terminator, then pad to a byte boundary.
    var terminator = Math.min(4, capacityBits - bits.length);
    push(0, terminator);
    while (bits.length % 8 !== 0) bits.push(0);

    var codewords = [];
    for (var i = 0; i < bits.length; i += 8) {
      var byte = 0;
      for (var j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
      codewords.push(byte);
    }
    // Alternating pad bytes fill the rest.
    var padBytes = [0xec, 0x11];
    var p = 0;
    while (codewords.length < dataCodewords(version)) {
      codewords.push(padBytes[p % 2]);
      p += 1;
    }
    return codewords;
  }

  /** Split into blocks, add EC, and interleave into the final codeword stream. */
  function addEccAndInterleave(data, version) {
    var numBlocks = NUM_BLOCKS[version];
    var eccLen = ECC_PER_BLOCK[version];
    var rawCw = totalCodewords(version);
    var numShort = numBlocks - (rawCw % numBlocks);
    var shortLen = Math.floor(rawCw / numBlocks);

    var blocks = [];
    var offset = 0;
    for (var i = 0; i < numBlocks; i += 1) {
      var datLen = shortLen - eccLen + (i < numShort ? 0 : 1);
      var dat = data.slice(offset, offset + datLen);
      offset += datLen;
      blocks.push({ data: dat, ecc: eccBlock(dat, eccLen) });
    }

    var result = [];
    // Data codewords, column-major across blocks. Short blocks skip their
    // final (missing) column.
    for (var col = 0; col < shortLen - eccLen + 1; col += 1) {
      for (var b = 0; b < numBlocks; b += 1) {
        if (col < blocks[b].data.length) result.push(blocks[b].data[col]);
      }
    }
    // Then all EC codewords, also column-major.
    for (var ec = 0; ec < eccLen; ec += 1) {
      for (var b2 = 0; b2 < numBlocks; b2 += 1) result.push(blocks[b2].ecc[ec]);
    }
    return result;
  }

  // -------------------------------------------------------------- matrix build

  function QrMatrix(version) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = [];
    this.reserved = [];
    for (var y = 0; y < this.size; y += 1) {
      this.modules.push(new Array(this.size).fill(false));
      this.reserved.push(new Array(this.size).fill(false));
    }
  }

  QrMatrix.prototype.setFunction = function (x, y, dark) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    this.modules[y][x] = dark;
    this.reserved[y][x] = true;
  };

  QrMatrix.prototype.drawFinder = function (cx, cy) {
    for (var dy = -4; dy <= 4; dy += 1) {
      for (var dx = -4; dx <= 4; dx += 1) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        this.setFunction(cx + dx, cy + dy, dist !== 2 && dist !== 4);
      }
    }
  };

  QrMatrix.prototype.drawAlignment = function (cx, cy) {
    for (var dy = -2; dy <= 2; dy += 1) {
      for (var dx = -2; dx <= 2; dx += 1) {
        this.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };

  QrMatrix.prototype.drawFunctionPatterns = function () {
    var size = this.size;
    // Timing patterns.
    for (var i = 0; i < size; i += 1) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    // Finders (with separators, courtesy of the 9x9 sweep).
    this.drawFinder(3, 3);
    this.drawFinder(size - 4, 3);
    this.drawFinder(3, size - 4);
    // Alignment patterns, skipping the three finder corners.
    var pos = alignmentPositions(this.version);
    var n = pos.length;
    for (var a = 0; a < n; a += 1) {
      for (var b = 0; b < n; b += 1) {
        var corner = (a === 0 && b === 0) || (a === 0 && b === n - 1) || (a === n - 1 && b === 0);
        if (!corner) this.drawAlignment(pos[a], pos[b]);
      }
    }
    // Reserve the format areas; real bits go in after masking.
    this.drawFormatBits(0);
    if (this.version >= 7) this.drawVersionBits();
  };

  QrMatrix.prototype.drawFormatBits = function (mask) {
    var data = (EC_LEVEL_BITS << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i += 1) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    var bit = function (n) { return ((bits >>> n) & 1) === 1; };

    for (var k = 0; k <= 5; k += 1) this.setFunction(8, k, bit(k));
    this.setFunction(8, 7, bit(6));
    this.setFunction(8, 8, bit(7));
    this.setFunction(7, 8, bit(8));
    for (var m = 9; m < 15; m += 1) this.setFunction(14 - m, 8, bit(m));

    var size = this.size;
    for (var p = 0; p < 8; p += 1) this.setFunction(size - 1 - p, 8, bit(p));
    for (var q = 8; q < 15; q += 1) this.setFunction(8, size - 15 + q, bit(q));
    this.setFunction(8, size - 8, true); // always dark
  };

  QrMatrix.prototype.drawVersionBits = function () {
    var rem = this.version;
    for (var i = 0; i < 12; i += 1) rem = (rem << 1) ^ (((rem >>> 11) & 1) * 0x1f25);
    var bits = (this.version << 12) | rem;
    for (var k = 0; k < 18; k += 1) {
      var dark = ((bits >>> k) & 1) === 1;
      var a = this.size - 11 + (k % 3);
      var b = Math.floor(k / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  };

  /** Zig-zag the codeword stream into the free modules, right to left. */
  QrMatrix.prototype.drawCodewords = function (codewords) {
    var i = 0; // bit index
    var size = this.size;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the vertical timing column
      for (var vert = 0; vert < size; vert += 1) {
        for (var j = 0; j < 2; j += 1) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (this.reserved[y][x]) continue;
          if (i < codewords.length * 8) {
            var byte = codewords[i >>> 3];
            this.modules[y][x] = ((byte >>> (7 - (i & 7))) & 1) === 1;
            i += 1;
          }
          // Remainder modules stay light.
        }
      }
    }
  };

  // ------------------------------------------------------------------- masking

  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0; },
    function (x, y) { return ((x * y) % 2) + ((x * y) % 3) === 0; },
    function (x, y) { return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; },
    function (x, y) { return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; },
  ];

  QrMatrix.prototype.applyMask = function (mask) {
    var fn = MASKS[mask];
    for (var y = 0; y < this.size; y += 1) {
      for (var x = 0; x < this.size; x += 1) {
        if (!this.reserved[y][x] && fn(x, y)) this.modules[y][x] = !this.modules[y][x];
      }
    }
  };

  /** Standard 4-rule penalty. Lower is better. */
  QrMatrix.prototype.penalty = function () {
    var size = this.size;
    var mods = this.modules;
    var score = 0;

    // Rule 1: runs of 5+ same-colour modules in a row or column.
    var runScore = function (run) { return run >= 5 ? 3 + (run - 5) : 0; };
    for (var y = 0; y < size; y += 1) {
      var run = 1;
      for (var x = 1; x < size; x += 1) {
        if (mods[y][x] === mods[y][x - 1]) run += 1;
        else { score += runScore(run); run = 1; }
      }
      score += runScore(run);
    }
    for (var x2 = 0; x2 < size; x2 += 1) {
      var vrun = 1;
      for (var y2 = 1; y2 < size; y2 += 1) {
        if (mods[y2][x2] === mods[y2 - 1][x2]) vrun += 1;
        else { score += runScore(vrun); vrun = 1; }
      }
      score += runScore(vrun);
    }

    // Rule 2: every 2x2 block of one colour.
    for (var y3 = 0; y3 < size - 1; y3 += 1) {
      for (var x3 = 0; x3 < size - 1; x3 += 1) {
        var c = mods[y3][x3];
        if (c === mods[y3][x3 + 1] && c === mods[y3 + 1][x3] && c === mods[y3 + 1][x3 + 1]) score += 3;
      }
    }

    // Rule 3: finder-lookalike 1:1:3:1:1 patterns with 4 light modules beside.
    var pattern = [true, false, true, true, true, false, true];
    var matches = function (get, i, len) {
      if (i + 7 > len) return false;
      for (var k = 0; k < 7; k += 1) if (get(i + k) !== pattern[k]) return false;
      var beforeClear = true;
      var afterClear = true;
      for (var b = 1; b <= 4; b += 1) {
        if (i - b >= 0 && get(i - b)) beforeClear = false;
        if (i + 6 + b < len && get(i + 6 + b)) afterClear = false;
      }
      return beforeClear || afterClear;
    };
    for (var y4 = 0; y4 < size; y4 += 1) {
      for (var i4 = 0; i4 < size; i4 += 1) {
        if (matches(function (n) { return mods[y4][n]; }, i4, size)) score += 40;
      }
    }
    for (var x5 = 0; x5 < size; x5 += 1) {
      for (var i5 = 0; i5 < size; i5 += 1) {
        if (matches(function (n) { return mods[n][x5]; }, i5, size)) score += 40;
      }
    }

    // Rule 4: deviation from a 50/50 dark ratio.
    var dark = 0;
    for (var y6 = 0; y6 < size; y6 += 1) {
      for (var x6 = 0; x6 < size; x6 += 1) if (mods[y6][x6]) dark += 1;
    }
    var total = size * size;
    var percent = (dark * 100) / total;
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return score;
  };

  // --------------------------------------------------------------- public API

  /**
   * Encode text into a QR matrix.
   * @returns {{size:number, modules:boolean[][], version:number, mask:number}}
   */
  function encode(text) {
    var bytes = utf8Bytes(String(text));
    var version = chooseVersion(bytes.length);
    var data = buildDataCodewords(bytes, version);
    var codewords = addEccAndInterleave(data, version);

    var best = null;
    for (var mask = 0; mask < 8; mask += 1) {
      var m = new QrMatrix(version);
      m.drawFunctionPatterns();
      m.drawCodewords(codewords);
      m.applyMask(mask);
      m.drawFormatBits(mask); // real format bits for this mask
      var score = m.penalty();
      if (!best || score < best.score) best = { score: score, matrix: m, mask: mask };
    }

    return {
      size: best.matrix.size,
      modules: best.matrix.modules,
      version: version,
      mask: best.mask,
      penalty: best.score,
    };
  }

  /**
   * Render as an SVG string. One <path> for every dark module keeps the file
   * small and prints crisply at any size.
   */
  function toSvg(text, opts) {
    opts = opts || {};
    var qr = encode(text);
    var quiet = opts.quiet == null ? 4 : opts.quiet;
    var dim = qr.size + quiet * 2;
    var dark = opts.dark || '#1e1a16';
    var light = opts.light || '#ffffff';

    var d = '';
    for (var y = 0; y < qr.size; y += 1) {
      for (var x = 0; x < qr.size; x += 1) {
        if (qr.modules[y][x]) d += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z';
      }
    }

    var sizeAttr = opts.size ? ' width="' + opts.size + '" height="' + opts.size + '"' : '';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '"' + sizeAttr +
      ' shape-rendering="crispEdges" role="img" aria-label="' + (opts.label || 'QR code') + '">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="' + light + '"/>' +
      '<path d="' + d + '" fill="' + dark + '"/></svg>';
  }

  global.QR = { encode: encode, toSvg: toSvg, capacityBytes: function (v) { return dataCodewords(v) - (v < 10 ? 2 : 3); } };
})(typeof window !== 'undefined' ? window : global);
