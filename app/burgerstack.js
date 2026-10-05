/**
 * The burger, drawn as it is built.
 *
 * Separate artwork from app/art.js on purpose. Those glyphs are badges: each
 * one is drawn to read on its own at 90px in a tile. These are side elevations
 * meant to sit on top of each other at a shared width, so a slice of cheese is
 * a drape rather than a square and lettuce is a frill rather than a leaf. One
 * set cannot do both jobs.
 *
 * Pure, so scripts/selftest.js can assert the stacking without a browser.
 *
 * TWO THINGS TO KNOW
 *
 * The stack is drawn in KITCHEN order, not the order the guest tapped. Someone
 * who picks the sauce before the cheese still gets a burger that looks like a
 * burger, because the drawing is of the finished thing rather than a log of
 * their taps.
 *
 * It scales to fit rather than growing without limit. A burger with every
 * topping on it is a tall burger, and the one thing this must never do is push
 * the choices off a phone screen.
 */

const W = 200;          // drawing width; everything is centred on x = 100
const BOX_H = 260;      // the box the stack is scaled into
const FLOOR = 244;      // baseline the heel sits on

/* ----------------------------------------------------------------- buns */

const heel = (fill, shade) => (y) => ''
  + '<path d="M38 ' + y + 'h124a10 10 0 0 1 10 10v6a14 14 0 0 1-14 14H42a14 14 0 0 1-14-14v-6a10 10 0 0 1 10-10z" fill="' + fill + '"/>'
  + '<path d="M30 ' + (y + 9) + 'h140v5a13 13 0 0 1-13 13H43a13 13 0 0 1-13-13z" fill="' + shade + '"/>';

const crown = (fill, shade, seeds) => (y) => ''
  + '<path d="M28 ' + (y + 34) + 'c0-22 16-34 72-34s72 12 72 34z" fill="' + fill + '"/>'
  + '<path d="M28 ' + (y + 34) + 'h144v3a7 7 0 0 1-7 7H35a7 7 0 0 1-7-7z" fill="' + shade + '"/>'
  + (seeds || '');

const SEEDS = (y) => '<g fill="#fdf1d6">'
  + '<ellipse cx="72" cy="' + (y + 16) + '" rx="5" ry="2.8"/>'
  + '<ellipse cx="100" cy="' + (y + 10) + '" rx="5" ry="2.8"/>'
  + '<ellipse cx="128" cy="' + (y + 16) + '" rx="5" ry="2.8"/>'
  + '<ellipse cx="86" cy="' + (y + 25) + '" rx="4.5" ry="2.6"/>'
  + '<ellipse cx="114" cy="' + (y + 25) + '" rx="4.5" ry="2.6"/></g>';

const BUNS = {
  bun_brioche: {
    heelH: 28, crownH: 34,
    heel: heel('#e3b670', '#cc9a4f'),
    crown: crown('#e3b670', '#cc9a4f'),
  },
  bun_potato: {
    heelH: 28, crownH: 34,
    heel: heel('#dda75c', '#c28f45'),
    crown: (y) => crown('#dda75c', '#c28f45', SEEDS(y))(y),
  },
  bun_gf: {
    heelH: 28, crownH: 34,
    heel: heel('#dcbb8c', '#c3a070'),
    // The leaf is the convention for gluten free, and it is on the crown so it
    // stays visible however tall the stack gets.
    crown: (y) => crown('#dcbb8c', '#c3a070')(y)
      + '<path d="M150 ' + (y + 6) + 'c10-6 20-6 26-2-4 10-14 14-24 10z" fill="#3f9150"/>',
  },
};

/* -------------------------------------------------------------- patties */

const pattySlab = (y, top, bottom) => ''
  + '<path d="M34 ' + y + 'h132a12 12 0 0 1 0 24H34a12 12 0 0 1 0-24z" fill="' + bottom + '"/>'
  + '<path d="M34 ' + y + 'h132a12 12 0 0 1 2 7H32a12 12 0 0 1 2-7z" fill="' + top + '"/>';

