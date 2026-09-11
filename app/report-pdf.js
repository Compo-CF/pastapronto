/**
 * The close-out report, laid out as a PDF.
 *
 * Same order as the screen and the print stylesheet - who to charge, then how
 * service ran, then what the kitchen used - because a manager who has read one
 * should not have to relearn the other.
 *
 * Kept apart from report.js so the layout stays pure: it takes a shiftReport()
 * and returns bytes, touches no DOM, and runs under plain node. Same split
 * order.js already has from the screens.
 *
 * Every number is set in Courier and right-aligned, because those widths are
 * exact (see pdf.js). Labels and prose are Helvetica and always left-aligned,
 * because its widths are not in this repo and a guessed centre is worse than
 * an honest left edge.
 */

import * as pdf from './pdf.js';

const INK = [0.13, 0.13, 0.13];
const SOFT = [0.42, 0.40, 0.39];
const FAINT = [0.58, 0.56, 0.54];
const RULE = [0.80, 0.78, 0.75];
const HEAD_BG = [0.95, 0.94, 0.92];
const HAIRLINE = [0.90, 0.89, 0.87];

const SIZE = {
  date: 17, h2: 9.5, body: 9, small: 7.8, figure: 26, cell: 8.2, foot: 7,
};
const LEAD = { body: 12, row: 13.5, section: 26 };

