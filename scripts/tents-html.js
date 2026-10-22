/**
 * Builds a standalone, printable sheet of table tents - two to a page.
 * Run: node scripts/tents-html.js [outFile] [baseUrl]
 *
 * The app already prints these from Manager > QR codes, and that stays the
 * way to do it on the night. This is for running off a stack beforehand: it
 * opens and prints on its own, with no passcode and no live screen, which
 * matters when the person at the printer is not the person with the iPad.
 *
 * A sheet makes two tents, and each reads from both sides of the table. One
 * cut down the middle separates them; one fold across each half stands it up.
 * The upper face of each pair is printed upside down, which is what makes the
 * far side read the right way up once the fold is made - printed the same way
 * up twice, a tent is readable from one side and useless from the other.
 *
 *     +------+------+
 *     | T1 v | T2 v |     v = printed upside down
 *     |......|......|  <- fold each half across here
 *     | T1 ^ | T2 ^ |
 *     +------+------+
 *            ^
 *            cut down here, giving two strips of 4.25 x 11 inches
 *
 * The codes, the brand and the table list all come from the same modules the
 * app uses, so a tent printed from here and a tent printed from the Manager
 * screen cannot say different things.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../app/config.js';
import * as qr from '../app/qr.js';
import { BRANDS, ACTIVE_BRAND_ID } from '../app/brand.js';

const OUT = process.argv[2] || 'table-tents.html';
const BASE = (process.argv[3] || 'https://pastapresto.web.app').replace(/\/+$/, '');

const brand = BRANDS[ACTIVE_BRAND_ID];

/*
 * Locations a manager added after the fact live in Firestore, which this
 * script has no credentials for. Listed here so the printed stack matches the
 * screen; anything added later is printed from the Manager screen instead.
 */
const EXTRA = [{ id: 'locker-room', label: 'Locker Room' }];
const TAGS = config.tags.concat(EXTRA);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

// Inlined, so the file is one thing to email, open or carry on a stick.
const logoPath = fileURLToPath(new URL('../brands/carltonwoods/logo.png', import.meta.url));
const logoSrc = 'data:image/png;base64,' + readFileSync(logoPath).toString('base64');

/**
 * One face of a tent. Tall rather than wide, because a folded half-sheet is
 * 4.25 by 5.5 inches - so the code sits under the table name the way a sign
 * reads, with the words above it.
 */
function face(tag) {
  const url = BASE + '/?t=' + tag.id;
  const svg = qr.toSvg(url, { quiet: 2, label: 'QR code for ' + tag.label });
  return `<div class="face">
    <div class="crown"><img src="${logoSrc}" alt="${esc(brand.logoAlt || brand.venueName)}"></div>
    <div class="where">${esc(tag.label)}</div>
    <div class="code">${svg}</div>
    <div class="how">Point your phone camera at the code to build your own pasta
      or pizza. No app to download.</div>
    <div class="url">${esc(url)}</div>
  </div>`;
}

/*
 * A sheet carries two tents side by side. Each is a column of two faces that
 * meet at a fold, and the upper face is turned upside down - that is what
 * makes the far side of a standing tent read the right way up.
 *
 * The cut runs down the middle of the sheet, so each tent comes away as a
 * tall strip that folds in its own middle.
 */
const sheetsHtml = [];
for (let i = 0; i < TAGS.length; i += 2) {
  const pair = [TAGS[i], TAGS[i + 1]].filter(Boolean);
  const cols = pair.map((tag) => `
    <div class="col">
      <div class="panel flip">${face(tag)}</div>
      <div class="fold" aria-hidden="true"><span>fold</span></div>
      <div class="panel">${face(tag)}</div>
    </div>
  `).join('<div class="cut" aria-hidden="true"><span>cut</span></div>');
  sheetsHtml.push(`<div class="sheet">${cols}</div>`);
}

const sheets = sheetsHtml.length;

const page = `<!doctype html>
<meta charset="utf-8">
<title>Table tents</title>
<style>
  :root { --maroon: #530000; --ink: #1e1a16; --tomato: #d33f30; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif; color: var(--ink); }

  .bar { padding: 14px 18px; border-bottom: 1px solid #ddd; font-size: 14px; line-height: 1.5; }
  .bar button {
    font: inherit; padding: 7px 16px; margin-right: 10px;
    border: 1px solid var(--ink); border-radius: 6px;
    background: var(--ink); color: #fff; cursor: pointer;
  }

  /* Two tents side by side. Each is a column of two faces that meet at a
     fold; the cut runs down the middle of the sheet between them. */
  .sheet {
    width: 196mm; height: 259mm; margin: 0 auto;
    display: flex; flex-direction: row;
    page-break-after: always; break-after: page;
  }
  .col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }
  .panel { flex: 1 1 0; min-height: 0; }
  .panel.flip { transform: rotate(180deg); }

  /* The two guides say which is which, because one of them ruins the tent if
     you get it wrong: cutting the fold leaves two loose halves. */
  .fold { position: relative; height: 0; }
  .fold::before {
    content: ''; position: absolute; left: 0; right: 0; top: 0;
    border-top: 1px dotted #bbb;
  }
  .cut {
    position: relative; flex: 0 0 0; align-self: stretch;
    border-left: 1px dashed #777;
  }
  .fold span, .cut span {
    position: absolute; padding: 0 4px; background: #fff;
    font-size: 6.5pt; letter-spacing: .14em; text-transform: uppercase; color: #aaa;
  }
  .fold span { right: 2mm; top: -6px; }
  .cut span { color: #777; top: 50%; left: -11px; }

  /* The face itself: the words, then the code beneath them. */
  .face {
    height: 100%; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 3mm;
    padding: 6mm 5mm; text-align: center;
  }
  .code svg { width: 44mm; height: 44mm; display: block; }

  /* The club mark is white on transparent and prints as nothing without the
     band behind it. */
  .crown {
    padding: 2mm 5mm; background: var(--maroon);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .crown img { height: 7mm; width: auto; display: block; object-fit: contain; }
  .where { font-size: 20pt; font-weight: 800; line-height: 1.05; }
  .how { font-size: 8.5pt; color: #444; line-height: 1.35; max-width: 82mm; }
  .url { font-family: ui-monospace, monospace; font-size: 6.5pt; color: #999; }

  @media print {
    @page { size: letter portrait; margin: 8mm; }
    .bar { display: none; }
    .sheet { width: auto; }
  }
</style>

<div class="bar">
  <button onclick="window.print()">Print all ${TAGS.length}</button>
  ${TAGS.length} tents on ${sheets} sheets. Print on card at 100%, no scaling.<br>
  <b>Cut</b> down the dashed line to separate the two, then <b>fold</b> each one
  across its dotted line. Each stands up and reads from both sides.
</div>

${sheetsHtml.join(String.fromCharCode(10))}
`;

writeFileSync(OUT, page);
console.log('wrote ' + OUT);
console.log(TAGS.length + ' tents, ' + sheets + ' sheets, codes point at ' + BASE);