const PATTIES = {
  beef_single: { h: 24, draw: (y) => pattySlab(y, '#9a5f36', '#75452a') },
  beef_double: {
    h: 50,
    draw: (y) => pattySlab(y + 26, '#9a5f36', '#75452a') + pattySlab(y, '#9a5f36', '#75452a'),
  },
  patty_bean: {
    h: 24,
    draw: (y) => pattySlab(y, '#6e5a3a', '#54452c')
      + '<g fill="#3d3220" opacity=".65"><circle cx="70" cy="' + (y + 12) + '" r="3"/>'
      + '<circle cx="100" cy="' + (y + 9) + '" r="2.6"/><circle cx="128" cy="' + (y + 13) + '" r="3"/></g>',
  },
};

/* -------------------------------------------------------------- cheeses */

// A slice that has been on a hot patty: it drapes over the edges.
const drape = (fill, extra) => (y) => ''
  + '<path d="M30 ' + y + 'h140v10c-10 0-10 12-20 12s-10-10-20-10-12 12-22 12-12-12-22-12-10 10-20 10-10-12-20-12z" fill="' + fill + '"/>'
  + (extra ? extra(y) : '');

const CHEESES = {
  ch_american: { h: 16, draw: drape('#f2b327') },
  ch_cheddar: { h: 16, draw: drape('#e08a2a') },
  ch_swiss: {
    h: 16,
    draw: drape('#f6d98a', (y) => '<g fill="#dcb757">'
      + '<circle cx="74" cy="' + (y + 5) + '" r="3.4"/><circle cx="108" cy="' + (y + 4) + '" r="2.6"/>'
      + '<circle cx="134" cy="' + (y + 6) + '" r="3"/></g>'),
  },
  ch_pepper: {
    h: 16,
    draw: drape('#f7dea0', (y) => '<g fill="#b8342a">'
      + '<circle cx="76" cy="' + (y + 5) + '" r="2.2"/><circle cx="104" cy="' + (y + 4) + '" r="1.9"/>'
      + '<circle cx="130" cy="' + (y + 6) + '" r="2.1"/></g>'),
  },
};

/* ------------------------------------------------------------- toppings */

