/**
 * Builds the printable floor guide. Run: node scripts/guide-pdf.js [--out FILE]
 *
 * Uses app/pdf.js - the same hand-written writer the close-out report goes
 * through - so this needs no dependencies and no build step, and a fix to the
 * writer is a fix to both documents.
 *
 * Every threshold, station and service point on these pages is read from
 * app/config.js rather than typed in here. Change a timing in the config and
 * the guide that trains staff on it changes with it, which is the only way a
 * printed document and a running system stay in agreement.
 */
import { writeFileSync } from 'node:fs';
import * as pdf from '../app/pdf.js';
import { config } from '../app/config.js';

const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'neapolitan-night-floor-guide.pdf';
})();

// ------------------------------------------------------------------ palette

const INK = [0.11, 0.086, 0.078];
const SOFT = [0.37, 0.33, 0.31];
const FAINT = [0.56, 0.51, 0.49];
const BRAND = [0.325, 0, 0];
const RULE = [0.88, 0.84, 0.83];
const WASH = [0.965, 0.925, 0.92];
const PAPER = [1, 1, 1];

const QUEUED = [0.54, 0.42, 0];
const COOKING = [0.66, 0.31, 0.05];
const READY = [0.12, 0.42, 0.25];
const LATE = [0.70, 0.15, 0.12];

const M = 46;
const doc = pdf.create({ margin: M });
const W = doc.width;
const RIGHT = W - M;
const COL = doc.innerWidth;

const fmt = (sec) => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');

// -------------------------------------------------------------- primitives

/**
 * Helvetica has no width table in app/pdf.js, so nothing set in it can be
 * centred. Anything that has to sit centred in a box is set in Courier, whose
 * widths are exact - which suits a kitchen document anyway.
 */
const monoMid = (text, cx, y, size, color, font = 'monoBold') => {
  doc.text(text, { x: cx - pdf.monoWidth(text, size) / 2, y, size, font, color });
};

function frame(x, y, w, h, color = RULE, width = 0.8) {
  doc.line(x, y, x + w, y, { color, width });
  doc.line(x, y + h, x + w, y + h, { color, width });
  doc.line(x, y, x, y + h, { color, width });
  doc.line(x + w, y, x + w, y + h, { color, width });
}

function panel(x, y, w, h, { fill = PAPER, accent = null, border = RULE } = {}) {
  doc.rect(x, y, w, h, fill);
  if (accent) doc.rect(x, y, w, 2.5, accent);
  if (border) frame(x, y, w, h, border);
}

/** Line with a two-stroke head at the far end. */
function arrow(x1, y1, x2, y2, color = FAINT, width = 1) {
  doc.line(x1, y1, x2, y2, { color, width });
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = x2 - ux * 6;
  const by = y2 - uy * 6;
  doc.line(bx - uy * 3.4, by + ux * 3.4, x2, y2, { color, width });
  doc.line(bx + uy * 3.4, by - ux * 3.4, x2, y2, { color, width });
}

function eyebrow(text, y, color = BRAND) {
  doc.text(text.toUpperCase(), { x: M, y, size: 8, font: 'bold', color });
}

function heading(text, y, size = 19) {
  doc.text(text, { x: M, y, size, font: 'bold', color: INK });
}

/** Wrapped body copy. Returns the y just past the last line. */
function para(text, y, opts = {}) {
  const x = opts.x == null ? M : opts.x;
  const width = opts.width == null ? COL : opts.width;
  const size = opts.size == null ? 9.5 : opts.size;
  const color = opts.color || SOFT;
  const lead = opts.lead == null ? 13 : opts.lead;
  const font = opts.font || 'regular';
  const lines = pdf.wrap(text, size, width);
  lines.forEach((line, i) => doc.text(line, { x, y: y + i * lead, size, font, color }));
  return y + lines.length * lead;
}

function rule(y, color = RULE) {
  doc.line(M, y, RIGHT, y, { color, width: 0.8 });
}