/** mm:ss. Duplicated from ui.js so this file imports nothing browser-only. */
function mmss(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function prettyDate(dateStr) {
  const d = new Date(String(dateStr) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

/**
 * Build the document.
 *
 * @param {object} report  output of order.shiftReport()
 * @param {string} date    service date, YYYY-MM-DD
 * @param {{orgName?: string, venueName?: string, accent?: number[]}} brand
 * @returns {Uint8Array}
 */
export function buildReportPdf(report, date, brand = {}) {
  const doc = pdf.create({ margin: 44 });
  const left = doc.margin;
  const right = doc.width - doc.margin;
  const accent = brand.accent || [0.33, 0, 0];
  const title = (brand.orgName || brand.venueName || 'PastaPresto') + ' close-out ' + date;

  let y = 0;

  // ---- page furniture ----------------------------------------------------

  const header = () => {
    const org = brand.orgName || brand.venueName || 'PastaPresto';
    const sub = brand.orgName && brand.venueName
      ? brand.venueName + ' - Close-out report'
      : 'Close-out report';
    doc.text(org, { x: left, y: doc.margin + 2, size: 10.5, font: 'bold', color: INK });
    doc.text(sub, { x: left, y: doc.margin + 15, size: SIZE.small, color: SOFT });
    doc.text(prettyDate(date), { x: left, y: doc.margin + 38, size: SIZE.date, font: 'bold', color: INK });
    doc.line(left, doc.margin + 48, right, doc.margin + 48, { width: 1.4, color: INK });
    return doc.margin + 70;
  };

  /** Room for `points`, or turn the page. */
  const need = (points) => {
    if (y + points <= doc.height - doc.margin - 26) return;
    doc.addPage();
    y = header();
  };

  const section = (label) => {
    need(LEAD.section + 34);
    y += 8;
    doc.line(left, y, right, y, { width: 0.8, color: RULE });
    y += 13;
    doc.text(label.toUpperCase(), { x: left, y, size: SIZE.h2, font: 'bold', color: accent });
    y += 15;
  };

  const prose = (text, color) => {
    pdf.wrap(text, SIZE.body, doc.innerWidth).forEach((line) => {
      need(LEAD.body);
      doc.text(line, { x: left, y, size: SIZE.body, color: color || SOFT });
      y += LEAD.body;
    });
    y += 2;
  };

  /**
   * A table. Columns are {label, width, get, mono, bold}. A mono column is
   * right-aligned on its own right edge, which is what lines the numbers up;
   * the widths are relative and scaled to the text block.
   */
  const table = (cols, rows, footRow) => {
    const total = cols.reduce((a, c) => a + c.width, 0);
    const scale = doc.innerWidth / total;
    const xs = [];
    let acc = left;
    cols.forEach((c) => { xs.push(acc); acc += c.width * scale; });
    // A right-aligned value needs real air before the next column starts, or
    // it reads as one run of words: "17 one AYCE charge per guest".
    const GAP = 9;
    const colRight = (i) => xs[i] + cols[i].width * scale - GAP;
    const colWidth = (i) => cols[i].width * scale - GAP - 2;

    const headRow = () => {
      doc.rect(left, y - 9, doc.innerWidth, 15, HEAD_BG);
      cols.forEach((c, i) => {
        doc.text(c.label.toUpperCase(), {
          x: c.mono ? colRight(i) : xs[i],
          y,
          size: 6.8,
          font: 'monoBold',
          align: c.mono ? 'right' : 'left',
          color: SOFT,
        });
      });
      y += LEAD.row + 2;
    };

    need(LEAD.row * 3);
    headRow();

    rows.forEach((row) => {
      // A table may run past the page; the header comes with it so page two
      // is never a wall of unlabelled numbers.
      if (y + LEAD.row > doc.height - doc.margin - 26) {
        doc.addPage();
        y = header();
        headRow();
      }
      cols.forEach((c, i) => {
        const raw = c.get(row);
        const value = raw == null ? '' : String(raw);
        if (c.mono) {
          doc.text(pdf.fitMono(value, SIZE.cell, colWidth(i)), {
            x: colRight(i), y, size: SIZE.cell,
            font: c.bold ? 'monoBold' : 'mono', align: 'right', color: INK,
          });
        } else {
          doc.text(value.slice(0, Math.max(1, Math.floor(colWidth(i) / (SIZE.cell * 0.5)))), {
            x: xs[i], y, size: SIZE.cell, font: c.bold ? 'bold' : 'regular', color: INK,
          });
        }
      });
      y += LEAD.row;
      doc.line(left, y - 9, right, y - 9, { width: 0.4, color: HAIRLINE });
    });

    if (footRow) {
      need(LEAD.row + 8);
      doc.line(left, y - 9, right, y - 9, { width: 1.1, color: INK });
      y += 3;
      cols.forEach((c, i) => {
        const raw = footRow[i];
        if (raw == null || raw === '') return;
        if (c.mono) {
          doc.text(String(raw), {
            x: colRight(i), y, size: SIZE.cell, font: 'monoBold', align: 'right', color: INK,
          });
        } else {
          doc.text(String(raw), { x: xs[i], y, size: SIZE.cell, font: 'bold', color: INK });
        }
      });
      y += LEAD.row;
    }
    y += 4;
  };

  // ---- the report --------------------------------------------------------

  y = header();

  if (!report || !report.totals || report.totals.orders === 0) {
    doc.text('No orders on this service date.', { x: left, y: y + 10, size: 11, color: SOFT });
    return doc.build({ title, author: brand.orgName || '' });
  }

  const t = report.totals;
  const k = report.byKind || { pasta: {}, pizza: {} };

  prose(t.covers + ' charges tonight - one per guest, all you can eat - across '
    + t.members + ' member' + (t.members === 1 ? '' : 's') + '. The kitchen sent '
    + t.bowls + ' items (' + (k.pasta.items || 0) + ' bowls, ' + (k.pizza.items || 0)
    + ' pizzas) on ' + t.orders + ' order' + (t.orders === 1 ? '' : 's')
    + '. How much they ordered does not change what they are charged.', INK);

  // ---- members to charge -------------------------------------------------

  section('Members to charge');

  doc.text(String(t.covers), { x: left, y: y + 18, size: SIZE.figure, font: 'monoBold', color: accent });
  doc.text('CHARGES TO POST', { x: left, y: y + 32, size: SIZE.small, font: 'bold', color: FAINT });
  const secondX = left + 160;
  doc.text(String(t.members), { x: secondX, y: y + 18, size: SIZE.figure, font: 'monoBold', color: accent });
  doc.text('MEMBER' + (t.members === 1 ? '' : 'S') + ' DINING',
    { x: secondX, y: y + 32, size: SIZE.small, font: 'bold', color: FAINT });
  y += 50;

  // Member-number order, because this gets reconciled against the club's own
  // billing list and two lists only compare easily in the same order.
  const members = [...(report.members || [])].sort(
    (a, b) => (Number(a.memberNumber) || 0) - (Number(b.memberNumber) || 0)
      || String(a.memberNumber).localeCompare(String(b.memberNumber)),
  );

  table([
    { label: 'Member', width: 62, get: (m) => m.memberNumber, mono: true },
    { label: 'Name', width: 148, get: (m) => m.name || '' },
    { label: 'Charges', width: 60, get: (m) => m.partySize, mono: true, bold: true },
    { label: 'Orders', width: 52, get: (m) => m.orders, mono: true },
    { label: 'Bowls', width: 48, get: (m) => m.bowls || '', mono: true },
    { label: 'Pizzas', width: 50, get: (m) => m.pizzas || '', mono: true },
    { label: 'Items', width: 46, get: (m) => m.items, mono: true },
    { label: '/cover', width: 50, get: (m) => m.itemsPerCover, mono: true },
    { label: 'Confirm', width: 58, get: (m) => (m.status === 'verified' ? '' : 'CHECK') },
  ], members, [
    members.length + (members.length === 1 ? ' member' : ' members'), '',
    t.covers, t.orders, k.pasta.items, k.pizza.items, t.bowls, t.bowlsPerCover, '',
  ]);

  const unverified = members.filter((m) => m.status !== 'verified');
  prose('Charges is the billing column - the rest is consumption. '
    + (t.repeatOrders > 0
      ? t.repeatOrders + ' order' + (t.repeatOrders === 1 ? ' was' : 's were')
        + ' a repeat trip by a member already counted, and added nothing to the bill. '
      : 'Nobody ordered twice tonight. ')
    + (unverified.length
      ? unverified.length + ' number' + (unverified.length === 1 ? ' was' : 's were')
        + ' not in the member directory and is marked CHECK - the food went out '
        + 'anyway, but confirm against the roster before posting: '
        + unverified.map((m) => m.memberNumber).join(', ') + '.'
      : 'Every member number was in the directory.'));

  // ---- service stats -----------------------------------------------------

  section('Service stats');
  table([
    { label: 'Measure', width: 160, get: (r) => r[0] },
    { label: 'Value', width: 90, get: (r) => r[1], mono: true, bold: true },
    { label: 'Note', width: 250, get: (r) => r[2] },
  ], [
    ['Covers = charges', String(t.covers), 'one AYCE charge per guest'],
    ['Items', String(t.bowls), (k.pasta.items || 0) + ' bowls / ' + (k.pizza.items || 0) + ' pizzas'],
    ['Items per cover', String(t.bowlsPerCover), 'how much the room ate'],
    ['Delivered', String(t.delivered), t.stillOpen + ' still open'],
    ['On time', report.onTime.pct == null ? '--' : report.onTime.pct + '%',
      report.onTime.lateCount + ' late of ' + (report.onTime.count + report.onTime.lateCount)],
    ['Avg ticket', mmss(report.timings.avgTotalSec), 'order to table'],
    ['Ticket p90', mmss(report.timings.p90TotalSec), 'worst ' + mmss(report.timings.worstTotalSec)],
    ['Avg cook', mmss(report.timings.avgCookSec), 'accept to food up'],
    ['Avg to accept', mmss(report.timings.avgQueueSec), 'wait before a cook took it'],
  ]);

  // ---- service curve -----------------------------------------------------

  if ((report.curve || []).length) {
    section('Per 15 minutes');
    table([
      { label: 'Time', width: 80, get: (b) => b.bucket, mono: true },
      { label: 'Orders', width: 70, get: (b) => b.orders, mono: true },
      { label: 'Bowls', width: 70, get: (b) => b.bowls, mono: true },
      { label: 'Pizzas', width: 70, get: (b) => b.pizzas, mono: true },
      { label: 'Items', width: 70, get: (b) => b.items, mono: true },
      { label: 'Covers', width: 70, get: (b) => b.covers, mono: true },
    ], report.curve);
    if (report.peak) {
      prose('Peak was ' + report.peak.items + ' items at ' + report.peak.bucket
        + ' - ' + report.peak.bowls + ' bowls and ' + report.peak.pizzas + ' pizzas.');
    }
  }

  // ---- food usage --------------------------------------------------------

  const lanes = [
    ['Pasta station', 'pasta', [
      ['Pasta shapes', report.mix.pasta.pastas], ['Sauces', report.mix.pasta.sauces],
      ['Proteins', report.mix.pasta.proteins], ['Toppings', report.mix.pasta.toppings],
      ['Sides', report.mix.pasta.sides], ['Portions', report.mix.pasta.portions],
    ]],
    ['Pizza station', 'pizza', [
      ['Sauces', report.mix.pizza.sauces], ['Cheeses', report.mix.pizza.cheeses],
      ['Proteins', report.mix.pizza.proteins], ['Toppings', report.mix.pizza.toppings],
    ]],
  ];
  const live = lanes.filter(([, , groups]) => groups.some(([, rows]) => (rows || []).length));

  if (live.length) {
    section('Food usage - prep guide for tomorrow');
    live.forEach(([label, kind, groups]) => {
      const kk = k[kind] || {};
      need(34);
      doc.text(label, { x: left, y, size: 11, font: 'bold', color: INK });
      doc.text((kk.orders || 0) + ' orders   ' + (kk.items || 0) + ' '
        + (kind === 'pizza' ? 'pizzas' : 'bowls') + '   ' + (kk.covers || 0) + ' covers',
      { x: left + 108, y, size: SIZE.small, color: SOFT });
      y += 16;

      groups.filter(([, rows]) => (rows || []).length).forEach(([groupLabel, rows]) => {
        need(LEAD.body * 2);
        doc.text(groupLabel, { x: left, y, size: SIZE.small, font: 'bold', color: FAINT });
        y += 11;
        // Two to a line, so a long prep list does not run for pages.
        for (let i = 0; i < rows.length; i += 2) {
          need(LEAD.body);
          [rows[i], rows[i + 1]].forEach((item, col) => {
            if (!item) return;
            const x = left + col * (doc.innerWidth / 2);
            doc.text(String(item.count), {
              x: x + 22, y, size: SIZE.cell, font: 'monoBold', align: 'right', color: accent,
            });
            doc.text(item.name, { x: x + 28, y, size: SIZE.cell, color: INK });
          });
          y += LEAD.body;
        }
        y += 3;
      });
      y += 6;
    });
  }

  // ---- follow-ups --------------------------------------------------------

  section('Late tickets');
  if ((report.late || []).length) {
    table([
      { label: 'Ticket', width: 60, get: (x) => '#' + x.ticketNo, mono: true },
      { label: 'Where', width: 110, get: (x) => x.tagLabel || '' },
      { label: 'Station', width: 90, get: (x) => x.station || '' },
      { label: 'Items', width: 50, get: (x) => x.bowls, mono: true },
      { label: 'Estimate', width: 70, get: (x) => mmss(x.estimateSec), mono: true },
      { label: 'Actual', width: 66, get: (x) => mmss(x.cookSec), mono: true },
      { label: 'Over by', width: 70, get: (x) => '+' + mmss(x.overSec), mono: true, bold: true },
    ], report.late);
  } else {
    prose('Nothing ran late. Every delivered ticket finished inside its allowance.');
  }

  if ((report.stations || []).length) {
    section('By station');
    table([
      { label: 'Station', width: 150, get: (s) => s.id },
      { label: 'Orders', width: 80, get: (s) => s.orders, mono: true },
      { label: 'Items', width: 80, get: (s) => s.bowls, mono: true },
      { label: 'Avg cook', width: 90, get: (s) => mmss(s.avgCookSec), mono: true },
    ], report.stations);
  }

  section('Exceptions to follow up');
  const e = report.exceptions || {};
  const list = (arr) => ((arr || []).length ? arr.map((x) => '#' + x.ticketNo).join(', ') : 'none');
  table([
    { label: 'Kind', width: 150, get: (r) => r[0] },
    { label: 'Count', width: 66, get: (r) => r[1], mono: true, bold: true },
    { label: 'Tickets', width: 284, get: (r) => r[2] },
  ], [
    ['Voided / comped', (e.voided || []).length, list(e.voided)],
    ['Left on hold', (e.held || []).length, list(e.held)],
    ['Rushed', (e.rushed || []).length, list(e.rushed)],
    ['Allergy orders', (e.allergy || []).length,
      (e.allergy || []).length
        ? e.allergy.map((x) => '#' + x.ticketNo + ' (' + (x.avoid || []).join('/') + ')').join(', ')
        : 'none'],
    ['Unverified members', (e.unverifiedMembers || []).length,
      (e.unverifiedMembers || []).length
        ? e.unverifiedMembers.map((x) => '#' + x.ticketNo + '/' + x.memberNumber).join(', ')
        : 'none'],
  ]);

  // ---- footers, stamped once the page count is known ---------------------

  const generated = new Date(report.generatedAt || Date.now());
  const stamp = prettyDate(date) + '   generated '
    + generated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const total = doc.pageCount;
  for (let i = 0; i < total; i += 1) {
    doc.selectPage(i);
    const fy = doc.height - doc.margin + 10;
    doc.line(left, fy - 12, right, fy - 12, { width: 0.5, color: RULE });
    doc.text(stamp, { x: left, y: fy, size: SIZE.foot, color: FAINT });
    doc.text('Page ' + (i + 1) + ' of ' + total, {
      x: right, y: fy, size: SIZE.foot, font: 'mono', align: 'right', color: FAINT,
    });
  }

  return doc.build({ title, author: brand.orgName || '', creator: 'PastaPresto close-out' });
}
