/**
 * A very small PDF writer. No dependencies, no build step.
 *
 * Written by hand for the same reason app/qr.js was: the close-out report is a
 * club's billing sheet, and shipping it through a CDN library - or worse, a
 * server-side render - would mean the member list leaves the building just to
 * become a file. This runs in the browser with the wifi unplugged.
 *
 * Deliberately the smallest thing that produces the report: uncompressed
 * PDF 1.4, the base-14 fonts (so nothing is embedded), text, filled
 * rectangles, lines. No images, no transparency, no compression.
 *
 * TWO THINGS TO KNOW BEFORE EDITING
 *
 * Coordinates here are top-down - y = 0 is the top of the page - because that
 * is how a report is laid out in prose and how every other file here reads.
 * PDF's own origin is bottom-left, and build() flips it at the last moment.
 *
 * The file is assembled as a string whose characters are all <= 0xFF, then
 * converted one character to one byte. That matters: the xref table stores
 * BYTE offsets, and one-to-one is what makes a string index a valid byte
 * offset. Everything that reaches a page goes through winAnsi() first, which
 * is what keeps that promise.
 */

const LETTER = { width: 612, height: 792 };

const FONTS = {
  regular: { name: 'F1', base: 'Helvetica' },
  bold: { name: 'F2', base: 'Helvetica-Bold' },
  mono: { name: 'F3', base: 'Courier' },
  monoBold: { name: 'F4', base: 'Courier-Bold' },
};

// Courier is metrically exact at 600/1000 of the point size per character,
// which is the whole reason the numeric columns are set in it: right-aligning
// them needs no font metrics and cannot drift. Helvetica's widths are not in
// this file, so nothing in Helvetica is ever right-aligned or centred.
const MONO_RATIO = 0.6;

/** Width of a monospaced run, in points. Exact. */
export function monoWidth(text, size) {
  return String(text == null ? '' : text).length * MONO_RATIO * size;
}

/**
 * Rough width of a proportional run, for wrapping only.
 *
 * Helvetica averages near 0.5em over mixed text; 0.52 buys headroom so a line
 * wraps slightly early rather than running past the margin. A wrap point has
 * no correct answer a reader can spot, unlike a ragged column - which is why
 * approximating is fine here and is not fine for alignment.
 */
function roughWidth(text, size) {
  return String(text == null ? '' : text).length * 0.52 * size;
}

// Characters worth carrying over rather than flattening to '?'.
const WIN_ANSI = {
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94,
  '–': 0x96, '—': 0x97, '•': 0x95, '…': 0x85,
  '·': 0xB7, '×': 0xD7, ' ': 0x20, '™': 0x99,
};

/**
 * Map a string onto WinAnsiEncoding and escape what PDF syntax treats
 * specially. Anything with no WinAnsi home becomes '?' rather than silently
 * emitting a multi-byte sequence, which would corrupt every xref offset after
 * it and make the file unopenable.
 */
export function winAnsi(text) {
  const s = String(text == null ? '' : text);
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (ch === '\\' || ch === '(' || ch === ')') out += '\\' + ch;
    else if (code >= 32 && code <= 126) out += ch;
    else if (WIN_ANSI[ch] != null) out += String.fromCharCode(WIN_ANSI[ch]);
    else if (code >= 160 && code <= 255) out += ch;
    else out += '?';
  }
  return out;
}

/** Trim a monospaced string to a width, because a column cannot overflow. */
export function fitMono(text, size, maxWidth) {
  const max = Math.max(1, Math.floor(maxWidth / (MONO_RATIO * size)));
  const s = String(text == null ? '' : text);
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)) + '.';
}