function footer(pageNo, label) {
  doc.line(M, 748, RIGHT, 748, { color: RULE, width: 0.6 });
  doc.text('Neapolitan Night - The Club at Carlton Woods', { x: M, y: 761, size: 7.5, color: FAINT });
  doc.text(label, { x: M + 260, y: 761, size: 7.5, color: FAINT });
  doc.text(String(pageNo), { x: RIGHT - pdf.monoWidth(String(pageNo), 8), y: 761, size: 8, font: 'mono', color: FAINT });
}

// ================================================================== page 1

doc.rect(0, 0, W, 132, WASH);
doc.rect(0, 130, W, 2, BRAND);

doc.text('THE CLUB AT CARLTON WOODS', { x: M, y: 52, size: 8.5, font: 'bold', color: BRAND });
doc.text('Neapolitan Night', { x: M, y: 86, size: 30, font: 'bold', color: INK });
doc.text('Floor Guide', { x: M, y: 114, size: 19, color: BRAND });

let y = para(
  'How an order travels from a member\'s phone to their table, and what each station does with it. '
  + 'Four roles, one ticket. Every timing and limit in this guide is read from the running system, so '
  + 'this document and the screens cannot drift apart.',
  170, { size: 10.5, lead: 15, width: COL - 60 },
);

eyebrow('One ticket, four hands', y + 26);

const stages = [
  ['QUEUED', 'Member sends', 'Lands on the kitchen rail', 'under New orders', QUEUED],
  ['COOKING', 'Kitchen accepts', 'Cook presses Accept.', 'The cook clock starts here', COOKING],
  ['READY', 'Kitchen calls it', 'Food Up - Call Runner.', 'Appears on the expo board', READY],
  ['DELIVERED', 'Runner drops it', 'Delivered to (table).', 'Phone says Buon appetito', READY],
];

const sw = (COL - 3 * 14) / 4;
const sy = y + 40;
stages.forEach((s, i) => {
  const x = M + i * (sw + 14);
  panel(x, sy, sw, 92, { accent: s[4] });
  doc.text(s[0], { x: x + 10, y: sy + 22, size: 7.5, font: 'monoBold', color: s[4] });
  doc.text(s[1], { x: x + 10, y: sy + 40, size: 10.5, font: 'bold', color: INK });
  doc.text(s[2], { x: x + 10, y: sy + 57, size: 7.5, color: SOFT });
  doc.text(s[3], { x: x + 10, y: sy + 69, size: 7.5, color: SOFT });
  if (i < 3) arrow(x + sw + 2, sy + 46, x + sw + 12, sy + 46, FAINT, 1.1);
});

y = sy + 118;
panel(M, y, COL, 60, { fill: WASH, accent: BRAND, border: null });
doc.text('Nothing here charges anyone.', { x: M + 14, y: y + 22, size: 10, font: 'bold', color: INK });
para(
  'The night is all you can eat. The app records which member numbers dined and how many people were '
  + 'at each table; the charge posts through the club\'s own system at close-out. A member who comes '
  + 'back for a second round is still one cover.',
  y + 37, { x: M + 14, width: COL - 28, size: 9, lead: 11.5 },
);

y += 88;
rule(y);
eyebrow('Who does what', y + 22);

const roles = [
  ['THE MEMBER', 'their own phone', 'Scans the tent, picks a language, enters their member number, builds and sends.'],
  ['BACK OF HOUSE', 'kitchen rail, iPad', 'Accepts the chit, cooks to its estimate, calls the runner.'],
  ['FRONT OF HOUSE', 'expo board, iPad', 'Runs the food, confirms allergies at the table, presses Delivered.'],
  ['MANAGER', 'manager + close-out', 'Prints tents, keeps the 86 list, watches the clocks, closes the night out.'],
];
let ry = y + 42;
roles.forEach((r) => {
  doc.rect(M, ry - 9, 3, 30, BRAND);
  doc.text(r[0], { x: M + 12, y: ry, size: 9, font: 'bold', color: INK });
  doc.text(r[1], { x: M + 150, y: ry, size: 8, font: 'mono', color: BRAND });
  doc.text(r[2], { x: M + 12, y: ry + 13, size: 9, color: SOFT });
  ry += 40;
});

