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
  burger: {
    // A flat-top takes a row of patties at once, so a table of six is one
    // pass rather than six. Clearing the top and starting the next row is
    // what costs, not each individual burger.
    pattiesPerStation: 6,
    batchPenaltySec: 90,
    platePerItemSec: 15,
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
    // Vegetables marked postBake go on after the pie leaves the oven, so they
    // buy no oven time - the same reason finishers never counted.
    const on = (line.toppings || []).map((id) => menu.find('pizzaToppings', id))
      .concat(menu.proteinsOf(line).map((id) => menu.find('pizzaProteins', id)))
      .filter(Boolean)
      .filter((t) => !t.postBake);
    const cheese = menu.cheesesOf(line).map((id) => menu.find('pizzaCheeses', id)).filter(Boolean);
    const load = on.reduce((a, t) => a + (t.addSec || 0), 0)
      + on.length * MODEL.pizza.perToppingSec
      // Cheese is spread, not placed, so it costs what it costs and no
      // per-item handling. Heavy cheese is wetter and genuinely bakes longer.
      + cheese.reduce((a, c) => a + (c.addSec || 0), 0);
    // Sauce is spread before the bake, so it does not extend the oven clock.
    // The crust decides the bake, not a constant: a gluten-free base needs
    // longer to set, and a dessert pie comes out sooner.
    return menu.crustOf(line).bakeSec + load;
  }

  if (kind === 'burger') {
    // The patty owns the clock. Everything else is assembly that happens while
    // it cooks - except a fried egg, which needs its own pan time, and the
    // basket, which runs in the fryer alongside. So the side is a max, not a
    // sum, the same way a pasta side bakes beside the boil.
    const patty = menu.proteinsOf(line)
      .map((id) => menu.find('burgerPatties', id))
      .filter(Boolean)[0];
    const bun = menu.find('burgerBuns', line.base);
    const tops = (line.toppings || [])
      .map((id) => menu.find('burgerToppings', id))
      .filter(Boolean);

    const grill = (patty ? patty.grillSec : 240)
      + (bun ? bun.addSec : 0)
      + tops.reduce((a, t) => a + (t.addSec || 0), 0)
      + menu.cheesesOf(line)
        .map((id) => menu.find('burgerCheeses', id))
        .filter(Boolean)
        .reduce((a, c) => a + (c.addSec || 0), 0);

    const basket = (line.sides || []).reduce((acc, id) => {
      const x = menu.find('burgerSides', id);
      return Math.max(acc, x ? x.cookSec : 0);
    }, 0);
    return Math.max(grill, basket);
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

  if (kind === 'burger') {
    const bm = MODEL.burger;
    const passes = Math.ceil(lines.length / bm.pattiesPerStation);
    return slowest + (passes - 1) * bm.batchPenaltySec + lines.length * bm.platePerItemSec;
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

/** How many items of a kind cook together at one station. */
function batchSizeFor(kind) {
  if (kind === 'pizza') return MODEL.pizza.decks * MODEL.pizza.piesPerDeck;
  if (kind === 'burger') return MODEL.burger.pattiesPerStation;
  return MODEL.pasta.pansPerStation;
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
    batches: Math.ceil(lines.length / batchSizeFor(menu.kindOf(lines[0] || {}))),
    orderCookSec: orderCookSec(lines),
    model: MODEL,
  };
}
