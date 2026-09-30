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
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import * as pdf from '../app/pdf.js';
import { config } from '../app/config.js';

/**
 * Screens captured from the running app into shots/. They are committed rather
 * than regenerated on every build: a guide that only assembles when someone
 * has a dev server up is a guide that stops being buildable.
 *
 * A missing file is not fatal. The page falls back to a labelled placeholder
 * so the layout still holds and the gap is obvious, rather than the build
 * dying and nobody getting a document at all.
 */
const shot = (name) => {
  const path = new URL('../shots/' + name, import.meta.url);
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
};

const SHOTS = {
  logo: shot('00-logo.jpeg'),
  landing: shot('01-guest-landing.jpeg'),
  lane: shot('02-guest-lane.jpeg'),
  build: shot('03-guest-build.jpeg'),
  kitchen: shot('04-kitchen.jpeg'),
  expo: shot('05-expo.jpeg'),
  cost: shot('06-food-cost.jpeg'),
};

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
// #a8792a - lifted from brands/carltonwoods.css, the club's own accent.
const GOLD = [0.659, 0.475, 0.165];

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

/**
 * A screenshot in a box `maxW` wide, centred, with a caption under it.
 * Returns the y below the caption so the page can carry on.
 *
 * A screen is worth more than a drawing of a screen: these are captures of the
 * running app, not mockups, so what a cook is told to look for is what they
 * will actually see.
 */
function screenshot(bytes, maxW, caption, y, maxH = 340) {
  const x0 = M + (COL - maxW) / 2;
  if (!bytes) {
    panel(x0, y, maxW, 60, { fill: WASH });
    doc.text('[ screenshot missing: run the capture again ]', { x: x0 + 14, y: y + 34, size: 9, color: LATE });
    return y + 74;
  }
  const box = doc.fit(bytes, maxW, maxH);
  const x = M + (COL - box.w) / 2;
  doc.image(bytes, { x, y, w: box.w, h: box.h });
  // A hairline keeps a pale screenshot from bleeding into the page.
  frame(x, y, box.w, box.h, RULE, 0.6);
  let out = y + box.h;
  if (caption) {
    out = para(caption, out + 13, { x, width: box.w, size: 8.5, lead: 11, color: FAINT });
  }
  return out + 6;
}

function footer(pageNo, label) {
  doc.line(M, 748, RIGHT, 748, { color: RULE, width: 0.6 });
  doc.text('Neapolitan Night - The Club at Carlton Woods', { x: M, y: 761, size: 7.5, color: FAINT });
  doc.text(label, { x: M + 260, y: 761, size: 7.5, color: FAINT });
  doc.text(String(pageNo), { x: RIGHT - pdf.monoWidth(String(pageNo), 8), y: 761, size: 8, font: 'mono', color: FAINT });
}

// ================================================================== page 1

/*
 * The venue's own masthead, on the venue's own maroon. The logo file is white
 * on transparent and JPEG has no transparency, so it is captured already
 * sitting on #530000 - the same value this band is filled with, which is what
 * keeps the join invisible.
 *
 * It is placed at 150pt wide on purpose. The asset is 211px across, so that
 * works out near 240dpi in print; anything larger starts showing the upscale.
 */
/*
 * A masthead, not a colour field.
 *
 * This was a 300pt maroon slab with a small crest adrift in it, which is what
 * a big flat rectangle always looks like when the thing inside it cannot fill
 * it. The club's logo is 211px wide - that is the only version they publish -
 * so it draws about 55pt across and no arrangement will make it a hero.
 *
 * So the band is only as tall as the mark needs, the brand colour reads as a
 * letterhead rule rather than a background, and the type carries the page.
 */
/*
 * The full stacked lockup, on white, where it belongs.
 *
 * The earlier wide logo was white-on-transparent, which forced a maroon field
 * behind it; the field had to be big enough to look deliberate and the logo
 * was too small to fill it, so the page read as a red slab with a speck in it.
 * This version is the crest and the wordmark together on white, so the brand
 * colour can go back to being a rule at the top rather than a background.
 *
 * The capture is 500px wide because Chrome will not open a window narrower
 * than that. The logo sits flush left in it and the rest is white on a white
 * page, which is why the image is placed wider than the logo draws.
 */
const LOGO_IMG_W = 232;          // logo itself lands ~103pt across, near 155dpi