footer(1, 'The ticket');

// ================================================================== page 2

doc.addPage();
eyebrow('Stations and service points', 62);
heading('The floor, and how a ticket crosses it', 88);
y = para(
  'The system routes on two things: what kind of item it is, and which tent the member scanned. Pasta '
  + 'goes to the main kitchen, pizza to the decks out on the patio, and the destination is whatever the '
  + 'code on the table said. Which means a pizza for a patio table barely travels, while the same pizza '
  + 'for the dining room crosses the building - worth knowing when the runner clock starts.',
  112, { width: COL - 40 },
);

const bandY = 160;
// Tall enough for the two cooking areas plus the note under them. They ended
// flush on the border at 236, with the note sitting on the last station box.
const bandH = 264;
const colW = (COL - 2 * 26) / 3;

panel(M, bandY, colW, bandH, { accent: COOKING });
doc.text('WHERE IT IS COOKED', { x: M + 12, y: bandY + 22, size: 7.5, font: 'monoBold', color: COOKING });
doc.text('Two areas', { x: M + 12, y: bandY + 42, size: 13, font: 'bold', color: INK });

/**
 * Grouped by the station's own `area`, never by guessing from its name. An
 * earlier draft of this page inferred the groupings and invented a poolside
 * that does not exist.
 */
const groupBy = (rows, key, value) => rows.reduce((acc, r) => {
  let g = acc.find((x) => x.name === r[key]);
  if (!g) { g = { name: r[key], items: [] }; acc.push(g); }
  g.items.push(value(r));
  return acc;
}, []);

const cookAreas = groupBy(config.kitchen.stations, 'area', (s) => s);

let sty = bandY + 64;
cookAreas.forEach((g) => {
  doc.text(g.name.toUpperCase(), { x: M + 12, y: sty, size: 7, font: 'monoBold', color: FAINT });
  g.items.forEach((s, i) => {
    const by = sty + 8 + i * 30;
    panel(M + 12, by, colW - 24, 24, { fill: WASH });
    doc.text(s.label, { x: M + 20, y: by + 16, size: 9.5, font: 'bold', color: INK });
    const sub = s.pans ? s.pans + ' pans' : s.decks + ' decks';
    doc.text(sub, { x: M + colW - 24 - pdf.monoWidth(sub, 8) - 8, y: by + 16, size: 8, font: 'mono', color: SOFT });
  });
  sty += 8 + g.items.length * 30 + 18;
});

doc.text('Tickets auto-assign, alternating', { x: M + 12, y: bandY + bandH - 14, size: 7.5, color: FAINT });

const passX = M + colW + 26;
panel(passX, bandY, colW, bandH, { accent: READY });
doc.text('THE PASS', { x: passX + 12, y: bandY + 22, size: 7.5, font: 'monoBold', color: READY });
doc.text('Expo', { x: passX + 12, y: bandY + 42, size: 13, font: 'bold', color: INK });
para('Everything the kitchen calls up lands here on one board, oldest first, whatever station cooked it.',
  bandY + 62, { x: passX + 12, width: colW - 24, size: 8.5, lead: 11 });
panel(passX + 12, bandY + 108, colW - 24, 46, { fill: WASH });
doc.text('Run These Now', { x: passX + 22, y: bandY + 128, size: 10, font: 'bold', color: INK });
doc.text('one button per ticket', { x: passX + 22, y: bandY + 142, size: 8, color: SOFT });
panel(passX + 12, bandY + 164, colW - 24, 46);
doc.text('Coming Up', { x: passX + 22, y: bandY + 184, size: 10, font: 'bold', color: INK });
doc.text('what is still cooking', { x: passX + 22, y: bandY + 198, size: 8, color: SOFT });

