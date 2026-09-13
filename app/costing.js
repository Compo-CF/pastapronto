/**
 * Food costing. Pure, like the rest of the domain layer, so scripts/selftest.js
 * can assert the arithmetic with no database, no browser and no credentials.
 *
 * THE MODEL is the one a kitchen already uses. You buy a pack at a price, that
 * pack yields some number of portions, and a portion costs the division:
 *
 *     #10 can of marinara, $18.40, ladles 40 bowls  ->  $0.46 a bowl
 *
 * A built bowl or pizza then costs the sum of what is on it, so the cost per
 * bowl is not a guess at a typical order - it is what the guests actually
 * chose, priced.
 *
 * WHAT THIS DELIBERATELY WILL NOT DO is invent a number. An ingredient with no
 * price entered is reported as unpriced, never counted as zero. An average
 * that quietly treats missing data as free reads as a real figure and is off
 * by however much you forgot to enter, which is worse than no figure at all.
 * Every roll-up below carries its own coverage alongside it for that reason.
 *
 * WHAT THIS IS NOT is a menu price. The app never quotes money to a guest -
 * the night is all-you-can-eat and charges post against the member number
 * through the club's own system. This is the other side of that ledger, and it
 * lives on the manager screen only.
 */
import * as menu from './menu.js';
import { billableCovers } from './order.js';

/**
 * Light and heavy are a guest's words for half and half-again. Nobody weighs
 * them, so these are the round numbers a chef would budget with rather than a
 * claim about grams. They are here, named, so that changing the assumption is
 * a one-line edit and not a hunt through the arithmetic.
 */
export const AMOUNT_FACTOR = { light: 0.5, heavy: 1.5 };

const BASE = menu.PIZZA_BASE;

/** The pizza crust is costed like an ingredient, under its own group key. */
export const BASE_GROUP = 'pizzaBase';

/**
 * Which menu groups can carry a price, in the order the manager screen shows
 * them - the same lane split as the menu reference directly above it, so a
 * manager pricing pepperoni finds it where they just read its allergens.
 *
 * Portions and spice levels are absent on purpose: they are multipliers and
 * seasonings, not things you buy by the case.
 */
const LANES = [
  {
    lane: 'pasta',
    label: 'Pasta station',
    groups: [
      ['pastas', 'Pasta', 'dry weight for one bowl'],
      ['sauces', 'Sauces', 'one ladle'],
      ['proteins', 'Proteins', 'one scoop'],
      ['toppings', 'Toppings', 'one pinch or spoon'],
      ['sides', 'Sides', 'one piece or plate'],
    ],
  },
  {
    lane: 'pizza',
    label: 'Pizza station',
    groups: [
      [BASE_GROUP, 'Base', 'one 12" dough ball'],
      ['pizzaSauces', 'Sauces', 'one ladle'],
      ['pizzaCheeses', 'Cheeses', 'one handful'],
      ['pizzaProteins', 'Proteins', 'one portion'],
      ['pizzaToppings', 'Toppings', 'one portion'],
    ],
  },
];

/**
 * Every row a price can be entered against.
 *
 * "No Sauce" and "Heavy Cheese" are filtered out here: neither is something
 * you buy. The first costs nothing and the second is a multiplier on a cheese
 * that already has its own row, so giving either a price box would invite a
 * manager to enter the same money twice.
 */
export function costRows() {
  const c = menu.catalog();

  return LANES.map((lane) => ({
    lane: lane.lane,
    label: lane.label,
    groups: lane.groups.map(([key, label, unitHint]) => {
      const items = key === BASE_GROUP
        ? [{ id: BASE.id, name: BASE.name }]
        : (c[key] || [])
          .filter((i) => !i.exclusive && !i.amount)
          .map((i) => ({ id: i.id, name: i.name }));
      return { key, label, unitHint, items };
    }).filter((g) => g.items.length),
  }));
}