const TOPPINGS = {
  bt_bacon: {
    h: 12,
    draw: (y) => '<g fill="#b4432f"><path d="M34 ' + (y + 2) + 'c22-6 44 8 66 2s44-8 66-2v7c-22-6-44 4-66 8s-44-10-66-4z"/></g>'
      + '<g fill="#efd0c4" opacity=".8"><path d="M34 ' + (y + 5) + 'c22-6 44 8 66 2v3c-22 6-44-8-66-2z"/></g>',
  },
  bt_grilled_onion: {
    h: 11,
    draw: (y) => '<g fill="none" stroke="#c98f4e" stroke-width="5" stroke-linecap="round">'
      + '<path d="M42 ' + (y + 7) + 'c20-9 44-9 62-1"/><path d="M92 ' + (y + 8) + 'c20-8 44-7 62 1"/></g>'
      + '<g fill="none" stroke="#e0b887" stroke-width="4" stroke-linecap="round">'
      + '<path d="M50 ' + (y + 3) + 'c22-6 48-5 66 2"/></g>',
  },
  bt_mushroom: {
    h: 12,
    draw: (y) => '<g fill="#a98263"><ellipse cx="72" cy="' + (y + 6) + '" rx="18" ry="6"/>'
      + '<ellipse cx="110" cy="' + (y + 7) + '" rx="20" ry="6"/>'
      + '<ellipse cx="142" cy="' + (y + 6) + '" rx="15" ry="5.5"/></g>',
  },
  bt_egg: {
    h: 18,
    draw: (y) => '<path d="M36 ' + (y + 14) + 'c-6-12 6-16 16-13 6-8 20-6 26 1 12-3 20 4 16 12z" fill="#fffdf6"/>'
      + '<path d="M96 ' + (y + 14) + 'c-4-10 8-14 18-11 8-6 20-3 22 4 10 0 14 4 12 7z" fill="#fffdf6"/>'
      + '<circle cx="74" cy="' + (y + 7) + '" r="7" fill="#f2b22c"/>',
  },
  bt_tomato: {
    h: 13,
    draw: (y) => '<g fill="#d8382f"><ellipse cx="74" cy="' + (y + 6) + '" rx="26" ry="6.5"/>'
      + '<ellipse cx="128" cy="' + (y + 7) + '" rx="26" ry="6.5"/></g>'
      + '<g fill="#ef7a6c"><ellipse cx="74" cy="' + (y + 5) + '" rx="17" ry="3.4"/>'
      + '<ellipse cx="128" cy="' + (y + 6) + '" rx="17" ry="3.4"/></g>',
  },
  bt_onion: {
    h: 10,
    draw: (y) => '<g fill="none" stroke="#c9a8d4" stroke-width="4">'
      + '<path d="M54 ' + (y + 6) + 'a28 7 0 0 1 56 0"/><path d="M94 ' + (y + 7) + 'a28 7 0 0 1 56 0"/></g>',
  },
  bt_pickles: {
    h: 11,
    draw: (y) => '<g fill="#5f9a3c"><ellipse cx="70" cy="' + (y + 6) + '" rx="17" ry="5.5"/>'
      + '<ellipse cx="106" cy="' + (y + 5) + '" rx="17" ry="5.5"/>'
      + '<ellipse cx="140" cy="' + (y + 6) + '" rx="15" ry="5"/></g>'
      + '<g fill="#8cc265" opacity=".7"><ellipse cx="70" cy="' + (y + 5) + '" rx="10" ry="2.6"/>'
      + '<ellipse cx="106" cy="' + (y + 4) + '" rx="10" ry="2.6"/></g>',
  },
  bt_jalapeno: {
    h: 10,
    draw: (y) => '<g fill="#3f8f33"><ellipse cx="78" cy="' + (y + 5) + '" rx="10" ry="4"/>'
      + '<ellipse cx="104" cy="' + (y + 6) + '" rx="10" ry="4"/>'
      + '<ellipse cx="130" cy="' + (y + 5) + '" rx="9" ry="3.6"/></g>',
  },
  bt_avocado: {
    h: 12,
    draw: (y) => '<g fill="#8fb95a"><ellipse cx="76" cy="' + (y + 6) + '" rx="22" ry="5.5"/>'
      + '<ellipse cx="124" cy="' + (y + 7) + '" rx="22" ry="5.5"/></g>'
      + '<g fill="#cfe08a"><ellipse cx="76" cy="' + (y + 5) + '" rx="14" ry="2.8"/>'
      + '<ellipse cx="124" cy="' + (y + 6) + '" rx="14" ry="2.8"/></g>',
  },
  bt_lettuce: {
    h: 14,
    draw: (y) => '<path d="M26 ' + (y + 12) + 'c6-12 16-4 22-10 6 8 16 2 22-4 6 10 16 4 24-2 6 10 18 6 26-2 6 10 18 8 26 0 6 8 16 10 24 6l4 12z" fill="#4faa4f"/>'
      + '<path d="M26 ' + (y + 12) + 'h148v3H26z" fill="#3c8c3e"/>',
  },
};

/* --------------------------------------------------------------- sauces */

// Sauce is a drizzle under the crown rather than a layer of its own: it is the
// one thing that would otherwise add height without adding anything to see.
const SAUCE_COLOUR = {
  bs_burger: '#e8a24f',
  bs_ketchup: '#cf2e26',
  bs_mustard: '#e8b713',
  bs_mayo: '#f6efdc',
  bs_bbq: '#7a3a1d',
  bs_aioli: '#efe3c4',
};

const drizzle = (y, colour) => '<g fill="none" stroke="' + colour + '" stroke-width="7" stroke-linecap="round">'
  + '<path d="M46 ' + (y + 5) + 'c18 6 34-6 52 0s36 6 54-2"/></g>';

/* ---------------------------------------------------------------- order */