const zoneX = passX + colW + 26;
panel(zoneX, bandY, colW, bandH, { accent: BRAND });
doc.text('FRONT OF HOUSE', { x: zoneX + 12, y: bandY + 22, size: 7.5, font: 'monoBold', color: BRAND });
doc.text('Service points', { x: zoneX + 12, y: bandY + 42, size: 13, font: 'bold', color: INK });

let zy = bandY + 62;
groupBy(config.tags, 'area', (t) => t.label).forEach((g) => {
  doc.text(g.name.toUpperCase(), { x: zoneX + 12, y: zy, size: 7, font: 'monoBold', color: FAINT });
  zy = para(g.items.join(', '), zy + 12, { x: zoneX + 12, width: colW - 24, size: 9, lead: 11.5, color: INK }) + 12;
});

arrow(M + colW + 5, bandY + 120, passX - 5, bandY + 120, FAINT, 1.2);
arrow(passX + colW + 5, bandY + 120, zoneX - 5, bandY + 120, FAINT, 1.2);

y = bandY + bandH + 34;
rule(y);
eyebrow('And back again', y + 22);

const loop = [
  ['1', 'Member scans the tent', 'The code carries the table. Nobody types a table number, ever.'],
  ['2', 'Ticket routes by kind', 'Pasta to the main kitchen, pizza to the patio decks, alternating.'],
  ['3', 'Kitchen calls it up', 'It leaves the rail and appears on the pass, wherever it was cooked.'],
  ['4', 'Runner reads the destination', 'Written large on the card: the tent name, not a code to decode.'],
  ['5', 'Delivered closes the loop', 'The member\'s own phone updates as the runner walks away.'],
];
let ly = y + 46;
loop.forEach((s) => {
  doc.rect(M, ly - 9, 18, 18, BRAND);
  monoMid(s[0], M + 9, ly + 4, 9, PAPER);
  doc.text(s[1], { x: M + 28, y: ly + 4, size: 9.5, font: 'bold', color: INK });
  doc.text(s[2], { x: M + 210, y: ly + 4, size: 9, color: SOFT });
  ly += 26;
});

footer(2, 'The floor');

// ================================================================== page 3

doc.addPage();
eyebrow('01 - The member', 62);
heading('Their own phone. No app, no account.', 88);
para('They scan the code on the table tent and they are in. The whole order takes about a minute.',
  112, { width: COL - 180 });

const memberSteps = [
  ['Scan the tent', 'Every table has its own code. It carries the table with it, so the kitchen always knows where the food goes.'],
  ['Language, then member number', 'English and Espanol are the first thing on the first screen, each written in its own language. Member numbers are 1 to 4 digits; leading zeros do not matter.'],
  ['Pasta or pizza', 'One tap. The next screen greets them by name.'],
  ['How many at the table', 'Up to ' + config.order.maxGuests + '. This is the number that becomes covers at close-out.'],
  ['Build each plate', 'One tile grid per person. Anything 86\'d is greyed out and marked sold out - visible rather than hidden. Allergens show on each ingredient as they build.'],
  ['Review and send', 'A note box for anything the tiles do not cover. They get a ticket number, a 4-character claim code, and a live bar: Sent, Cooking, Ready, Enjoy.'],
  ['Another round', 'Start another order goes back to pasta-or-pizza, not the keypad. Same party, same table, and under all you can eat it adds nothing to their bill.'],
];

y = 148;
memberSteps.forEach((s, i) => {
  doc.rect(M, y - 9, 20, 20, BRAND);
  monoMid(String(i + 1), M + 10, y + 5, 10, PAPER);
  doc.text(s[0], { x: M + 32, y: y + 5, size: 11, font: 'bold', color: INK });
  const end = para(s[1], y + 21, { x: M + 32, width: COL - 32 - 178, size: 9, lead: 11.5 });
  if (i < memberSteps.length - 1) doc.line(M + 10, y + 14, M + 10, end + 3, { color: RULE, width: 0.8 });
  y = end + 16;
});