doc.rect(0, 0, W, 14, BRAND);
doc.rect(0, 14, W, 2, GOLD);     // #a8792a, from brands/carltonwoods.css

if (SHOTS.logo) {
  const lg = doc.fit(SHOTS.logo, LOGO_IMG_W, 200);
  doc.image(SHOTS.logo, { x: M, y: 60, w: lg.w, h: lg.h });
} else {
  doc.text('THE CLUB AT CARLTON WOODS', { x: M, y: 96, size: 10, font: 'bold', color: BRAND });
}

doc.text('Neapolitan Night', { x: M, y: 232, size: 34, font: 'bold', color: INK });
doc.text('Floor Guide', { x: M, y: 264, size: 15, color: BRAND });

doc.line(M, 292, M + 56, 292, { color: GOLD, width: 1.4 });
doc.text('Service manual for every station', { x: M, y: 316, size: 9.5, color: FAINT });

let y = para(
  'How an order travels from a member\'s phone to their table, and what each station does with it. '
  + 'Four roles, one ticket. Every timing and limit in this guide is read from the running system, and '
  + 'every screen shown is a capture of it - so this document and the app cannot drift apart.',
  362, { size: 10.5, lead: 16, width: COL - 60 },
);

eyebrow('One ticket, four hands', y + 34);

const stages = [
  ['QUEUED', 'Member sends', 'Lands on the kitchen rail', 'under New orders', QUEUED],
  ['COOKING', 'Kitchen accepts', 'Cook presses Accept.', 'The cook clock starts here', COOKING],
  ['READY', 'Kitchen calls it', 'Food Up - Call Runner.', 'Appears on the expo board', READY],
  ['DELIVERED', 'Runner drops it', 'Delivered to (table).', 'Phone says Buon appetito', READY],
];

const sw = (COL - 3 * 14) / 4;
const sy = y + 52;
stages.forEach((s, i) => {
  const x = M + i * (sw + 14);
  panel(x, sy, sw, 104, { accent: s[4] });
  doc.text(s[0], { x: x + 12, y: sy + 24, size: 7.5, font: 'monoBold', color: s[4] });
  doc.text(s[1], { x: x + 12, y: sy + 46, size: 10.5, font: 'bold', color: INK });
  doc.text(s[2], { x: x + 12, y: sy + 66, size: 7.5, color: SOFT });
  doc.text(s[3], { x: x + 12, y: sy + 79, size: 7.5, color: SOFT });
  if (i < 3) arrow(x + sw + 2, sy + 52, x + sw + 12, sy + 52, FAINT, 1.1);
});

y = sy + 136;
panel(M, y, COL, 68, { fill: WASH, accent: BRAND, border: null });
doc.text('Nothing here charges anyone.', { x: M + 16, y: y + 26, size: 10, font: 'bold', color: INK });
para(
  'The night is all you can eat. The app records which member numbers dined and how many people were '
  + 'at each table; the charge posts through the club\'s own system at close-out. A member who comes '
  + 'back for a second round is still one cover.',
  y + 43, { x: M + 16, width: COL - 32, size: 9, lead: 12 },
);

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

// Clear of the intro above it. At 160 the last line of that paragraph ran
// underneath this row and lost a word behind the first panel.
const bandY = 204;
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
  const covers = config.areaCovers[g.name];
  // Tables come from the tent list, covers from the config. Printing them
  // together is the whole point: a manager reading this wants to know what a
  // full room looks like before the first ticket lands.
  // An area with covers leads with its capacity and names its range beneath.
  // One with a single point just names it - "Takeout Counter - Takeout
  // Counter" is what a first-to-last range says when there is only one.
  const headline = covers ? g.items.length + ' tables, ' + covers + ' covers' : g.items[0];
  doc.text(headline, { x: zoneX + 12, y: zy + 14, size: 10.5, font: 'bold', color: INK });
  zy += 14;
  if (covers) {
    const range = g.items.length > 1
      ? g.items[0] + ' - ' + g.items[g.items.length - 1]
      : g.items[0];
    zy = para(range, zy + 13, { x: zoneX + 12, width: colW - 24, size: 8.5, lead: 11 });
  }
  zy += 18;
});

const totalCovers = Object.values(config.areaCovers).reduce((a, b) => a + b, 0);
doc.line(zoneX + 12, zy - 2, zoneX + colW - 12, zy - 2, { color: RULE, width: 0.6 });
doc.text('FULL HOUSE', { x: zoneX + 12, y: zy + 12, size: 7, font: 'monoBold', color: FAINT });
doc.text(totalCovers + ' covers', { x: zoneX + 12, y: zy + 28, size: 13, font: 'bold', color: BRAND });

