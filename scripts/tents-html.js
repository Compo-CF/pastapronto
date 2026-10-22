/**
 * Builds a standalone, printable sheet of table tents - two to a page.
 * Run: node scripts/tents-html.js [outFile] [baseUrl]
 *
 * The app already prints these from Manager > QR codes, and that stays the
 * way to do it on the night. This is for running off a stack beforehand: it
 * opens and prints on its own, with no passcode and no live screen, which
 * matters when the person at the printer is not the person with the iPad.
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
 * One face of a tent. Wide and short, because a folded half-sheet is
 * 8.5 x 2.75 inches - so the code sits beside the words rather than above
 * them, the way a place card reads rather than a poster.
 */
function face(tag) {
  const url = BASE + '/?t=' + tag.id;
  const svg = qr.toSvg(url, { quiet: 2, label: 'QR code for ' + tag.label });
  return `<div class="face">
    <div class="code">${svg}</div>
    <div class="say">
      <div class="crown"><img src="${logoSrc}" alt="${esc(brand.logoAlt || brand.venueName)}"></div>
      <div class="where">${esc(tag.label)}</div>
      <div class="how">Point your phone camera at the code to build your own pasta
        or pizza. No app to download.</div>
      <div class="url">${esc(url)}</div>
    </div>
  </div>`;
}

/*
 * A sheet carries two tents, one above the other. Each tent is two faces that
 * meet at a fold, and the upper face of each pair is turned upside down - that
 * is what makes the far side of a standing tent read the right way up.
 */
const sheetsHtml = [];
for (let i = 0; i < TAGS.length; i += 2) {
  const pair = [TAGS[i], TAGS[i + 1]].filter(Boolean);
  const panels = pair.map((tag, n) => `
    <div class="panel flip">${face(tag)}</div>
    <div class="fold" aria-hidden="true"><span>fold</span></div>
    <div class="panel">${face(tag)}</div>
    ${n === 0 && pair.length > 1 ? '<div class="cut" aria-hidden="true"><span>cut</span></div>' : ''}
  `).join('');
  sheetsHtml.push(`<div class="sheet">${panels}</div>`);
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

  /* Four faces to a sheet: two tents, each a pair that meets at a fold. */
  .sheet {
    width: 196mm; height: 259mm; margin: 0 auto;
    display: flex; flex-direction: column;
    page-break-after: always; break-after: page;
  }
  .panel { flex: 1 1 0; min-height: 0; }
  .panel.flip { transform: rotate(180deg); }

  /* The two guides say which is which, because one of them ruins the tent if
     you get it wrong: cutting the fold leaves two loose halves. */
  .fold, .cut { position: relative; height: 0; }
  .fold::before, .cut::before {
    content: ''; position: absolute; left: 0; right: 0; top: 0;
  }
  .fold::before { border-top: 1px dotted #bbb; }
  .cut::before { border-top: 1px dashed #777; }
  .fold span, .cut span {
    position: absolute; right: 0; top: -6px; padding: 0 4px;
    background: #fff; font-size: 6.5pt; letter-spacing: .14em;
    text-transform: uppercase; color: #aaa;
  }
  .cut span { color: #777; }

  /* The face itself: code on the left, words on the right. */
  .face {
    height: 100%; display: flex; align-items: center; justify-content: center; gap: 8mm;
    padding: 5mm 7mm;
  }
  .code { flex: 0 0 auto; }
  .code svg { width: 44mm; height: 44mm; display: block; }
  .say { flex: 1 1 auto; min-width: 0; }

  /* The club mark is white on transparent and prints as nothing without the
     band behind it. */
  .crown {
    display: inline-block; padding: 2mm 4mm; margin-bottom: 1.5mm;
    background: var(--maroon);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .crown img { height: 7mm; width: auto; display: block; object-fit: contain; }
  .where { font-size: 21pt; font-weight: 800; line-height: 1.05; margin-bottom: 1mm; }
  .how { font-size: 9pt; color: #444; line-height: 1.35; max-width: 105mm; }
  .url { margin-top: 1.5mm; font-family: ui-monospace, monospace; font-size: 7pt; color: #999; }

  @media print {
    @page { size: letter portrait; margin: 8mm; }
    .bar { display: none; }
    .sheet { width: auto; }
  }
</style>

<div class="bar">
  <button onclick="window.print()">Print all ${TAGS.length}</button>
  ${TAGS.length} tents on ${sheets} sheets. Print on card at 100%, no scaling.<br>
  <b>Cut</b> each sheet in half across the dashed line, then <b>fold</b> each half
  on its dotted line. Each one stands up and reads from both sides.
</div>

${sheetsHtml.join(String.fromCharCode(10))}
`;

writeFileSync(OUT, page);
console.log('wrote ' + OUT);
console.log(TAGS.length + ' tents, ' + sheets + ' sheets, codes point at ' + BASE);
