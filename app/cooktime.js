import * as menu from './menu.js';

/**
 * Cook-time model. Deliberately explicit so a chef can argue with the numbers
 * and change them in one place.
 *
 * PASTA - one bowl:
 *   boil(pasta) + finish(sauces) + add(protein) + topping prep + portion extra
 *   ... plus the slowest side, which bakes in parallel with the boil.
 *
 * Boil times come from PARCOOKED pasta held at the station, so they are
 * finish-to-order times rather than from-dry times.
 *
 * A bowl can take more than one sauce. They go in the same pan, so the cost is
 * the slowest sauce plus a small handling penalty for each extra one - not the
 * sum, which would badly over-quote a half-marinara-half-alfredo bowl.
 *
 * PIZZA - one pie:
 *   bake(base) + topping load. Every pizza is the same size, so the base bake
 *   is a constant; more toppings hold more water and run a little longer.
 *   Finishers go on after the bake and cost nothing on the oven clock.
 *
 * The two differ in how they BATCH, which is the part that actually matters at
 * a rush. A pasta station runs three pans at once. A pizza station is a small
 * two-deck oven holding one pie per deck, so only two pizzas bake together and
 * the third waits for a deck to clear - pizza throughput is much tighter than
 * pasta, and a table of six pizzas is a genuinely long ticket.
 */
export const MODEL = {
  pasta: {
    pansPerStation: 3,
    batchPenaltySec: 120,
    platePerItemSec: 20,
  },
  pizza: {
    // A small two-deck oven: one 12" pie per deck, so a station bakes two at a
    // time and the third pie waits for a deck to clear. This is the number that
    // decides whether a table of six waits 10 minutes or 25, so it is worth
    // getting from the actual oven rather than guessing.
    decks: 2,
    piesPerDeck: 1,
    // Pulling a finished pie and loading the next one.
    deckReloadSec: 180,
    platePerItemSec: 15,
    perToppingSec: 10,
  },
  extraSaucePenaltySec: 20,
  extraProteinPenaltySec: 15,
  // Rough queue drag used only for the guest-facing promise, not the SLA.
  queueDragPerOrderSec: 45,
  minPromiseSec: 240,
};

/** Seconds of active cooking for one bowl or one pizza. */
export function lineCookSec(line) {
  const kind = menu.kindOf(line);
  const g = menu.GROUPS_FOR[kind];

  const sauces = menu.saucesOf(line).map((id) => menu.find(g.sauces, id)).filter(Boolean);

  if (kind === 'pizza') {
    // On a pizza, meats are just more load on the pie - they go on before the
    // bake like everything else.
    const on = (line.toppings || []).map((id) => menu.find('pizzaToppings', id))
      .concat(menu.proteinsOf(line).map((id) => menu.find('pizzaProteins', id)))
      .filter(Boolean);
    const load = on.reduce((a, t) => a + (t.addSec || 0), 0)
      + on.length * MODEL.pizza.perToppingSec;
    // Sauce is spread before the bake, so it does not extend the oven clock.
    return menu.PIZZA_BASE.bakeSec + load;
  }

  const pasta = menu.find('pastas', line.pasta);
  const proteins = menu.proteinsOf(line).map((id) => menu.find('proteins', id)).filter(Boolean);
  const portion = menu.find('portions', line.portion) || menu.find('portions', 'regular');

  let sec = 0;
  sec += pasta ? pasta.boilSec : 480;
  sec += sauces.length
    ? Math.max(...sauces.map((x) => x.finishSec)) + (sauces.length - 1) * MODEL.extraSaucePenaltySec
    : 60;
  // Proteins share the pan, so the cost is the slowest plus a little handling
  // for each extra - the same shape as sauces, and for the same reason.
  sec += proteins.length
    ? Math.max(...proteins.map((x) => x.addSec)) + (proteins.length - 1) * MODEL.extraProteinPenaltySec
    : 0;
  sec += portion.extraSec;
  sec += (line.toppings || []).reduce((acc, id) => {
    const t = menu.find('toppings', id);
    return acc + (t ? t.addSec : 0);
  }, 0);
  const slowestSide = (line.sides || []).reduce((acc, id) => {
    const x = menu.find('sides', id);
    return Math.max(acc, x ? x.cookSec : 0);
  }, 0);
  return Math.max(sec, slowestSide);
}

/** Kept for older call sites; a "bowl" is just a pasta line. */
export const bowlCookSec = lineCookSec;

/**
 * Seconds of cooking for a whole order, measured from ACCEPT.
 *
 * Not the sum of its items: a pasta station runs several pans at once, and a
 * pizza oven bakes a whole deck together. Both are batching problems, with
 * different batch sizes and different reload costs.
 */
export function orderCookSec(lines) {
  if (!lines || lines.length === 0) return 0;
  const kind = menu.kindOf(lines[0]);
  const slowest = Math.max(...lines.map(lineCookSec));

  if (kind === 'pizza') {
    const m = MODEL.pizza;
    const perBatch = Math.max(1, m.decks * m.piesPerDeck);
    const batches = Math.ceil(lines.length / perBatch);
    return slowest + (batches - 1) * m.deckReloadSec + lines.length * m.platePerItemSec;
  }

  const m = MODEL.pasta;
  const panLoads = Math.ceil(lines.length / m.pansPerStation);
  return slowest + (panLoads - 1) * m.batchPenaltySec + lines.length * m.platePerItemSec;
}

/**
 * What we tell the guest: cook time plus however long the queue ahead of them
 * is likely to take. Kept separate from the kitchen SLA on purpose - the
 * kitchen is graded on cook time, not on how busy the room was.
 */
export function promiseSec(lines, queueDepth = 0) {
  const cook = orderCookSec(lines);
  const drag = Math.max(0, queueDepth) * MODEL.queueDragPerOrderSec;
  return Math.max(MODEL.minPromiseSec, cook + drag);
}

/** Per-bowl breakdown, used by the admin screen to explain an estimate. */
export function explain(lines) {
  return {
    items: lines.map((l) => ({
      guest: l.guestLabel,
      kind: menu.kindOf(l),
      dish: menu.describe(l),
      cookSec: lineCookSec(l),
    })),
    batches: menu.kindOf(lines[0] || {}) === 'pizza'
      ? Math.ceil(lines.length / (MODEL.pizza.decks * MODEL.pizza.piesPerDeck))
      : Math.ceil(lines.length / MODEL.pasta.pansPerStation),
    orderCookSec: orderCookSec(lines),
    model: MODEL,
  };
}