const cardY = 148;
const cardX = RIGHT - 152;
panel(cardX, cardY, 152, 198, { fill: WASH });
doc.text('WHAT THEY CAN BUILD', { x: cardX + 12, y: cardY + 20, size: 7, font: 'monoBold', color: FAINT });
const limits = [
  ['People', 'up to ' + config.order.maxGuests],
  ['Sauces, bowl', 'up to ' + config.order.maxSaucesPerBowl],
  ['Proteins', 'up to ' + config.order.maxProteinsPerItem],
  ['Toppings, bowl', 'up to ' + config.order.maxToppingsPerBowl],
  ['Sides', 'up to ' + config.order.maxSidesPerBowl],
  ['Cheeses, pizza', 'up to ' + config.order.maxCheesesPerPizza],
  ['Toppings, pizza', 'up to ' + config.order.maxToppingsPerPizza],
  ['Claim code', '4 chars'],
];
let liy = cardY + 40;
limits.forEach(([k, v]) => {
  doc.text(k, { x: cardX + 12, y: liy, size: 8.5, color: SOFT });
  doc.text(v, { x: cardX + 140 - pdf.monoWidth(v, 8), y: liy, size: 8, font: 'mono', color: INK });
  doc.line(cardX + 12, liy + 5, cardX + 140, liy + 5, { color: RULE, width: 0.4 });
  liy += 19;
});

y += 6;
panel(M, y, COL, 58, { fill: WASH, accent: QUEUED, border: null });
doc.text('An unrecognised member number still goes through.', { x: M + 14, y: y + 22, size: 10, font: 'bold', color: INK });
para('The kitchen is not the place to settle a membership question and a hungry guest should not be '
  + 'stuck at a keypad. The ticket is stamped UNVERIFIED and appears flagged on the close-out sheet for '
  + 'the office to sort out afterwards.', y + 37, { x: M + 14, width: COL - 28, size: 9, lead: 11.5 });

footer(3, 'The member');

// ================================================================== page 4

doc.addPage();
eyebrow('02 - Back of house', 62);
heading('The chit rail', 88);
y = para('Three lanes. Chits move left to right and never need dragging. Built for a cook with flour on '
  + 'their hands, so every action is one large button or one key.', 112, { width: COL - 40 });

const lanes = [
  ['New orders', QUEUED, 'Accept'],
  ['Cooking', COOKING, 'Food Up - Call Runner'],
  ['Ready / runner', READY, 'picked up by expo'],
];
const lw = (COL - 2 * 16) / 3;
const lyTop = y + 24;
lanes.forEach((l, i) => {
  const x = M + i * (lw + 16);
  panel(x, lyTop, lw, 106, { accent: l[1] });
  doc.text(l[0].toUpperCase(), { x: x + 12, y: lyTop + 22, size: 8, font: 'monoBold', color: l[1] });
  panel(x + 12, lyTop + 34, lw - 24, 26, { fill: WASH });
  doc.text('#41  Table 3', { x: x + 20, y: lyTop + 51, size: 8.5, font: 'mono', color: INK });
  panel(x + 12, lyTop + 68, lw - 24, 26, { fill: WASH });
  doc.text('#42  Patio A', { x: x + 20, y: lyTop + 85, size: 8.5, font: 'mono', color: INK });
  doc.text(l[2], { x: x + 12, y: lyTop + 122, size: 8, font: 'bold', color: SOFT });
  if (i < 2) arrow(x + lw + 3, lyTop + 54, x + lw + 13, lyTop + 54, FAINT, 1.1);
});

y = lyTop + 150;
rule(y);

const halfW = (COL - 30) / 2;
eyebrow('Reading a chit', y + 22);
let cy = y + 44;
[
  ['Allergy banner', 'Names exactly what to avoid. Read it before the food.'],
  ['Rush / Held / Unverified', 'Each badge says what it means in words, not colour alone.'],
  ['A Spanish note', 'Shows a best-effort English reading with the member\'s own words underneath, tagged ES. Read both - the gloss is a helper, not a translation.'],
].forEach((n) => {
  doc.text(n[0], { x: M, y: cy, size: 9.5, font: 'bold', color: INK });
  cy = para(n[1], cy + 13, { width: halfW, size: 9, lead: 11.5 }) + 12;
});