// Kitchen order, bottom to top. The guest may tap these in any sequence; the
// drawing is of the finished burger, not of their path through the menu.
const TOPPING_ORDER = [
  'bt_bacon', 'bt_grilled_onion', 'bt_mushroom', 'bt_egg',
  'bt_tomato', 'bt_onion', 'bt_pickles', 'bt_jalapeno', 'bt_avocado', 'bt_lettuce',
];

/** Every id this module can draw, so a test can prove nothing is missing. */
export function stackableIds() {
  return [
    ...Object.keys(BUNS), ...Object.keys(PATTIES),
    ...Object.keys(CHEESES), ...Object.keys(TOPPINGS), ...Object.keys(SAUCE_COLOUR),
  ];
}

/**
 * The burger so far, as an SVG string.
 *
 * @param {object} line  a burger line, part-built is the normal case
 * @param {object} opts  { height } - the box to fit into, default 260
 */
export function burgerStackSvg(line, opts = {}) {
  const l = line || {};
  const boxH = opts.height || BOX_H;
  const bun = BUNS[l.base] || null;
  const patty = PATTIES[(l.proteins || [])[0]] || null;
  const cheese = CHEESES[(l.cheeses || [])[0]] || null;
  const tops = TOPPING_ORDER.filter((id) => (l.toppings || []).indexOf(id) !== -1);
  const sauceId = (l.sauces || []).filter((id) => SAUCE_COLOUR[id])[0] || null;

  // Nothing chosen yet: a plate, so the space does not read as broken.
  if (!bun && !patty && !cheese && !tops.length) {
    // Just the plate, and only as tall as the plate. Drawing it into the full
    // hero box put 150px of nothing above an empty plate.
    return svgWrap('<ellipse cx="100" cy="' + (FLOOR + 6) + '" rx="78" ry="10" fill="#e6ddd2"/>'
      + '<ellipse cx="100" cy="' + (FLOOR + 3) + '" rx="78" ry="10" fill="#f4eee6"/>', 34);
  }

  const parts = [];
  let y = FLOOR;

  // A couple of points of overlap per layer. Butted exactly edge to edge they
  // read as a column of separate slabs; overlapping slightly reads as a stack.
  const OVERLAP = 3;
  const push = (h, draw) => { y -= (h - OVERLAP); parts.push(draw(y)); };

  if (bun) push(bun.heelH, bun.heel);
  if (patty) push(patty.h, patty.draw);
  if (cheese) push(cheese.h, cheese.draw);
  tops.forEach((id) => push(TOPPINGS[id].h, TOPPINGS[id].draw));
  if (sauceId) push(9, (yy) => drizzle(yy, SAUCE_COLOUR[sauceId]));
  if (bun) push(bun.crownH, bun.crown);

  // Plate under it, and a shadow so the stack sits rather than floats.
  const plate = '<ellipse cx="100" cy="' + (FLOOR + 6) + '" rx="78" ry="10" fill="#e6ddd2"/>'
    + '<ellipse cx="100" cy="' + (FLOOR + 3) + '" rx="78" ry="10" fill="#f4eee6"/>';

  // The box FITS the stack rather than the stack sitting in a fixed box. A
  // one-layer burger drawn into a full-height frame is mostly empty space
  // above it, and the thing a guest is meant to notice is that it grows.
  //
  // Past the cap it stops growing and scales instead, because the choices
  // staying on screen matters more than the drawing getting bigger.
  const used = (FLOOR + 16) - y;
  const fitted = Math.min(used, boxH);
  const scale = Math.min(1, fitted / used);
  const body = parts.join('');
  const inner = scale < 1
    ? '<g transform="translate(100 ' + (FLOOR + 16) + ') scale(' + scale.toFixed(3)
      + ') translate(-100 ' + (-(FLOOR + 16)) + ')">' + body + '</g>'
    : body;

  return svgWrap(plate + inner, fitted);
}

function svgWrap(inner, boxH) {
  const top = FLOOR + 16 - boxH;
  return '<svg class="bstack" viewBox="0 ' + top + ' ' + W + ' ' + boxH
    + '" role="img" aria-hidden="true" preserveAspectRatio="xMidYMax meet">' + inner + '</svg>';
}
