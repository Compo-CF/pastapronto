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

const cards = TAGS.map((tag) => {
  const url = BASE + '/?t=' + tag.id;
  const svg = qr.toSvg(url, { quiet: 2, label: 'QR code for ' + tag.label });
  return `<section class="tent">
  <div class="crown"><img src="${logoSrc}" alt="${esc(brand.logoAlt || brand.venueName)}"></div>
  <div class="event">${esc(brand.venueName)}</div>
  <div class="tagline">${esc(brand.tagline)}</div>
  <div class="rule"></div>
  <div class="where">${esc(tag.label)}</div>
  <div class="qr">${svg}</div>
  <div class="how">Point your phone camera at the code to build your own pasta or pizza.
    No app to download.</div>
  <div class="url">${esc(url)}</div>
</section>`;
}).join('\n');

const sheets = Math.ceil(TAGS.length / 2);

const page = `<!doctype html>
<meta charset="utf-8">
<title>Table tents</title>
<style>
  :root { --maroon: #530000; --basil: #2f7d4f; --ink: #1e1a16; --tomato: #d33f30; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif; color: var(--ink); }

  .bar { padding: 14px 18px; border-bottom: 1px solid #ddd; font-size: 14px; }
  .bar button {
    font: inherit; padding: 7px 16px; margin-right: 10px;
    border: 1px solid var(--ink); border-radius: 6px;
    background: var(--ink); color: #fff; cursor: pointer;
  }

  /* Half a Letter sheet each, so one straight cut across the short way makes
     two cards - no trimming to size and no offcuts. */
  .tent {
    height: 125mm; width: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 2.5mm; text-align: center;
    break-inside: avoid; page-break-inside: avoid;
  }
  /* The guide is drawn between the pair rather than around them, so the outer
     edges stay the edges of the sheet. */
  .tent:nth-of-type(2n-1)::after {
    content: ''; display: block; width: 100%; margin-top: 2.5mm;
    border-top: 1px dashed #999;
  }
  .tent:nth-of-type(2n) { page-break-after: always; break-after: page; }

  /* The club's mark is white on transparent and would print as nothing at all
     without the band behind it. */
  .crown {
    width: 100%; padding: 4mm; background: var(--maroon);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .crown img { height: 9mm; width: auto; object-fit: contain; }
  .event {
    font-size: 17pt; font-weight: 700; letter-spacing: -0.01em; color: var(--tomato);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .tagline {
    font-size: 8pt; font-weight: 600; letter-spacing: .1em;
    text-transform: uppercase; color: #6b6b6b;
  }
  .rule {
    width: 28mm; height: 1.5pt; background: var(--basil);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .where { font-size: 19pt; font-weight: 800; }
  .qr svg { width: 46mm; height: 46mm; display: block; }
  .how { font-size: 8.5pt; color: #444; max-width: 110mm; line-height: 1.4; }
  .url { font-family: ui-monospace, monospace; font-size: 7pt; color: #888; }

  @media print {
    @page { size: letter portrait; margin: 12mm; }
    .bar { display: none; }
  }
</style>

<div class="bar">
  <button onclick="window.print()">Print all ${TAGS.length}</button>
  ${TAGS.length} tents on ${sheets} sheets &mdash; one straight cut across each sheet makes two cards.
  Print on card at 100%, no scaling.
</div>

${cards}
`;

writeFileSync(OUT, page);
console.log('wrote ' + OUT);
console.log(TAGS.length + ' tents, ' + sheets + ' sheets, codes point at ' + BASE);