const rx = M + halfW + 30;
doc.text('BUMP BAR', { x: rx, y: y + 22, size: 8, font: 'bold', color: BRAND });
let ky = y + 44;
[
  ['1 - 9', 'send that chit forward'],
  ['Shift + 1-9', 'undo that step'],
  ['H', 'hold or release'],
  ['R', 'mark rush'],
  ['S', 'alert sounds'],
  ['Esc', 'clear selection'],
].forEach(([k, v]) => {
  doc.text(k, { x: rx, y: ky, size: 8.5, font: 'monoBold', color: INK });
  doc.text(v, { x: rx + 80, y: ky, size: 9, color: SOFT });
  ky += 16;
});

ky += 12;
doc.text('CLOCKS', { x: rx, y: ky, size: 7, font: 'monoBold', color: FAINT });
ky += 16;
[
  ['Queue amber', fmt(config.sla.acceptWarnSec), SOFT],
  ['Queue red', fmt(config.sla.acceptLateSec), LATE],
  ['Cook late', config.sla.cookLateFactor + 'x est', LATE],
  ['Undo window', fmt(config.sla.undoWindowSec), SOFT],
].forEach(([k, v, c]) => {
  doc.text(k, { x: rx, y: ky, size: 9, color: SOFT });
  doc.text(v, { x: RIGHT - pdf.monoWidth(v, 8.5), y: ky, size: 8.5, font: 'monoBold', color: c });
  doc.line(rx, ky + 5, RIGHT, ky + 5, { color: RULE, width: 0.4 });
  ky += 18;
});

y = Math.max(cy, ky) + 18;
panel(M, y, COL, 48, { fill: WASH, accent: BRAND, border: null });
doc.text('Numbers run across the whole rail', { x: M + 14, y: y + 21, size: 9.5, font: 'bold', color: INK });
para('Left lane first, re-flowing as chits move - so 3 is always the third chit you can see, not a '
  + 'fixed ticket. Tap a chit to select it, tap again to let go.',
  y + 34, { x: M + 14, width: COL - 28, size: 9, lead: 11 });

footer(4, 'Back of house');

// ================================================================== page 5

doc.addPage();
eyebrow('03 - Front of house', 62);
heading('Expo and runners', 88);
y = para('Deliberately thinner than the kitchen screen. A runner carrying four bowls needs four things: '
  + 'the ticket number, where it goes, what is on the tray, and one button.', 112, { width: COL - 40 });

y += 16;
[
  ['Work the Run These Now cards', 'Oldest first. Each card is one ticket with its destination written large.'],
  ['Watch the runner clock', 'Starts when the kitchen calls food up. Amber at ' + fmt(config.sla.runnerWarnSec) + ', red and nudging at ' + fmt(config.sla.runnerLateSec) + '. That clock is food sitting under a lamp.'],
  ['Confirm allergies at the table', 'Allergy orders repeat their warning on the expo card on purpose, so it gets said out loud as the plate goes down.'],
  ['Press Delivered', 'One button, and it names the table. The member\'s phone updates as you walk away. Undo is there for ' + fmt(config.sla.undoWindowSec) + '.'],
  ['Use Coming Up to get ahead', 'The sidebar counts down what is still cooking and flips red when the kitchen is behind - the cue to warn a table before it complains.'],
].forEach((s, i, all) => {
  doc.rect(M, y - 9, 20, 20, BRAND);
  monoMid(String(i + 1), M + 10, y + 5, 10, PAPER);
  doc.text(s[0], { x: M + 32, y: y + 5, size: 11, font: 'bold', color: INK });
  const end = para(s[1], y + 21, { x: M + 32, width: COL - 32, size: 9, lead: 11.5 });
  if (i < all.length - 1) doc.line(M + 10, y + 14, M + 10, end + 3, { color: RULE, width: 0.8 });
  y = end + 16;
});