/** Every priceable id, flat. Used to size coverage and to prune stale keys. */
export function costableIds() {
  const out = [];
  costRows().forEach((lane) => lane.groups.forEach((g) => g.items.forEach((i) => out.push(i.id))));
  return out;
}

/** A display name for any priceable id, including the pizza base. */
export function nameOf(id) {
  if (id === BASE.id) return BASE.name;
  const hit = menu.findAnywhere(id);
  return hit ? hit.name : id;
}

/**
 * Cost of one portion, or null when the entry cannot answer the question.
 *
 * null and 0 are different answers and the difference matters: null is "nobody
 * has priced this", 0 is "priced, and it is free" - which is a real case for
 * herbs off the property. Only null counts against coverage.
 */
export function perPortion(entry) {
  if (!entry) return null;
  const price = Number(entry.price);
  const yieldN = Number(entry.yield);
  if (!Number.isFinite(price) || price < 0) return null;
  // A pack that yields nothing has no cost per portion - dividing anyway gives
  // Infinity, which would poison every total downstream of it.
  if (!Number.isFinite(yieldN) || yieldN <= 0) return null;
  return price / yieldN;
}

/**
 * A charge per cover, or null when there isn't one.
 *
 * Guarding with Number.isFinite alone is not enough, which is how this got out
 * the door wrong: Number(null) is 0 and 0 is finite, so "nobody entered one"
 * stored as a charge of zero and read back into the box as "0". Zero is not a
 * charge in any case - it is a division by zero wearing a number's clothes.
 */