/** Break prose into lines that fit a width. Approximate, and always short. */
export function wrap(text, size, maxWidth) {
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach((w) => {
    const candidate = line ? line + ' ' + w : w;
    if (line && roughWidth(candidate, size) > maxWidth) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * Start a document.
 *
 * @param {{margin?: number, width?: number, height?: number}} opts
 */
export function create(opts = {}) {
  const width = opts.width || LETTER.width;
  const height = opts.height || LETTER.height;
  const margin = opts.margin == null ? 40 : opts.margin;

  const pages = [''];
  let page = 0;

  const num = (n) => {
    const r = Math.round(n * 100) / 100;
    return String(Object.is(r, -0) ? 0 : r);
  };
  const flipY = (y) => height - y;

  const api = {
    width,
    height,
    margin,
    get innerWidth() { return width - margin * 2; },
    get pageCount() { return pages.length; },
    get pageIndex() { return page; },

    addPage() {
      pages.push('');
      page = pages.length - 1;
      return api;
    },

    /** Go back to a page already written, so footers can be stamped at the end. */
    selectPage(i) {
      if (i >= 0 && i < pages.length) page = i;
      return api;
    },

    /**
     * Text with its BASELINE at y, in top-down coordinates.
     *
     * align 'right' is honoured only for the mono fonts, whose widths are
     * exact. Asking for it on Helvetica would be guesswork dressed up as
     * layout, so it is ignored there.
     */
    text(value, o = {}) {
      const size = o.size || 10;
      const font = FONTS[o.font] || FONTS.regular;
      const isMono = font.base.indexOf('Courier') === 0;
      let x = o.x == null ? margin : o.x;
      if (o.align === 'right' && isMono) x -= monoWidth(value, size);
      const c = o.color || [0, 0, 0];
      pages[page] += 'BT /' + font.name + ' ' + num(size) + ' Tf '
        + num(c[0]) + ' ' + num(c[1]) + ' ' + num(c[2]) + ' rg '
        + num(x) + ' ' + num(flipY(o.y == null ? margin + size : o.y)) + ' Td'
        + ' (' + winAnsi(value) + ') Tj ET\n';
      return api;
    },

    /** Filled rectangle, y being its top edge. */
    rect(x, y, w, h, color) {
      const c = color || [0, 0, 0];
      pages[page] += num(c[0]) + ' ' + num(c[1]) + ' ' + num(c[2]) + ' rg '
        + num(x) + ' ' + num(flipY(y + h)) + ' ' + num(w) + ' ' + num(h) + ' re f\n';
      return api;
    },

    /** A rule. */
    line(x1, y1, x2, y2, o = {}) {
      const c = o.color || [0, 0, 0];
      pages[page] += num(o.width == null ? 0.6 : o.width) + ' w '
        + num(c[0]) + ' ' + num(c[1]) + ' ' + num(c[2]) + ' RG '
        + num(x1) + ' ' + num(flipY(y1)) + ' m '
        + num(x2) + ' ' + num(flipY(y2)) + ' l S\n';
      return api;
    },

    /**
     * Serialise to bytes - one byte per character of the assembled file, which
     * is what makes the xref offsets below correct.
     */
    build(meta = {}) {
      const objects = [];
      const add = (body) => { objects.push(body); return objects.length; };

      const catalogId = add(null);
      const pagesId = add(null);

      const fontIds = {};
      Object.keys(FONTS).forEach((k) => {
        fontIds[k] = add('<< /Type /Font /Subtype /Type1 /BaseFont /'
          + FONTS[k].base + ' /Encoding /WinAnsiEncoding >>');
      });
      const fontRes = Object.keys(FONTS)
        .map((k) => '/' + FONTS[k].name + ' ' + fontIds[k] + ' 0 R')
        .join(' ');

      const pageIds = [];
      pages.forEach((content) => {
        const streamId = add('<< /Length ' + content.length + ' >>\nstream\n'
          + content + 'endstream');
        const pageId = add(null);
        pageIds.push(pageId);
        objects[pageId - 1] = '<< /Type /Page /Parent ' + pagesId + ' 0 R'
          + ' /MediaBox [0 0 ' + num(width) + ' ' + num(height) + ']'
          + ' /Resources << /Font << ' + fontRes + ' >> >>'
          + ' /Contents ' + streamId + ' 0 R >>';
      });

      objects[catalogId - 1] = '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>';
      objects[pagesId - 1] = '<< /Type /Pages /Count ' + pageIds.length
        + ' /Kids [' + pageIds.map((id) => id + ' 0 R').join(' ') + '] >>';

      const infoId = add('<< /Title (' + winAnsi(meta.title || 'Report') + ')'
        + ' /Author (' + winAnsi(meta.author || '') + ')'
        + ' /Creator (' + winAnsi(meta.creator || 'PastaPresto') + ') >>');

      let out = '%PDF-1.4\n';
      const offsets = [];
      objects.forEach((body, i) => {
        offsets[i] = out.length;
        out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
      });

      const xrefAt = out.length;
      out += 'xref\n0 ' + (objects.length + 1) + '\n';
      out += '0000000000 65535 f \n';
      offsets.forEach((off) => {
        out += String(off).padStart(10, '0') + ' 00000 n \n';
      });
      out += 'trailer\n<< /Size ' + (objects.length + 1)
        + ' /Root ' + catalogId + ' 0 R /Info ' + infoId + ' 0 R >>\n'
        + 'startxref\n' + xrefAt + '\n%%EOF\n';

      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i += 1) bytes[i] = out.charCodeAt(i) & 0xFF;
      return bytes;
    },
  };

  return api;
}