panel(M, y, COL, 58, { fill: WASH, accent: BRAND, border: null });
doc.text('A member without a smartphone is not stuck.', { x: M + 14, y: y + 22, size: 10, font: 'bold', color: INK });
para('Any staff device can open the same ordering screen, take their member number and build the order '
  + 'with them. The ticket is identical - the kitchen cannot tell, and does not need to.',
  y + 37, { x: M + 14, width: COL - 28, size: 9, lead: 11.5 });

footer(5, 'Front of house');

// ================================================================== page 6
// The manager gets its own page. Sharing one with expo ran the last three
// lines off the bottom of the sheet - caught by the bounds check, not by
// looking at the first page and assuming the rest followed.

doc.addPage();
eyebrow('04 - Manager', 62);
heading('Setting up, and closing out', 88);
y = para('Two screens: one to set the night up and watch it run, one to close it out. Both sit behind '
  + 'the staff passcode.', 112, { width: COL - 40 });

let my = y + 26;
[
  ['Before service', 'Print the tents from the QR codes tab. Codes are drawn on the device, so this works with the internet unplugged and no outside service sees the club\'s links.'],
  ['Before service', 'Check the 86 list. Switch an ingredient off and it greys out on every member\'s phone within a second. The count rides on the tab itself.'],
  ['During service', 'Today at a glance: orders, covers, what is open now, average accept, cook and runner times, ticket time at p90, on-time percentage.'],
  ['Any time', 'Food cost prices the pantry the way a kitchen buys it - pack price and portions per pack - and works out cost per bowl, per pizza and per cover from what members actually built.'],
  ['After service', 'Close-out leads with who to charge: every member number that dined and how many covers, sorted by member number so it reconciles line by line. Save PDF keeps the lot.'],
].forEach((s) => {
  doc.text(s[0].toUpperCase(), { x: M, y: my, size: 7, font: 'monoBold', color: BRAND });
  my = para(s[1], my + 13, { x: M, width: COL - 190, size: 9.5, lead: 12.5 }) + 18;
});

// the close-out running order, beside the steps
const coX = RIGHT - 176;
panel(coX, y + 26, 176, 150, { fill: WASH });
doc.text('CLOSE-OUT, IN ORDER', { x: coX + 12, y: y + 46, size: 7, font: 'monoBold', color: FAINT });
[
  ['1', 'Members to charge', 'with member numbers'],
  ['2', 'Service stats', 'times, on-time percent'],
  ['3', 'Food usage', 'split by station'],
].forEach((r, i) => {
  const ry2 = y + 66 + i * 34;
  doc.rect(coX + 12, ry2 - 8, 16, 16, BRAND);
  monoMid(r[0], coX + 20, ry2 + 3, 8.5, PAPER);
  doc.text(r[1], { x: coX + 36, y: ry2 + 2, size: 9, font: 'bold', color: INK });
  doc.text(r[2], { x: coX + 36, y: ry2 + 14, size: 8, color: SOFT });
});

my = Math.max(my, y + 194);
panel(M, my, COL, 62, { fill: WASH, accent: LATE, border: null });
doc.text('The staff passcode is a convenience lock, not security.', { x: M + 14, y: my + 22, size: 10, font: 'bold', color: INK });
para('It stops a member who wanders onto a staff link from landing on the kitchen rail. Treat the '
  + 'staff screens as trusted-network tools and keep the links inside the team. Clear today deletes '
  + 'the whole service day and cannot be undone.',
  my + 37, { x: M + 14, width: COL - 28, size: 9, lead: 11.5 });

footer(6, 'Manager');

// ================================================================== page 7

doc.addPage();
eyebrow('05 - When it goes wrong', 62);
heading('Everything below is reversible', 88);
y = para('And everything below is recorded. No step silently overwrites another: an undo is its own '
  + 'entry in the ticket\'s history, so a mis-tap in a rush leaves an honest trail.',
  112, { width: COL - 40 });