export function normalizeCharge(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function portionFactor(line) {
  const p = menu.PORTIONS.find((x) => x.id === line.portion);
  return p ? p.factor : 1;
}

/**
 * What one built bowl or pizza costs in food.
 *
 * @param {object} line   a line off an order, exactly as stored
 * @param {object} costs  { [ingredientId]: { price, yield } }
 * @returns {{kind, total, parts, missing, complete}}
 *          `total` counts only the parts that have a price, and `complete`
 *          says whether that is the whole bowl. Read them together or not at
 *          all - a total with `complete: false` is a floor, not a cost.
 */
export function lineCost(line, costs) {
  const kind = menu.kindOf(line);
  const groups = menu.GROUPS_FOR[kind];
  const cs = costs || {};
  const parts = [];
  const missing = [];

  const add = (id, factor) => {
    const name = nameOf(id);
    const unit = perPortion(cs[id]);
    if (unit == null) {
      missing.push({ id, name });
      return;
    }
    parts.push({ id, name, unit, factor, cost: unit * factor });
  };

  /*
   * Every multi-select group goes through menu.groupRules(), which is the same
   * call the guest tiles and validateLine() make. So "No Sauce" costs nothing
   * here for exactly the reason it greys out the other sauces there, and if a
   * "No Sauce" is ever added to the pasta lane the costing follows it without
   * an edit.
   */
  const pick = (groupKey, chosen, scale) => {
    const rules = menu.groupRules(groupKey, chosen);
    if (rules.exclusive) return;
    const mult = rules.amount ? (AMOUNT_FACTOR[rules.amount.amount] || 1) : 1;
    rules.bases.forEach((id) => add(id, scale * mult));
  };

  if (kind === 'pizza') {
    add(BASE.id, 1);
    pick(groups.sauces, menu.saucesOf(line), 1);
    pick(groups.cheeses, menu.cheesesOf(line), 1);
    pick(groups.proteins, menu.proteinsOf(line), 1);
    pick(groups.toppings, line.toppings || [], 1);
  } else {
    // Portion size scales the bowl itself. A kid bowl is 0.6 of the pasta, the
    // sauce and the protein, because that is what 0.6 of a bowl means.
    const f = portionFactor(line);
    if (line.pasta) add(line.pasta, f);
    pick(groups.sauces, menu.saucesOf(line), f);
    pick(groups.proteins, menu.proteinsOf(line), f);
    pick(groups.toppings, line.toppings || [], f);
    // A side is its own plate. A kid-size bowl still comes with a whole piece
    // of garlic bread, so sides do not take the portion factor.
    (line.sides || []).forEach((id) => add(id, 1));
  }

  const total = parts.reduce((a, p) => a + p.cost, 0);
  return { kind, total, parts, missing, complete: missing.length === 0 };
}

function laneSummary(list) {
  const complete = list.filter((c) => c.complete);
  return {
    items: list.length,
    priced: complete.length,
    // Averaged over fully-priced items only. Mixing in half-priced bowls would
    // drag the mean down by however much is missing and still look like money.
    avg: complete.length
      ? complete.reduce((a, c) => a + c.total, 0) / complete.length
      : null,
    // Every part we could price, across every item. A floor on the real spend.
    known: list.reduce((a, c) => a + c.total, 0),
  };
}

/**
 * The night, costed.
 *
 * @param {object[]} orders  today's orders, exactly as the rail holds them
 * @param {object} costs     { [ingredientId]: { price, yield } }
 * @param {object} opts      { chargePerCover } - what the club charges a head,
 *                           optional, and only used to derive food cost %.
 */
export function costReport(orders, costs, opts = {}) {
  const cs = costs || {};
  const alive = (orders || []).filter((o) => o.status !== 'voided');

  const lanes = { pasta: [], pizza: [] };
  const contrib = new Map();
  const unpriced = new Map();
  let dearest = null;

  alive.forEach((o) => {
    (o.lines || []).forEach((line) => {
      const c = lineCost(line, cs);
      lanes[c.kind === 'pizza' ? 'pizza' : 'pasta'].push(c);

      c.parts.forEach((p) => {
        const row = contrib.get(p.id) || { id: p.id, name: p.name, uses: 0, total: 0 };
        row.uses += 1;
        row.total += p.cost;
        contrib.set(p.id, row);
      });
      c.missing.forEach((m) => {
        const row = unpriced.get(m.id) || { id: m.id, name: m.name, uses: 0 };
        row.uses += 1;
        unpriced.set(m.id, row);
      });

      // Only a fully-priced item can claim to be the dearest one. A partly
      // priced bowl cannot be compared against a complete one.
      if (c.complete && (!dearest || c.total > dearest.total)) {
        dearest = {
          total: c.total,
          kind: c.kind,
          ticketNo: o.ticketNo,
          guestLabel: line.guestLabel || '',
          dish: line.dish || '',
        };
      }
    });
  });

  const pasta = laneSummary(lanes.pasta);
  const pizza = laneSummary(lanes.pizza);
  const items = pasta.items + pizza.items;
  const known = pasta.known + pizza.known;

  const covers = billableCovers(orders || []);
  const perCover = covers ? known / covers : null;

  const chargePerCover = normalizeCharge(opts.chargePerCover);

  const usedIds = new Set([...contrib.keys(), ...unpriced.keys()]);

  return {
    pasta,
    pizza,
    totals: {
      items,
      // The spend we can account for. Equal to the real spend only when
      // coverage.complete is true.
      known,
      covers,
      perCover,
    },
    chargePerCover,
    foodCostPct: chargePerCover && perCover != null
      ? (perCover / chargePerCover) * 100
      : null,
    coverage: {
      ingredientsUsed: usedIds.size,
      ingredientsPriced: contrib.size,
      itemsComplete: pasta.priced + pizza.priced,
      itemsTotal: items,
      complete: items > 0 && unpriced.size === 0,
      unpriced: [...unpriced.values()].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name)),
    },
    contributors: [...contrib.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    dearest,
  };
}

// ------------------------------------------------------------------ display

/** Money, to the cent. `null` renders as a dash rather than as $0.00. */
export function money(n) {
  if (n == null || !Number.isFinite(Number(n))) return '--';
  const v = Number(n);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2);
}

/**
 * A per-portion cost, which is routinely under a cent a pinch. Rounding a
 * third of a cent to $0.00 makes a priced ingredient look unpriced, so small
 * numbers keep three decimals.
 */
export function unitMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return '--';
  const v = Number(n);
  return '$' + (Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(2));
}