arrow(M + colW + 5, bandY + 120, passX - 5, bandY + 120, FAINT, 1.2);
arrow(passX + colW + 5, bandY + 120, zoneX - 5, bandY + 120, FAINT, 1.2);

// The five-step loop that used to sit here restated the cover strip almost
// step for step. The page reads better with the air.
y = bandY + bandH + 36;
const ly = y;

y = ly + 18;
rule(y);
eyebrow('Who does what', y + 26);

// Four across rather than four stacked. The list ran 160pt down the page for
// four lines of information, which is what made the cover feel padded out
// instead of composed.
const roles = [
  ['THE MEMBER', 'their own phone', 'Scans, picks a language, builds, sends.'],
  ['BACK OF HOUSE', 'kitchen iPad', 'Accepts, cooks to the estimate, calls up.'],
  ['FRONT OF HOUSE', 'expo iPad', 'Runs it, confirms allergies, delivers.'],
  ['MANAGER', 'manager, close-out', 'Sets up, watches the clocks, closes out.'],
];
const rw = (COL - 3 * 14) / 4;
const ry = y + 44;
roles.forEach((r, i) => {
  const x = M + i * (rw + 14);
  doc.rect(x, ry, 22, 2.5, BRAND);
  doc.text(r[0], { x, y: ry + 22, size: 8.5, font: 'bold', color: INK });
  doc.text(r[1], { x, y: ry + 35, size: 7.5, font: 'mono', color: BRAND });
  para(r[2], ry + 50, { x, width: rw, size: 8.5, lead: 11 });
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
  ['Language, then member number', 'English and Español are the first thing on the first screen, each written in its own language. Member numbers are 1 to 4 digits; leading zeros do not matter.'],
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
let rightColumnBottom = cardY + 198;

// The build grid, actual size on a phone, in the column beside the steps.
if (SHOTS.build) {
  const shotTop = cardY + 216;
  const ph = doc.fit(SHOTS.build, 152, 250);
  doc.image(SHOTS.build, { x: cardX + (152 - ph.w) / 2, y: shotTop, w: ph.w, h: ph.h });
  frame(cardX + (152 - ph.w) / 2, shotTop, ph.w, ph.h, RULE, 0.6);
  rightColumnBottom = para(
    'Building bowl 1 of 2. Bow Ties is 86\'d - greyed out and marked sold out, never hidden.',
    shotTop + ph.h + 14, { x: cardX, width: 152, size: 8, lead: 10, color: FAINT },
  );
}

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

// Full width, so it has to clear BOTH columns. Taking only the steps column
// into account put it straight through the phone screenshot beside them.
y = Math.max(y, rightColumnBottom) + 18;
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

// The real rail, rather than a drawing of one. It shows the three lanes, the
// badges and the live timers in one frame, which a diagram was only ever
// approximating.
y = screenshot(SHOTS.kitchen, 390,
  'New orders, Cooking, Ready. Chits carry the ticket number, the table, the guest count and every '
  + 'plate written out. The timer on each one is counting against that chit\'s own estimate.',
  y + 20, 236);

rule(y + 6);
y += 6;

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
  ['', 'numbered across the whole rail,'],
  ['', 're-flowing as chits move'],
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

footer(4, 'Back of house');

// ================================================================== page 5

doc.addPage();
eyebrow('03 - Front of house', 62);
heading('Expo and runners', 88);
y = para('Deliberately thinner than the kitchen screen. A runner carrying four bowls needs four things: '
  + 'the ticket number, where it goes, what is on the tray, and one button.', 112, { width: COL - 40 });

y = screenshot(SHOTS.expo, 340,
  'Run These Now on the left, oldest at the top; Coming Up on the right. One button per card, and it '
  + 'names the table.', y + 16, 196);

y += 6;
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

y = screenshot(SHOTS.cost, 340,
  'The food cost tab with the pantry priced. Cost per bowl, per pizza and per cover come from what '
  + 'members actually built - and every ingredient that went out is priced, which the tiles say out loud.',
  y + 16, 196);

let my = y + 8;
[
  ['Before service', 'Print the tents from the QR codes tab. Codes are drawn on the device, so this works with the internet unplugged.'],
  ['Before service', 'Check the 86 list. An ingredient switched off greys out on every phone within a second, and the count rides on the tab.'],
  ['During service', 'Today at a glance: covers, what is open now, accept, cook and runner times, and on-time percentage.'],
  ['After service', 'Close-out leads with who to charge, sorted by member number so it reconciles line by line against the club\'s billing.'],
].forEach((s) => {
  doc.text(s[0].toUpperCase(), { x: M, y: my, size: 7, font: 'monoBold', color: BRAND });
  my = para(s[1], my + 12, { x: M, width: COL - 190, size: 9, lead: 11.5 }) + 14;
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

my = Math.max(my, y + 156) + 4;
panel(M, my, COL, 50, { fill: WASH, accent: LATE, border: null });
doc.text('The staff passcode is a convenience lock, not security.', { x: M + 14, y: my + 21, size: 9.5, font: 'bold', color: INK });
para('Keep staff links inside the team. Clear today deletes the whole service day and cannot be undone.',
  my + 35, { x: M + 14, width: COL - 28, size: 9, lead: 11 });

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

/**
 * Read the finished file back and check the layout actually holds.
 *
 * Laying a page out in absolute coordinates means a paragraph that grows by
 * one line silently slides under whatever is beneath it. Both faults this
 * document has shipped were exactly that: copy running off the bottom of the
 * sheet, and a screenshot sitting on top of a callout because the callout only
 * cleared the column to its left.
 *
 * Neither is visible in a page count or a byte size, and the second is not
 * visible in a margin check either - the two elements were both comfortably
 * inside the margins, just on top of each other. So the build refuses rather
 * than handing over a document that has to be proofread by eye every time.
 */
function verify(pdfBytes) {
  const src = Buffer.from(pdfBytes).toString('latin1');
  const problems = [];
  const streams = [...src.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map((m) => m[1])
    .filter((s) => /Tj/.test(s));

  const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const H = doc.height;
  const FOOT = 748;

  streams.forEach((s, i) => {
    const page = 'page ' + (i + 1);
    const boxes = [];

    for (const m of s.matchAll(/([\d.-]+) ([\d.-]+) Td \((.*?)\) Tj/g)) {
      const x = +m[1];
      const y = H - +m[2];
      if (x < M - 1 || x > doc.width - M + 1 || y < 20 || y > H - 20) {
        problems.push(`${page}: text "${m[3].slice(0, 30)}" outside the margins at y=${y.toFixed(0)}`);
      }
    }

    for (const m of s.matchAll(/q ([\d.-]+) 0 0 ([\d.-]+) ([\d.-]+) ([\d.-]+) cm \/(Im\d+) Do Q/g)) {
      const w = +m[1];
      const h = +m[2];
      const box = { what: m[5], x: +m[3], y: H - (+m[4] + h), w, h };
      boxes.push(box);
      if (box.y + h > FOOT) problems.push(`${page}: ${box.what} runs into the footer`);
    }

    for (const m of s.matchAll(/([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f/g)) {
      const w = +m[3];
      const h = +m[4];
      // Full-bleed bands and hairline rules are not content boxes.
      if (w > doc.width - 20 || h < 12) continue;
      const box = { what: 'panel', x: +m[1], y: H - (+m[2] + h), w, h };
      boxes.push(box);
      if (box.y + h > FOOT) problems.push(`${page}: a panel runs into the footer`);
    }

    boxes.forEach((a, ai) => boxes.slice(ai + 1).forEach((b) => {
      // Panels nest inside panels by design - a chit inside a lane.
      if (a.what === 'panel' && b.what === 'panel') return;
      if (hits(a, b)) {
        problems.push(`${page}: ${a.what} overlaps ${b.what}`
          + ` (y ${a.y.toFixed(0)}-${(a.y + a.h).toFixed(0)} vs ${b.y.toFixed(0)}-${(b.y + b.h).toFixed(0)})`);
      }
    }));
  });

  return problems;
}

const problems = verify(bytes);
writeFileSync(OUT, Buffer.from(bytes));

if (problems.length) {
  console.error('wrote ' + OUT + ', but the layout is broken:');
  problems.forEach((p) => console.error('  ' + p));
  process.exitCode = 1;
} else {
  console.log('wrote ' + OUT + '  (' + doc.pageCount + ' pages, '
    + (bytes.length / 1024).toFixed(0) + 'KB, layout checked)');
}