y += 22;
doc.text('WHAT HAPPENED', { x: M, y, size: 7, font: 'monoBold', color: FAINT });
doc.text('WHO', { x: M + 172, y, size: 7, font: 'monoBold', color: FAINT });
doc.text('THE MOVE', { x: M + 224, y, size: 7, font: 'monoBold', color: FAINT });
y += 7;
rule(y);
y += 18;

[
  ['Accepted the wrong chit', 'Kitchen', 'Undo arrow, or Shift + the chit number. Back to New orders.'],
  ['Called food up too early', 'Kitchen', 'Undo returns it to Cooking and takes it off the expo board.'],
  ['Delivered by mistake', 'Expo', 'Undo, within ' + fmt(config.sla.undoWindowSec) + '. After that, ask a manager.'],
  ['A table needs it now', 'Kitchen', 'Mark it Rush with R. It sorts to the front of the rail.'],
  ['The party stepped away', 'Kitchen', 'Hold with H. It leaves the queue and stops its clock. Back to queue returns it.'],
  ['Order placed in error', 'Manager', 'Void it. Stops counting toward covers, usage and cost; stays in the close-out exceptions.'],
  ['Ran out of an ingredient', 'Either', '86 it on the manager screen. Every phone greys it out at once.'],
  ['Member number unknown', 'Nobody', 'Goes through flagged Unverified and lands on the close-out sheet for the office.'],
  ['Wi-Fi drops', 'Nobody', 'Screens work from cache and sync when it returns. A member can still send; it queues on their phone.'],
].forEach((r) => {
  doc.text(r[0], { x: M, y, size: 9, font: 'bold', color: INK });
  doc.text(r[1], { x: M + 172, y, size: 8, font: 'mono', color: BRAND });
  const end = para(r[2], y, { x: M + 224, width: COL - 224, size: 9, lead: 11 });
  y = Math.max(y + 15, end + 5);
  doc.line(M, y - 7, RIGHT, y - 7, { color: RULE, width: 0.4 });
  y += 8;
});

y += 4;
panel(M, y, COL, 48, { fill: WASH, accent: BRAND, border: null });
doc.text('Voided is not deleted.', { x: M + 14, y: y + 21, size: 9.5, font: 'bold', color: INK });
para('A voided ticket keeps its history and appears in the close-out exceptions list. If a table '
  + 'disputes something, the evidence is still there.',
  y + 34, { x: M + 14, width: COL - 28, size: 9, lead: 11 });

y += 78;
rule(y);
eyebrow('Training a new starter', y + 24);
doc.text('Three passes, about twenty minutes.', { x: M, y: y + 42, size: 9.5, color: SOFT });

const tw = (COL - 2 * 18) / 3;
let ty = y + 64;
[
  ['Order as a member', 'Have them scan a tent and build a plate for themselves. Two minutes, and they understand the whole guest side. Do this one first, always.'],
  ['Push their ticket through', 'Then accept and call up the order they just placed, and deliver it from expo. Watching their own phone change teaches the chain faster than describing it.'],
  ['Break it on purpose', 'Undo an accept, hold a chit, release it, 86 an ingredient while someone else has the ordering screen open. The recoveries are what people panic about in service.'],
].forEach((t, i) => {
  const x = M + i * (tw + 18);
  doc.rect(x, ty, 24, 2.5, BRAND);
  doc.text(t[0], { x, y: ty + 22, size: 10, font: 'bold', color: INK });
  para(t[1], ty + 36, { x, width: tw, size: 8.5, lead: 11 });
});

footer(7, 'When it goes wrong');

// ------------------------------------------------------------------ write

const bytes = doc.build({
  title: 'Neapolitan Night - Floor Guide',
  author: 'The Club at Carlton Woods',
});
writeFileSync(OUT, Buffer.from(bytes));
console.log('wrote ' + OUT + '  (' + doc.pageCount + ' pages, ' + bytes.length + ' bytes)');
