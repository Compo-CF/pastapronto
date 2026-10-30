/**
 * Domain self-test. Run: node scripts/selftest.js
 *
 * Exercises the order lifecycle, every illegal transition we care about, the
 * cook-time model and the metrics roll-up. These modules are deliberately
 * Firebase-free, so this runs with no emulator, no network and no credentials.
 */
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STRINGS } from '../app/i18n.js';
import { config, kindsForNight, nightById } from '../app/config.js';
import * as cfgTags from '../app/config.js';
import * as order from '../app/order.js';
import * as cooktime from '../app/cooktime.js';
import * as menu from '../app/menu.js';
import * as costing from '../app/costing.js';
import * as stack from '../app/burgerstack.js';
import * as seed from '../app/seed.js';
import * as roster from './roster.js';
import { art, has as hasArt } from '../app/art.js';
import * as pdf from '../app/pdf.js';
import { buildReportPdf } from '../app/report-pdf.js';
import { html, raw } from '../app/ui.js';

const { STATUS } = order;
const sla = config.sla;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    console.error('  FAIL  ' + name + '\n        ' + err.message);
    process.exitCode = 1;
  }
}

const draft = () => ({
  memberNumber: '1794',
  memberName: 'Compofelice',
  memberStatus: 'verified',
  guestCount: 2,
  lines: [
    { guestLabel: 'Ada', pasta: 'shells', sauces: ['butter'], proteins: [], toppings: ['parmesan'], sides: [], portion: 'kid', spice: 'mild' },
    { guestLabel: 'Sam', pasta: 'penne', sauces: ['arrabbiata', 'marinara'], proteins: ['chicken', 'meatballs'], toppings: ['mushrooms', 'chili'], sides: ['garlic_bread'], portion: 'regular', spice: 'hot' },
  ],
});

const burgerLine = (over = {}) => ({
  kind: 'burger',
  guestLabel: 'Ada',
  base: 'bun_brioche',
  proteins: ['beef_single'],
  cheeses: ['ch_american'],
  toppings: ['bt_lettuce', 'bt_pickles'],
  sauces: ['bs_burger'],
  sides: ['side_fries'],
  ...over,
});
const burgerDraft = (over = {}) => ({
  memberNumber: '1794', memberName: 'Compofelice', memberStatus: 'verified',
  guestCount: 1, lines: [burgerLine()], ...over,
});

const draftOf = (...lines) => ({ ...draft(), lines });

let seq = 0;
const make = (d = draft(), ctx = {}) => ({
  id: 'ord_test_' + (seq += 1),
  ...order.buildOrder(d, {
    ticketNo: seq,
    station: 'PASTA-1',
    queueDepth: 0,
    tag: { id: 'table-12', label: 'Table 12', kind: 'table' },
    serviceDate: '2026-09-09',
    ...ctx,
  }),
});

console.log('\nPastaPresto self-test\n');

/**
 * Every choice a guest makes has to reach the kitchen.
 *
 * The crust was dropped here once. buildLine() was written when a pizza had
 * exactly one crust, so when the gluten-free and dessert bases arrived the
 * choice was offered on the phone, confirmed on the review screen, and then
 * quietly replaced with the classic one on the way to the pass - a pie
 * somebody ordered gluten free printed as 12" Classic. Every crust test
 * passed throughout, because every one of them built its line by hand with
 * the base already set, and so never went through the function that lost it.
 *
 * This walks each kind's own groups rather than naming fields, so the next
 * field added to a line is covered the day it is added.
 */
test('every choice a guest makes survives into the ticket', () => {
  const cases = {
    pizza: {
      kind: 'pizza', base: 'pz_gf_dessert', sauces: ['pz_nutella'],
      cheeses: ['pz_no_cheese'], proteins: [], toppings: ['pz_strawberry'],
    },
    pasta: {
      kind: 'pasta', pastas: ['shells'], sauces: ['marinara'], proteins: ['chicken'],
      toppings: ['parmesan'], sides: ['garlic_bread'], portion: 'kid', spice: 'mild',
    },
    burger: {
      kind: 'burger', base: 'bun_gf', proteins: ['beef_single'], cheeses: ['bc_cheddar'],
      toppings: [], sauces: [], sides: [],
    },
  };

  Object.entries(cases).forEach(([kind, chosen]) => {
    const built = order.buildLine({ ...chosen, guestLabel: 'Ada', notes: '' }, 0, kind);

    // The slots this kind actually uses, from the menu's own map.
    Object.keys(menu.GROUPS_FOR[kind]).forEach((slot) => {
      if (!(slot in chosen)) return;
      assert.deepStrictEqual(built[slot], chosen[slot],
        kind + ' lost its ' + slot + ' on the way to the kitchen');
    });

    // The shape list. Not in GROUPS_FOR, so neither loop above covers it -
    // and it is the field a split bowl is built out of.
    if ('pastas' in chosen) {
      assert.deepStrictEqual(built.pastas, chosen.pastas,
        kind + ' lost its shapes on the way to the kitchen');
    }

    // And the scalars that are not groups.
    ['portion'].forEach((field) => {
      if (field in chosen) assert.strictEqual(built[field], chosen[field], kind + '.' + field);
    });
  });

  // The case that made this matter: a gluten free order must not reach a cook
  // described as the house dough.
  const pie = order.buildLine(cases.pizza, 0, 'pizza');
  assert.strictEqual(menu.crustOf(pie).id, 'pz_gf_dessert');
  assert.ok(!menu.allergensFor(pie).includes('gluten'),
    'the built line is still gluten free');
  assert.ok(/Gluten Free Dessert Pizza/.test(pie.dish),
    'and the chit says so: ' + pie.dish);
});

test('building an order leaves the draft it was given untouched', () => {
  // The guest screen keeps its bowls after sending and offers "Same again",
  // which re-submits the very same objects. That only works while buildOrder
  // treats the draft as read-only - if it ever started stamping line ids or
  // normalising in place, the second send would be built from an already-built
  // order and the member would get something they did not ask for.
  const d = draft();
  const untouched = JSON.parse(JSON.stringify(d));

  make(d);
  assert.deepStrictEqual(d, untouched, 'the draft after one build');

  // And a second build of the same draft must produce the same order, which is
  // what pressing "Same again" actually does.
  const first = order.buildOrder(d, { ticketNo: 7, station: 'PASTA-1', queueDepth: 0, tag: null, serviceDate: '2026-10-08', now: new Date(0) });
  const second = order.buildOrder(d, { ticketNo: 7, station: 'PASTA-1', queueDepth: 0, tag: null, serviceDate: '2026-10-08', now: new Date(0) });
  assert.deepStrictEqual(second, first, 'ordering the same thing twice builds the same order');
});

test('draft validation accepts a good order', () => {
  assert.deepStrictEqual(order.validateDraft(draft(), config), []);
});

test('buildOrder derives allergens, cook time and audit entry', () => {
  const o = make();
  assert.strictEqual(o.status, STATUS.QUEUED);
  assert.strictEqual(o.lines.length, 2);
  assert.ok(o.cookEstimateSec > 0, 'cook estimate computed');
  assert.ok(o.allergenFlags.includes('gluten'), 'gluten from penne');
  assert.ok(o.allergenFlags.includes('dairy'), 'dairy from butter');
  assert.strictEqual(o.tagLabel, 'Table 12');
  assert.strictEqual(o.events.length, 1);
  assert.strictEqual(o.lines[1].dish, 'Penne w/ Arrabbiata + Marinara + Grilled Chicken, Meatballs');
  assert.ok(!('totalPrice' in o), 'nothing is priced');
  assert.ok(!('price' in o.lines[0]), 'no per-bowl price either');
});

test('derived fields ignore anything the client tried to assert', () => {
  const tampered = draft();
  tampered.cookEstimateSec = 1;
  tampered.lines[0].cookSec = 1;
  tampered.lines[0].dish = 'Free Lobster';
  const o = make(tampered);
  assert.ok(o.cookEstimateSec > 100, 'estimate recomputed, not trusted');
  assert.ok(o.lines[0].cookSec > 100, 'line cook time recomputed');
  assert.ok(!/Lobster/.test(o.lines[0].dish), 'dish text recomputed from the ids');
});

test('validation rejects a bowl with no sauce', () => {
  const bad = draft();
  bad.lines[0].sauces = [];
  const errors = order.validateDraft(bad, config);
  assert.ok(errors.some((e) => /sauce/i.test(e)), 'error mentions sauce');
});

test('a bowl can carry more than one sauce, up to the cap', () => {
  const two = draft();
  two.lines[0].sauces = ['marinara', 'alfredo'];
  assert.deepStrictEqual(order.validateDraft(two, config), []);
  const built = make(two);
  assert.deepStrictEqual(built.lines[0].sauces, ['marinara', 'alfredo']);
  assert.strictEqual(built.lines[0].dish, 'Shells w/ Marinara + Alfredo');
  // Allergens union across every sauce chosen.
  assert.ok(built.lines[0].allergens.includes('dairy'), 'alfredo brings dairy');

  const tooMany = draft();
  // Four sauces that are all real choices. 'butter' used to be the fourth
  // here and is now exclusive, so it trips the contradiction rule instead of
  // the cap - a different rule, tested on its own below.
  tooMany.lines[0].sauces = ['marinara', 'alfredo', 'pesto', 'arrabbiata'];
  assert.ok(order.validateDraft(tooMany, config).some((e) => /Up to 3 sauces/.test(e)));
});

test('two sauces cost the slowest plus a handling penalty, not the sum', () => {
  const one = { pasta: 'penne', sauces: ['marinara'], proteins: [], toppings: [], sides: [], portion: 'regular' };
  const two = { ...one, sauces: ['marinara', 'alfredo'] };
  const marinara = menu.find('sauces', 'marinara').finishSec;
  const alfredo = menu.find('sauces', 'alfredo').finishSec;
  const delta = cooktime.bowlCookSec(two) - cooktime.bowlCookSec(one);
  assert.strictEqual(delta, (alfredo - marinara) + cooktime.MODEL.extraSaucePenaltySec);
  assert.ok(cooktime.bowlCookSec(two) < cooktime.bowlCookSec(one) + alfredo, 'not a naive sum');
});

test('just butter is the whole answer to the sauce question', () => {
  // Buttered pasta is a dish, not a base to put marinara on. Same mechanic as
  // "No Sauce" on a pizza, so the screen greys the rest out and the validator
  // refuses the combination - one rule, read by both.
  const L = config.order;
  const bowl = { pasta: 'penne', proteins: [], toppings: [], sides: [], portion: 'regular' };

  assert.deepStrictEqual(menu.validateLine({ ...bowl, sauces: ['butter'] }, L), []);
  assert.ok(menu.validateLine({ ...bowl, sauces: ['butter', 'marinara'] }, L).length,
    'butter and marinara together is not a dish anyone ordered');

  // The tiles grey out for the same reason, from the same rule.
  const ruled = menu.groupRules('sauces', ['butter']);
  assert.ok(ruled.exclusive && ruled.exclusive.id === 'butter');
  assert.ok(ruled.blocked.marinara, 'marinara is greyed once butter is chosen');
});

test('a bowl or a pizza can carry more than one protein', () => {
  const L = config.order;

  const bowl = { pasta: 'penne', sauces: ['marinara'], proteins: ['chicken', 'meatballs'], toppings: [], sides: [], portion: 'regular' };
  assert.deepStrictEqual(menu.validateLine(bowl, L), []);
  assert.strictEqual(menu.describe(bowl), 'Penne w/ Marinara + Grilled Chicken, Meatballs');
  // Allergens union across every protein: meatballs bring gluten and egg.
  assert.ok(menu.allergensFor(bowl).includes('egg'));

  const pie = { kind: 'pizza', sauces: ['pz_bbq'], cheeses: ['pz_shred_mozz'], proteins: ['pepperoni', 'bacon'], toppings: ['red_onion'] };
  assert.deepStrictEqual(menu.validateLine(pie, L), []);
  assert.strictEqual(menu.describe(pie), 'BBQ Sauce Pizza w/ Shredded Mozzarella + Pepperoni, Bacon, Onions');

  // No cap on either lane, by the club's instruction - the same call they
  // made on toppings. A member who wants all of it gets all of it, and the
  // validator agrees by staying silent rather than refusing an order the
  // screen invited them to build.
  assert.deepStrictEqual(
    menu.validateLine({ ...bowl, proteins: ['chicken', 'meatballs', 'sausage', 'shrimp'] }, L), [],
  );
  assert.deepStrictEqual(
    menu.validateLine({ ...pie, proteins: ['pepperoni', 'bacon', 'ham', 'pz_chicken'] }, L), [],
  );

  // No protein is an empty array, not a 'none' tile.
  assert.deepStrictEqual(menu.validateLine({ ...bowl, proteins: [] }, L), []);
  assert.strictEqual(menu.describe({ ...bowl, proteins: [] }), 'Penne w/ Marinara');
});

test('proteins do not cross between the lanes', () => {
  const L = config.order;
  // Pepperoni is a pizza protein; shrimp is a pasta one.
  assert.ok(menu.validateLine({ pasta: 'penne', sauces: ['marinara'], proteins: ['pepperoni'], portion: 'regular' }, L)
    .some((e) => /protein is not on the menu/.test(e)));
  assert.ok(menu.validateLine({ kind: 'pizza', sauces: ['pz_bbq'], cheeses: ['pz_shred_mozz'], proteins: ['shrimp'], toppings: [] }, L)
    .some((e) => /protein is not on the menu/.test(e)));
});

test('two proteins cost the slowest plus handling, not the sum', () => {
  const one = { pasta: 'penne', sauces: ['marinara'], proteins: ['chicken'], toppings: [], sides: [], portion: 'regular' };
  const two = { ...one, proteins: ['chicken', 'shrimp'] };
  const chicken = menu.find('proteins', 'chicken').addSec;
  const shrimp = menu.find('proteins', 'shrimp').addSec;
  const delta = cooktime.lineCookSec(two) - cooktime.lineCookSec(one);
  assert.strictEqual(delta, (shrimp - chicken) + cooktime.MODEL.extraProteinPenaltySec);
  assert.ok(cooktime.lineCookSec(two) < cooktime.lineCookSec(one) + shrimp, 'not a naive sum');
});

test('a legacy single-protein line still reads correctly', () => {
  // Orders written before multi-select carry `protein`, sometimes 'none'.
  const legacy = { pasta: 'penne', sauces: ['marinara'], protein: 'chicken', toppings: [], sides: [], portion: 'regular' };
  assert.deepStrictEqual(menu.proteinsOf(legacy), ['chicken']);
  assert.strictEqual(menu.describe(legacy), 'Penne w/ Marinara + Grilled Chicken');
  assert.ok(cooktime.lineCookSec(legacy) > 0);

  const noneLegacy = { ...legacy, protein: 'none' };
  assert.deepStrictEqual(menu.proteinsOf(noneLegacy), [], "'none' becomes an empty list");
  assert.strictEqual(menu.describe(noneLegacy), 'Penne w/ Marinara', 'and never prints as a topping');
});

test('a legacy single-sauce bowl still reads correctly', () => {
  // Orders already on the rail when this build deployed carry `sauce`, not
  // `sauces`. The kitchen display must not break on them mid-service.
  const legacy = { pasta: 'penne', sauce: 'pesto', protein: 'none', toppings: [], sides: [], portion: 'regular' };
  assert.deepStrictEqual(menu.saucesOf(legacy), ['pesto']);
  assert.strictEqual(menu.describe(legacy), 'Penne w/ Basil Pesto');
  assert.ok(menu.allergensFor(legacy).includes('tree_nuts'), 'pesto allergens still found');
  assert.ok(cooktime.bowlCookSec(legacy) > 0);
});

test('86 ingredients are refused at submit, by name', () => {
  const d = draft();
  assert.deepStrictEqual(order.validateDraft(d, config, []), [], 'nothing 86 = fine');
  const errors = order.validateDraft(d, config, ['chicken', 'butter']);
  assert.ok(errors.some((e) => /^Bowl 2: Grilled Chicken just sold out/.test(e)), 'names the right bowl and the protein');
  assert.ok(errors.some((e) => /^Bowl 1: Just Butter just sold out/.test(e)), 'and the right bowl for the sauce');
  assert.ok(errors.some((e) => /Just Butter just sold out/.test(e)), 'names the sauce');
  // An 86'd item nobody chose must not raise anything.
  assert.deepStrictEqual(order.validateDraft(d, config, ['shrimp', 'olives']), []);
});

test('parcooked boil times are half the from-dry figures', () => {
  // These are finish-to-order times for pasta already blanched and held.
  const expected = { spaghetti: 240, penne: 300, rigatoni: 330, fettuccine: 210,
    farfalle: 270, shells: 300, tortellini: 120, fusilli_gf: 270 };
  Object.entries(expected).forEach(([id, sec]) => {
    assert.strictEqual(menu.find('pastas', id).boilSec, sec, id + ' boil time');
  });
});

test('a bowl may be piled as high as the member likes', () => {
  // The club removed the cap deliberately: a member who wants everything on it
  // should get everything on it. The guest screen offers advice at
  // config.order.toppingAdvice and the validator agrees by staying silent - if
  // the two ever disagree, a member is refused an order the app invited them
  // to build, which is the one failure worth never having.
  const loaded = draft();
  loaded.lines[0].toppings = ['parmesan', 'broccoli', 'olives', 'basil', 'spinach'];
  assert.deepStrictEqual(order.validateDraft(loaded, config), []);

  const absurd = draft();
  absurd.lines[0].toppings = menu.catalog().toppings.map((x) => x.id);
  // There are only ten pasta toppings, which is the advice exactly - so this
  // cannot show a bowl going past the advice, only that nothing stops a member
  // taking the lot. The pizza list is longer, and proves the rest.
  assert.ok(absurd.lines[0].toppings.length > 5,
    'the topping list is longer than the old cap, or this proves nothing');
  assert.deepStrictEqual(order.validateDraft(absurd, config), [],
    'every topping on the menu at once is still a valid order');
});

test('validation rejects a bad member number and guest count', () => {
  const bad = draft();
  bad.memberNumber = 'abc';
  bad.guestCount = 99;
  const errors = order.validateDraft(bad, config);
  assert.ok(errors.some((e) => /Member number/.test(e)));
  assert.ok(errors.some((e) => /Guest count/.test(e)));
});

test('a ticket may cover a full table, and not one more', () => {
  const cap = config.order.maxGuests;

  // The club seats 12, so a party of 12 on one ticket is the normal case and
  // has to pass. Read from config so raising or lowering the cap moves the
  // boundary this test checks, rather than leaving it behind.
  const full = draft();
  full.guestCount = cap;
  assert.deepStrictEqual(
    order.validateDraft(full, config).filter((e) => /Guest count/.test(e)), [],
    'a party of ' + cap + ' is allowed',
  );

  const over = draft();
  over.guestCount = cap + 1;
  assert.ok(
    order.validateDraft(over, config).some((e) => /Guest count/.test(e)),
    'a party of ' + (cap + 1) + ' is refused',
  );

  const none = draft();
  none.guestCount = 0;
  assert.ok(order.validateDraft(none, config).some((e) => /Guest count/.test(e)));
});

test('happy path runs queued -> cooking -> ready -> delivered', () => {
  let o = make();
  assert.deepStrictEqual(order.allowedActions(o, sla).sort(), ['accept', 'hold', 'rush', 'void']);
  o = order.applyTransition(o, 'accept', { actor: 'cook:marco', sla });
  assert.strictEqual(o.status, STATUS.COOKING);
  assert.strictEqual(o.acceptedBy, 'cook:marco');
  o = order.applyTransition(o, 'ready', { actor: 'cook:marco', sla });
  assert.strictEqual(o.status, STATUS.READY);
  o = order.applyTransition(o, 'deliver', { actor: 'runner:tess', sla });
  assert.strictEqual(o.status, STATUS.DELIVERED);
  assert.strictEqual(o.events.length, 4, 'audit trail has four entries');
});

test('illegal transitions are refused with the allowed set attached', () => {
  const o = make();
  assert.throws(() => order.applyTransition(o, 'ready', { sla }), (e) => {
    assert.strictEqual(e.code, 'ILLEGAL_TRANSITION');
    assert.deepStrictEqual(e.allowed.sort(), ['accept', 'hold', 'rush', 'void']);
    return true;
  });
  assert.throws(() => order.applyTransition(o, 'deliver', { sla }), (e) => e.code === 'ILLEGAL_TRANSITION');
  assert.throws(() => order.applyTransition(o, 'nope', { sla }), (e) => e.code === 'BAD_ACTION');
});

test('a second accept cannot land on a cooking chit', () => {
  const o = order.applyTransition(make(), 'accept', { actor: 'screen-a', sla });
  assert.throws(() => order.applyTransition(o, 'accept', { actor: 'screen-b', sla }), (e) => e.code === 'ILLEGAL_TRANSITION');
  assert.strictEqual(o.acceptedBy, 'screen-a');
});

test('undo walks the chit back and clears its stamp', () => {
  let o = order.applyTransition(make(), 'accept', { sla });
  o = order.applyTransition(o, 'unaccept', { sla });
  assert.strictEqual(o.status, STATUS.QUEUED);
  assert.strictEqual(o.acceptedAt, null);
  assert.strictEqual(o.acceptedBy, null);
});

test('undeliver is offered inside the undo window and withdrawn after', () => {
  let o = make();
  o = order.applyTransition(o, 'accept', { sla });
  o = order.applyTransition(o, 'ready', { sla });
  o = order.applyTransition(o, 'deliver', { sla });
  assert.ok(order.allowedActions(o, sla).includes('undeliver'), 'available immediately');
  const later = Date.now() + (sla.undoWindowSec + 5) * 1000;
  assert.ok(!order.allowedActions(o, sla, later).includes('undeliver'), 'gone after the window');
});

test('hold and release park an order without losing it', () => {
  let o = order.applyTransition(make(), 'hold', { note: 'guest stepped away', sla });
  assert.strictEqual(o.status, STATUS.HELD);
  o = order.applyTransition(o, 'release', { sla });
  assert.strictEqual(o.status, STATUS.QUEUED);
});

test('rush raises priority without changing status, and cannot repeat', () => {
  const o = order.applyTransition(make(), 'rush', { actor: 'expo', sla });
  assert.strictEqual(o.priority, 'rush');
  assert.strictEqual(o.status, STATUS.QUEUED);
  assert.ok(!order.allowedActions(o, sla).includes('rush'), 'already rushed');
});

test('allergy avoidance flags the chit', () => {
  const d = draft();
  d.avoidAllergens = ['shellfish'];
  assert.strictEqual(make(d).priority, 'allergy');
});

test('publicView hides staff and audit detail from the guest', () => {
  const o = order.applyTransition(make(), 'accept', { actor: 'cook:marco', sla });
  const pub = order.publicView(o);
  assert.strictEqual(pub.ticketNo, o.ticketNo);
  ['acceptedBy', 'station', 'events', 'memberNumber', 'memberTier', 'totalPrice'].forEach((f) => {
    assert.ok(!(f in pub), f + ' must not reach the guest');
  });
});

test('cook estimate grows with pan loads, not linearly with bowls', () => {
  const one = [draft().lines[1]];
  const six = Array.from({ length: 6 }, () => draft().lines[1]);
  const a = cooktime.orderCookSec(one);
  const b = cooktime.orderCookSec(six);
  assert.ok(b > a, 'six bowls take longer than one');
  assert.ok(b < a * 6, 'but far less than six times longer');
});

test('station assignment round-robins by ticket number', () => {
  const st = config.kitchen.stations;
  assert.strictEqual(order.stationForTicket(1, st), 'PASTA-1');
  assert.strictEqual(order.stationForTicket(2, st), 'PASTA-2');
  assert.strictEqual(order.stationForTicket(3, st), 'PASTA-1');
  assert.strictEqual(order.stationForTicket(4, st), 'PASTA-2');
  // Even distribution over a service, and no reliance on a live read.
  const counts = {};
  for (let n = 1; n <= 100; n += 1) {
    const id = order.stationForTicket(n, st);
    counts[id] = (counts[id] || 0) + 1;
  }
  assert.strictEqual(counts['PASTA-1'], 50);
  assert.strictEqual(counts['PASTA-2'], 50);
  // Pinning everything to one station is still honoured.
  assert.strictEqual(order.stationForTicket(7, st, false), 'PASTA-1');
});

test('metrics roll up a finished day', () => {
  const orders = [];
  for (let i = 0; i < 5; i += 1) {
    let o = make();
    const base = Date.now() - (60 - i * 5) * 60000;
    o.submittedAt = new Date(base).toISOString();
    o = order.applyTransition(o, 'accept', { sla, now: new Date(base + 45000) });
    o = order.applyTransition(o, 'ready', { sla, now: new Date(base + 45000 + o.cookEstimateSec * 1000) });
    o = order.applyTransition(o, 'deliver', { sla, now: new Date(base + 45000 + o.cookEstimateSec * 1000 + 30000) });
    orders.push(o);
  }
  const m = order.metrics(orders, sla);
  assert.strictEqual(m.counts.total, 5);
  assert.strictEqual(m.counts.delivered, 5);
  // All five orders are the same member with a party of two. AYCE bills per
  // person, so that is TWO covers on one charge - not ten. Summing guest counts
  // over orders is exactly the double-bill this replaced.
  assert.strictEqual(m.covers, 2, 'billable covers, not a sum over orders');
  assert.strictEqual(m.guestCountEntries, 10, 'the raw sum is still available');
  assert.strictEqual(m.bowls, 10, 'ten bowls were still cooked');
  assert.ok(!('revenue' in m), 'metrics carry no money');
  assert.strictEqual(m.timings.avgQueueSec, 45);
  assert.strictEqual(m.timings.avgRunnerSec, 30);
  assert.strictEqual(m.onTimePct, 100, 'cooked exactly to estimate counts as on time');
});

test('shift report totals, mix and exceptions', () => {
  const orders = [];
  // Three delivered on time, one delivered late, one voided, one held.
  for (let i = 0; i < 4; i += 1) {
    let o = make();
    const base = Date.now() - (90 - i * 10) * 60000;
    o.submittedAt = new Date(base).toISOString();
    o = order.applyTransition(o, 'accept', { sla, now: new Date(base + 40000) });
    // The fourth takes twice its estimate, so it must land in `late`.
    const cook = i === 3 ? o.cookEstimateSec * 2 : o.cookEstimateSec * 0.9;
    o = order.applyTransition(o, 'ready', { sla, now: new Date(base + 40000 + cook * 1000) });
    o = order.applyTransition(o, 'deliver', { sla, now: new Date(base + 40000 + cook * 1000 + 25000) });
    orders.push(o);
  }
  orders.push(order.applyTransition(make(), 'void', { sla }));
  orders.push(order.applyTransition(make(), 'hold', { sla }));

  const r = order.shiftReport(orders, sla);

  // Voided tickets are excluded from covers, bowls and mix, but still reported.
  assert.strictEqual(r.totals.orders, 5, 'five live orders, void excluded');
  assert.strictEqual(r.totals.delivered, 4);
  assert.strictEqual(r.totals.voided, 1);
  assert.strictEqual(r.totals.held, 1);
  assert.strictEqual(r.totals.covers, 2, 'one member, one party of two, one charge');
  assert.strictEqual(r.totals.members, 1);
  assert.strictEqual(r.totals.repeatOrders, 4, 'four of the five were repeat trips');
  assert.strictEqual(r.totals.bowls, 10);

  assert.strictEqual(r.late.length, 1, 'exactly one late ticket');
  assert.ok(r.late[0].overSec > 0, 'and it records how far over');
  assert.strictEqual(r.onTime.count, 3);
  assert.strictEqual(r.onTime.pct, 75, '3 of 4 on time');

  // Menu mix counts each sauce on a mixed bowl, so sauces exceed bowls.
  const sauceTotal = r.mix.pasta.sauces.reduce((a, x) => a + x.count, 0);
  assert.strictEqual(sauceTotal, 15, '5 orders x (1 sauce + 2 sauces)');
  // One shape per bowl in this fixture; a split bowl would count two, the
  // same way a two-sauce bowl counts two sauces above.
  assert.strictEqual(r.mix.pasta.pastas.reduce((a, x) => a + x.count, 0), 10, 'one shape per bowl');
  assert.strictEqual(r.byKind.pasta.items, 10);
  assert.strictEqual(r.byKind.pizza.items, 0, 'no pizzas in this fixture');

  // The curve accounts for every live item, split by kind.
  assert.strictEqual(r.curve.reduce((a, b) => a + b.items, 0), 10);
  assert.strictEqual(r.curve.reduce((a, b) => a + b.bowls, 0), 10, 'all pasta in this fixture');
  assert.strictEqual(r.curve.reduce((a, b) => a + b.pizzas, 0), 0);
  assert.ok(r.peak && r.peak.bowls > 0);

  assert.strictEqual(r.exceptions.voided.length, 1);
  assert.strictEqual(r.exceptions.held.length, 1);
  assert.strictEqual(r.stations.length, 1, 'all seeded to PASTA-1');
});

test('shift report survives an empty day', () => {
  const r = order.shiftReport([], sla);
  assert.strictEqual(r.totals.orders, 0);
  assert.deepStrictEqual(r.mix.pizza.sauces, [], 'empty pizza mix, not undefined');
  assert.strictEqual(r.totals.covers, 0);
  assert.strictEqual(r.onTime.pct, null, 'no percentage without deliveries');
  assert.deepStrictEqual(r.late, []);
  assert.deepStrictEqual(r.curve, []);
  assert.strictEqual(r.peak, null);
  assert.strictEqual(r.totals.bowlsPerCover, 0, 'no divide by zero');
});

const pizzaDraft = () => ({
  memberNumber: '1794',
  memberName: 'Compofelice',
  memberStatus: 'verified',
  guestCount: 2,
  lines: [
    { guestLabel: 'Ada', kind: 'pizza', sauces: ['pz_bbq'], cheeses: ['pz_shred_mozz'], proteins: ['pz_chicken', 'bacon'], toppings: ['red_onion', 'fin_salt', 'fin_oregano'] },
    { guestLabel: 'Sam', kind: 'pizza', sauces: ['pz_marinara', 'pz_alfredo'], cheeses: ['pz_fresh_mozz'], proteins: ['pepperoni'], toppings: [] },
  ],
});

const makePizza = (d = pizzaDraft()) => ({
  id: 'ord_pz_' + (seq += 1),
  ...order.buildOrder(d, {
    ticketNo: seq,
    station: order.stationForTicket(seq, config.kitchen.stations, true, 'pizza'),
    queueDepth: 0,
    tag: { id: 'table-04', label: 'Table 4', kind: 'table' },
    serviceDate: '2026-09-10',
  }),
});

test('validation names a pizza a pizza, not a bowl', () => {
  const d = pizzaDraft();
  d.lines[0].sauces = [];
  const errors = order.validateDraft(d, config);
  assert.ok(errors.some((e) => /^Pizza 1:/.test(e)), 'says Pizza 1, got: ' + errors.join(' | '));
  assert.ok(!errors.some((e) => /^Bowl /.test(e)), 'never says Bowl for a pizza');
  const sold = order.validateDraft(pizzaDraft(), config, ['pepperoni']);
  assert.ok(sold.some((e) => /^Pizza 2: Pepperoni just sold out/.test(e)), sold.join(' | '));
});

test('a pizza is built with no portion, sides or spice', () => {
  assert.deepStrictEqual(order.validateDraft(pizzaDraft(), config), []);
  const o = makePizza();
  assert.strictEqual(o.kind, 'pizza');
  const line = o.lines[0];
  assert.strictEqual(line.kind, 'pizza');
  assert.deepStrictEqual(line.toppings, ['red_onion', 'fin_salt', 'fin_oregano']);
  ['portion', 'sides', 'spice'].forEach((f) => {
    assert.ok(!(f in line), 'a pizza line has no ' + f);
  });
  assert.strictEqual(line.dish, 'BBQ Sauce Pizza w/ Shredded Mozzarella + Chicken, Bacon, Onions, Flake Salt, Oregano');
  assert.strictEqual(o.lines[1].dish, 'House Made Marinara + Alfredo Sauce Pizza w/ Fresh Mozzarella + Pepperoni');
});

test('every pizza inherits the crust allergens', () => {
  const plain = { kind: 'pizza', sauces: ['pz_marinara'], cheeses: ['pz_shred_mozz'], toppings: [] };
  const a = menu.allergensFor(plain);
  assert.ok(a.includes('gluten'), 'crust');
  assert.ok(a.includes('dairy'), 'cheese');
  assert.ok(menu.allergensFor({ ...plain, proteins: ['bacon'] }).includes('pork'), 'bacon is a protein now');
});

test('two kinds cannot share one order', () => {
  const mixed = pizzaDraft();
  mixed.lines.push({ pasta: 'penne', sauces: ['marinara'], portion: 'regular' });
  assert.ok(order.validateDraft(mixed, config).some((e) => /separate order/.test(e)));

  // Same rule for a burger, which routes to a third station again.
  const withBurger = pizzaDraft();
  withBurger.lines.push(burgerLine());
  assert.ok(order.validateDraft(withBurger, config).some((e) => /separate order/.test(e)));
});

test('pizza sauces and pasta sauces are not interchangeable', () => {
  const wrong = pizzaDraft();
  wrong.lines[0].sauces = ['pesto'];
  assert.ok(order.validateDraft(wrong, config).some((e) => /not on the menu/.test(e)));
  const alsoWrong = draft();
  alsoWrong.lines[0].sauces = ['pz_bbq'];
  assert.ok(order.validateDraft(alsoWrong, config).some((e) => /not on the menu/.test(e)));
});

test('a pizza may be piled as high as the member likes', () => {
  const many = pizzaDraft();
  many.lines[0].toppings = ['pz_olives', 'pz_artichoke', 'pz_mushroom', 'pineapple', 'jalapeno'];
  assert.deepStrictEqual(order.validateDraft(many, config), []);

  // What used to be the sixth baked topping, one past the old cap of five.
  many.lines[0].toppings.push('red_onion');
  assert.deepStrictEqual(order.validateDraft(many, config), [],
    'a sixth baked topping was the old cap, and is now simply a topping');

  // The pizza list is the longer of the two, so this is where the advice can
  // actually be exceeded - and must still be accepted. If the advice ever
  // grows past the menu, this stops proving anything and says so.
  const everything = pizzaDraft();
  // Everything this crust offers - strawberries and powdered sugar belong to
  // a dessert pizza and are refused on a savoury one, which is a different
  // rule and has its own test.
  const allowed = menu.crustBlocks('pizzaToppings', everything.lines[0]);
  everything.lines[0].toppings = menu.catalog().pizzaToppings
    .filter((x) => !allowed[x.id]).map((x) => x.id);
  assert.ok(everything.lines[0].toppings.length > config.order.toppingAdvice,
    'the pizza topping list must be longer than the advice for this to mean anything');
  assert.deepStrictEqual(order.validateDraft(everything, config), [],
    'more toppings than the chef advises is still a valid order');
});

test('orders route to the station pool matching their kind', () => {
  const st = config.kitchen.stations;
  const kinds = [...new Set(st.map((s) => s.kind))];
  assert.ok(kinds.length > 1, 'more than one kind of station exists to confuse');

  // Derived from config rather than written down, because the line changes:
  // the club went from two pizza ovens to one, and a test that named PIZZA-2
  // failed for the wrong reason - not because routing broke, but because it
  // had memorised a piece of equipment. Assert the properties instead.
  kinds.forEach((kind) => {
    const pool = st.filter((s) => s.kind === kind).map((s) => s.id);
    const perStation = 20;
    const hits = {};

    for (let n = 1; n <= pool.length * perStation; n += 1) {
      const id = order.stationForTicket(n, st, true, kind);
      assert.ok(pool.includes(id), kind + ' ticket ' + n + ' landed on ' + id);
      hits[id] = (hits[id] || 0) + 1;
    }

    // An even share matters more than which station is first: a cook stood at
    // a station that never receives a ticket is the failure worth catching.
    pool.forEach((id) => assert.strictEqual(hits[id], perStation, id + ' share'));
  });
});

test('the two-deck oven bakes two pies at a time', () => {
  const pie = { kind: 'pizza', sauces: ['pz_marinara'], cheeses: ['pz_shred_mozz'], proteins: ['pepperoni'], toppings: [] };
  const at = (n) => cooktime.orderCookSec(Array.from({ length: n }, () => pie));
  const reload = cooktime.MODEL.pizza.deckReloadSec;
  assert.strictEqual(cooktime.MODEL.pizza.decks * cooktime.MODEL.pizza.piesPerDeck, 2);
  assert.ok(at(2) - at(1) < 60, 'second pie rides along in the other deck');
  assert.ok(at(3) - at(2) >= reload, 'third waits for a deck to clear');
  assert.ok(at(5) - at(3) >= reload, 'and so does the fifth');
  const finished = { ...pie, toppings: ['fin_salt', 'fin_oregano'] };
  assert.strictEqual(cooktime.lineCookSec(finished), cooktime.lineCookSec(pie),
    'salt and oregano go on after the bake, so they cost no oven time');
});

test('shift report splits the prep guide by station', () => {
  const r = order.shiftReport([makePizza(), makePizza(), make()], sla);
  assert.strictEqual(r.byKind.pizza.orders, 2);
  assert.strictEqual(r.byKind.pizza.items, 4);
  assert.strictEqual(r.byKind.pasta.orders, 1);
  assert.strictEqual(r.byKind.pasta.items, 2);
  assert.ok(r.mix.pizza.sauces.some((x) => x.name === 'BBQ Sauce'));
  assert.ok(!r.mix.pasta.sauces.some((x) => x.name === 'BBQ'), 'BBQ never lands in the pasta list');
  assert.strictEqual(r.mix.pizza.sauces.reduce((a, x) => a + x.count, 0), 6, '2 orders x (1 + 2 sauces)');
  assert.ok(r.mix.pizza.cheeses.length > 0, 'cheeses tallied');

  // The service curve separates the two, and the totals reconcile.
  const bowls = r.curve.reduce((a, b) => a + b.bowls, 0);
  const pizzas = r.curve.reduce((a, b) => a + b.pizzas, 0);
  const items = r.curve.reduce((a, b) => a + b.items, 0);
  assert.strictEqual(bowls, 2, 'one pasta order of two bowls');
  assert.strictEqual(pizzas, 4, 'two pizza orders of two pies');
  assert.strictEqual(items, bowls + pizzas, 'total is the sum of the two series');
  assert.strictEqual(items, r.totals.bowls, 'and matches the day total');
  // The peak is chosen on the stacked total, not on either series alone.
  assert.ok(r.peak.items >= r.peak.bowls && r.peak.items >= r.peak.pizzas);
});

test('AYCE billing counts a person once, however many orders they place', () => {
  // A party of four eats pasta, then comes back for pizza. One price covers
  // both, so this is four covers and one charge - not eight.
  const pasta = make();
  pasta.memberNumber = '3150';
  pasta.memberName = 'Okonkwo';
  pasta.guestCount = 4;

  const pizza = makePizza();
  pizza.memberNumber = '3150';
  pizza.memberName = 'Okonkwo';
  pizza.guestCount = 4;

  const rows = order.memberRollup([pasta, pizza]);
  assert.strictEqual(rows.length, 1, 'one member, one row');
  const m = rows[0];
  assert.strictEqual(m.memberNumber, '3150');
  assert.strictEqual(m.name, 'Okonkwo');
  assert.strictEqual(m.orders, 2, 'two trips to the app');
  assert.strictEqual(m.partySize, 4, 'still four people');
  assert.strictEqual(m.bowls, 2);
  assert.strictEqual(m.pizzas, 2);
  assert.strictEqual(m.items, 4);
  assert.deepStrictEqual(m.kinds, ['pasta', 'pizza'], 'ate both');
  assert.strictEqual(order.billableCovers([pasta, pizza]), 4, 'four covers, not eight');
});

test('four guests at a table are four charges, whatever they order', () => {
  // The operator's rule, verbatim: "If there are four guests at the table, no
  // matter how many bowls or pizzas they order, it's always just four charges."
  const orders = [];
  for (let i = 0; i < 3; i += 1) {
    const o = make();            // three pasta orders, four bowls each
    o.memberNumber = '3150';
    o.guestCount = 4;
    o.lines = [...o.lines, ...o.lines];
    orders.push(o);
  }
  for (let i = 0; i < 2; i += 1) {
    const o = makePizza();       // then two pizza orders on top
    o.memberNumber = '3150';
    o.guestCount = 4;
    orders.push(o);
  }

  const items = orders.reduce((a, o) => a + o.lines.length, 0);
  assert.ok(items >= 16, 'they ordered a lot: ' + items + ' items');
  assert.strictEqual(order.billableCovers(orders), 4, 'still four charges');

  const r = order.shiftReport(orders, sla);
  assert.strictEqual(r.totals.covers, 4, 'the report charges four');
  assert.strictEqual(r.totals.orders, 5, 'across five orders');
  assert.strictEqual(r.totals.members, 1, 'one member');
  assert.strictEqual(r.totals.bowls, items, 'and every item is still counted');
  assert.strictEqual(r.members[0].partySize, 4);
  assert.strictEqual(r.members[0].orders, 5);
});

test('a bigger second party raises the billable count', () => {
  // Two joined them for round two, so the party genuinely grew.
  const first = make();
  first.memberNumber = '4421';
  first.guestCount = 2;
  const second = makePizza();
  second.memberNumber = '4421';
  second.guestCount = 5;
  assert.strictEqual(order.billableCovers([first, second]), 5, 'take the largest head count');
});

test('separate members are billed separately, and voids are excluded', () => {
  const a = make(); a.memberNumber = '1001'; a.guestCount = 3;
  const b = make(); b.memberNumber = '1002'; b.guestCount = 2;
  const voided = order.applyTransition(make(), 'void', { sla });
  voided.memberNumber = '1003';
  voided.guestCount = 9;

  assert.strictEqual(order.billableCovers([a, b, voided]), 5, '3 + 2, void not charged');
  const rows = order.memberRollup([a, b, voided]);
  assert.strictEqual(rows.length, 2, 'the voided member does not appear');
});

test('an unverified member still appears on the list', () => {
  const o = make();
  o.memberNumber = '7890';
  o.memberName = '';
  o.memberStatus = 'unverified';
  const m = order.memberRollup([o])[0];
  assert.strictEqual(m.status, 'unverified');
  assert.strictEqual(m.name, '', 'no name to show, so the report says so');
  assert.strictEqual(m.partySize, 2, 'still billable');
});

test('the member list is sorted by how much they ate', () => {
  const light = make(); light.memberNumber = '2001';
  const heavy = make(); heavy.memberNumber = '2002';
  heavy.lines = heavy.lines.concat(heavy.lines);
  const rows = order.memberRollup([light, heavy]);
  assert.strictEqual(rows[0].memberNumber, '2002', 'heaviest eater first');
  assert.ok(rows[0].items > rows[1].items);
});

test('a member number is the same member however it is typed', () => {
  // The operator's case: someone enters 2, or 0002, or 002.
  ['2', '02', '002', '0002'].forEach((typed) => {
    assert.strictEqual(order.normalizeMemberNumber(typed), '2', typed + ' is member 2');
  });
  assert.strictEqual(order.normalizeMemberNumber('0007'), '7');
  assert.strictEqual(order.normalizeMemberNumber('1794'), '1794');
  assert.strictEqual(order.normalizeMemberNumber(' 42 '), '42', 'stray spaces forgiven');

  // There is no member zero, so these are not a member rather than member 0.
  ['0', '00', '000', '0000'].forEach((z) => {
    assert.strictEqual(order.normalizeMemberNumber(z), null, z + ' is not a member');
  });
  // And nothing outside 1-4 digits.
  ['', '12345', 'abc', '1a', '-1', '1.5'].forEach((bad) => {
    assert.strictEqual(order.normalizeMemberNumber(bad), null, JSON.stringify(bad));
  });
});

test('an order stores the canonical member number, not what was typed', () => {
  const padded = draft();
  padded.memberNumber = '0007';
  assert.deepStrictEqual(order.validateDraft(padded, config), [], '0007 is valid input');
  assert.strictEqual(make(padded).memberNumber, '7', 'stored canonical');

  // So two guests typing the same member differently are one member on the
  // report, not two - which is what AYCE billing depends on.
  const a = make((() => { const d = draft(); d.memberNumber = '7'; return d; })());
  const b = make((() => { const d = draft(); d.memberNumber = '007'; return d; })());
  const rows = order.memberRollup([a, b]);
  assert.strictEqual(rows.length, 1, 'one member, not two');
  assert.strictEqual(rows[0].memberNumber, '7');
  assert.strictEqual(rows[0].orders, 2);
});

test('a member number outside 1-4 digits is refused', () => {
  const bad = draft();
  bad.memberNumber = '12345';
  assert.ok(order.validateDraft(bad, config).some((e) => /1 to 4 digits/.test(e)));
  bad.memberNumber = '0000';
  assert.ok(order.validateDraft(bad, config).some((e) => /1 to 4 digits/.test(e)));
});

test('the directory holds family names, so rows read as a party', () => {
  // Every row is a surname, which is why the greeting is addressed to the
  // party and not to a person. Guard against a first name creeping in.
  seed.MEMBERS.forEach((m) => {
    assert.ok(!m.name.includes(' '), m.name + ' should be a single family name');
    assert.strictEqual(m.name, m.name.trim());
    assert.ok(/^[A-Z]/.test(m.name), m.name + ' should be capitalised');
  });
});

test('the demo member directory is usable as a lookup table', () => {
  const nums = seed.MEMBERS.map((m) => m.memberNumber);

  assert.strictEqual(seed.MEMBERS.length, 30);
  // Every number must be in canonical form, or the row is unreachable: a guest
  // typing 7 would look up members/7 and never find members/0007.
  nums.forEach((n) => assert.ok(config.order.memberNumberPattern.test(n),
    n + ' is not a canonical 1-4 digit number'));
  nums.forEach((n) => assert.strictEqual(order.normalizeMemberNumber(n), n,
    n + ' is already canonical'));
  // The demo has to exercise every length the keypad accepts, or a 1-digit
  // member is a path nobody ever walks before a guest walks it.
  const lengths = new Set(nums.map((n) => n.length));
  assert.deepStrictEqual([...lengths].sort(), [1, 2, 3, 4],
    'directory spans all four number lengths, got ' + [...lengths].sort());
  assert.strictEqual(new Set(nums).size, nums.length, 'numbers are unique');
  assert.strictEqual(new Set(seed.MEMBERS.map((m) => m.name)).size, 30, 'names are unique');

  const anthony = seed.MEMBERS.find((m) => m.memberNumber === '1794');
  assert.ok(anthony, '1794 is in the directory');
  assert.strictEqual(anthony.name, 'Compofelice');

  seed.MEMBERS.forEach((m) => {
    assert.ok(m.name && m.name.length > 1, 'every row has a name');
    assert.ok(Number.isInteger(m.defaultGuests) && m.defaultGuests >= 1
      && m.defaultGuests <= config.order.maxGuests, m.name + ' default guests');
  });

  // Any member the seeded orders reference must resolve to a name, or the demo
  // rail shows unverified badges that are not demonstrating anything. Checked
  // against the orders that actually get written, not the draft table.
  const referenced = [...new Set(seed.buildDemoOrders().map((o) => o.memberNumber))].sort();
  const missing = referenced.filter((n) => !nums.includes(n));
  assert.deepStrictEqual(missing, ['7890'],
    'only 7890 should be absent - it is what exercises the unverified path, got '
    + JSON.stringify(missing));
});

test('every short member in the directory is reachable zero-padded', () => {
  // A guest reads 42 off their card and types it into four boxes as 0042. The
  // short members are the whole point of the mixed list, so each one has to
  // survive that on the way to a document id.
  const short = seed.MEMBERS.filter((m) => m.memberNumber.length < 4);
  assert.ok(short.length >= 15, 'plenty of short numbers to exercise, got ' + short.length);
  short.forEach((m) => {
    const padded = m.memberNumber.padStart(4, '0');
    assert.strictEqual(order.normalizeMemberNumber(padded), m.memberNumber,
      padded + ' reaches ' + m.name);
  });
});

test('No Sauce answers the whole question and greys the rest', () => {
  const r = menu.groupRules('pizzaSauces', ['pz_no_sauce']);
  assert.ok(r.exclusive, 'no-sauce is recognised as the exclusive answer');
  assert.deepStrictEqual(r.bases, [], 'it is not itself a sauce');
  // Every other entry in the group, sauces and amounts alike, is unpickable.
  ['pz_marinara', 'pz_alfredo', 'pz_bbq', 'pz_sauce_light', 'pz_sauce_heavy']
    .forEach((id) => assert.ok(r.blocked[id], id + ' is greyed out'));
  assert.ok(!r.blocked.pz_no_sauce, 'and it can still be tapped off again');
});

test('light and heavy rule each other out, but not a sauce', () => {
  const r = menu.groupRules('pizzaSauces', ['pz_marinara', 'pz_sauce_heavy']);
  assert.deepStrictEqual(r.bases, ['pz_marinara']);
  assert.strictEqual(r.amount.amount, 'heavy');
  assert.ok(r.blocked.pz_sauce_light, 'nothing is both light and heavy');
  assert.ok(!r.blocked.pz_alfredo, 'a second sauce is still fair game');
  assert.strictEqual(r.error, null);
});

test('an amount with nothing under it is refused', () => {
  const r = menu.groupRules('pizzaCheeses', ['pz_cheese_heavy']);
  assert.match(r.error, /needs something to go on/i);
  const errs = menu.validateLine(
    { kind: 'pizza', sauces: ['pz_marinara'], cheeses: ['pz_cheese_heavy'], toppings: [] },
    config.order,
  );
  assert.ok(errs.some((e) => /needs something to go on/i.test(e)), errs.join('; '));
});

test('the sauce cap counts sauces, not the amount chip', () => {
  const L = config.order;
  // Three sauces plus "heavy" is four selections but three sauces, and three
  // is the cap - this must not be refused for being one over.
  const ok = {
    kind: 'pizza', cheeses: ['pz_shred_mozz'], toppings: [],
    sauces: ['pz_marinara', 'pz_alfredo', 'pz_bbq', 'pz_sauce_heavy'],
  };
  assert.deepStrictEqual(menu.validateLine(ok, L), []);

  const tooMany = { ...ok, sauces: ['pz_marinara', 'pz_alfredo', 'pz_bbq', 'pz_pesto'] };
  assert.ok(menu.validateLine(tooMany, L).some((e) => /Up to 3 sauces/.test(e)));
});

test('a contradictory pizza cannot be written even if a screen let it through', () => {
  const contradiction = {
    kind: 'pizza', sauces: ['pz_no_sauce', 'pz_marinara'],
    cheeses: ['pz_shred_mozz'], toppings: [],
  };
  assert.ok(menu.validateLine(contradiction, config.order).some((e) => /contradict/i.test(e)));
});

test('a pizza has to answer the cheese question', () => {
  const L = config.order;
  const noAnswer = { kind: 'pizza', sauces: ['pz_marinara'], cheeses: [], toppings: [] };
  assert.ok(menu.validateLine(noAnswer, L).some((e) => /Pick a cheese, or No Cheese/.test(e)));

  // "No Cheese" is an answer, not the absence of one.
  const declined = { ...noAnswer, cheeses: ['pz_no_cheese'] };
  assert.deepStrictEqual(menu.validateLine(declined, L), []);
});

test('a no-cheese pizza is genuinely dairy free', () => {
  const dairy = menu.allergensFor({ kind: 'pizza', sauces: ['pz_marinara'], cheeses: ['pz_shred_mozz'], toppings: [] });
  assert.ok(dairy.includes('dairy'), 'mozzarella brings dairy');

  const none = menu.allergensFor({ kind: 'pizza', sauces: ['pz_marinara'], cheeses: ['pz_no_cheese'], toppings: [] });
  assert.ok(!none.includes('dairy'), 'no cheese means no dairy, got ' + none.join(','));
  assert.ok(none.includes('gluten'), 'the crust still has gluten');
});

test('post-bake vegetables cost no oven time', () => {
  const base = { kind: 'pizza', sauces: ['pz_marinara'], cheeses: ['pz_shred_mozz'], proteins: [], toppings: [] };
  const plain = cooktime.lineCookSec(base);
  // Basil, arugula and the flakes go on after it leaves the oven.
  const garnished = cooktime.lineCookSec({ ...base, toppings: ['pz_basil', 'pz_arugula', 'pz_chili'] });
  assert.strictEqual(garnished, plain, 'garnish does not extend the bake');
  // A mushroom does go in the oven.
  assert.ok(cooktime.lineCookSec({ ...base, toppings: ['pz_mushroom'] }) > plain);
});

test('heavy cheese is the one amount that changes the bake', () => {
  const base = { kind: 'pizza', sauces: ['pz_marinara'], cheeses: ['pz_shred_mozz'], proteins: [], toppings: [] };
  const plain = cooktime.lineCookSec(base);
  const heavy = cooktime.lineCookSec({ ...base, cheeses: ['pz_shred_mozz', 'pz_cheese_heavy'] });
  assert.ok(heavy > plain, 'more cheese is more moisture and more time');
  const light = cooktime.lineCookSec({ ...base, cheeses: ['pz_shred_mozz', 'pz_cheese_light'] });
  assert.strictEqual(light, plain, 'less cheese does not make the oven faster');
});

test('an order keeps the cheese the guest chose', () => {
  const o = order.buildOrder({
    memberNumber: '1794',
    guestCount: 1,
    lines: [{
      guestLabel: 'A', kind: 'pizza', sauces: ['pz_bbq'],
      cheeses: ['pz_fresh_mozz', 'pz_cheese_light'],
      proteins: [], toppings: [],
    }],
  }, {
    ticketNo: 1, serviceDate: '2026-09-11',
    station: 'PIZZA-1', tag: null, queueDepth: 0,
  });
  assert.deepStrictEqual(o.lines[0].cheeses, ['pz_fresh_mozz', 'pz_cheese_light']);
  assert.match(o.lines[0].dish, /Fresh Mozzarella \(light\)/);
});

test('every menu item resolves to a real glyph', () => {
  // The glyph set had no coverage at all until a malformed one took the whole
  // app down while every test stayed green - the suite imported menu.js and
  // never art.js. Importing it here means a syntax error fails the run, and
  // walking the menu means a typo'd icon key does too.
  const c = menu.catalog();

  // Groups that are never drawn as tiles, and so need no artwork. Everything
  // else in the catalog is checked, whether or not it existed when this test
  // was written - the previous version named nine groups by hand, which meant
  // `portions` went years with no art at all (both sizes wore the crossed-out
  // "none" glyph) and all six burger groups arrived unchecked. A list of what
  // to skip stays right as the menu grows; a list of what to check does not.
  const NOT_TILED = ['allergens', 'spice'];
  NOT_TILED.forEach((g) => assert.ok(Array.isArray(c[g]), g + ' is still a group'));

  const groups = Object.keys(c)
    .filter((g) => Array.isArray(c[g]) && NOT_TILED.indexOf(g) === -1);
  assert.ok(groups.length >= 15, 'only ' + groups.length + ' groups found - the scan is broken');

  const broken = [];
  groups.forEach((g) => {
    assert.ok(Array.isArray(c[g]), g + ' is a group');
    c[g].forEach((x) => {
      const key = x.shape || x.icon;
      assert.ok(key, x.name + ' names an icon');
      // hasArt(), not just "did something render" - an unknown key silently
      // falls back to the crossed-out "no" glyph, which on a tile reads as a
      // deliberate choice rather than a missing picture. Grilled Artichokes
      // shipped looking exactly like that.
      if (!hasArt(key)) broken.push(g + '/' + x.name + ' -> ' + key + ' (falls back)');
    });
  });
  assert.deepStrictEqual(broken, [], 'menu items pointing at nothing drawable');
});

test('items in one list do not share a glyph', () => {
  // Two tiles side by side with identical artwork is a tile a guest cannot
  // tell apart. It happened to shredded vs fresh mozzarella, and to the red
  // pepper flakes vs the jalapenos.
  // Every group in the catalog, not a list written by hand. The hardcoded list
  // went stale the moment Burger Night added six groups, and shipped a grilled
  // onion drawn exactly like a raw one - the precise bug this test exists to
  // catch, missed because the test did not know the group existed.
  const c = menu.catalog();
  const clashes = [];
  Object.keys(c)
    .filter((k) => Array.isArray(c[k]) && c[k].some((x) => x && (x.icon || x.shape)))
    .forEach((g) => {
    const byArt = new Map();
    c[g].forEach((x) => {
      const svg = art(x.shape || x.icon);
      const seen = byArt.get(svg);
      if (seen) clashes.push(g + ': ' + seen + ' and ' + x.name);
      else byArt.set(svg, x.name);
    });
  });
  assert.deepStrictEqual(clashes, [], 'these render identically in one list');
});

/**
 * Pull every text run out of a generated PDF's content streams, in PDF
 * coordinates. Used by the layout tests below.
 */
function pdfTextRuns(bytes) {
  const whole = Buffer.from(bytes).toString('latin1');
  // Per content stream, because y alone is not a line: every page has a
  // header at the same y, and comparing across pages reports every one of
  // them as a collision with itself.
  const streams = [...whole.matchAll(/stream\n([\s\S]*?)endstream/g)].map((m) => m[1]);
  const re = /BT \/(F\d) ([\d.]+) Tf [\d.]+ [\d.]+ [\d.]+ rg (-?[\d.]+) (-?[\d.]+) Td \((.*?)\) Tj ET/g;
  const runs = [];
  streams.forEach((src, pageIndex) => {
  re.lastIndex = 0;
  let m = re.exec(src);
  while (m) {
    const font = m[1];
    const size = Number(m[2]);
    const body = m[5].replace(/\\([()\\])/g, '$1');
    const mono = font === 'F3' || font === 'F4';
    runs.push({
      page: pageIndex,
      font,
      mono,
      size,
      x: Number(m[3]),
      y: Number(m[4]),
      // Courier is exact. For Helvetica this deliberately UNDER-estimates, so
      // an overlap it reports is a real one and not a metric guess.
      width: body.length * (mono ? 0.6 : 0.45) * size,
      text: body,
    });
    m = re.exec(src);
  }
  });
  return runs;
}

const demoReport = () => order.shiftReport(seed.buildDemoOrders(), config.sla);

test('the close-out PDF is a structurally valid file', () => {
  const bytes = buildReportPdf(demoReport(), '2026-09-11', { orgName: 'Test Club' });
  const src = Buffer.from(bytes).toString('latin1');

  assert.strictEqual(src.slice(0, 8), '%PDF-1.4');
  assert.ok(src.trimEnd().endsWith('%%EOF'), 'ends with the EOF marker');

  // Every byte must be a byte. The writer assembles the file as characters and
  // converts one to one, so a stray multi-byte character would shift every
  // xref offset after it and make the file unopenable.
  assert.ok(bytes.every((b) => b >= 0 && b <= 255), 'all bytes in range');

  // The xref offsets have to land on their objects. This is the single thing
  // most likely to be quietly wrong in a hand-written PDF, and a reader
  // refuses the whole file rather than rendering it crooked.
  const offsets = [...src.matchAll(/^(\d{10}) 00000 n $/gm)].map((x) => Number(x[1]));
  assert.ok(offsets.length >= 5, 'xref has entries, got ' + offsets.length);
  offsets.forEach((off, i) => {
    assert.ok(src.slice(off).startsWith((i + 1) + ' 0 obj'),
      'xref entry ' + (i + 1) + ' points at ' + off + ', which is not its object');
  });

  const startxref = Number(/startxref\s+(\d+)/.exec(src)[1]);
  assert.strictEqual(src.slice(startxref, startxref + 4), 'xref', 'startxref finds the table');

  const declared = Number(/\/Count (\d+)/.exec(src)[1]);
  const actual = (src.match(/\/Type \/Page[^s]/g) || []).length;
  assert.strictEqual(actual, declared, 'declared page count matches the pages present');
});

test('columns in the PDF keep enough air to read as columns', () => {
  // This bug shipped once and was only visible by opening the file: a
  // right-aligned value sat 2pt from the next column, so a row read
  // "17 one AYCE charge per guest" as one run of words.
  const bytes = buildReportPdf(demoReport(), '2026-09-11', {
    orgName: 'The Club at Carlton Woods', venueName: 'Neapolitan Night',
  });
  const byLine = new Map();
  pdfTextRuns(bytes).forEach((r) => {
    const key = r.page + '@' + r.y.toFixed(1);
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(r);
  });

  // Enough air that two columns read as two columns. The failure this guards
  // against was not an overlap - it was a legal 2pt gap that a reader saw as
  // one sentence.
  const MIN_GAP = 3;
  const collisions = [];
  byLine.forEach((list) => {
    list.sort((a, b) => a.x - b.x);
    for (let i = 0; i < list.length - 1; i += 1) {
      const a = list[i];
      const b = list[i + 1];
      const gap = b.x - (a.x + a.width);
      if (gap < MIN_GAP) {
        collisions.push(JSON.stringify(a.text) + ' is ' + gap.toFixed(1)
          + 'pt from ' + JSON.stringify(b.text));
      }
    }
  });
  assert.deepStrictEqual(collisions, []);
});

test('nothing in the PDF is printed outside the margins', () => {
  const bytes = buildReportPdf(demoReport(), '2026-09-11', { orgName: 'Test Club' });
  const runs = pdfTextRuns(bytes);
  assert.ok(runs.length > 100, 'the report has content, got ' + runs.length + ' runs');

  const MARGIN = 44;
  const outside = runs.filter((r) => r.x < MARGIN - 1
    || r.x + r.width > 612 - MARGIN + 1
    || r.y < 12
    || r.y > 792 - 12);
  assert.deepStrictEqual(
    outside.map((r) => r.text + ' @' + r.x.toFixed(0) + ',' + r.y.toFixed(0)), [],
  );
});

test('the PDF carries the billing numbers the screen shows', () => {
  const r = demoReport();
  const runs = pdfTextRuns(buildReportPdf(r, '2026-09-11', { orgName: 'Test Club' }));
  const said = (s) => runs.some((x) => x.text === String(s));

  assert.ok(said(r.totals.covers), 'charges to post appears');
  assert.ok(said(r.totals.members), 'member count appears');
  r.members.forEach((m) => {
    assert.ok(said(m.memberNumber), 'member ' + m.memberNumber + ' is on the sheet');
  });
  // An unverified number has to be flagged where it gets read, not only in the
  // exceptions list at the end.
  if (r.members.some((m) => m.status !== 'verified')) {
    assert.ok(said('CHECK'), 'an unconfirmed member is marked on its own row');
  }
});

test('an empty service date still produces an openable PDF', () => {
  const bytes = buildReportPdf(order.shiftReport([], config.sla), '2026-09-11', {});
  const src = Buffer.from(bytes).toString('latin1');
  assert.strictEqual(src.slice(0, 8), '%PDF-1.4');
  assert.ok(src.includes('No orders on this service date'));
  assert.strictEqual((src.match(/\/Type \/Page[^s]/g) || []).length, 1, 'one page');
});

test('PDF text escaping cannot break the file', () => {
  // An unbalanced parenthesis or backslash ends a PDF string early and
  // corrupts everything after it. Non-Latin1 has to collapse to one byte too,
  // or every xref offset past it is wrong by however many bytes it took.
  assert.strictEqual(pdf.winAnsi('a(b)c\\d'), 'a\\(b\\)c\\\\d');
  assert.strictEqual(pdf.winAnsi('café').length, 4, 'latin1 stays one byte per character');
  assert.strictEqual(pdf.winAnsi('中文'), '??', 'no multi-byte sequence reaches the page');

  const doc = pdf.create();
  doc.text('Members (7890) \\ unconfirmed', { x: 44, y: 60 });
  const out = Buffer.from(doc.build()).toString('latin1');
  assert.ok(out.includes('(Members \\(7890\\) \\\\ unconfirmed) Tj'));
});

test('Courier widths are exact, which is what lets a column right-align', () => {
  assert.strictEqual(pdf.monoWidth('1234', 10), 24);
  assert.strictEqual(pdf.monoWidth('', 10), 0);
  // A column trims rather than spilling into its neighbour.
  assert.strictEqual(pdf.fitMono('Compofelice', 10, 30), 'Comp.');
  assert.strictEqual(pdf.fitMono('abc', 10, 100), 'abc');
  // Wrapping never exceeds the width it was handed.
  pdf.wrap('the quick brown fox jumps over the lazy dog again and again', 9, 120)
    .forEach((line) => assert.ok(line.length * 0.52 * 9 <= 129, 'line fits: ' + line));
});

test('menu catalog exposes every group the screens render', () => {
  const c = menu.catalog();
  ['allergens', 'pastas', 'sauces', 'proteins', 'toppings', 'sides', 'portions', 'spice',
    'pizzaSauces', 'pizzaCheeses', 'pizzaToppings', 'pizzaCrusts']
    .forEach((k) => assert.ok(Array.isArray(c[k]) && c[k].length, k + ' present'));
  // Counted by what they are rather than written down: a sauce list that grew
  // by one (Nutella) should not fail a test about the shape of the list.
  const modifiers = (g) => c[g].filter((x) => x.exclusive || x.amount).length;
  assert.strictEqual(modifiers('pizzaSauces'), 3, 'no-sauce, light, heavy');
  assert.strictEqual(modifiers('pizzaCheeses'), 3, 'no-cheese, light, heavy');
  assert.ok(c.pizzaSauces.length - modifiers('pizzaSauces') >= 4, 'at least four real sauces');
  // The crust is a choice now - classic, gluten free, dessert - and every
  // one of them has to name a bake time, because that is what the oven clock
  // is built from.
  assert.ok(c.pizzaCrusts.length >= 3, 'classic, gluten free and dessert');
  c.pizzaCrusts.forEach((cr) => assert.ok(cr.bakeSec > 0, cr.name + ' needs a bake time'));
});

// ------------------------------------------------------------- food costing

const near = (got, want, msg) => assert.ok(
  Math.abs(got - want) < 1e-9,
  msg + ' (got ' + got + ', wanted ' + want + ')',
);

// A small priced pantry. Chosen so every per-portion figure is exact in
// decimal, which keeps a failure readable instead of a float comparison.
const PANTRY = {
  penne: { price: 12.00, yield: 40 },         // 0.30
  marinara: { price: 18.40, yield: 40 },      // 0.46
  chicken: { price: 24.00, yield: 30 },       // 0.80
  garlic_bread: { price: 6.00, yield: 12 },   // 0.50
  classic: { price: 9.00, yield: 12 },        // 0.75 a dough ball
  pz_marinara: { price: 18.40, yield: 40 },   // 0.46
  pz_shred_mozz: { price: 20.00, yield: 25 }, // 0.80
};

const bowl = (over = {}) => ({
  guestLabel: 'Ada', pasta: 'penne', sauces: ['marinara'], proteins: ['chicken'],
  toppings: [], sides: [], portion: 'regular', spice: 'mild', ...over,
});
const pie = (over = {}) => ({
  kind: 'pizza', guestLabel: 'Sam', sauces: ['pz_marinara'], cheeses: ['pz_shred_mozz'],
  proteins: [], toppings: [], ...over,
});
const costOrder = (over = {}) => ({
  id: 'o1', status: 'delivered', kind: 'pasta', ticketNo: 1, memberNumber: '1794',
  guestCount: 2, submittedAt: '2026-09-13T18:00:00.000Z', lines: [bowl()], ...over,
});

test('a portion costs the pack price divided by what the pack yields', () => {
  near(costing.perPortion({ price: 18.40, yield: 40 }), 0.46, 'a #10 can of marinara');
  // Free and unpriced are different answers, and only one of them is a gap.
  assert.strictEqual(costing.perPortion({ price: 0, yield: 10 }), 0, 'herbs off the property are free, not unpriced');
  assert.strictEqual(costing.perPortion(undefined), null, 'nothing entered');
  assert.strictEqual(costing.perPortion({ price: 12 }), null, 'a price with no yield cannot answer');
  // Dividing anyway gives Infinity, which would poison every total after it.
  assert.strictEqual(costing.perPortion({ price: 12, yield: 0 }), null, 'a pack that yields nothing');
  assert.strictEqual(costing.perPortion({ price: -3, yield: 10 }), null, 'negative money is a typo');
});

test('a bowl costs the sum of what is in it', () => {
  const c = costing.lineCost(bowl(), PANTRY);
  near(c.total, 1.56, 'penne 0.30 + marinara 0.46 + chicken 0.80');
  assert.ok(c.complete, 'every ingredient priced');
  assert.strictEqual(c.parts.length, 3);
});

test('portion size scales the bowl but not the side plate', () => {
  const kid = costing.lineCost(bowl({ portion: 'kid', sides: ['garlic_bread'] }), PANTRY);
  // 1.56 * 0.6 = 0.936, plus a whole piece of garlic bread at 0.50. A kid-size
  // bowl does not come with six tenths of a slice.
  near(kid.total, 1.436, 'kid bowl scales, the side does not');

  const large = costing.lineCost(bowl({ portion: 'large' }), PANTRY);
  near(large.total, 1.56 * 1.4, 'a large bowl is 1.4 of everything in it');
});

test('a pizza costs its crust plus what goes on it', () => {
  near(costing.lineCost(pie(), PANTRY).total, 2.01, 'dough 0.75 + sauce 0.46 + mozz 0.80');
});

test('"no sauce" costs nothing and the amount chips scale what is under them', () => {
  const dry = costing.lineCost(pie({ sauces: ['pz_no_sauce'], cheeses: ['pz_no_cheese'] }), PANTRY);
  near(dry.total, 0.75, 'a bare crust is just the dough');
  assert.ok(dry.complete, 'nothing chosen is not the same as nothing priced');

  const heavy = costing.lineCost(pie({ sauces: ['pz_marinara', 'pz_sauce_heavy'] }), PANTRY);
  near(heavy.total, 0.75 + 0.46 * 1.5 + 0.80, 'heavy sauce is half again');

  const light = costing.lineCost(pie({ cheeses: ['pz_shred_mozz', 'pz_cheese_light'] }), PANTRY);
  near(light.total, 0.75 + 0.46 + 0.80 * 0.5, 'light cheese is half');

  // The amount chip is not itself an ingredient, so it never gets its own row
  // and can never be priced twice.
  assert.ok(!heavy.parts.some((p) => p.id === 'pz_sauce_heavy'), 'the chip is a multiplier, not a line');
});

test('an unpriced ingredient is reported, never counted as free', () => {
  const c = costing.lineCost(bowl({ toppings: ['mushrooms'] }), PANTRY);
  near(c.total, 1.56, 'the total covers only what has a price');
  assert.strictEqual(c.complete, false, 'and says so');
  assert.deepStrictEqual(c.missing.map((m) => m.id), ['mushrooms']);
  assert.strictEqual(c.missing[0].name, 'Mushrooms', 'named so a manager can find the row');
});

test('the night averages over fully-priced items only', () => {
  // The second bowl has no chicken and an unpriced mushroom, so it prices at
  // 0.76 of its real cost. Averaging both would report $1.16 a bowl - lower
  // than either real bowl - and read as a cost rather than as a gap.
  const rep = costing.costReport([
    costOrder({ lines: [bowl(), bowl({ proteins: [], toppings: ['mushrooms'] })] }),
  ], PANTRY);

  near(rep.pasta.avg, 1.56, 'the average ignores the incomplete bowl');
  assert.notStrictEqual(Math.round(rep.pasta.avg * 100), 116, 'not the average of both');
  assert.strictEqual(rep.pasta.items, 2);
  assert.strictEqual(rep.pasta.priced, 1);
  assert.strictEqual(rep.coverage.complete, false);
  assert.deepStrictEqual(rep.coverage.unpriced.map((g) => g.id), ['mushrooms']);
  assert.strictEqual(rep.pizza.avg, null, 'no pizzas is not a pizza costing nothing');
});

test('cost per cover charges a party once, however many trips it makes', () => {
  const rep = costing.costReport([
    costOrder({ id: 'a', guestCount: 2, lines: [bowl()] }),
    costOrder({ id: 'b', guestCount: 3, lines: [bowl(), bowl()] }),
  ], PANTRY);

  // All you can eat: the same member coming back for a second round is three
  // covers, not five, so the cost per cover is over three heads.
  assert.strictEqual(rep.totals.covers, 3, 'the largest head count that member reported');
  assert.strictEqual(rep.totals.items, 3);
  near(rep.totals.known, 1.56 * 3, 'three bowls of food went out');
  near(rep.totals.perCover, (1.56 * 3) / 3, 'spread over three heads');
});

test('a voided ticket costs nothing', () => {
  const rep = costing.costReport([
    costOrder({ id: 'a', lines: [bowl()] }),
    costOrder({ id: 'b', memberNumber: '42', status: 'voided', lines: [bowl(), bowl()] }),
  ], PANTRY);
  assert.strictEqual(rep.totals.items, 1, 'a voided chit never reached the pass');
  near(rep.totals.known, 1.56);
});

test('food cost percentage needs a charge, and refuses to invent one', () => {
  const orders = [costOrder({ guestCount: 2, lines: [bowl(), bowl()] })];
  assert.strictEqual(costing.costReport(orders, PANTRY).foodCostPct, null, 'no charge entered');

  // 3.12 of food over 2 covers is 1.56 a head against a $39 cover.
  const rep = costing.costReport(orders, PANTRY, { chargePerCover: 39 });
  near(rep.totals.perCover, 1.56);
  near(rep.foodCostPct, (1.56 / 39) * 100);
  assert.strictEqual(costing.costReport(orders, PANTRY, { chargePerCover: 0 }).foodCostPct, null,
    'a free cover has no percentage, it has a division by zero');
});

test('nothing on the cost sheet can be priced twice', () => {
  const c2 = menu.catalog();
  const rows = costing.costRows();
  const ids = costing.costableIds();
  assert.strictEqual(ids.length, new Set(ids).size, 'every row is its own ingredient');

  const group = (key) => rows.flatMap((lane) => lane.groups).find((g) => g.key === key);

  // "No Sauce" buys nothing and "Heavy Sauce" is a multiplier on a sauce that
  // already has a row, so neither gets a price box.
  // Every tile that is a thing you buy, and none of the tiles that are not.
  const real = (g) => c2[g].filter((x) => !x.exclusive && !x.amount).length;
  assert.strictEqual(group('pizzaSauces').items.length, real('pizzaSauces'));
  assert.strictEqual(group('pizzaCheeses').items.length, real('pizzaCheeses'));
  assert.ok(group('pizzaSauces').items.some((i) => i.id === 'pz_nutella'),
    'the dessert sauce is bought by the case like any other');
  assert.ok(!ids.includes('pz_no_sauce') && !ids.includes('pz_cheese_heavy'));

  // The crust is bought by the case like anything else, so it must be priceable
  // or every pizza silently reads as incomplete.
  menu.PIZZA_CRUSTS.forEach((cr) => assert.ok(ids.includes(cr.id), cr.name + ' has a price row'));
});

test('every ingredient a guest can order can be priced', () => {
  // The gap that matters: an ingredient on the guest tiles with no row on the
  // cost sheet can never be priced, so any item carrying it reads as
  // part-priced forever with nothing a manager can do about it.
  const priceable = new Set(costing.costableIds());
  const c = menu.catalog();
  ['pastas', 'sauces', 'proteins', 'toppings', 'sides',
    'pizzaSauces', 'pizzaCheeses', 'pizzaProteins', 'pizzaToppings']
    .forEach((key) => c[key]
      .filter((i) => !i.exclusive && !i.amount)
      .forEach((i) => assert.ok(priceable.has(i.id), i.name + ' (' + i.id + ') has a price box')));
});

test('the demo night costs out end to end', () => {
  // The seeded rail is the one a pitch actually shows, so it has to survive
  // the whole pipeline rather than just the hand-built lines above.
  const built = seed.buildDemoOrders().map((o, i) => ({
    ...o, id: 'seed-' + i, status: 'delivered',
  }));
  const rep = costing.costReport(built, PANTRY, { chargePerCover: 39 });

  assert.ok(rep.totals.items > 0, 'the demo rail has food on it');
  assert.ok(rep.totals.known > 0, 'and some of it is priced');
  assert.ok(rep.coverage.unpriced.length > 0, 'a seven-item pantry cannot cover the whole menu');
  assert.strictEqual(rep.coverage.complete, false, 'which the report says out loud');
  // Whatever is priced has to add up to the sum of its parts.
  near(
    rep.contributors.reduce((a, x) => a + x.total, 0),
    rep.totals.known,
    'contributors reconcile to the total',
  );
});

// ------------------------------------------------------------ burger night


test('a night decides which kinds a guest can order', () => {
  assert.deepStrictEqual(kindsForNight('neapolitan'), ['pasta', 'pizza']);
  assert.deepStrictEqual(kindsForNight('burger'), ['burger']);
  // An unknown night must not empty the menu - it falls back.
  assert.deepStrictEqual(kindsForNight('karaoke'), ['pasta', 'pizza']);
  assert.strictEqual(nightById('karaoke').id, config.defaultNight);

  // Every kind a night claims must actually have somewhere to cook.
  Object.values(config.nights).forEach((n) => n.kinds.forEach((kind) => {
    const stations = config.kitchen.stations.filter((s) => s.kind === kind);
    assert.ok(stations.length > 0, kind + ' has a station on ' + n.label);
  }));
});

test('a burger is a valid order, and routes to the grill', () => {
  assert.deepStrictEqual(menu.validateLine(burgerLine(), config.order), []);

  const built = order.buildOrder(burgerDraft(), {
    ticketNo: 1, serviceDate: '2026-10-02', tag: null,
  });
  assert.strictEqual(built.kind, 'burger');
  assert.strictEqual(built.lines[0].base, 'bun_brioche');
  assert.ok(built.cookEstimateSec > 0, 'the grill clock is a real number');

  const station = order.stationForTicket(1, config.kitchen.stations, true, 'burger');
  assert.ok(/^GRILL-/.test(station), 'burgers go to a grill, got ' + station);
  // And never to a pan or a deck, whatever the ticket number.
  for (let n = 1; n <= 8; n += 1) {
    assert.ok(/^GRILL-/.test(order.stationForTicket(n, config.kitchen.stations, true, 'burger')));
  }
});

test('a burger takes one patty, one cheese and one basket', () => {
  const lim = config.order;
  assert.ok(menu.validateLine(burgerLine({ proteins: [] }), lim).some((e) => /one patty/i.test(e)));
  assert.ok(menu.validateLine(burgerLine({ proteins: ['beef_single', 'beef_double'] }), lim).some((e) => /one patty/i.test(e)));
  assert.ok(menu.validateLine(burgerLine({ base: null }), lim).some((e) => /bun/i.test(e)));
  assert.ok(menu.validateLine(burgerLine({ cheeses: [] }), lim).some((e) => /cheese/i.test(e)));
  assert.ok(menu.validateLine(burgerLine({ cheeses: ['ch_american', 'ch_swiss'] }), lim).some((e) => /one cheese/i.test(e)));
  assert.ok(menu.validateLine(burgerLine({ sides: ['side_fries', 'side_tots'] }), lim).some((e) => /one side/i.test(e)));

  // "No Cheese" is an answer, not an absence.
  assert.deepStrictEqual(menu.validateLine(burgerLine({ cheeses: ['ch_none'] }), lim), []);
  // And it cannot be combined with a real cheese.
  assert.ok(menu.validateLine(burgerLine({ cheeses: ['ch_none', 'ch_swiss'] }), lim).length > 0);
});

test('a burger is only gluten free if its bun is', () => {
  const onBrioche = menu.allergensFor(burgerLine());
  assert.ok(onBrioche.includes('gluten'), 'a brioche bun carries gluten');

  const wrapped = menu.allergensFor(burgerLine({ base: 'bun_lettuce', cheeses: ['ch_none'], sides: [] }));
  assert.ok(!wrapped.includes('gluten'), 'a lettuce wrap carries none');
  assert.ok(!wrapped.includes('dairy'), 'and no cheese means no dairy');

  // Onion rings are breaded, so the basket can put gluten back on the plate.
  const rings = menu.allergensFor(burgerLine({ base: 'bun_lettuce', cheeses: ['ch_none'], sides: ['side_rings'] }));
  assert.ok(rings.includes('gluten'), 'the side counts too');

  assert.ok(menu.allergensFor(burgerLine({ toppings: ['bt_bacon'] })).includes('pork'));
  assert.ok(menu.allergensFor(burgerLine({ toppings: ['bt_egg'] })).includes('egg'));
});

test('a burger reads as a burger on the chit', () => {
  const text = menu.describe(burgerLine());
  assert.ok(/Beef - Single/.test(text), 'the patty leads: ' + text);
  assert.ok(/Brioche/.test(text), 'the bun is named');
  assert.ok(/Fries/.test(text), 'and the basket');

  const es = menu.describe(burgerLine(), 'es');
  assert.ok(/Carne de Res/.test(es), 'Spanish names the patty: ' + es);
  assert.ok(/Papas Fritas/.test(es));

  // A no-cheese burger says so rather than going quiet about it.
  assert.ok(/Sin Queso/.test(menu.describe(burgerLine({ cheeses: ['ch_none'] }), 'es')));
});

test('the grill batches a table rather than cooking one at a time', () => {
  const one = cooktime.orderCookSec([burgerLine()]);
  const six = cooktime.orderCookSec(Array.from({ length: 6 }, () => burgerLine()));
  const seven = cooktime.orderCookSec(Array.from({ length: 7 }, () => burgerLine()));

  assert.ok(six < one * 6, 'six on the flat-top is not six times one');
  // The seventh does not fit the pass, so it costs a second one.
  assert.ok(seven > six + 60, 'a seventh burger starts another pass');
});

test('the close-out counts burgers, and does not lose pasta doing it', () => {
  const o = (kind, lines) => ({
    id: kind, status: 'delivered', kind, ticketNo: 1, memberNumber: '1794',
    guestCount: 2, submittedAt: '2026-10-02T18:00:00.000Z',
    acceptedAt: '2026-10-02T18:01:00.000Z', readyAt: '2026-10-02T18:08:00.000Z',
    deliveredAt: '2026-10-02T18:10:00.000Z', cookEstimateSec: 420, lines,
  });
  const rep = order.shiftReport([
    o('burger', [burgerLine(), burgerLine({ proteins: ['patty_bean'] })]),
    o('pasta', [{ pasta: 'penne', sauces: ['marinara'], proteins: [], toppings: [], sides: [], portion: 'regular' }]),
  ], config.sla);

  assert.strictEqual(rep.byKind.burger.items, 2);
  assert.strictEqual(rep.byKind.pasta.items, 1);
  assert.strictEqual(rep.byKind.pizza.items, 0, 'a kind with no orders is zero, not missing');

  const patties = rep.mix.burger.patties.map((p) => p.id).sort();
  assert.deepStrictEqual(patties, ['beef_single', 'patty_bean']);
  assert.strictEqual(rep.mix.burger.buns[0].name, 'Brioche Bun', 'buns are tallied for prep');
  assert.ok(rep.mix.pasta.pastas.length > 0, 'the pasta lane still reports');

  // The member row counts burgers in its own column and in the item total.
  const m = rep.members[0];
  assert.strictEqual(m.burgers, 2);
  assert.strictEqual(m.bowls, 1);
  assert.strictEqual(m.items, 3);
});

test('the burger stack can draw everything a guest can pick', () => {
  // The gap this closes is the one the glyph test had: an ingredient added to
  // the menu with no artwork behind it. A missing layer here does not throw -
  // it silently draws a burger with a piece absent, which is worse.
  const drawable = new Set(stack.stackableIds());
  const c = menu.catalog();
  ['burgerBuns', 'burgerPatties', 'burgerCheeses', 'burgerToppings', 'burgerSauces']
    .forEach((g) => c[g]
      .filter((i) => !i.exclusive)
      .forEach((i) => assert.ok(drawable.has(i.id), i.name + ' (' + i.id + ') has a stack layer')));
});

test('the stack draws kitchen order, not tap order', () => {
  // Toppings picked back to front still come out as a burger.
  const backwards = burgerLine({ toppings: ['bt_lettuce', 'bt_bacon'] });
  const forwards = burgerLine({ toppings: ['bt_bacon', 'bt_lettuce'] });
  assert.strictEqual(stack.burgerStackSvg(backwards), stack.burgerStackSvg(forwards),
    'the drawing is of the finished burger, not of the order it was tapped in');

  const svg = stack.burgerStackSvg(burgerLine());
  assert.ok(svg.startsWith('<svg'), 'it is an svg');
  assert.ok(svg.includes('</svg>'), 'and a closed one');

  // An empty line draws a plate rather than nothing, so the space does not
  // read as a broken image before the first tap.
  const empty = stack.burgerStackSvg({ kind: 'burger', proteins: [], cheeses: [], toppings: [], sauces: [] });
  assert.ok(empty.includes('<ellipse'), 'empty draws a plate');
});

test('a loaded burger scales to fit instead of growing off the screen', () => {
  const everything = burgerLine({
    proteins: ['beef_double'],
    toppings: ['bt_bacon', 'bt_grilled_onion', 'bt_mushroom', 'bt_egg', 'bt_tomato', 'bt_lettuce'],
  });

  // At the full hero size even a double with six toppings fits, which is the
  // headroom the box was chosen for. Nothing is scaled when nothing needs to be.
  assert.ok(!stack.burgerStackSvg(everything).includes('scale('), 'a full burger fits the hero box');

  // The safety net is for a short screen, where the hero is given less room.
  const squeezed = stack.burgerStackSvg(everything, { height: 150 });
  assert.ok(squeezed.includes('scale('), 'a short box scales the stack down');
  const factor = Number(squeezed.match(/scale\(([\d.]+)\)/)[1]);
  assert.ok(factor > 0 && factor < 1, 'scale is a real reduction, got ' + factor);

  // However it is scaled, it renders into the box it was given - that is what
  // keeps the choices on screen rather than pushed below the fold.
  assert.ok(stack.burgerStackSvg(everything, { height: 150 }).includes('viewBox="0 110 200 150"'));
});

test('every burger ingredient can be priced', () => {
  const priceable = new Set(costing.costableIds());
  ['burgerBuns', 'burgerPatties', 'burgerCheeses', 'burgerToppings', 'burgerSauces', 'burgerSides']
    .forEach((key) => menu.catalog()[key]
      .filter((i) => !i.exclusive && !i.amount)
      .forEach((i) => assert.ok(priceable.has(i.id), i.name + ' (' + i.id + ') has a price box')));

  // And a built burger costs what its parts cost.
  const pantry = {
    bun_brioche: { price: 6, yield: 12 },      // 0.50
    beef_single: { price: 40, yield: 20 },           // 2.00
    ch_american: { price: 9, yield: 36 },      // 0.25
    bt_lettuce: { price: 4, yield: 40 },       // 0.10
    bt_pickles: { price: 7, yield: 70 },       // 0.10
    bs_burger: { price: 8, yield: 80 },        // 0.10
    side_fries: { price: 12, yield: 24 },      // 0.50
  };
  const c = costing.lineCost(burgerLine(), pantry);
  assert.ok(c.complete, 'nothing unpriced: ' + JSON.stringify(c.missing));
  near(c.total, 3.55, 'bun + patty + cheese + 2 toppings + sauce + fries');
});

test('"no charge entered" never round-trips as a charge of zero', () => {
  // This shipped wrong. Number(null) is 0 and 0 is finite, so a guard of
  // Number.isFinite(Number(v)) let "unset" through as 0 - it saved to the
  // document as 0 and came back into the box as the string "0".
  assert.strictEqual(costing.normalizeCharge(null), null, 'null is not a charge');
  assert.strictEqual(costing.normalizeCharge(undefined), null, 'absent is not a charge');
  assert.strictEqual(costing.normalizeCharge(''), null, 'an empty box is not a charge');
  assert.strictEqual(costing.normalizeCharge('   '), null, 'nor is whitespace');
  assert.strictEqual(costing.normalizeCharge(0), null, 'zero is a division, not a price');
  assert.strictEqual(costing.normalizeCharge(-5), null, 'nor is a negative');
  assert.strictEqual(costing.normalizeCharge('abc'), null);

  assert.strictEqual(costing.normalizeCharge(39), 39);
  assert.strictEqual(costing.normalizeCharge('39.50'), 39.5, 'the box hands over a string');
});

test('a JPEG goes into the PDF whole, and only once', () => {
  // A minimal baseline JPEG header: SOI, then SOF0 declaring 40x25 in 3
  // components, then EOI. Enough for jpegSize and for the writer to embed.
  const jpg = new Uint8Array([
    0xFF, 0xD8,
    0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x19, 0x00, 0x28, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xFF, 0xD9,
  ]);

  const size = pdf.jpegSize(jpg);
  assert.deepStrictEqual(size, { width: 40, height: 25, components: 3 });
  assert.strictEqual(pdf.jpegSize(new Uint8Array([1, 2, 3, 4])), null, 'not a JPEG');
  assert.strictEqual(pdf.jpegSize(null), null);

  // fit() keeps the shape rather than stretching to the box.
  const box = pdf.create().fit(jpg, 80, 80);
  assert.strictEqual(Math.round(box.w), 80);
  assert.strictEqual(Math.round(box.h), 50, '40x25 into an 80 square is 80x50');

  const doc = pdf.create();
  doc.image(jpg, { x: 20, y: 30, w: 80, h: 50 });
  doc.addPage();
  doc.image(jpg, { x: 20, y: 30, w: 40, h: 25 });
  const out = Buffer.from(doc.build()).toString('latin1');

  // Embedded once, drawn twice. Six copies of a logo in a seven-page guide is
  // exactly the bug this de-duplication exists to prevent.
  assert.strictEqual((out.match(/\/Subtype \/Image/g) || []).length, 1, 'one image object');
  assert.strictEqual((out.match(/\/Im1 Do/g) || []).length, 2, 'drawn on both pages');
  assert.ok(out.includes('/Filter /DCTDecode'), 'embedded as JPEG, not re-encoded');
  assert.ok(out.includes('/Width 40 /Height 25'), 'pixel size comes from the file');
  assert.ok(out.includes('/XObject << /Im1'), 'listed in the page resources');

  // The bytes have to survive intact or the reader sees a corrupt image.
  const raw = Array.from(jpg).map((b) => String.fromCharCode(b)).join('');
  assert.ok(out.includes(raw), 'the JPEG is in the file byte for byte');
  assert.ok(out.includes('/Length ' + jpg.length + ' >>\nstream'), 'declared length matches');

  // And the whole file still parses: one byte per character, so the xref
  // offsets a reader follows are still right with binary in the middle.
  const startxref = Number(out.slice(out.lastIndexOf('startxref') + 9).trim().split('\n')[0]);
  assert.strictEqual(out.slice(startxref, startxref + 4), 'xref', 'xref offset survives binary');
});

test('a PDF with no images is unchanged by image support existing', () => {
  // The close-out report draws no images. Its bytes must not move.
  const doc = pdf.create();
  doc.text('Members to charge', { x: 44, y: 60 });
  const out = Buffer.from(doc.build()).toString('latin1');
  assert.ok(!out.includes('/XObject'), 'no empty XObject dict on a page without images');
  assert.ok(!out.includes('/Subtype /Image'));
});

test('every seating area has tents, and every tent has an area', () => {
  // The floor page of the printed guide groups tents by area. It used to infer
  // the grouping from the id string, which is how it invented a poolside that
  // does not exist - so the area is data now, and this is what keeps it honest.
  config.tags.forEach((t) => {
    assert.ok(t.area, t.id + ' names the area it stands in');
  });

  const tentsIn = (area) => config.tags.filter((t) => t.area === area);

  Object.keys(config.areaCovers).forEach((area) => {
    assert.ok(tentsIn(area).length > 0, area + ' has tents to seat its covers in');
    assert.ok(config.areaCovers[area] > 0, area + ' seats somebody');
    // More covers than tables, always - a table for nobody is not a table.
    assert.ok(
      config.areaCovers[area] >= tentsIn(area).length,
      area + ' cannot seat fewer people than it has tables',
    );
  });

  assert.strictEqual(tentsIn('Dining room').length, 19, 'dining room tables');
  assert.strictEqual(tentsIn('Patio').length, 7, 'patio tables');
  assert.strictEqual(config.areaCovers['Dining room'] + config.areaCovers.Patio, 115, 'covers at once');

  const ids = config.tags.map((t) => t.id);
  assert.strictEqual(ids.length, new Set(ids).size, 'every tent id is unique');
});

// ------------------------------------------------------------------- i18n

/**
 * The guest app is bilingual, and a missing Spanish key does not throw - it
 * falls through to the English, so a half-translated screen looks right to
 * whoever wrote it and wrong to the member reading it. Nothing else in this
 * suite would notice.
 */
test('every guest string exists in both languages', () => {
  const en = Object.keys(STRINGS.en).filter((k) => k.startsWith('guest.'));
  const es = Object.keys(STRINGS.es).filter((k) => k.startsWith('guest.'));

  assert.deepStrictEqual(
    en.filter((k) => !(k in STRINGS.es)), [], 'guest keys with no Spanish',
  );
  assert.deepStrictEqual(
    es.filter((k) => !(k in STRINGS.en)), [], 'Spanish keys with no English',
  );
});

/**
 * Keys are looked up by string at render time, so one deleted from under a
 * caller surfaces as a blank line on a member's phone rather than as an error
 * anywhere a developer would see it. Read the source and check every literal.
 *
 * Only literal t('...') calls can be checked; a computed key is skipped rather
 * than guessed at. The step and lane tables pass their keys as data, so those
 * are collected too.
 */
function guestSource() {
  return readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');
}

test('every string the guest screen asks for is defined', () => {
  const src = guestSource();
  const used = new Set();
  for (const m of src.matchAll(/\bt\(\s*'([a-z][\w.]*)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/(?:labelKey|titleKey|subKey|blurbKey):\s*'([a-z][\w.]*)'/g)) {
    used.add(m[1]);
  }

  assert.ok(used.size > 40, 'found only ' + used.size + ' keys - the scan is broken, not the app');
  assert.deepStrictEqual(
    [...used].filter((k) => !(k in STRINGS.en)).sort(), [],
    'keys guest.js asks for that have no English string',
  );
});

/**
 * The other direction. An unused string is not a bug, but it is how wording
 * that no longer matches the screen survives - "pick up to 5 toppings"
 * outlived the cap it described.
 */
/**
 * Nine strings guest.js stopped asking for before this test existed. Each is a
 * place where the English was written straight into the markup while the
 * translation stayed here - so the Spanish ticket screen still reads "Ticket"
 * and "Show this code if a server asks" in English. Worth fixing, but not as
 * part of this change; an allowlist keeps the test sharp for the next string
 * that falls out of use instead of leaving it red forever.
 *
 * Shrinking this list is the point. Nothing should ever be added to it.
 */
const KNOWN_UNUSED = [
  'guest.guests.build',
  'guest.label.has',
  'guest.member.clear',
  'guest.member.delete',
  'guest.review.contains',
  'guest.review.nextItem',
  'guest.review.with',
  'guest.sent.ticket',
];

test('no guest string is left behind unused', () => {
  const src = guestSource();
  const orphans = Object.keys(STRINGS.en)
    .filter((k) => k.startsWith('guest.'))
    .filter((k) => !src.includes("'" + k + "'"))
    .sort();

  assert.deepStrictEqual(
    orphans.filter((k) => KNOWN_UNUSED.indexOf(k) === -1), [],
    'guest strings defined but never used',
  );
  // The allowlist must not rot either: a string that is back in use should be
  // taken off the list, not left there to excuse the next one.
  assert.deepStrictEqual(
    KNOWN_UNUSED.filter((k) => orphans.indexOf(k) === -1), [],
    'allowlisted strings that are used again - remove them from KNOWN_UNUSED',
  );
});

// --------------------------------------------------------- manager edits

function rulesSource() {
  return readFileSync(fileURLToPath(new URL('../firestore.rules', import.meta.url)), 'utf8');
}

/**
 * firestore.rules cannot import config.js, so every number in it is a copy.
 * One of those copies went stale: the party size moved from 8 to 12 on the
 * client and the rules kept refusing anything over 8, so a table of nine
 * built an order, pressed Send, and got a permission error with nothing on
 * screen to explain it. Nothing in this suite noticed, because nothing in
 * this suite had ever read the rules.
 */
test('the rules agree with config about how big a party can be', () => {
  const rules = rulesSource();
  const cap = config.order.maxGuests;

  const guestCaps = [...rules.matchAll(/guestCount\s*<=\s*(\d+)/g)].map((m) => Number(m[1]));
  // The declared party is capped by the same number, in the same place.
  const partyCaps = [...rules.matchAll(/partySize\s*<=\s*(\d+)/g)].map((m) => Number(m[1]));
  const lineCaps = [...rules.matchAll(/lines\.size\(\)\s*<=\s*(\d+)/g)].map((m) => Number(m[1]));

  assert.ok(guestCaps.length >= 2, 'found ' + guestCaps.length + ' guest caps - the scan is broken');
  assert.ok(lineCaps.length >= 2, 'found ' + lineCaps.length + ' line caps - the scan is broken');

  assert.ok(partyCaps.length >= 1, 'no partySize cap in firestore.rules - parties/ is unbounded');
  guestCaps.forEach((n) => assert.strictEqual(n, cap, 'a guestCount cap in firestore.rules'));
  // A party is bounded by the BILLING cap, not the plate cap. They were the
  // same number until a party of fourteen billed as twelve.
  partyCaps.forEach((n) => assert.strictEqual(n, config.order.maxPartySize,
    'a partySize cap in firestore.rules'));
  assert.ok(config.order.maxPartySize > config.order.maxGuests,
    'the party cap must exceed the per-order cap, or it is not a separate limit');
  lineCaps.forEach((n) => assert.strictEqual(n, cap, 'a lines.size cap in firestore.rules'));
});

/** The identity of a ticket is what the rules refuse to let anyone rewrite. */
test('the rules still pin a ticket to its number and its kind', () => {
  const rules = rulesSource();
  const IDENTITY = ['ticketNo', 'kind', 'serviceDate', 'submittedAt', 'memberNumber'];
  const built = make();

  IDENTITY.forEach((field) => {
    // A rule guarding a field the model no longer carries guards nothing, and
    // reads like protection. The claim code sat here after it was removed.
    assert.ok(
      Object.prototype.hasOwnProperty.call(built, field),
      field + ' is guarded in firestore.rules but is not on a ticket any more',
    );
    assert.ok(
      new RegExp('after\\.' + field + '\\s*==\\s*before\\.' + field).test(rules),
      field + ' must stay immutable in firestore.rules',
    );
  });
});

test('a manager edit moves the table and says so', () => {
  const o = make();
  const patch = order.editPatch(o, {}, {
    tag: { id: 'patio-03', label: 'Patio 3', kind: 'table' },
    now: new Date('2026-10-08T18:30:00Z'),
  });

  assert.strictEqual(patch.tagLabel, 'Patio 3');
  assert.strictEqual(patch.tag, 'patio-03');
  assert.strictEqual(patch.editCount, 1);
  assert.deepStrictEqual(patch.editedLineIds, [], 'the food did not change');
  assert.strictEqual(patch.events.at(-1).action, 'edit');
  assert.strictEqual(patch.events.at(-1).note, 'table');
  // The queue position is not the manager's to give away.
  assert.strictEqual(patch.ticketNo, undefined);
  assert.strictEqual(patch.status, undefined);
});

test('an edit names the line that changed, and only that line', () => {
  const o = make(draftOf(bowl(), bowl(), bowl()));
  assert.strictEqual(o.lines.length, 3);

  // Change the middle bowl only - the shape, because that is what the chit
  // prints, so it proves the derived text was rebuilt and not carried over.
  const lines = o.lines.map((l) => ({ ...l }));
  lines[1].pastas = ['shells'];
  lines[1].toppings = ['olives'];

  const patch = order.editPatch(o, { lines });
  assert.deepStrictEqual(patch.editedLineIds, ['ln02']);
  assert.notStrictEqual(patch.lines[1].dish, o.lines[1].dish, 'the dish text follows the food');
  assert.deepStrictEqual(patch.lines[0].dish, o.lines[0].dish, 'the untouched bowl reads the same');
  assert.deepStrictEqual(patch.lines[1].toppings, ['olives']);
  // Derived fields are rebuilt, not carried over.
  assert.strictEqual(typeof patch.cookEstimateSec, 'number');
  assert.ok(patch.cookEstimateSec > 0);
});

test('reordering the same food is not an edit', () => {
  // A line that moved up the ticket is the same food. Reporting it as edited
  // would light up a chit and send a cook looking for a change nobody made.
  const o = make(draftOf(bowl(), bowl()));
  const same = o.lines.map((l) => ({ ...l }));
  assert.strictEqual(order.editPatch(o, { lines: same }), null, 'no change, no patch');
});

test('saving an order nobody touched changes nothing', () => {
  const o = make();
  assert.strictEqual(order.editPatch(o, { guestCount: o.guestCount, notes: o.notes || '' }), null);
  assert.strictEqual(order.editPatch(o, {}, { tag: { id: o.tag, label: o.tagLabel, kind: 'table' } }), null);
});

test('delivered and voided orders refuse to be edited', () => {
  const delivered = { ...make(), status: 'delivered' };
  assert.throws(() => order.editPatch(delivered, { guestCount: 4 }), /delivered/);

  const voided = { ...make(), status: 'voided' };
  assert.throws(() => order.editPatch(voided, { guestCount: 4 }), /voided/);
});

test('an edit cannot empty an order', () => {
  const o = make();
  assert.throws(() => order.editPatch(o, { lines: [] }), /at least one item/);
});

test('the kitchen stops highlighting an edit once the food is gone', () => {
  const edited = { ...make(), editedAt: '2026-10-08T18:30:00.000Z', status: 'cooking' };
  assert.strictEqual(order.isEdited(edited), true);
  assert.strictEqual(order.isEdited({ ...edited, status: 'delivered' }), false);
  assert.strictEqual(order.isEdited({ ...edited, status: 'voided' }), false);
  assert.strictEqual(order.isEdited(make()), false, 'an order nobody edited');
});

test('a second edit highlights what changed this time, not last time', () => {
  const o = make(draftOf(bowl(), bowl()));

  const first = order.editPatch(o, {
    lines: o.lines.map((l, i) => (i === 0 ? { ...l, toppings: ['olives'] } : { ...l })),
  });
  assert.deepStrictEqual(first.editedLineIds, ['ln01']);

  const after = { ...o, ...first };
  const second = order.editPatch(after, {
    lines: after.lines.map((l, i) => (i === 1 ? { ...l, toppings: ['spinach'] } : { ...l })),
  });
  assert.deepStrictEqual(second.editedLineIds, ['ln02'], 'the first line is right already');
  assert.strictEqual(second.editCount, 2);
});

// ------------------------------------------------------------- locations

test('a manager can add a location, and cannot break one', () => {
  const kept = cfgTags.setCustomTags([
    { id: 'locker-room', label: 'Locker Room', kind: 'table', area: 'Clubhouse' },
    { id: 'BAD ID', label: 'Nope', kind: 'table', area: 'Clubhouse' },
    { id: 'no-kind', label: 'Nope', kind: 'spaceship', area: 'Clubhouse' },
    { id: 'blank', label: '   ', kind: 'table', area: 'Clubhouse' },
    { id: 'table-01', label: 'Impostor', kind: 'table', area: 'Clubhouse' },
    { id: 'locker-room', label: 'Duplicate', kind: 'table', area: 'Clubhouse' },
  ]);

  assert.deepStrictEqual(kept.map((t) => t.id), ['locker-room'],
    'only the one valid, non-colliding, non-duplicate entry survives');
  assert.strictEqual(cfgTags.tagById('locker-room').label, 'Locker Room');
  assert.strictEqual(cfgTags.tagById('table-01').label, 'Table 1',
    'a built-in tent cannot be shadowed by something a manager typed');
  assert.strictEqual(cfgTags.allTags().length, config.tags.length + 1);

  cfgTags.setCustomTags([]);
  assert.strictEqual(cfgTags.tagById('locker-room'), null);
  assert.strictEqual(cfgTags.allTags().length, config.tags.length);
});

test('a location id is derived from what a manager types', () => {
  assert.strictEqual(cfgTags.tagIdFor('Locker Room'), 'locker-room');
  assert.strictEqual(cfgTags.tagIdFor('  Halfway  House!  '), 'halfway-house');
  assert.strictEqual(cfgTags.tagIdFor('19th Hole'), '19th-hole');
  assert.strictEqual(cfgTags.tagIdFor('***'), '', 'nothing usable is left, and that is not an id');
  assert.strictEqual(cfgTags.isValidTag({ id: '', label: 'x', kind: 'table', area: 'a' }), false);
});

// ------------------------------------------------------ the pizza path

const pizzaOrder = (over = {}) => ({
  ...make(pizzaDraft(), { station: 'PIZZA-1' }),
  kind: 'pizza',
  ...over,
});

/**
 * Every status the state machine can produce has to be a status the rules
 * will accept, or the write is refused at the moment a cook taps the button -
 * which is the worst possible time to find out.
 */
test('the rules accept every status the state machine can reach', () => {
  const rules = rulesSource();
  const listed = /function statuses\(\)[\s\S]*?return \[([^\]]*)\]/.exec(rules);
  assert.ok(listed, 'statuses() not found in firestore.rules');

  const allowed = listed[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
  Object.values(order.STATUS).forEach((st) => {
    assert.ok(allowed.includes(st), st + ' is reachable but firestore.rules refuses it');
  });
});

test('a pizza is built before it is baked, and never accepted', () => {
  const pie = pizzaOrder();
  const first = order.allowedActions(pie, sla);

  assert.ok(first.includes('build'), 'a pizza starts by being built');
  assert.ok(!first.includes('accept'), 'the acceptance step is gone');

  // Sent -> Building
  const built = { ...pie, ...order.transitionPatch(pie, 'build', { sla, actor: 'builder' }) };
  assert.strictEqual(built.status, 'building');
  assert.ok(built.buildingAt, 'the builder picking it up is stamped');
  assert.strictEqual(built.acceptedAt, null, 'nothing is cooking yet');

  // Building -> Cooking. The builder hands it to the oven; the cook does not
  // have to claim it first.
  const inOven = { ...built, ...order.transitionPatch(built, 'oven', { sla, actor: 'builder' }) };
  assert.strictEqual(inOven.status, 'cooking');
  assert.ok(inOven.acceptedAt, 'the cook clock starts at the oven');

  // Cooking -> On its way -> delivered
  const out = { ...inOven, ...order.transitionPatch(inOven, 'ready', { sla, actor: 'cook' }) };
  assert.strictEqual(out.status, 'ready');
  const done = { ...out, ...order.transitionPatch(out, 'deliver', { sla, actor: 'runner' }) };
  assert.strictEqual(done.status, 'delivered');

  assert.deepStrictEqual(
    done.events.map((e) => e.action),
    ['submit', 'build', 'oven', 'ready', 'deliver'],
    'the audit trail reads as the four stages',
  );
});

test('a bowl goes straight to the pan, and is never built', () => {
  const bowlOrder = make();
  const first = order.allowedActions(bowlOrder, sla);
  assert.ok(first.includes('accept'), 'one cook owns a bowl end to end');
  assert.ok(!first.includes('build'), 'there is nobody assembling a bowl');

  assert.throws(
    () => order.transitionPatch(bowlOrder, 'build', { sla }),
    /Cannot build/,
    'the state machine refuses, not just the screen',
  );
});

test('a pizza cannot skip the builder', () => {
  const pie = pizzaOrder();
  assert.throws(() => order.transitionPatch(pie, 'accept', { sla }), /Cannot accept/);
});

test('a mis-tap on the pizza path walks back one stage at a time', () => {
  const pie = pizzaOrder();
  const built = { ...pie, ...order.transitionPatch(pie, 'build', { sla }) };
  const inOven = { ...built, ...order.transitionPatch(built, 'oven', { sla }) };

  // Out of the oven by mistake: back to the builder, not back to the queue.
  const backToBuild = { ...inOven, ...order.transitionPatch(inOven, 'unoven', { sla }) };
  assert.strictEqual(backToBuild.status, 'building');
  assert.strictEqual(backToBuild.acceptedAt, null, 'the cook clock is cleared with it');

  // Picked up by mistake: back to the queue.
  const backToSent = { ...backToBuild, ...order.transitionPatch(backToBuild, 'unbuild', { sla }) };
  assert.strictEqual(backToSent.status, 'queued');
  assert.strictEqual(backToSent.buildingAt, null);
});

test('a pizza can be held while it is being built', () => {
  const pie = pizzaOrder();
  const built = { ...pie, ...order.transitionPatch(pie, 'build', { sla }) };
  assert.ok(order.allowedActions(built, sla).includes('hold'),
    'a party that walks out mid-build is exactly when hold is wanted');
  const held = { ...built, ...order.transitionPatch(built, 'hold', { sla }) };
  assert.strictEqual(held.status, 'held');
});

test('an order being built still counts as live work', () => {
  const pie = pizzaOrder();
  const built = { ...pie, ...order.transitionPatch(pie, 'build', { sla }) };
  assert.ok(order.LIVE_STATUSES.includes('building'),
    'a pizza on the build bench is not finished, and must be rushable and voidable');
  assert.ok(order.allowedActions(built, sla).includes('void'));
  assert.ok(order.allowedActions(built, sla).includes('rush'));
});

/**
 * The guest's progress bar is a list of statuses written out by hand, and a
 * status missing from it does not throw - findIndex returns -1 and the bar
 * silently falls back to the first step. A member watching a pizza being
 * assembled saw "Sent" for the whole of it, and nothing anywhere said why.
 *
 * A stage now covers several statuses, and the bar differs by kind: a pizza
 * is built and a bowl is not. So this asks the real state machine which
 * statuses each kind can actually reach, rather than keeping a second list
 * here that would have to be remembered.
 */
/** The member's progress bar, parsed out of guest.js as data. */
function trackSegments() {
  const block = /var TRACK_ALL = \[([\s\S]*?)\n  \];/.exec(guestSource());
  assert.ok(block, 'TRACK_ALL not found in guest.js');
  const list = (line, name) => {
    const m = new RegExp(name + String.raw`:\s*\[([^\]]*)\]`).exec(line);
    return m ? [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]) : null;
  };
  const segments = block[1].split('\n')
    .filter((line) => line.includes('statuses:'))
    .map((line) => ({
      statuses: list(line, 'statuses'),
      kinds: list(line, 'kinds'),
      notKinds: list(line, 'notKinds'),
    }));
  assert.ok(segments.length >= 3, 'found ' + segments.length + ' stages - the scan is broken');
  return segments;
}

test('every stage a guest can be in has a step on their tracker', () => {
  const src = guestSource();
  const block = /var TRACK_ALL = \[([\s\S]*?)\n  \];/.exec(src);
  assert.ok(block, 'TRACK_ALL not found in guest.js');

  const list = (line, name) => {
    const m = new RegExp(name + String.raw`:\s*\[([^\]]*)\]`).exec(line);
    return m ? [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]) : null;
  };
  const segments = block[1].split('\n')
    .filter((line) => line.includes('statuses:'))
    .map((line) => ({
      statuses: list(line, 'statuses'),
      kinds: list(line, 'kinds'),
      notKinds: list(line, 'notKinds'),
    }));
  assert.ok(segments.length >= 3, 'found ' + segments.length + ' stages - the scan is broken');

  // held and voided are not stages on the way to food - a guest whose ticket
  // is parked or cancelled is told in words, not moved along a bar.
  const offBar = [order.STATUS.HELD, order.STATUS.VOIDED];

  /** Every status this kind can actually end up in, per order.js itself. */
  const reachable = (kind) => {
    const out = new Set([order.STATUS.QUEUED]);
    Object.values(order.TRANSITIONS).forEach((tr) => {
      if (tr.kinds && !tr.kinds.includes(kind)) return;
      if (tr.notKinds && tr.notKinds.includes(kind)) return;
      if (tr.to) out.add(tr.to);
    });
    return [...out].filter((st) => !offBar.includes(st));
  };

  ['pasta', 'pizza'].forEach((kind) => {
    const covered = new Set();
    segments.forEach((seg) => {
      if (seg.kinds && !seg.kinds.includes(kind)) return;
      if (seg.notKinds && seg.notKinds.includes(kind)) return;
      seg.statuses.forEach((st) => covered.add(st));
    });
    reachable(kind).forEach((st) => {
      assert.ok(
        covered.has(st),
        'a ' + kind + ' can be ' + st + ', and nothing on the guest tracker covers it',
      );
    });
  });
});

/**
 * The club's objection, kept honest: "don't tell the member it's ready until
 * the runner is walking." Food on a pass is not food at a table, and a member
 * told it is ready starts waiting, then starts asking a server.
 *
 * So the bar must not move when a ticket is plated. ready and cooking have to
 * land on the same stage - if ready ever gets a stage of its own again, the
 * member is being told, whatever the words on it say.
 */
test('the member is not told their food is ready, only that it is coming', () => {
  const stages = trackSegments();

  ['pasta', 'pizza'].forEach((kind) => {
    const forKind = stages.filter((seg) => {
      if (seg.kinds && !seg.kinds.includes(kind)) return false;
      if (seg.notKinds && seg.notKinds.includes(kind)) return false;
      return true;
    });
    const stageOf = (st) => forKind.findIndex((seg) => seg.statuses.includes(st));

    assert.ok(stageOf('ready') >= 0, 'a plated ' + kind + ' has fallen off the bar entirely');
    assert.strictEqual(
      stageOf('ready'), stageOf('cooking'),
      "a plated " + kind + " moves the member's bar, which tells them it is ready",
    );
    assert.ok(
      stageOf('delivered') > stageOf('ready'),
      'the bar has to finish moving when a runner picks it up',
    );
  });

  // And nothing on that screen announces a ready ticket.
  const src = guestSource();
  const banner = /readyBanner = ticket\.status === '([a-z]+)'/.exec(src);
  assert.ok(banner, 'the banner condition has moved - check it still waits for a runner');
  assert.strictEqual(banner[1], 'delivered', 'the banner fires before a runner has it');
});

/**
 * A pizza leaves the kitchen at the oven door: the builder loads it and starts
 * the next one. Nobody stands at the oven to tap, so the window takes it out.
 * A bowl is the opposite - one cook owns it start to finish - and the rail
 * keeps that tap. The two must not drift into each other.
 */
test('a pizza is taken out of the oven at the window, a bowl at the rail', () => {
  const kitchen = readFileSync(fileURLToPath(new URL('../app/kitchen.js', import.meta.url)), 'utf8');
  const expo = readFileSync(fileURLToPath(new URL('../app/expo.js', import.meta.url)), 'utf8');

  const lanes = /var ROLE_LANES = \{([\s\S]*?)\n  \};/.exec(kitchen);
  assert.ok(lanes, 'ROLE_LANES not found in kitchen.js');

  const roles = {};
  [...lanes[1].matchAll(/(\w+):\s*\{\s*built:\s*\[([^\]]*)\][^}]*plain:\s*\[([^\]]*)\]/g)]
    .forEach((m) => {
      const ids = (t) => [...t.matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
      roles[m[1]] = { built: ids(m[2]), plain: ids(m[3]) };
    });
  assert.ok(Object.keys(roles).length >= 3, 'the lane scan is broken');

  // 'all' is nobody's station - it is the whole-rail overview, and it keeps
  // every lane. Every other role is somebody standing at one bench.
  assert.ok(roles.all, "the overview role is gone - this test no longer knows what it is checking");
  assert.ok(roles.all.built.includes('ready') && roles.all.plain.includes('ready'),
    'the overview has lost its ready column, so on a mixed night a bowl cannot be finished');

  Object.keys(roles).filter((r) => r !== 'all').forEach((role) => {
    assert.ok(
      !roles[role].built.includes('ready'),
      role + ' has a ready column on a built lane, so the rail and the window '
      + 'both claim the tap that takes a pizza out of the oven',
    );
    assert.ok(
      roles[role].plain.length,
      role + ' has no plain lanes at all - the scan is broken',
    );
  });
  assert.ok(
    Object.values(roles).some((r) => r.plain.includes('ready')),
    'no plain lane has a ready column - a bowl now has nobody to finish it',
  );

  // The tap has to exist somewhere, or a pizza never leaves the oven.
  assert.ok(
    /data-act="ready"/.test(expo),
    'the window cannot take a pizza out of the oven, and the rail no longer can either',
  );
});

/**
 * A role nobody at this station fills is a choice that leads to two empty
 * columns, and the club asked for both halves: a pasta range has no build
 * bench, and a pizza station has no cook line - the oven is watched rather
 * than tapped along.
 *
 * This reads the source because syncRoleOptions touches the DOM. What it can
 * hold is the shape: both roles gated, each on the opposite kind, and neither
 * gated on a screen with no station.
 */
test('a station is only offered the roles somebody there actually fills', () => {
  const kitchen = readFileSync(fileURLToPath(new URL('../app/kitchen.js', import.meta.url)), 'utf8');
  const fn = /function syncRoleOptions\(\)\s*\{([\s\S]*?)\n  \}/.exec(kitchen);
  assert.ok(fn, 'syncRoleOptions not found in kitchen.js');
  const body = fn[1];

  assert.ok(
    /stationKind\(\)/.test(body),
    'the roles are gated on something other than the station, so the whole-rail '
    + 'view will lose roles it is covering for',
  );
  ['builder', 'cook'].forEach((role) => {
    assert.ok(
      body.includes("'" + role + "'"),
      role + ' is not gated at all, so it is offered where nobody fills it',
    );
  });
  assert.ok(
    /pizza only/.test(body) && /pasta only/.test(body),
    'a disabled role has to say why it is disabled, or it reads as broken',
  );
});

/**
 * A stylesheet that names a custom property nobody defines does not warn, it
 * just drops the declaration. The chip for a selected allergen was written
 * with var(--brand), which exists nowhere: it rendered white text on a cream
 * panel, so ticking "Gluten" looked like it had not registered. On the one
 * control in this app where that matters most.
 */
/**
 * A stylesheet whose braces do not balance still loads: the browser recovers
 * and carries on, so nothing anywhere says a thing.
 *
 * kitchen.css had a @media (max-width: 720px) block that was never closed. It
 * swallowed the rest of the file - the Spanish note styling, the boot-failure
 * card, the Unclaimed chip, and the whole changed-ticket highlight the club
 * asked for. All of it applied only on a phone, so on the rail it did nothing
 * at all, which is why the kitchen asked for a changed ticket to stand out:
 * from where they were standing it never had.
 */
test('no stylesheet is mis-nested', () => {
  ['shared', 'admin', 'guest', 'kitchen', 'expo', 'report'].forEach((name) => {
    const src = readFileSync(fileURLToPath(new URL('../' + name + '.css', import.meta.url)), 'utf8');

    let depth = 0;
    let line = 1;
    for (const ch of src) {
      if (ch === '\n') line += 1;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        assert.ok(depth >= 0, name + '.css:' + line + ' closes a block that was never opened');
      }
    }
    assert.strictEqual(
      depth, 0,
      name + '.css has ' + depth + ' block(s) left open at the end of the file, so '
      + 'everything after the one that was missed is trapped inside it',
    );
  });
});

test('every CSS variable a stylesheet uses is one some stylesheet defines', () => {
  const sheets = ['shared', 'admin', 'guest', 'kitchen', 'expo', 'report'];
  const read = (n) => readFileSync(fileURLToPath(new URL('../' + n + '.css', import.meta.url)), 'utf8');
  const all = sheets.map(read).join('\n');

  const defined = new Set([...all.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  assert.ok(defined.size > 10, 'found ' + defined.size + ' definitions - the scan is broken');

  const missing = [];
  sheets.forEach((name) => {
    read(name).split('\n').forEach((line, i) => {
      [...line.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)].forEach((m) => {
        // A var() with a fallback still renders if the token is absent.
        if (m[2] || defined.has(m[1])) return;
        missing.push(name + '.css:' + (i + 1) + '  ' + m[1]);
      });
    });
  });

  assert.deepStrictEqual(
    missing, [],
    'these resolve to nothing, so the declaration is silently dropped - define '
    + 'the token or give var() a fallback',
  );
});

// ------------------------------------------- items the club added itself

/**
 * The club asked to add items, not just rename them, and the Sous Chef made
 * it the gate on live testing. A new item is modelled on one already on its
 * list, because the template is what supplies the things nobody types: the
 * cook-time field for that group, and the artwork.
 */
test('an item the club adds arrives whole, not half-made', () => {
  const id = 'cw_linguini';
  menu.applyMenuOverrides({
    [id]: {
      added: true, group: 'pastas', template: 'penne',
      name: 'Linguini', es: 'Linguini', allergens: ['gluten'],
    },
  });

  const made = menu.find('pastas', id);
  assert.ok(made, 'the new item never reached the menu');
  assert.strictEqual(made.name, 'Linguini');

  // The two things a template exists to supply. Without the first the kitchen
  // clock counts it as free; without the second its tile draws the crossed
  // circle, which on a menu reads as "we are out of this".
  assert.strictEqual(made.boilSec, menu.find('pastas', 'penne').boilSec,
    'a new pasta with no boil time costs the rail nothing and skews every estimate');
  assert.ok(made.shape && made.shape !== 'none',
    'a new item with no artwork draws the "unavailable" glyph');
  assert.strictEqual(made.shape, menu.find('pastas', 'penne').shape,
    'the artwork should come from the template it was modelled on');

  // And it behaves like any other pasta from here on.
  const line = { kind: 'pasta', pasta: id, sauces: ['marinara'], portion: 'regular' };
  assert.deepStrictEqual(menu.validateLine(line, config.order), []);
  assert.deepStrictEqual(menu.allergensFor(line), ['gluten'],
    'the allergen the club declared has to reach the ticket');

  menu.applyMenuOverrides({});
});

/**
 * The rule the club asked for by name: a new item must answer the allergen
 * question, and "No allergens" is an answer. An unanswered one is not.
 *
 * The two are indistinguishable once stored if the answer is an empty list,
 * so absence of the key is what "nobody said" looks like. This is the only
 * check here that protects a person rather than a number: an item that
 * reaches a chit with no allergens on it reads as safe.
 */
test('a new item cannot be saved until somebody answers the allergen question', () => {
  const base = { added: true, group: 'pastas', template: 'penne', name: 'Gemelli' };

  assert.ok(
    menu.overrideProblems({ cw_g: { ...base } }).length,
    'an item with no allergen answer was allowed through',
  );
  assert.deepStrictEqual(
    menu.overrideProblems({ cw_g: { ...base, allergens: [] } }), [],
    '"No allergens" is a real answer and must be accepted',
  );
  assert.deepStrictEqual(
    menu.overrideProblems({ cw_g: { ...base, allergens: ['gluten'] } }), [],
  );
  assert.ok(
    menu.overrideProblems({ cw_g: { ...base, allergens: ['kryptonite'] } }).length,
    'an allergen nobody has heard of was allowed through',
  );
  assert.ok(
    menu.overrideProblems({ cw_g: { ...base, name: '  ' , allergens: [] } }).length,
    'a nameless item was allowed through',
  );

  // And an unanswered one never becomes a live item, whatever reaches apply.
  menu.applyMenuOverrides({ cw_g: { ...base } });
  assert.ok(!menu.find('pastas', 'cw_g'),
    'an item with no allergen answer reached the menu anyway');
});

/**
 * Cloning the gluten-free fusilli to make a wheat pasta must not carry the
 * badge across. The flag follows the answer the club gave, never the template.
 */
test('gluten free follows what was declared, not what it was cloned from', () => {
  const from = { added: true, group: 'pastas', template: 'fusilli_gf' };

  menu.applyMenuOverrides({ cw_w: { ...from, name: 'Wheat Linguini', allergens: ['gluten'] } });
  assert.strictEqual(menu.find('pastas', 'cw_w').glutenFree, false,
    'a pasta declared to contain gluten is wearing a gluten-free badge');

  menu.applyMenuOverrides({ cw_r: { ...from, name: 'Rice Spirals', allergens: [] } });
  assert.strictEqual(menu.find('pastas', 'cw_r').glutenFree, true);

  menu.applyMenuOverrides({});
});

/** A mechanic is not a template: cloning "No Sauce" would cancel the step. */
test('a new item cannot be modelled on a mechanic', () => {
  const ids = menu.templatesFor('sauces').map((x) => x.id);
  assert.ok(ids.length, 'no templates at all - the scan is broken');
  assert.ok(!ids.includes('none'), '"No Sauce" is offered as something to clone');
  menu.catalog().sauces.filter((x) => !menu.isEditableItem(x)).forEach((x) => {
    assert.ok(!ids.includes(x.id), x.id + ' is a mechanic and cannot be a template');
  });
});

/** Saving, reopening and saving again must not stack duplicates. */
test('an added item round-trips and is not doubled by a second apply', () => {
  const entry = {
    added: true, group: 'pastas', template: 'penne',
    name: 'Gemelli', allergens: ['gluten'],
  };
  menu.applyMenuOverrides({ cw_gem: entry });

  const back = menu.menuOverrides().cw_gem;
  assert.ok(back && back.added, 'the item did not survive being read back');
  assert.deepStrictEqual(back.allergens, ['gluten']);
  assert.strictEqual(back.group, 'pastas');

  menu.applyMenuOverrides({ cw_gem: back });
  assert.strictEqual(
    menu.catalog().pastas.filter((x) => x.id === 'cw_gem').length, 1,
    'applying twice left two of it on the menu',
  );
  menu.applyMenuOverrides({});
  assert.ok(!menu.find('pastas', 'cw_gem'),
    'clearing the overrides left the added item behind');
});

/**
 * The save path sanitises every entry, and it used to do that by asking the
 * catalog whether the item existed. A brand new one does not exist yet, so it
 * was dropped - and the screen still said "Menu saved. Every screen has it."
 */
test('the save path keeps an added item rather than quietly dropping it', () => {
  const src = readFileSync(fileURLToPath(new URL('../app/db.js', import.meta.url)), 'utf8');
  const fn = /export async function saveMenuOverrides[\s\S]*?\n}/.exec(src);
  assert.ok(fn, 'saveMenuOverrides not found in db.js');
  const body = fn[0];

  const added = body.indexOf('o.added === true');
  const gate = body.indexOf('!menu.editableItem(id)');
  assert.ok(added !== -1, 'nothing in the save path handles an added item');
  assert.ok(gate !== -1, 'the editableItem gate has moved - check added items still pass it');
  assert.ok(added < gate,
    'the editableItem gate runs first, so a new item is dropped before it is written');
  assert.ok(/allergens/.test(body.slice(added, gate)),
    'the saved shape drops the allergens, which is the one field that must survive');
});

// ------------------------------------------------- the printed floor guide

/**
 * The guide is printed, handed to staff, and then not looked at again for
 * weeks. Its numbers cannot drift - the generator reads every threshold from
 * config.js - but its prose can, and did: five rounds of changes left it
 * promising members a claim code that no longer exists and a progress bar
 * with a stop that was deliberately removed.
 *
 * Nothing catches that by reading the PDF, so this reads the generator and
 * holds it against the code rather than against a list of phrases kept here.
 */
const guideSource = () => readFileSync(
  fileURLToPath(new URL('../scripts/guide-pdf.js', import.meta.url)), 'utf8',
);

test('the floor guide does not describe things the app no longer has', () => {
  const guide = guideSource().toLowerCase();
  const app = ['order', 'guest', 'menu', 'db'].map((n) => readFileSync(
    fileURLToPath(new URL('../app/' + n + '.js', import.meta.url)), 'utf8',
  )).join('\n');

  // Each pair is: a thing the code may or may not have, and what the guide
  // calls it. If the code has dropped it, the guide may not still promise it.
  [
    ['claimCode', 'claim code'],
    ['spice', 'spice level'],
  ].forEach(([inCode, inGuide]) => {
    if (app.includes(inCode)) return;
    assert.ok(
      !guide.includes(inGuide),
      'the guide still tells staff about "' + inGuide + '", which the app no longer has',
    );
  });
});

/**
 * The member's progress bar, held to what guest.js actually draws. The guide
 * printed the old four stops for a week after the bar became three.
 */
test('the floor guide names the stages a member actually sees', () => {
  const guide = guideSource();
  const src = guestSource();

  const block = /var TRACK_ALL = \[([\s\S]*?)\n  \];/.exec(src);
  assert.ok(block, 'TRACK_ALL not found in guest.js');
  const keys = [...block[1].matchAll(/key: '([\w.]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 3, 'found ' + keys.length + ' stages - the scan is broken');

  const labels = [...new Set(keys.map((k) => STRINGS.en[k]))].filter(Boolean);

  /*
   * Checked where the guide actually draws the bar, not merely somewhere in
   * the document. "On its way" also appears in the runner's steps, so a
   * presence check passed happily while the bar itself still read the old
   * four stops - which is the exact fault this is here to catch.
   *
   * The prose is stitched back together from the generator's string literals
   * first, because a sentence that long is written as a concatenation.
   */
  const prose = guide.replace(/'\s*\+\s*'/g, '').replace(/\s+/g, ' ');
  const bar = /stops:\s*(.*?)\./.exec(prose);
  assert.ok(bar, 'the guide no longer lists the stops on the member bar');

  labels.forEach((label) => {
    assert.ok(
      bar[1].includes(label),
      'the member bar has a stop called "' + label + '" and the guide draws ' + JSON.stringify(bar[1]),
    );
  });

  // And nothing the member never sees may be drawn as a stop.
  ['guest.track.ready', 'guest.track.enjoy'].forEach((k) => {
    const gone = STRINGS.en[k];
    if (!gone) return;
    assert.ok(
      !bar[1].includes(gone),
      'the guide draws "' + gone + '" as a stop the member sees, and it is not one',
    );
  });
});

/**
 * The guide is what a new starter is handed, so a screen they are expected to
 * run has to be in it. Menu editing was absent for a week after the club was
 * given it - the one thing the Sous Chef said gated live testing, and the
 * printed instructions said nothing about it at all.
 *
 * Each entry pairs a thing the manager screen can do with a phrase the guide
 * uses for it, so adding an ability and forgetting the paperwork fails here.
 */
test('the floor guide covers what the manager screen can actually do', () => {
  const guide = guideSource();
  const admin = readFileSync(fileURLToPath(new URL('../app/admin.js', import.meta.url)), 'utf8');

  [
    ['the menu editor', 'menuEditToggle', 'Edit the menu'],
    ['adding an item', 'menuaddgo', 'add an item'],
    ['the allergen answer', 'menuallergen', 'what it contains'],
    ['taking an order', 'placeorder', 'take an order from the bar'],
    ['the order search', 'orderQuery', 'search for a ticket'],
    ['reopening a ticket', 'reopenOrder', 'reopen one closed by mistake'],
    ['the close-out', 'report.html', 'Close-out'],
  ].forEach(([what, inCode, inGuide]) => {
    if (!admin.includes(inCode)) return;
    assert.ok(
      guide.includes(inGuide),
      'the manager screen does ' + what + ' and the guide never tells anyone',
    );
  });
});

/**
 * A new item starts holding the allergens of whatever it was modelled on.
 *
 * The club added Fried Ravioli, modelled on Garlic Bread, and declared it
 * allergen-free: ravioli is pasta dough, usually cheese-filled, and the bread
 * it was cloned from carries gluten and dairy. A bowl of gluten-free fusilli
 * with it on the side would have reached the kitchen saying no gluten.
 *
 * Starting blank made "No allergens" the one click that got you past the
 * gate. Starting from the template flips the direction of a mistake towards
 * over-declaring, which is merely annoying. Carried over is still not the
 * same as answered, so the commit waits for somebody to say so.
 */
test('a new item inherits its template allergens and still waits to be checked', () => {
  const src = readFileSync(fileURLToPath(new URL('../app/admin.js', import.meta.url)), 'utf8');

  const opens = /state\.menuNew\[group\] = \{([\s\S]*?)\};/.exec(src);
  assert.ok(opens, 'the add form no longer sets up its own state');
  assert.ok(
    /allergens:\s*\(tpl\.allergens/.test(opens[1]),
    'the form opens without carrying the template allergens over',
  );
  assert.ok(
    /checked:\s*false/.test(opens[1]),
    'the form opens already counted as checked, so nobody has to look',
  );

  // Picking a different template is a different starting point.
  const swap = /form\.template = sel\.value;([\s\S]*?)renderMenuEditor\(\);/.exec(src);
  assert.ok(swap, 'the template picker no longer updates the form');
  assert.ok(
    /form\.allergens =/.test(swap[1]) && /form\.checked = false/.test(swap[1]),
    'changing the template leaves the old allergens behind and still counted as checked',
  );

  // And nothing commits until somebody has looked.
  const commit = /if \(t\.dataset\.menuaddgo\)([\s\S]*?)return renderMenuEditor\(\);/.exec(src);
  assert.ok(commit, 'the Add button handler is gone');
  assert.ok(
    /!form\.checked/.test(commit[1]),
    'an item can be added without its allergens being looked at',
  );
});

/**
 * Every station on the floor plan has to state its capacity in its own units.
 *
 * The guide said "pans, or else decks", which knew about two kinds when the
 * menu has three: the grill carries patties, so a printed document handed to
 * staff announced that Grill 1 had "undefined decks". The close-out made the
 * same mistake with burgers, which is why this walks config rather than
 * naming the fields it expects to find.
 */
test('the floor guide can say how big every station is', () => {
  const guide = guideSource();
  const block = /const CAPACITY = \[([\s\S]*?)\];/.exec(guide);
  assert.ok(block, 'the guide no longer has a capacity table');

  const known = [...block[1].matchAll(/\['(\w+)'/g)].map((m) => m[1]);
  assert.ok(known.length >= 2, 'found ' + known.length + ' capacity units - the scan is broken');

  // The table being right is no use if the page does not read it. Reverting
  // to "pans, or else decks" leaves this table untouched and still prints
  // "undefined decks" on the sheet.
  const defined = guide.indexOf('function stationCapacity');
  assert.ok(defined > 0, 'the capacity helper is gone');
  const after = guide.slice(guide.indexOf('}', defined));
  assert.ok(
    after.includes('stationCapacity('),
    'the floor plan works out capacity by hand instead of using the table',
  );

  config.kitchen.stations.forEach((st) => {
    const has = known.filter((f) => typeof st[f] === 'number');
    assert.ok(
      has.length,
      st.label + ' has no capacity the guide knows how to print, so it prints nothing - '
      + 'it carries ' + JSON.stringify(Object.keys(st).filter((k) => typeof st[k] === 'number')),
    );
  });
});

// ------------------------------------------- icons on the iPad home screen

/**
 * Each screen is added to an iPad's home screen as its own button, so each
 * needs its own icon and its own name.
 *
 * Both have a silent failure mode. iOS ignores SVG for a home-screen icon and
 * quietly substitutes a screenshot of the page, which on a dark rail is a
 * black square; and every screen shipped the same apple-mobile-web-app-title,
 * so five buttons would all have read "PastaPresto" and been impossible to
 * tell apart on a dock.
 */
test('every screen has its own home-screen icon and name', () => {
  const pages = ['index', 'kitchen', 'expo', 'admin', 'report'];
  const names = new Set();
  const icons = new Set();

  pages.forEach((name) => {
    const html = readFileSync(fileURLToPath(new URL('../' + name + '.html', import.meta.url)), 'utf8');

    const title = /apple-mobile-web-app-title"\s+content="([^"]+)"/.exec(html);
    assert.ok(title, name + '.html has no home-screen name, so iOS uses the page title');
    assert.ok(!names.has(title[1]),
      name + '.html is called "' + title[1] + '" on the home screen, and so is another screen');
    names.add(title[1]);

    // Without this the button opens in Safari with its chrome, which on a
    // rail costs a third of the screen and puts a URL bar in a kitchen.
    assert.ok(
      /apple-mobile-web-app-capable"\s+content="yes"/.test(html),
      name + '.html opens in Safari rather than as its own app',
    );

    const icon = /apple-touch-icon"[^>]*href="([^"]+)"/.exec(html);
    assert.ok(icon, name + '.html has no apple-touch-icon, so iOS uses a screenshot of the page');
    assert.ok(/\.png$/.test(icon[1]),
      name + '.html points its home-screen icon at ' + icon[1] + ' - iOS ignores anything but PNG');
    assert.ok(!icons.has(icon[1]),
      name + '.html shares its icon with another screen');
    icons.add(icon[1]);

    const file = fileURLToPath(new URL('../' + icon[1], import.meta.url));
    assert.ok(existsSync(file), icon[1] + ' is linked by ' + name + '.html but is not in the repo');

    // A home-screen launch with no connection asks for the icon first, and a
    // miss shows as a blank square.
    const sw = readFileSync(fileURLToPath(new URL('../sw.js', import.meta.url)), 'utf8');
    assert.ok(sw.includes(icon[1]),
      icon[1] + ' is not in the service worker shell, so it is blank offline');
  });
});

// ----------------------------------------------------------- the manager code

/**
 * Only the manager and close-out screens are locked.
 *
 * The rail and the window are mounted in the kitchen and tapped with wet
 * hands; a code there is friction with nothing behind it, because everything
 * a cook can reach on those screens they are already standing in front of.
 * The other two delete the service day, show what the food cost and name the
 * members to charge, so those stay locked.
 *
 * Not security either way - the code ships in config.js. firestore.rules is
 * what protects the data.
 */
test('the manager screens are locked and the rail is not', () => {
  const read = (p) => readFileSync(fileURLToPath(new URL('../app/' + p, import.meta.url)), 'utf8');

  assert.ok(config.kitchen.managerPasscode, 'there is no manager code');
  assert.strictEqual(
    config.kitchen.staffPasscode, undefined,
    'a second passcode is back in config, and only one of them is wired up',
  );

  [['admin.js', true], ['report.js', true], ['kitchen.js', false], ['expo.js', false]]
    .forEach(function (pair) {
      const file = pair[0];
      const locked = pair[1];
      const gated = /requireManager\(/.test(read(file));
      assert.strictEqual(
        gated, locked,
        file + (locked
          ? ' no longer asks for the manager code'
          : ' asks for a code, and the rail is meant to open straight into service'),
      );
    });

  // One CODE, one level. The club asked for the second passcode to go, and
  // this is what stops it coming back - including under another name. The
  // staff sign-in that arrived later is a different animal: a real account
  // the rules can see, holding no passcode at all. So the test is that no
  // gate compares a code except the one manager gate.
  const ui = read('ui.js');
  const staffGate = ui.slice(ui.indexOf('export function requireStaffDevice'));
  const staffBody = staffGate.slice(0, staffGate.indexOf(String.fromCharCode(10) + 'export '));
  assert.ok(
    staffBody && !/[Pp]asscode/.test(staffBody),
    'the staff sign-in has grown a passcode - it is meant to be a real account',
  );
  assert.strictEqual(
    (ui.match(/config\.kitchen\.\w*[Pp]asscode/g) || []).length, 1,
    'the gate compares against more than one code',
  );
});

/**
 * The rail now asks for a wake lock with no gesture behind it, the passcode
 * having been the thing that supplied one. So it has to be the kind that
 * retries - keeping iPad screens awake was the first thing the club ever
 * asked for, and a lock refused once and never asked for again is a rail that
 * dims in the middle of service.
 */
test('the rail can still take a wake lock without a tap to earn it', () => {
  const ui = readFileSync(fileURLToPath(new URL('../app/ui.js', import.meta.url)), 'utf8');
  const fn = /export async function keepScreenAwake[\s\S]*?\n}/.exec(ui);
  assert.ok(fn, 'keepScreenAwake is gone');
  assert.ok(
    /pointerdown/.test(fn[0]),
    'the wake lock is asked for once and never retried, so a refusal for want '
    + 'of a gesture is permanent',
  );
});

// --------------------------------------------- nights the venue is running

/**
 * Burger night is switched off while the club rolls out Neapolitan night, and
 * "off" has to mean nobody meets it: not in the night chooser, not as six
 * lists of buns to scroll past in the menu editor, not as a grill on the
 * printed floor plan.
 *
 * It is switched off, not deleted, so this also checks the machinery is still
 * there - putting it back should be one word in config.
 */
test('a night that is switched off is not offered anywhere', () => {
  const off = Object.keys(config.nights).filter((id) => !config.activeNights.includes(id));
  assert.ok(off.length, 'no night is switched off - this test has nothing to check');

  const offered = cfgTags.nightList().map((n) => n.id);
  off.forEach((id) => {
    assert.ok(!offered.includes(id), id + ' night is switched off but still in the chooser');
  });

  // The kinds only that night serves must not reach the editor or the floor.
  const running = cfgTags.activeKinds();
  const dormant = off.flatMap((id) => config.nights[id].kinds).filter((k) => !running.includes(k));
  assert.ok(dormant.length, 'the switched-off night shares all its kinds with a running one');

  const shown = menu.editableGroupsFor(running).map(([g]) => g);
  dormant.forEach((kind) => {
    Object.keys(menu.GROUP_KIND)
      .filter((g) => menu.GROUP_KIND[g] === kind)
      .forEach((g) => {
        assert.ok(!shown.includes(g),
          g + ' is still offered in the menu editor, and nobody can order from it');
      });
    assert.ok(
      !config.kitchen.stations.some((st) => running.includes(st.kind) && st.kind === kind),
      'a station for ' + kind + ' is still on a running night',
    );
  });

  // And it is dormant, not gone.
  off.forEach((id) => {
    assert.ok(config.nights[id], id + ' has been deleted rather than switched off');
    assert.ok(config.nights[id].kinds.length, id + ' no longer declares what it serves');
  });
});

/**
 * Every editable group has to be claimed by exactly one kind.
 *
 * The editor is built by asking which groups the running kinds own, so a group
 * nobody claims does not appear at all - which is how Pasta shapes and Pasta
 * sides fell off the screen the first time this was wired up.
 */
test('every editable group belongs to a kind, and every claim to a real group', () => {
  const editable = menu.EDITABLE_GROUPS.map(([g]) => g);

  editable.forEach((g) => {
    assert.ok(menu.GROUP_KIND[g],
      g + ' is editable but belongs to no kind, so it vanishes from the editor');
  });

  Object.keys(menu.GROUP_KIND).forEach((g) => {
    assert.ok(editable.includes(g),
      g + ' is claimed by a kind but is not an editable group any more');
  });

  /*
   * And the two maps have to agree. GROUPS_FOR says which group a kind builds
   * from; GROUP_KIND says which kind owns it. A group built by pizza but
   * claimed by pasta would keep showing on a pasta night with burger night
   * off - switched off in name only.
   */
  Object.keys(menu.GROUPS_FOR).forEach((kind) => {
    Object.values(menu.GROUPS_FOR[kind]).forEach((group) => {
      if (!menu.GROUP_KIND[group]) return;
      assert.strictEqual(
        menu.GROUP_KIND[group], kind,
        group + ' is built by ' + kind + ' but claimed by ' + menu.GROUP_KIND[group],
      );
    });
  });

  // Nothing is lost when everything runs.
  const all = [...new Set(Object.values(menu.GROUP_KIND))];
  assert.strictEqual(
    menu.editableGroupsFor(all).length, menu.EDITABLE_GROUPS.length,
    'with every kind running, the editor should offer every editable group',
  );
});

// -------------------------------------------------- ticket layout

test('a dish reads as rows, and every choice appears in one', () => {
  const line = {
    kind: 'pasta', pasta: 'penne', sauces: ['marinara'], proteins: ['chicken'],
    toppings: ['parmesan', 'broccoli'], sides: ['garlic_bread'], portion: 'regular',
  };
  const rows = menu.ingredientList(line, 'en');
  const labels = rows.map((r) => r.label);

  assert.deepStrictEqual(labels, ['Pasta', 'Sauce', 'Protein', 'Toppings', 'Side', 'Size']);
  assert.deepStrictEqual(rows.find((r) => r.label === 'Toppings').items, ['Parmesan', 'Broccoli']);

  // Nothing a guest chose may go missing between the sentence and the rows -
  // a cook reading the list has to be reading the whole dish.
  const flat = rows.flatMap((r) => r.items).join(' | ');
  ['Penne', 'Marinara', 'Grilled Chicken', 'Parmesan', 'Broccoli', 'Garlic Bread', 'Regular']
    .forEach((n) => assert.ok(flat.includes(n), n + ' is missing from the rows'));
});

test('an empty choice is left out rather than printed blank', () => {
  const plain = {
    kind: 'pasta', pasta: 'penne', sauces: ['butter'], proteins: [],
    toppings: [], sides: [], portion: 'kid',
  };
  const labels = menu.ingredientList(plain, 'en').map((r) => r.label);
  assert.deepStrictEqual(labels, ['Pasta', 'Sauce', 'Size']);
  assert.ok(!labels.includes('Protein'), 'a row with nothing in it is not a row');
});

test('every kind produces rows, and a pizza is never asked its size', () => {
  const byKind = {
    pasta: { kind: 'pasta', pasta: 'penne', sauces: ['marinara'], proteins: [], toppings: [], sides: [], portion: 'regular' },
    pizza: { kind: 'pizza', sauces: ['pz_marinara'], cheeses: ['pz_shred_mozz'], proteins: [], toppings: [] },
    burger: { kind: 'burger', base: 'bun_brioche', proteins: ['beef_single'], cheeses: [], toppings: [], sauces: [], sides: [] },
  };
  Object.entries(byKind).forEach(([kind, line]) => {
    const rows = menu.ingredientList(line, 'en');
    assert.ok(rows.length > 0, kind + ' produced no rows');
    rows.forEach((r) => {
      assert.ok(r.label && r.label.length, kind + ' has a row with no label');
      assert.ok(r.items.length, kind + ' has an empty row');
    });
  });
  const pizzaLabels = menu.ingredientList(byKind.pizza, 'en').map((r) => r.label);
  assert.ok(!pizzaLabels.includes('Size'), 'every pizza is one size');
  assert.ok(menu.ingredientList(byKind.burger, 'en').some((r) => r.label === 'Bun'));
});

test('the rows speak Spanish when the order was placed in Spanish', () => {
  const line = {
    kind: 'pasta', pasta: 'penne', sauces: ['marinara'], proteins: ['chicken'],
    toppings: [], sides: [], portion: 'regular',
  };
  const es = menu.ingredientList(line, 'es');
  assert.deepStrictEqual(es.map((r) => r.label), ['Pasta', 'Salsa', 'Proteína', 'Tamaño']);
  assert.ok(es.find((r) => r.label === 'Proteína').items[0] !== 'Grilled Chicken',
    'the values are translated, not just the labels');
});

// ----------------------------------------------------- the order of work

/**
 * The one promise the rail makes a cook: the ticket at the top is the one to
 * work on next, and it stays there until somebody moves it on.
 *
 * This is a sort, so it is tested where it is decided rather than through the
 * screen - order.workOrder(), which app/kitchen.js calls for every lane. An allergy ticket used to be promoted automatically, which broke
 * the promise and bought nothing - it already arrives with a badge and a
 * banner. Rush is the deliberate exception and stays.
 */
const laneSort = (orders) => order.workOrder(orders);

test('the oldest ticket sits at the top, allergy or not', () => {
  const at = (mins, over = {}) => ({
    ticketNo: mins,
    submittedAt: new Date(Date.UTC(2026, 9, 8, 18, mins)).toISOString(),
    status: 'queued', priority: 'normal', ...over,
  });

  const lane = laneSort([at(30), at(10, { priority: 'allergy' }), at(20), at(5)]);
  assert.deepStrictEqual(lane.map((o) => o.ticketNo), [5, 10, 20, 30],
    'strictly oldest first - an allergy ticket does not jump the queue');
});

test('a rush ticket is the one thing that goes first', () => {
  const at = (mins, over = {}) => ({
    ticketNo: mins,
    submittedAt: new Date(Date.UTC(2026, 9, 8, 18, mins)).toISOString(),
    status: 'queued', priority: 'normal', ...over,
  });

  const lane = laneSort([at(5), at(10), at(40, { priority: 'rush' }), at(20)]);
  assert.strictEqual(lane[0].ticketNo, 40, 'somebody decided this one comes first');
  assert.deepStrictEqual(lane.slice(1).map((o) => o.ticketNo), [5, 10, 20],
    'and everything behind it is still oldest first');
});

test('a held ticket drops to the foot of the lane without vanishing', () => {
  const at = (mins, over = {}) => ({
    ticketNo: mins,
    submittedAt: new Date(Date.UTC(2026, 9, 8, 18, mins)).toISOString(),
    status: 'queued', priority: 'normal', ...over,
  });

  const lane = laneSort([at(5, { status: 'held' }), at(20), at(10)]);
  assert.deepStrictEqual(lane.map((o) => o.ticketNo), [10, 20, 5],
    'parked, not lost - an invisible order is a lost order');
});

// ------------------------------------------------- claiming a ticket

const STATIONS = config.kitchen.stations;

test('a pasta ticket arrives belonging to nobody', () => {
  // Two pasta ranges, so there is a choice to make and the cooks make it.
  assert.strictEqual(order.stationsFor(STATIONS, 'pasta').length, 2,
    'this test only means something while pasta has more than one station');

  assert.strictEqual(order.initialStation(1, STATIONS, true, 'pasta'), null);
  assert.strictEqual(order.initialStation(2, STATIONS, true, 'pasta'), null);

  // A venue that pinned everything to one station still gets that. The flag
  // means 'do not spread these around', and leaving them unclaimed would be
  // the opposite of what it asks for.
  assert.strictEqual(order.initialStation(1, STATIONS, false, 'pasta'), 'PASTA-1');
  assert.strictEqual(order.initialStation(2, STATIONS, false, 'pasta'), 'PASTA-1');
});

test('a kind with one station is stamped with it at once', () => {
  // Nothing to decide and nobody to decide between, so asking a cook to claim
  // it would be a tap that could only ever have one answer.
  assert.strictEqual(order.stationsFor(STATIONS, 'pizza').length, 1);
  assert.strictEqual(order.initialStation(1, STATIONS, true, 'pizza'), 'PIZZA-1');
  assert.strictEqual(order.initialStation(9, STATIONS, true, 'burger'), 'GRILL-1');
});

test('the cook who starts a bowl takes it', () => {
  const unclaimed = { ...make(), station: null };
  assert.strictEqual(unclaimed.station, null);

  const patch = order.transitionPatch(unclaimed, 'accept', {
    sla, station: 'PASTA-2', stations: STATIONS,
  });
  assert.strictEqual(patch.station, 'PASTA-2', 'it goes to whoever pressed the button');
  assert.strictEqual(patch.status, 'cooking', 'and the same tap starts the cooking');
});

test('a cook who has not said where they are still gets a working ticket', () => {
  // The fallback is the alternating assignment this used to do at creation,
  // so a screen left on "All stations" degrades to the old behaviour instead
  // of leaving the ticket belonging to nobody.
  const odd = { ...make(), ticketNo: 1, station: null };
  const even = { ...make(), ticketNo: 2, station: null };

  const a = order.transitionPatch(odd, 'accept', { sla, stations: STATIONS });
  const b = order.transitionPatch(even, 'accept', { sla, stations: STATIONS });

  assert.strictEqual(a.station, 'PASTA-1');
  assert.strictEqual(b.station, 'PASTA-2');
  assert.notStrictEqual(a.station, b.station, 'consecutive tickets still alternate');
});

test('starting a ticket twice does not move it to another station', () => {
  // A cook un-starts a ticket by mistake and the other cook restarts it: the
  // ticket is already somebody's, and the second tap must not quietly hand it
  // over. Only a ticket with no station at all is up for grabs.
  const claimed = { ...make(), station: 'PASTA-1', status: 'queued' };
  const patch = order.transitionPatch(claimed, 'accept', {
    sla, station: 'PASTA-2', stations: STATIONS,
  });
  assert.strictEqual(patch.station, undefined, 'the assignment is left exactly as found');
});

test('moving a ticket onward never re-assigns it', () => {
  // Only the tap out of Sent claims. Everything after it is the same cook
  // carrying on, and a station that changed at the pass would be a ticket
  // that moved kitchens halfway through being cooked.
  const claimed = { ...make(), station: 'PASTA-1', status: 'cooking', acceptedAt: new Date().toISOString() };
  assert.strictEqual(
    order.transitionPatch(claimed, 'ready', { sla, station: 'PASTA-2', stations: STATIONS }).station,
    undefined,
  );

  // And with no station at all, so the assertion rests on which action it is
  // rather than on the ticket already being spoken for. Testing only the
  // claimed case passed whether or not 'ready' was treated as a claim.
  const nobodys = { ...make(), station: null, status: 'cooking', acceptedAt: new Date().toISOString() };
  assert.strictEqual(
    order.transitionPatch(nobodys, 'ready', { sla, station: 'PASTA-2', stations: STATIONS }).station,
    undefined,
    'finishing a dish is not how a ticket gets a station',
  );
});

test('a pizza is claimed by the builder who starts building it', () => {
  // Pizza has one station today, so this is about the mechanism rather than
  // the choice: the tap out of Sent is 'build' there, and it claims the same
  // way 'accept' does on a bowl.
  const pie = { ...make(pizzaDraft(), { station: null }), kind: 'pizza', station: null };
  const patch = order.transitionPatch(pie, 'build', { sla, station: 'PIZZA-1', stations: STATIONS });
  assert.strictEqual(patch.station, 'PIZZA-1');
  assert.strictEqual(patch.status, 'building');
});

/**
 * What a screen filtered to one station shows - order.visibleAtStation(),
 * which app/kitchen.js calls for every render. The club's request in one
 * line: new orders at both ranges, and once a cook takes one it is only on
 * their screen.
 */
const visibleAt = (stationId, orders) => order.visibleAtStation(orders, stationId, STATIONS);

test('an unclaimed bowl is on both pasta screens, and a claimed one is on neither but its own', () => {
  const open = { ...make(), ticketNo: 1, station: null, kind: 'pasta' };
  const mine = { ...make(), ticketNo: 2, station: 'PASTA-1', kind: 'pasta' };
  const pie = { ...make(pizzaDraft()), ticketNo: 3, station: null, kind: 'pizza' };
  const all = [open, mine, pie];

  assert.deepStrictEqual(visibleAt('PASTA-1', all).map((o) => o.ticketNo), [1, 2],
    'the open bowl and its own');
  assert.deepStrictEqual(visibleAt('PASTA-2', all).map((o) => o.ticketNo), [1],
    'the open bowl only - ticket 2 belongs to the other range now');
  assert.deepStrictEqual(visibleAt('PIZZA-1', all).map((o) => o.ticketNo), [3],
    'an unclaimed pizza does not appear on a pasta range, or the other way round');
});

// ------------------------------------------- crusts and dessert pizza

test('a gluten free crust makes a gluten free pizza', () => {
  const classic = { kind: 'pizza', base: 'classic', sauces: ['pz_marinara'], cheeses: ['pz_no_cheese'], proteins: [], toppings: [] };
  const gf = { ...classic, base: 'pz_gf_crust' };

  assert.ok(menu.allergensFor(classic).includes('gluten'), 'the classic base is wheat');
  assert.ok(!menu.allergensFor(gf).includes('gluten'),
    'the whole point of putting it on the menu');

  // A pie taken before the crust was a question was a classic one, and still
  // has to read as carrying gluten.
  const legacy = { kind: 'pizza', sauces: ['pz_marinara'], cheeses: [], proteins: [], toppings: [] };
  assert.strictEqual(menu.crustOf(legacy).id, 'classic');
  assert.ok(menu.allergensFor(legacy).includes('gluten'));
});

test('a special crust reaches the kitchen, and a classic one stays quiet', () => {
  const pie = (base) => ({
    kind: 'pizza', base, sauces: ['pz_marinara'], cheeses: ['pz_no_cheese'],
    proteins: [], toppings: [],
  });

  // The row a cook reads at the pass. This is the whole reason a gluten free
  // base is on the menu: a ticket that says "12 inch pie" is a pizza made on
  // the wrong dough for someone who asked carefully.
  const row = (line, lang) => menu.ingredientList(line, lang)
    .find((r) => r.label === 'Crust' || r.label === 'Masa');
  assert.deepStrictEqual(row(pie('pz_gf_crust'), 'en').items, ['Gluten Free Crust']);
  assert.deepStrictEqual(row(pie('pz_dessert'), 'en').items, ['Dessert Pizza']);
  assert.deepStrictEqual(row(pie('pz_gf_crust'), 'es').items, ['Masa Sin Gluten']);

  // The one-line form, used on the close-out and anywhere a dish is a
  // sentence. Named when it is unusual, silent when it is the house dough -
  // every ticket saying "12 inch Classic" would be noise a cook reads past.
  assert.ok(/Gluten Free Crust/.test(menu.describe(pie('pz_gf_crust'), 'en')));
  assert.ok(/Dessert Pizza/.test(menu.describe(pie('pz_dessert'), 'en')));
  assert.ok(!/Classic/.test(menu.describe(pie('classic'), 'en')),
    'the house crust needs no announcement');
  assert.ok(/Masa Sin Gluten/.test(menu.describe(pie('pz_gf_crust'), 'es')));
});

test('the crust decides how long the pie is in the oven', () => {
  const of = (base) => cooktime.lineCookSec({
    kind: 'pizza', base, sauces: ['pz_marinara'], cheeses: [], proteins: [], toppings: [],
  });
  // A gluten free base needs longer to set; a dessert pie comes out sooner.
  assert.ok(of('pz_gf_crust') > of('classic'), 'gluten free bakes longer');
  assert.ok(of('pz_dessert') < of('classic'), 'a dessert pie is quicker');
});

test('both dessert crusts arrive already built, the same way', () => {
  const dessertCrusts = menu.PIZZA_CRUSTS.filter((c) => c.dessert);
  assert.strictEqual(dessertCrusts.length, 2, 'dessert, and gluten free dessert');

  dessertCrusts.forEach((crust) => {
    assert.ok(crust.defaults, crust.name + ' has to fill something in');
    // Nutella is the sauce and the only one. Strawberries and powdered sugar
    // come ticked; pineapple is offered but not assumed.
    assert.deepStrictEqual(crust.defaults.sauces, ['pz_nutella'], crust.name);
    assert.deepStrictEqual(crust.defaults.toppings,
      ['pz_strawberry', 'pz_powdered_sugar'], crust.name);
    assert.deepStrictEqual(crust.defaults.cheeses, ['pz_no_cheese'], crust.name);

    // Every id it names must be real, or the screen pre-selects nothing and
    // says nothing about it.
    crust.defaults.sauces.forEach((id) => assert.ok(menu.find('pizzaSauces', id), id));
    crust.defaults.toppings.forEach((id) => assert.ok(menu.find('pizzaToppings', id), id));
    crust.defaults.cheeses.forEach((id) => assert.ok(menu.find('pizzaCheeses', id), id));
  });

  // One of the two is gluten free, which is the whole reason there are two.
  assert.ok(dessertCrusts.some((c) => c.allergens.length === 0));
  assert.ok(dessertCrusts.some((c) => c.allergens.includes('gluten')));
});

test('a dessert pizza offers only what belongs on one', () => {
  const dessert = { kind: 'pizza', base: 'pz_dessert' };
  const open = (group, line) => menu.catalog()[group]
    .filter((x) => !menu.crustBlocks(group, line)[x.id])
    .map((x) => x.id);

  // Nutella, and nothing else at all - not even "No Sauce".
  assert.deepStrictEqual(open('pizzaSauces', dessert), ['pz_nutella']);

  // Strawberries, powdered sugar and pineapple. Pineapple because it is the
  // one thing on the savoury list that belongs on either.
  assert.deepStrictEqual(open('pizzaToppings', dessert).sort(),
    ['pineapple', 'pz_powdered_sugar', 'pz_strawberry']);

  // And the two questions a dessert pizza has no answer to are never asked.
  assert.deepStrictEqual(menu.crustSkips(dessert), ['cheeses', 'proteins']);
});

test('the validator refuses what the screen greys out', () => {
  // The screen and the validator read one rule. If they ever disagreed, a
  // guest would build something the tiles allowed and then be refused at
  // send with no way to see why.
  const dessert = (over = {}) => ({
    kind: 'pizza', base: 'pz_dessert', sauces: ['pz_nutella'],
    cheeses: ['pz_no_cheese'], proteins: [], toppings: [], ...over,
  });

  assert.deepStrictEqual(menu.validateLine(dessert(), config.order), [],
    'the default dessert pizza is a valid order');
  assert.deepStrictEqual(
    menu.validateLine(dessert({ toppings: ['pz_strawberry', 'pz_powdered_sugar', 'pineapple'] }), config.order),
    [], 'and so is one with all three of the things it may have');

  // Marinara on a dessert pizza, and mushrooms on one.
  assert.ok(menu.validateLine(dessert({ sauces: ['pz_marinara'] }), config.order)
    .some((e) => /dessert pizza/.test(e)));
  assert.ok(menu.validateLine(dessert({ toppings: ['pz_mushroom'] }), config.order)
    .some((e) => /dessert pizza/.test(e)));

  // And the other way: dessert things on a savoury pie.
  const savoury = (over = {}) => ({
    kind: 'pizza', base: 'classic', sauces: ['pz_marinara'],
    cheeses: ['pz_no_cheese'], proteins: [], toppings: [], ...over,
  });
  assert.deepStrictEqual(menu.validateLine(savoury(), config.order), []);
  assert.ok(menu.validateLine(savoury({ sauces: ['pz_nutella'] }), config.order).length);
  assert.ok(menu.validateLine(savoury({ toppings: ['pz_strawberry'] }), config.order).length);
  assert.deepStrictEqual(menu.validateLine(savoury({ toppings: ['pineapple'] }), config.order), [],
    'pineapple is the one thing allowed on both');
});

test('a gluten free dessert pizza is both things at once', () => {
  const line = {
    kind: 'pizza', base: 'pz_gf_dessert', sauces: ['pz_nutella'],
    cheeses: ['pz_no_cheese'], proteins: [], toppings: ['pz_strawberry'],
  };
  assert.deepStrictEqual(menu.validateLine(line, config.order), []);
  assert.ok(!menu.allergensFor(line).includes('gluten'), 'the crust is gluten free');
  assert.ok(menu.allergensFor(line).includes('tree_nuts'), 'the Nutella still is not');
  assert.deepStrictEqual(menu.crustSkips(line), ['cheeses', 'proteins']);
  assert.ok(/Gluten Free Dessert Pizza/.test(menu.describe(line, 'en')));
});

test('a savoury pizza offers nothing that belongs only on a dessert', () => {
  const classic = { kind: 'pizza', base: 'classic' };
  const blocked = (group) => Object.keys(menu.crustBlocks(group, classic)).sort();

  assert.deepStrictEqual(blocked('pizzaSauces'), ['pz_nutella'],
    'Nutella is not a pizza sauce on a savoury pie');
  assert.deepStrictEqual(blocked('pizzaToppings'), ['pz_powdered_sugar', 'pz_strawberry']);

  // Pineapple stays available on both, which is the point of marking it.
  assert.ok(!menu.crustBlocks('pizzaToppings', classic).pineapple);
  assert.deepStrictEqual(menu.crustSkips(classic), [], 'a savoury pie is asked everything');
});

test('the dessert toppings cost no oven time', () => {
  // They go on after the bake, like the herbs - so loading a pie with all
  // three must not stretch the oven clock.
  const plain = { kind: 'pizza', base: 'pz_dessert', sauces: ['pz_no_sauce'], cheeses: ['pz_no_cheese'], proteins: [], toppings: [] };
  const loaded = { ...plain, toppings: ['pz_nutella', 'pz_strawberry', 'pz_powdered_sugar'] };
  assert.strictEqual(cooktime.lineCookSec(loaded), cooktime.lineCookSec(plain));
});

test('nutella carries its allergens onto the pie', () => {
  // It is the sauce now, not a topping - and it still has to reach the
  // allergen line, because hazelnut spread on a nut allergy is the case this
  // whole mechanism exists for.
  const pie = {
    kind: 'pizza', base: 'pz_dessert', sauces: ['pz_nutella'],
    cheeses: ['pz_no_cheese'], proteins: [], toppings: [],
  };
  const flags = menu.allergensFor(pie);
  assert.ok(flags.includes('tree_nuts'), 'hazelnut spread on a nut allergy is the case that matters');
  assert.ok(flags.includes('dairy'));
});

test('every crust can be priced, and a pizza is costed on the one it used', () => {
  // A gluten free base costs more than a classic one, which is the reason it
  // gets its own price row instead of hiding inside the crust it replaced.
  menu.PIZZA_CRUSTS.forEach((c) => {
    assert.ok(costing.costableIds().includes(c.id), c.name + ' has no price row');
  });

  const costs = {
    pz_gf_crust: { price: 24, yield: 12 },
    pz_marinara: { price: 6, yield: 24 },
    pz_no_cheese: { price: 0, yield: 1 },
  };
  const line = { kind: 'pizza', base: 'pz_gf_crust', sauces: ['pz_marinara'], cheeses: ['pz_no_cheese'], proteins: [], toppings: [] };
  const got = costing.lineCost(line, costs);
  assert.ok(got.complete, 'both priced, so the line is complete: ' + JSON.stringify(got.missing));
  near(got.total, 24 / 12 + 6 / 24, 'crust plus sauce');
});

test('the close-out counts every kind it served, and names it correctly', () => {
  // A burger night used to report '0 bowls / 0 pizzas' beside an item count
  // that was not zero, because the close-out knew about two kinds and the
  // menu had three. Derived from menu.KINDS so a fourth cannot be missed.
  const sla2 = config.sla;
  const mk = (kind, station) => ({
    id: kind, kind, status: 'delivered', guestCount: 2, memberNumber: '1794',
    lines: [{ lineId: 'ln01', kind }],
    submittedAt: '2026-10-13T18:00:00.000Z', acceptedAt: '2026-10-13T18:01:00.000Z',
    readyAt: '2026-10-13T18:05:00.000Z', deliveredAt: '2026-10-13T18:06:00.000Z',
    station, events: [],
  });

  menu.KINDS.forEach((kind) => {
    const r = order.shiftReport([mk(kind, 'PASTA-1')], sla2);
    assert.strictEqual(r.byKind[kind].items, 1, kind + ' was not counted');
    assert.strictEqual(r.totals.bowls, 1, kind + ' is missing from the item total');
    // And the curve has a column for it, or the chart draws nothing.
    const key = { pasta: 'bowls', pizza: 'pizzas', burger: 'burgers' }[kind];
    assert.ok(key, kind + ' has no curve column name');
    assert.strictEqual(r.curve.reduce((a, b) => a + (b[key] || 0), 0), 1,
      kind + ' is counted in the totals but not drawn on the curve');
  });
});

// ------------------------------------------------- manager menu edits

test("a rename reaches every screen, because they share the objects", () => {
  const c = menu.catalog();
  const before = c.toppings.find((x) => x.id === "parmesan").name;

  menu.applyMenuOverrides({ parmesan: { name: "Shaved Parmesan" } });
  // The same array every screen captured at load, not a copy of it.
  assert.strictEqual(c.toppings.find((x) => x.id === "parmesan").name, "Shaved Parmesan");
  // And everything derived from it follows without being told.
  const bowl = { pasta: "penne", sauces: ["marinara"], proteins: [], toppings: ["parmesan"], sides: [], portion: "regular" };
  assert.ok(menu.ingredientList(bowl, "en").some((r) => r.items.includes("Shaved Parmesan")));

  menu.applyMenuOverrides({});
  assert.strictEqual(c.toppings.find((x) => x.id === "parmesan").name, before,
    "clearing an override restores the real name, not the last one");
});

test("removing an item takes it off the menu and leaves old tickets alone", () => {
  const c = menu.catalog();
  menu.applyMenuOverrides({ broccoli: { retired: true } });
  assert.strictEqual(c.toppings.find((x) => x.id === "broccoli").retired, true);

  // A ticket already taken still reads correctly - the item is hidden from
  // members, not deleted from the world.
  const old = { pasta: "penne", sauces: ["marinara"], proteins: [], toppings: ["broccoli"], sides: [], portion: "regular" };
  assert.deepStrictEqual(menu.validateLine(old, config.order), []);
  assert.ok(menu.ingredientList(old, "en").some((r) => r.items.includes("Broccoli")));
  menu.applyMenuOverrides({});
});

test("a mechanic can be renamed but never removed", () => {
  const c = menu.catalog();
  // "No Sauce" is how a guest says no. Retiring it would take away the
  // answer, not the ingredient.
  assert.strictEqual(menu.isEditableItem(c.pizzaSauces.find((x) => x.id === "pz_no_sauce")), false);
  menu.applyMenuOverrides({ pz_no_sauce: { retired: true, name: "Plain" } });
  const it = c.pizzaSauces.find((x) => x.id === "pz_no_sauce");
  assert.ok(!it.retired, "the removal is refused");
  assert.strictEqual(it.name, "Plain", "the rename is not");
  menu.applyMenuOverrides({});
});

test("a group cannot be emptied", () => {
  // Retiring every cheese leaves a pizza nobody can order, and the failure
  // would surface as a guest stuck on a step with no tiles on it.
  const all = {};
  menu.catalog().pizzaCheeses.filter(menu.isEditableItem).forEach((x) => { all[x.id] = { retired: true }; });
  assert.ok(menu.overrideProblems(all).length, "saving this has to be refused");

  // One left is enough.
  const keys = Object.keys(all);
  delete all[keys[0]];
  assert.deepStrictEqual(menu.overrideProblems(all), []);
});

test("what a manager changed round-trips back out", () => {
  menu.applyMenuOverrides({ parmesan: { name: "Shaved Parmesan" }, broccoli: { retired: true } });
  assert.deepStrictEqual(menu.menuOverrides(), {
    parmesan: { name: "Shaved Parmesan" },
    broccoli: { retired: true },
  });
  menu.applyMenuOverrides({});
  assert.deepStrictEqual(menu.menuOverrides(), {}, "nothing changed means nothing saved");
});

// --------------------------------------------- reopening a finished ticket

test("a manager can reopen delivered food, with no clock on it", () => {
  const done = { ...make(), status: "delivered", deliveredAt: "2026-10-14T18:00:00.000Z" };

  // The cook's undo arrow has expired - this happened an hour ago.
  const hourLater = new Date("2026-10-14T19:00:00.000Z").getTime();
  const allowed = order.allowedActions(done, sla, hourLater);
  assert.ok(!allowed.includes("undeliver"), "the mis-tap window is long gone");
  assert.ok(allowed.includes("reopen"), "but a manager is not correcting a mis-tap");

  const back = { ...done, ...order.transitionPatch(done, "reopen", { sla, actor: "manager", now: new Date(hourLater) }) };
  assert.strictEqual(back.status, "ready", "cooked food goes back to the runner, not the pan");
  assert.strictEqual(back.deliveredAt, null);
  assert.strictEqual(back.events.at(-1).action, "reopen");
});

test("a voided ticket goes back to the queue, because it was never made", () => {
  const killed = { ...make(), status: "voided", voidedAt: "2026-10-14T18:00:00.000Z" };
  assert.strictEqual(order.reopenAction(killed), "unvoid");

  const back = { ...killed, ...order.transitionPatch(killed, "unvoid", { sla, actor: "manager" }) };
  assert.strictEqual(back.status, "queued", "the kitchen has to actually cook it");
  assert.strictEqual(back.voidedAt, null);

  // And it can be edited again, which it could not be while voided.
  assert.ok(order.editPatch(back, { guestCount: 4 }), "a reopened ticket is editable");
});

test("only finished tickets can be reopened", () => {
  ["queued", "cooking", "ready", "held"].forEach((status) => {
    const live = { ...make(), status };
    assert.strictEqual(order.isReopenable(live), false, status + " is not finished with");
    assert.strictEqual(order.reopenAction(live), null);
  });
  assert.strictEqual(order.isReopenable({ ...make(), status: "delivered" }), true);
  assert.strictEqual(order.isReopenable({ ...make(), status: "voided" }), true);
});

test("reopening is the manager's call, not the rail's", () => {
  // allowedActions still reports them, because the state machine is the one
  // answer to what is legal. The kitchen names the buttons it draws, so a
  // cook is never handed one of these.
  ["reopen", "unvoid", "void"].forEach((a) => {
    assert.ok(order.MANAGER_ACTIONS.includes(a), a + " belongs to the manager");
  });
  const rail = readFileSync(fileURLToPath(new URL("../app/kitchen.js", import.meta.url)), "utf8");
  order.MANAGER_ACTIONS.filter((a) => a !== "void").forEach((a) => {
    assert.ok(!rail.includes('data-act="' + a + '"'), a + " must not be a button on the rail");
  });
});

/**
 * The manager panel acts through one delegated listener, which matches a
 * selector and then branches on whichever attribute it found. Those were two
 * lists that had to agree, and twice did not - data-placeorder, then
 * data-reopen, each given a branch and left out of the selector. The symptom
 * is the worst kind available: a button that does nothing at all, with no
 * error, no toast and nothing to debug from.
 *
 * The selector is built from the list now. This checks the other direction,
 * that every branch names something the list carries.
 */
test('every manager button the panel handles is one it listens for', () => {
  const src = readFileSync(fileURLToPath(new URL('../app/admin.js', import.meta.url)), 'utf8');

  // Both delegated panels, held to the same rule. The menu panel grew four
  // actions when the club got an Add form, and it is the same shape of
  // mistake waiting in exactly the same place.
  [['ORDER_ACTIONS', 'ORDER_ACTION_SELECTOR'], ['MENU_ACTIONS', 'MENU_ACTION_SELECTOR']]
    .forEach(([listName, selName]) => {
      const open = src.indexOf('var ' + listName + ' = [');
      assert.ok(open > 0, listName + ' not found in admin.js');
      const close = src.indexOf('];', open);
      const list = [src.slice(open, close)];
      const names = [...list[0].matchAll(/'([a-z]+)'/g)].map((m) => m[1])
        .filter((n) => n !== listName.toLowerCase());
      assert.ok(names.length >= 4, listName + ' has ' + names.length + ' entries - scan broken');

      const from = src.indexOf(selName, src.indexOf('var ' + selName) + 1);
      assert.ok(from > 0, selName + ' is never used - the selector is not derived');
      const handler = src.slice(from);
      const branched = [...handler.matchAll(/if \(t\.dataset\.([a-z]+)\)/g)].map((m) => m[1])
        .filter((b) => b.startsWith(listName === 'MENU_ACTIONS' ? 'menu' : ''));

      [...new Set(branched)].forEach((b) => {
        if (listName === 'ORDER_ACTIONS' && b.startsWith('menu')) return;
        assert.ok(
          names.includes(b),
          b + ' is handled but not in ' + listName + ', so the button does nothing',
        );
      });
    });

  const listed = /var ORDER_ACTIONS = \[([\s\S]*?)\];/.exec(src);
  assert.ok(listed, 'ORDER_ACTIONS not found in admin.js');
  const names = [...listed[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(names.length >= 8, 'found ' + names.length + ' actions - the scan is broken');

  // Every attribute the click handler branches on, which is what makes a button
  // a button. Bounded to that one listener, and to an `if` on the attribute
  // alone: a toggle button also carries data-field and data-id as payload, and
  // the input and change handlers beside it read data-edit, none of which are
  // actions anyone clicks.
  const from = src.indexOf('ORDER_ACTION_SELECTOR', src.indexOf('var ORDER_ACTION_SELECTOR') + 1);
  const to = src.indexOf("addEventListener('input'", from);
  assert.ok(from > 0 && to > from, 'could not find the click handler');
  const handler = src.slice(from, to);
  const branched = [...handler.matchAll(/if \(t\.dataset\.([a-z]+)\)/g)].map((m) => m[1]);
  assert.ok(branched.length >= 8, 'found ' + branched.length + ' branches - scan is broken');

  assert.deepStrictEqual(
    [...new Set(branched)].filter((b) => !names.includes(b)).sort(), [],
    'handled but never listened for, so the button does nothing',
  );
});

/**
 * The club lifted the cap on toppings, and then on proteins. A lifted cap is
 * written as null, and null is a trap: `0 >= null` is true, so a bare
 * comparison refuses the very first pick. That shipped. Every protein tile on
 * the member's phone was dead, and the toast read "Up to null proteins."
 *
 * One function decides now, and this is what it has to get right.
 */
test('a lifted cap lets the first pick through, and every one after', () => {
  assert.strictEqual(menu.overCap(0, null), false, 'no cap cannot be exceeded by nothing');
  assert.strictEqual(menu.overCap(99, null), false, 'no cap cannot be exceeded at all');
  assert.strictEqual(menu.atCap(0, null), false, 'the first pick is the one that broke');
  assert.strictEqual(menu.atCap(99, null), false);
  assert.strictEqual(menu.atCap(0, undefined), false, 'a missing cap is no cap either');

  // A real cap still bites, in both directions.
  assert.strictEqual(menu.atCap(2, 3), false, 'two picked, three allowed - room for one');
  assert.strictEqual(menu.atCap(3, 3), true, 'three picked, three allowed - full');
  assert.strictEqual(menu.overCap(3, 3), false, 'three is not over three');
  assert.strictEqual(menu.overCap(4, 3), true);

  // And a cap of zero means zero, which null must not be confused with.
  assert.strictEqual(menu.atCap(0, 0), true, 'a cap of none is not the same as no cap');
});

/**
 * The validator was tested and passed; the screen was not, and the screen is
 * what the member touches. Both now ask menu.overCap()/atCap(). This holds
 * them to it, because the next cap the club lifts will land the same way.
 */
test('nothing compares a cap by hand', () => {
  const files = ['../app/guest.js', '../app/menu.js', '../app/admin.js', '../app/order.js'];
  const offences = [];

  // Not every max is a cap on what someone may pick. These are structural -
  // a loop bound and the length of a typed number - and comparing them is
  // ordinary. The assertion below is what keeps this list honest: the day one
  // of them is lifted to null it stops being structural, and this test starts
  // demanding it go through the helper like everything else.
  const STRUCTURAL = ['maxGuests', 'maxMemberNumberLength'];
  STRUCTURAL.forEach((name) => {
    assert.ok(
      config.order[name] != null,
      name + ' has no value any more, so it is a cap now - take it off the list',
    );
  });

  files.forEach((rel) => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    src.split('\n').forEach((line, i) => {
      // A relational operator immediately beside a cap, either way round. It
      // has to be adjacent: markup carries both a `<` and a cap on one line
      // (`<input max="${config.order.maxGuests}">`) and is not a comparison.
      const CAP = String.raw`[\w.]*\b(?:limits|config\.order)\.max[A-Za-z]+`;
      const beside = new RegExp(CAP + String.raw`\s*[<>]=?|[<>]=?\s*` + CAP);
      if (!beside.test(line)) return;
      if (STRUCTURAL.some((name) => line.includes(name))) return;
      offences.push(rel.replace('../', '') + ':' + (i + 1) + '  ' + line.trim());
    });
  });

  assert.deepStrictEqual(
    offences, [],
    'compare caps with menu.overCap()/menu.atCap() - a null cap means no cap, '
    + 'and a bare >= refuses the first pick',
  );
});

test('money renders a missing figure as a dash, never as zero', () => {
  assert.strictEqual(costing.money(null), '--', 'no answer is not $0.00');
  assert.strictEqual(costing.money(1.5), '$1.50');
  assert.strictEqual(costing.money(0), '$0.00');
  // A third of a cent rounded to $0.00 makes a priced pinch look unpriced.
  assert.strictEqual(costing.unitMoney(0.004), '$0.004');
  assert.strictEqual(costing.unitMoney(2.5), '$2.50');
});

test('the member directory can be looked up but not listed or written', () => {
  // The collection holds real families and the only identity a browser has is
  // anonymous, so `allow read` was the whole roster for one request from any
  // phone that loaded the page. Split: the keypad's single get stays, listing
  // and writing do not.
  const rules = rulesSource();
  const block = rules.slice(rules.indexOf('match /members/'));
  // Cut at the end of the block, not at the first brace - the path itself
  // carries one, in {memberNumber}.
  const body = block.slice(block.indexOf(String.fromCharCode(10)), block.indexOf(String.fromCharCode(10) + '    }'));

  const allow = Object.fromEntries(
    [...body.matchAll(/allow\s+(\w+)\s*:\s*if\s+([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );

  assert.deepStrictEqual(
    Object.keys(allow).sort(), ['get', 'list', 'write'],
    'members must spell out get, list and write - a bare `read` grants listing',
  );
  assert.strictEqual(allow.get, 'signedIn()', 'the guest keypad has to be able to get one member');
  assert.strictEqual(allow.list, 'false', 'listing members hands over the whole roster');
  assert.strictEqual(allow.write, 'false', 'no browser should be able to rename or delete a member');
});

test('nothing in the app writes to the member directory', () => {
  // Not belt and braces: the rules refuse it, so a writer left behind would
  // not corrupt anything - it would fail in front of a manager mid-service
  // with a permission error and no explanation. The import script is the way
  // in, and it is deliberately not loaded by any page.
  const WRITERS = /\b(setDoc|updateDoc|deleteDoc|addDoc|writeBatch)\s*\(/;
  const offences = [];

  ['../app/db.js', '../app/admin.js', '../app/seed.js', '../app/guest.js'].forEach((rel) => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (!line.includes("'members'")) return;
      if (!WRITERS.test(line)) return;
      offences.push(rel.replace('../', '') + ':' + (i + 1) + '  ' + line.trim());
    });
  });

  assert.deepStrictEqual(offences, [], 'members/ is read-only to the client');
});

test('seeding the demo leaves the member directory alone', () => {
  // The demo seeder used to replace the directory and prune anything not in
  // its list of 30 invented families. With the real roster loaded that was one
  // tap from deleting all 736. It can go entirely, because a demo chit already
  // carries the member number and name it needs.
  const admin = readFileSync(fileURLToPath(new URL('../app/admin.js', import.meta.url)), 'utf8');
  const btn = admin.slice(admin.indexOf("getElementById('seedBtn')"));
  const handler = btn.slice(0, btn.indexOf('});'));

  assert.ok(!/seedMembers|MEMBERS/.test(handler), 'the demo button touches the directory again');
  assert.ok(handler.includes('seedOrders('), 'the demo button should still write demo chits');

  // And what makes that safe: every demo chit names its own member.
  const drafted = seed.buildDemoOrders();
  assert.ok(drafted.length > 0, 'no demo orders built');
  drafted.forEach((o) => {
    // One chit is deliberately nameless: member 7890 is the guest who typed a
    // number the directory does not hold, and the app lets them eat anyway.
    // The rail falls back to "Member 7890". Everyone else must carry a name,
    // or they would read as unverified on the pass when they are not.
    assert.ok(o.memberName || o.memberStatus === 'unverified',
      'chit ' + o.ticketNo + ' has no name and is not flagged unverified');
  });
});

test('no demo chit puts an invented surname on a real member number', () => {
  // A demo chit carries its own member number and name. If one of those numbers
  // belonged to a real family, the rail would show their account against a name
  // that is not theirs - and in close-out, against a bill they did not run up.
  // The demo numbers are all above the roster's range today; this is what keeps
  // that true when the club sends a longer roster.
  if (!existsSync(fileURLToPath(new URL('../private/members.csv', import.meta.url)))) return;
  const real = new Map(roster.load().members.map((m) => [m.memberNumber, m]));

  const offences = [];
  seed.buildDemoOrders().forEach((o) => {
    const hit = real.get(o.memberNumber);
    if (!hit) return;
    offences.push('chit ' + o.ticketNo + ' calls member ' + o.memberNumber
      + ' "' + (o.memberName || '(unverified)') + '", but that is the ' + hit.name + ' family');
  });

  assert.deepStrictEqual(offences, [], 'pick demo numbers the roster does not use');
});

// ------------------------------------------------- the declared party size

/** An order as the guest app now builds one, with the night's party size on it. */
function trip(opts) {
  return order.buildOrder({
    memberNumber: opts.member || '1794',
    memberName: 'Compofelice',
    memberStatus: 'verified',
    guestCount: opts.guests,
    partySize: opts.party,
    lines: Array.from({ length: opts.guests }, (_, i) => ({
      guestLabel: 'G' + i, pasta: 'penne', sauces: ['marinara'],
      proteins: [], toppings: [], sides: [], portion: 'regular', spice: 'mild',
    })),
  }, {
    ticketNo: opts.ticket || 1,
    station: 'pasta-1',
    queueDepth: 1,
    tag: opts.tag ? { id: opts.tag, label: opts.tag, kind: 'table' } : null,
    serviceDate: '2026-11-05',
    now: new Date('2026-11-05T18:00:00Z'),
  });
}

test('the charge comes from the declared party, not the biggest order', () => {
  // S2a: one person orders for themselves, another for the other three, on one
  // membership. The old rule billed max(1, 3) = 3 for a table of four.
  const a = trip({ guests: 1, party: 4, ticket: 1 });
  const b = trip({ guests: 3, party: 4, ticket: 2 });
  b.submittedAt = '2026-11-05T18:06:00.000Z';

  assert.strictEqual(order.billableCovers([a, b]), 4, 'four people ate, four charges');
  const m = order.memberRollup([a, b])[0];
  assert.strictEqual(m.partySize, 4);
  assert.strictEqual(m.chargeBasis, 'declared');
  assert.strictEqual(m.items, 4, 'still four plates');
});

test('two memberships at one table each bill only their own people', () => {
  // S4: the overcharge. Both entered 4 on the order - the table - because the
  // kitchen is making four plates between them. Each DECLARED 2, their own
  // people, because that question is worded about the account. Billing the
  // head count gives 8 for a table of four; billing the declaration gives 4.
  const a = trip({ member: '1794', guests: 4, party: 2, tag: 'table-03', ticket: 1 });
  const b = trip({ member: '1276', guests: 4, party: 2, tag: 'table-03', ticket: 2 });
  assert.strictEqual(order.billableCovers([a, b]), 4, 'four people, not eight');
  assert.notStrictEqual(order.billableCovers([a, b]), 8, 'the head count must not bill');
});

test('a corrected party size wins over the one it corrected', () => {
  // The change link. A later trip carries the new answer, and later means later
  // by the clock, not by the order the array happens to be in.
  const first = trip({ guests: 2, party: 2, ticket: 1 });
  const fixed = trip({ guests: 2, party: 5, ticket: 2 });
  fixed.submittedAt = '2026-11-05T18:30:00.000Z';

  assert.strictEqual(order.billableCovers([first, fixed]), 5, 'the correction stands');
  assert.strictEqual(order.billableCovers([fixed, first]), 5, 'and not just in array order');

  // Corrections go down as well as up - a party of 5 that turns out to be 3.
  const down = trip({ guests: 2, party: 3, ticket: 3 });
  down.submittedAt = '2026-11-05T19:00:00.000Z';
  assert.strictEqual(order.billableCovers([first, fixed, down]), 3,
    'the latest answer bills, even when it is smaller');
});

test('a night from before partySize existed still rolls up', () => {
  // Orders already in Firestore have no partySize. They must not bill zero.
  const a = trip({ guests: 4, ticket: 1 });
  const b = trip({ guests: 2, ticket: 2 });
  assert.strictEqual(a.partySize, null, 'absent, not invented');
  assert.strictEqual(order.billableCovers([a, b]), 4, 'falls back to the old rule');
  assert.strictEqual(order.memberRollup([a, b])[0].chargeBasis, 'legacy-headcount',
    'and says which rule it used');
});

test('close-out spots two memberships sharing one table', () => {
  // The net under the wording change. Overlapping windows are one seating.
  const a = trip({ member: '1794', guests: 2, party: 2, tag: 'table-03', ticket: 1 });
  a.submittedAt = '2026-11-05T18:10:00.000Z';
  a.deliveredAt = '2026-11-05T18:40:00.000Z';
  const b = trip({ member: '1276', guests: 2, party: 2, tag: 'table-03', ticket: 2 });
  b.submittedAt = '2026-11-05T18:25:00.000Z';
  b.deliveredAt = '2026-11-05T18:55:00.000Z';

  const flagged = order.overlappingParties([a, b]);
  assert.strictEqual(flagged.length, 1, 'one table to look at');
  assert.deepStrictEqual(flagged[0].members.map((m) => m.memberNumber).sort(),
    ['1276', '1794']);
});

test('a table that turned over is not mistaken for a shared one', () => {
  // The question Anthony asked: nothing records a seating, so the only evidence
  // is the windows. These do not overlap - the second party sat down after the
  // first had eaten and gone.
  const early = trip({ member: '1794', guests: 2, party: 2, tag: 'table-03', ticket: 1 });
  early.submittedAt = '2026-11-05T18:10:00.000Z';
  early.deliveredAt = '2026-11-05T18:40:00.000Z';
  const late = trip({ member: '1276', guests: 2, party: 2, tag: 'table-03', ticket: 2 });
  late.submittedAt = '2026-11-05T20:30:00.000Z';
  late.deliveredAt = '2026-11-05T21:00:00.000Z';

  assert.deepStrictEqual(order.overlappingParties([early, late]), [],
    'a turned table is not a shared one');

  // One membership alone at a table is never a clash, however many trips.
  const again = trip({ member: '1794', guests: 2, party: 2, tag: 'table-03', ticket: 3 });
  again.submittedAt = '2026-11-05T18:20:00.000Z';
  assert.deepStrictEqual(order.overlappingParties([early, again]), []);

  // And a voided order cannot put a membership at a table it never used.
  const voided = trip({ member: '1276', guests: 2, party: 2, tag: 'table-03', ticket: 4 });
  voided.submittedAt = '2026-11-05T18:15:00.000Z';
  voided.status = order.STATUS.VOIDED;
  assert.deepStrictEqual(order.overlappingParties([early, voided]), []);
});

test('a closed kitchen is refused by the rules, not just by the screen', () => {
  // The guest screen blocks Send, but a phone that had the page open when the
  // kitchen closed would still have a working button. The rules are what make
  // "closed" mean closed.
  const rules = rulesSource();
  const create = rules.slice(rules.indexOf('allow create: if signedIn()'));
  const line = create.slice(0, create.indexOf(';'));
  assert.ok(line.includes('kitchenOpen()'),
    'order create must check the kitchen is open');

  const fn = rules.slice(rules.indexOf('function kitchenOpen()'));
  const body = fn.slice(0, fn.indexOf('\n      }'));
  assert.ok(body.includes('config/service'), 'it reads the service document');
  assert.ok(body.includes('svc.open == true'), 'it requires open');
  assert.ok(
    body.includes("svc.openFor == request.resource.data.serviceDate"),
    'it must match the flag against THIS order\'s service date, or last '
    + 'Thursday\'s "open" admits tonight\'s orders',
  );
});

test('the kitchen closes itself when the service date rolls', () => {
  // Nobody has to remember to close up. The stamp is what expires, so the
  // reading of it is the thing that has to compare dates.
  const src = readFileSync(fileURLToPath(new URL('../app/db.js', import.meta.url)), 'utf8');
  const fn = src.slice(src.indexOf('export function watchServiceOpen'));
  const body = fn.slice(0, fn.indexOf('\n}'));

  assert.ok(body.includes('data.openFor === serviceDate()'),
    'an open stamped for another date must not read as open');
  assert.ok(body.includes('cb(false)'),
    'an unreachable service document must read as closed, not open');

  // And closing must clear the stamp rather than leave a stale one behind.
  const setter = src.slice(src.indexOf('export async function setServiceOpen'));
  assert.ok(setter.slice(0, setter.indexOf('\n}')).includes('openFor: open === true ? serviceDate() : null'),
    'closing must clear openFor');
});

test('the guest screen will not send into a closed kitchen', () => {
  const src = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');
  const send = src.slice(src.indexOf('send: async function ()'));
  const head = send.slice(0, send.indexOf('db.submitOrder'));
  assert.ok(/if \(!state\.kitchenOpen\)/.test(head),
    'Send must check before it builds an order');
  assert.ok(src.includes('db.watchServiceOpen('),
    'and the screen must follow the switch rather than read it once');
});

test('both rails say when members cannot order', () => {
  // A quiet rail and a closed kitchen look identical from the pass.
  ['../app/kitchen.js', '../app/expo.js'].forEach((rel) => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    assert.ok(src.includes('watchServiceOpen'), rel + ' does not watch the switch');
    assert.ok(src.includes('closedFlag'), rel + ' has nowhere to show it');
  });
  ['../kitchen.html', '../expo.html'].forEach((rel) => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    assert.ok(src.includes('id="closedFlag"'), rel + ' is missing the flag');
  });
});

test('close-out shows tables two memberships shared', () => {
  const src = readFileSync(fileURLToPath(new URL('../app/report.js', import.meta.url)), 'utf8');
  assert.ok(src.includes('sharedTablesPanel('), 'no panel on the close-out screen');
  assert.ok(src.includes('TABLES SHARED BY TWO MEMBERSHIPS'),
    'the CSV export must carry it too - a figure only on screen is not a record');
});

// ------------------------------------------------- staff, and what it gates

/** Every `allow` inside one match block, as {verb: condition}. */
function allowsFor(rules, path) {
  const at = rules.indexOf('match /' + path);
  assert.ok(at > -1, 'no match block for ' + path);
  const block = rules.slice(at);
  const body = block.slice(0, block.indexOf('\n    }'));
  const out = {};
  [...body.matchAll(/allow\s+([\w,\s]+?)\s*:\s*if\s+([\s\S]*?);/g)].forEach((m) => {
    m[1].split(',').forEach((verb) => { out[verb.trim()] = m[2].replace(/\s+/g, ' ').trim(); });
  });
  return out;
}

test('only a signed-in staff device can read the whole service', () => {
  // The exposure this closes: every visitor is signed in, because the guest
  // app signs itself in anonymously, so `signedIn()` never told a phone at a
  // table apart from the kitchen rail. Listing orders is the whole night -
  // member numbers, names, what they ate, where they sat.
  const a = allowsFor(rulesSource(), 'orders/{orderId}');

  assert.ok(/staff\(\)/.test(a.list), 'orders may be listed without being staff');
  assert.ok(/staff\(\)/.test(a.update), 'a guest can advance someone else\'s ticket');
  assert.ok(/staff\(\)/.test(a.delete), 'a guest can delete orders');

  // A guest must still place one, and still watch the one they placed.
  assert.ok(/signedIn\(\)/.test(a.create) && !/staff\(\)/.test(a.create),
    'a guest can no longer order');
  assert.ok(/signedIn\(\)/.test(a.get), 'a guest can no longer track their ticket');
});

test('a guest cannot rewrite the menu or the 86 list', () => {
  const a = allowsFor(rulesSource(), 'config/{docId}');
  assert.ok(/staff\(\)/.test(a.write),
    'config is writable without being staff - a guest could 86 the building');
  assert.ok(/signedIn\(\)/.test(a.read) && !/staff\(\)/.test(a.read),
    'guests need to read the menu');
});

test('a guest can take the next ticket number but not move it back', () => {
  // Left open, a guest could reset the counter and collide every ticket after
  // it. The order path needs to move it, so the bound is the shape of the move.
  const a = allowsFor(rulesSource(), 'counters/{serviceDate}');
  assert.ok(/lastTicket == resource.data.lastTicket \+ 1/.test(a.update),
    'the counter can be moved by something other than one step forward');
  assert.ok(/staff\(\)/.test(a.update), 'a reset to zero must still be possible for staff');
});

test('the staff list is not readable as a list, or writable at all', () => {
  const a = allowsFor(rulesSource(), 'staff/{uid}');
  assert.strictEqual(a.list, 'false', 'the staff roll can be enumerated');
  assert.strictEqual(a.write, 'false',
    'a browser can add itself to staff - rows are added with admin credentials');
  assert.ok(/request.auth.uid == uid/.test(a.get),
    'a device may check its own row and no one else\'s');
});

test('staff() asks the database, not the browser', () => {
  const rules = rulesSource();
  const fn = rules.slice(rules.indexOf('function staff()'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  assert.ok(/exists\(/.test(body) && /documents\/staff\//.test(body),
    'staff() must be decided by a document, not by anything a client sends');
  assert.ok(!/[Pp]asscode/.test(body), 'staff() must not rest on a shipped code');
});

test('every staff screen proves the device before it asks for anything', () => {
  // Without the proof the rules hand the screen nothing, and it sits empty
  // with no clue why - which is worse than being asked to sign in.
  ['kitchen.js', 'expo.js', 'admin.js', 'report.js'].forEach((f) => {
    const src = readFileSync(fileURLToPath(new URL('../app/' + f, import.meta.url)), 'utf8');
    assert.ok(/await requireStaffDevice\(db\)/.test(src), f + ' does not prove the device');
  });
  // And the guest screen must NOT - a member is not staff.
  const guest = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');
  assert.ok(!/requireStaffDevice/.test(guest), 'the guest screen asks members to sign in');
});

test('a phone at a table never lists the service to get a wait time', () => {
  // The queue depth used to be counted by listing every order in the room.
  const guest = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');
  assert.ok(!/db\.getDay\(/.test(guest), 'the guest screen still lists orders');
  assert.ok(/db\.readQueueDepth\(/.test(guest), 'and has nothing to quote instead');

  const rail = readFileSync(fileURLToPath(new URL('../app/kitchen.js', import.meta.url)), 'utf8');
  assert.ok(/db\.publishQueueDepth\(/.test(rail), 'nothing publishes the depth');
});

test('a device can be handed back without touching the shared account', () => {
  // Every iPad shares one staff account, so there is no per-device row to
  // delete when one is retired. Signing the device out is the case that comes
  // up - a tablet repurposed, or going back to the office.
  const html = readFileSync(fileURLToPath(new URL('../admin.html', import.meta.url)), 'utf8');
  assert.ok(html.includes('id="signOutBtn"'), 'no way to hand a device back');

  const admin = readFileSync(fileURLToPath(new URL('../app/admin.js', import.meta.url)), 'utf8');
  const handler = admin.slice(admin.indexOf("getElementById('signOutBtn')"));
  const body = handler.slice(0, handler.indexOf('});'));
  assert.ok(/db\.signOutStaff\(/.test(body), 'the button does not sign anything out');
  assert.ok(/window\.confirm\(/.test(body),
    'signing a wall-mounted rail out by a stray tap is worse than the tap it saves');

  // And signing out must land back on anonymous, or the device cannot even
  // read the menu to tell someone what went wrong.
  const db = readFileSync(fileURLToPath(new URL('../app/db.js', import.meta.url)), 'utf8');
  const fn = db.slice(db.indexOf('export async function signOutStaff'));
  assert.ok(/signInAnonymously/.test(fn.slice(0, fn.indexOf('\n}'))),
    'signOutStaff leaves the device with no identity at all');
});

test('a closed kitchen says so on the first screen, not the last', () => {
  // Meeting the refusal at Send means four bowls built for nothing. The rules
  // refuse it either way; this is about not wasting somebody's evening.
  const src = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');

  const screen = src.slice(src.indexOf('function screenMember()'));
  const body = screen.slice(0, screen.indexOf('\n  function '));
  assert.ok(/state\.kitchenOpen/.test(body),
    'the member-number screen says nothing about the kitchen being shut');
  assert.ok(/guest\.closed\.title/.test(body), 'and has no words to say it with');

  // And the keypad must not carry on into a flow that ends in a refusal.
  const submit = src.slice(src.indexOf('submitMember: async function ()'));
  const head = submit.slice(0, submit.indexOf('db.lookupMember'));
  assert.ok(/if \(!state\.kitchenOpen\)/.test(head),
    'the keypad still advances while the kitchen is closed');

  // Both languages, or a Spanish-speaking member gets a blank banner.
  ['guest.closed.title', 'guest.closed.sub'].forEach((k) => {
    assert.ok(STRINGS.en[k], k + ' has no English');
    assert.ok(STRINGS.es[k], k + ' has no Spanish');
  });
});

// ------------------------------------------------------- the split bowl

test('a bowl can be split between shapes, and still be one bowl', () => {
  const split = { kind: 'pasta', pastas: ['penne', 'rigatoni'], sauces: ['marinara'],
    proteins: [], toppings: [], sides: [], portion: 'regular', spice: 'mild' };
  const built = order.buildLine({ ...split, guestLabel: 'Ada' }, 0, 'pasta');

  assert.deepStrictEqual(built.pastas, ['penne', 'rigatoni']);
  // One line is one plate is one person. Splitting must not quietly make two.
  assert.strictEqual(built.lineId, 'ln01');
  assert.ok(built.dish.includes('Penne + Rigatoni'), 'the chit must name both: ' + built.dish);
});

test('a split bowl boils to the slowest shape in it', () => {
  // One pan. Half a portion of the slow shape still needs the slow time, so
  // averaging the two would send it to the pass raw.
  const one = (ids) => ({ kind: 'pasta', pastas: ids, sauces: ['marinara'],
    proteins: [], toppings: [], sides: [], portion: 'regular' });

  const shapes = ['fettuccine', 'penne', 'rigatoni'].map((id) => menu.find('pastas', id));
  const slowest = Math.max(...shapes.map((x) => x.boilSec));
  const fastest = Math.min(...shapes.map((x) => x.boilSec));
  assert.notStrictEqual(slowest, fastest, 'fixture needs shapes that differ');

  const slowId = shapes.find((x) => x.boilSec === slowest).id;
  const fastId = shapes.find((x) => x.boilSec === fastest).id;

  assert.strictEqual(
    cooktime.lineCookSec(one([fastId, slowId])),
    cooktime.lineCookSec(one([slowId])),
    'a split bowl must take the slower shape, not the one picked first',
  );
  assert.ok(
    cooktime.lineCookSec(one([fastId, slowId])) > cooktime.lineCookSec(one([fastId])),
    'and more than the fast shape alone',
  );
});

test('splitting a bowl costs one bowl, not two', () => {
  // Half and half. If each shape were added at a full portion the cost per
  // cover would climb every time somebody could not decide.
  const costs = { penne: { price: 4, yield: 10 }, rigatoni: { price: 6, yield: 10 },
    marinara: { price: 0, yield: 1 } };
  const base = { kind: 'pasta', sauces: ['marinara'], proteins: [], toppings: [],
    sides: [], portion: 'regular' };

  const whole = costing.lineCost({ ...base, pastas: ['penne'] }, costs);
  const split = costing.lineCost({ ...base, pastas: ['penne', 'rigatoni'] }, costs);

  // penne alone = 0.40; half penne + half rigatoni = 0.20 + 0.30 = 0.50.
  assert.ok(Math.abs(whole.total - 0.40) < 0.001, 'whole bowl ' + whole.total);
  assert.ok(Math.abs(split.total - 0.50) < 0.001, 'split bowl ' + split.total);
  assert.ok(split.total < 0.40 + 0.60, 'a split must not cost two whole bowls');
});

test('a gluten-free shape beside a wheat one is not a gluten-free bowl', () => {
  const mixed = { kind: 'pasta', pastas: ['penne', 'fusilli_gf'], sauces: [],
    proteins: [], toppings: [], sides: [] };
  assert.ok(menu.allergensFor(mixed).includes('gluten'),
    'the bowl must carry gluten - it has wheat pasta in it');

  // And with the gluten-free shape picked FIRST, which is the order that
  // matters: anything reading only shape [0] would call this bowl safe.
  const gfFirst = { ...mixed, pastas: ['fusilli_gf', 'penne'] };
  assert.ok(menu.allergensFor(gfFirst).includes('gluten'),
    'a wheat shape behind a gluten-free one still puts gluten in the bowl');

  const clash = menu.glutenClash(mixed);
  assert.ok(clash, 'nothing warns the guest while they are choosing');
  assert.deepStrictEqual(clash.free, ['Gluten-Free Fusilli']);
  assert.deepStrictEqual(clash.wheat, ['Penne']);

  // And no false alarms either way round.
  assert.strictEqual(menu.glutenClash({ kind: 'pasta', pastas: ['fusilli_gf'] }), null);
  assert.strictEqual(menu.glutenClash({ kind: 'pasta', pastas: ['penne', 'shells'] }), null);

  const guest = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');
  assert.ok(guest.includes('glutenClash(bowl)'), 'the shape step does not check');
  ['guest.pasta.glutenmix'].forEach((k) => {
    assert.ok(STRINGS.en[k] && STRINGS.es[k], k + ' is missing a language');
  });
});

test('a bowl written before shapes were a list still reads', () => {
  // Orders already in Firestore carry `pasta`, not `pastas`.
  const old = { kind: 'pasta', pasta: 'shells', sauces: ['marinara'], proteins: [],
    toppings: [], sides: [], portion: 'regular' };
  assert.deepStrictEqual(menu.pastasOf(old), ['shells'], 'the old field must still be read');
  assert.ok(/Shells/.test(menu.describe(old)), 'and still name the dish: ' + menu.describe(old));
  assert.ok(cooktime.lineCookSec(old) > 0, 'and still have a cook time');
  assert.deepStrictEqual(menu.pastasOf({ kind: 'pasta' }), [], 'an empty bowl is an empty list');
});

test('signing in as a guest never overwrites a staff session', () => {
  // The bug this pins: ready() called signInAnonymously() unconditionally on
  // load, so a staff device was signed out of its own account on every page
  // load and every tap between screens. It looked like "sign-in does not
  // stick"; it was the app signing itself out.
  const src = readFileSync(fileURLToPath(new URL('../app/db.js', import.meta.url)), 'utf8');
  const fn = src.slice(src.indexOf('export function ready()'));
  const body = fn.slice(0, fn.indexOf('\n  return readyPromise;'));

  // Every path to anonymous must go through the guard, not straight to the
  // SDK. Comment lines are stripped first: the one above the guard names the
  // function it exists to contain.
  const code = body.split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith('//')).join(String.fromCharCode(10));
  const calls = (code.match(new RegExp('signInAnonymously\\(', 'g')) || []).length;
  assert.strictEqual(calls, 1,
    'ready() calls signInAnonymously ' + calls + ' times - it must have exactly '
    + 'one guarded path, or a restored session gets replaced');
  assert.ok(/becameGuest/.test(body), 'the guard is gone');
  assert.ok(/if \(user\) finish\(resolve, user\); else becomeGuest\(\);/.test(body),
    'a restored user must settle it before anything signs in as a guest');

  // And the fallback has to wait long enough for a restore to land, while
  // still beating the timeout that rejects the whole thing.
  const grace = Number((src.match(/RESTORE_GRACE_MS = (\d+)/) || [])[1]);
  const timeout = Number((src.match(/AUTH_TIMEOUT_MS = (\d+)/) || [])[1]);
  assert.ok(grace > 0, 'no restore grace');
  assert.ok(grace < timeout,
    'the guest fallback (' + grace + 'ms) must fire before the auth timeout ('
    + timeout + 'ms), or a device with no session to restore never signs in');
});

test('a private party bills for everyone, not for one ticket', () => {
  // S6: fourteen on one membership. An order carries twelve plates at most,
  // so the party used to be billed as twelve - the cap meant for the pass
  // was deciding the bill.
  assert.ok(config.order.maxPartySize > config.order.maxGuests,
    'the party cap must be its own number, or this is the same bug');

  const trip = (plates, party, ticket) => order.buildOrder({
    memberNumber: '1794', memberName: 'Compofelice', memberStatus: 'verified',
    guestCount: plates, partySize: party,
    lines: Array.from({ length: plates }, (_, i) => ({
      guestLabel: 'G' + i, pasta: 'penne', sauces: ['marinara'],
      proteins: [], toppings: [], sides: [], portion: 'regular', spice: 'mild',
    })),
  }, { ticketNo: ticket, station: 'pasta-1', queueDepth: 1, tag: null,
    serviceDate: '2026-11-05', now: new Date('2026-11-05T18:00:00Z') });

  // Fourteen people, served as two tickets of seven, on one account.
  const a = trip(7, 14, 1);
  const b = trip(7, 14, 2);
  b.submittedAt = '2026-11-05T18:08:00.000Z';

  assert.strictEqual(order.billableCovers([a, b]), 14, 'fourteen people, fourteen charges');
  assert.strictEqual(order.memberRollup([a, b])[0].items, 14, 'and fourteen plates');
});

test('the party cap bounds the party, and the plate cap bounds the ticket', () => {
  // Two limits that mean different things. Letting the billing one drift up
  // to the kitchen one is how the bug happened; letting the kitchen one drift
  // up to the billing one would put 60 plates on a single chit.
  const draft = {
    memberNumber: '1794', guestCount: 2, partySize: 14,
    lines: [
      { guestLabel: 'A', pasta: 'penne', sauces: ['marinara'], proteins: [], toppings: [], sides: [], portion: 'regular' },
      { guestLabel: 'B', pasta: 'penne', sauces: ['marinara'], proteins: [], toppings: [], sides: [], portion: 'regular' },
    ],
  };
  assert.deepStrictEqual(order.validateDraft(draft, config, []), [],
    'a party larger than one ticket must be allowed');

  const tooBig = order.validateDraft(
    { ...draft, partySize: config.order.maxPartySize + 1 }, config, [],
  );
  assert.ok(tooBig.some((e) => /party is 1 to/i.test(e)),
    'a party beyond the cap must be refused: ' + JSON.stringify(tooBig));

  // And the plate cap is untouched by any of this.
  const tooManyPlates = order.validateDraft(
    { ...draft, guestCount: config.order.maxGuests + 1 }, config, [],
  );
  assert.ok(tooManyPlates.length > 0, 'the per-order plate cap must still bite');
});

test('a party bigger than a ticket has somewhere to be typed', () => {
  // Raising the cap achieves nothing if the tiles stop at twelve and there is
  // no other way in.
  const src = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');
  assert.ok(/maxPartySize: config\.order\.maxPartySize/.test(src),
    'the screen is never told the party cap');
  assert.ok(src.includes('id="bigParty"'), 'there is no control for a large party');
  assert.ok(src.includes('setBigParty: function (el) {'), 'and nothing handles it');

  const handler = src.slice(src.indexOf('setBigParty: function (el) {'));
  const body = handler.slice(0, handler.indexOf('\n    },'));
  assert.ok(/maxPartySize/.test(body), 'the box is not bounded by the party cap');
  assert.ok(/Math\.min\(state\.guestCount, state\.boot\.limits\.maxGuests\)/.test(body),
    'a large party must not put more plates on one ticket than the pass can build');

  ['guest.party.big.title', 'guest.party.big.sub', 'guest.party.big.hint'].forEach((k) => {
    assert.ok(STRINGS.en[k] && STRINGS.es[k], k + ' is missing a language');
  });
});

test('the member roster never reaches git or the web', () => {
  // private/ holds 700-odd real families and their account numbers. Two
  // separate mechanisms keep it out: .gitignore, and the hosting ignore list -
  // a different list that Firebase reads on its own, so .gitignore alone would
  // still have published it at /private/members.csv on the next deploy.
  const root = (rel) => fileURLToPath(new URL(rel, import.meta.url));

  const tracked = execFileSync('git', ['ls-files', '--', 'private'], {
    cwd: root('../'), encoding: 'utf8',
  }).trim();
  assert.strictEqual(
    tracked, '',
    'the roster is tracked by git and this repo is public: ' + tracked,
  );

  const hosting = JSON.parse(readFileSync(root('../firebase.json'), 'utf8')).hosting;
  assert.ok(hosting.length >= 1, 'no hosting targets to check');
  hosting.forEach((target) => {
    assert.ok(
      target.ignore.includes('private/**'),
      'hosting target ' + target.site + ' would upload private/ - its root is "'
      + target.public + '"',
    );
  });
});

test('the roster reader agrees with the keypad about what a number means', () => {
  // The roster stores "0001"; the guest types whatever they like. If these two
  // ever normalised differently, every padded number on the roster would
  // resolve to nobody - so the reader imports the keypad's own function rather
  // than keeping a copy of the rule.
  const src = readFileSync(fileURLToPath(new URL('../scripts/roster.js', import.meta.url)), 'utf8');
  assert.ok(
    src.includes('order.normalizeMemberNumber('),
    'scripts/roster.js must normalise through app/order.js, not its own copy',
  );

  // The roster itself is deliberately absent from a fresh clone.
  if (!existsSync(fileURLToPath(new URL('../private/members.csv', import.meta.url)))) return;
  const { members } = roster.load();
  assert.ok(members.length > 0, 'the roster loaded empty');
  members.forEach((m) => {
    assert.strictEqual(
      m.memberNumber, order.normalizeMemberNumber(m.raw),
      'member on line ' + m.line + ' normalises differently from the keypad',
    );
    assert.ok(
      config.order.memberNumberPattern.test(m.memberNumber),
      'member ' + m.memberNumber + ' would be refused by the app',
    );
  });
});


// ------------------------------------------- the table a server types in

test('a typed table number resolves to exactly one tent', () => {
  const ids = (q) => cfgTags.findTags(q).map((t) => t.id);

  assert.deepStrictEqual(ids('12'), ['table-12'],
    'the room has one Table 12 and nothing else called 12');

  // The reason the box offers chips instead of taking the first match: a
  // server who types 3 has told us two different places, on two sides of
  // the building, and only they know which.
  assert.deepStrictEqual(ids('3'), ['table-03', 'patio-03']);

  // A bare number means the table NUMBERED that. Were it a substring match,
  // 1 would offer Table 1 and Tables 10 through 19, and the one tent the
  // server meant would be the hardest to find on the screen.
  assert.deepStrictEqual(ids('1'), ['table-01', 'patio-01']);

  // Names, with our punctuation and spacing not the server's problem.
  assert.deepStrictEqual(ids('patio 3'), ['patio-03']);
  assert.deepStrictEqual(ids('patio3'), ['patio-03']);
  assert.deepStrictEqual(ids('PATIO-03'), ['patio-03']);
  assert.deepStrictEqual(ids('takeout'), ['takeout']);

  // Nothing typed is not a match for everything.
  assert.deepStrictEqual(ids(''), []);
  assert.deepStrictEqual(ids('   '), []);
  assert.deepStrictEqual(ids(null), []);
  assert.deepStrictEqual(ids('!!!'), []);
  assert.deepStrictEqual(ids('99'), [], 'there is no Table 99 to send food to');
  assert.deepStrictEqual(ids('zzz'), []);
});

test('an ambiguous table is refused, not guessed at', () => {
  // The whole reason the box shows chips. "3" is Table 3 in the dining room
  // and Patio 3 outside, and only the server holding the tablet knows which
  // one they are standing at. Taking the first match would read as helpful
  // and would walk the patio's dinner indoors, with nothing anywhere saying
  // it had happened - the kitchen would print a correct-looking chit.
  assert.strictEqual(cfgTags.resolveTag('3'), null, '3 is two places, not one');
  assert.strictEqual(cfgTags.resolveTag('12').id, 'table-12');
  assert.strictEqual(cfgTags.resolveTag('patio 3').id, 'patio-03');
  assert.strictEqual(cfgTags.resolveTag(''), null);
  assert.strictEqual(cfgTags.resolveTag('99'), null, 'no table, so no table');
});

test('a location a manager added is typeable too', () => {
  cfgTags.setCustomTags([
    { id: 'locker-room', label: 'Locker Room', kind: 'table', area: 'Clubhouse' },
  ]);
  try {
    assert.deepStrictEqual(cfgTags.findTags('locker').map((t) => t.id), ['locker-room'],
      'a code the club added on Thursday is a place a server can type on Friday');
  } finally {
    cfgTags.setCustomTags([]);
  }
  assert.deepStrictEqual(cfgTags.findTags('locker'), [],
    'and stops being one when the manager removes it');
});

test('a tablet with no QR code asks which table before it asks anything else', () => {
  const src = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');

  // The box itself, on the first screen - not discovered at Send, which is
  // where a table nobody checked turns into a tray nobody can deliver.
  assert.ok(/function screenWhere\(\)/.test(src), 'there is no table box');
  assert.ok(src.includes("data-act=\"tagQuery\""), 'the box takes nothing typed into it');
  assert.ok(src.includes("data-act=\"pickTag\""), 'and offers no way to choose between matches');

  // Where before who: a member lookup costs a round trip, and an order with
  // nowhere to go should not spend one.
  const submit = src.slice(src.indexOf('submitMember: async function ()'));
  const head = submit.slice(0, submit.indexOf('db.lookupMember'));
  assert.ok(/resolveTypedTag\(\)/.test(head),
    'the keypad advances without ever settling the table');

  // Next must not light up on a member number alone.
  const bar = src.slice(src.indexOf("} else if (s === 'member') {"));
  const clause = bar.slice(0, bar.indexOf("} else if (s === 'guests')"));
  assert.ok(/state\.boot\.tag/.test(clause) && /resolveTag\(/.test(clause),
    'the footbar would send an order that has nowhere to be carried');

  // resolveTag refuses an ambiguous query by returning null, and that refusal
  // only holds if the screen takes no for an answer. This is a shape check,
  // not a behaviour one: the mistake it is watching for is the screen
  // reaching past the refusal into the match list for a first-best guess.
  const resolver = src.slice(src.indexOf('function resolveTypedTag()'));
  const rbody = resolver.slice(0, resolver.indexOf('\n  }'));
  assert.ok(/resolveTag\(/.test(rbody),
    'the screen keeps its own idea of which table a query means');
  assert.ok(!/\[0\]/.test(rbody),
    'the screen indexes into the matches - which is the guess resolveTag exists to refuse');

  // Both languages, or a Spanish-speaking server gets an unlabelled box.
  ['guest.where.ask', 'guest.where.ph', 'guest.where.pick', 'guest.where.none',
    'guest.sent.newTable'].forEach((k) => {
    assert.ok(STRINGS.en[k], k + ' has no English');
    assert.ok(STRINGS.es[k], k + ' has no Spanish');
  });
});

test('typing a table number does not also type a member number', () => {
  // The member screen listens on the document for digits, because the keypad
  // is drawn as buttons and a tablet may have a real keyboard. Adding a text
  // field to that screen put the two in the same ear: typing 12 for the table
  // made the membership 12 as well, silently, on every order of the night.
  const src = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');
  const handler = src.slice(src.indexOf("document.addEventListener('keydown'"));
  const body = handler.slice(0, handler.indexOf('\n  });'));

  const guard = body.indexOf("tagName === 'INPUT'");
  const keypad = body.indexOf('state.memberDigits +=');
  assert.ok(guard !== -1, 'the keypad listener does not check what is focused');
  assert.ok(guard < keypad, 'it checks too late to stop the digit');
});

test('the next table starts clean, and the last one is not billed for it', () => {
  const src = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');
  const act = src.slice(src.indexOf('newTable: function ()'));
  const body = act.slice(0, act.indexOf('\n    },'));

  // Everything that identifies the party that just ate. partySize is the one
  // that costs money: inherited onto the next membership, it bills a four-top
  // for a party of twelve.
  ['state.boot.tag = null', "state.tagQuery = ''", "state.memberDigits = ''",
    'state.member = null', 'state.partySize = null', 'state.partyInherited = false',
  ].forEach((line) => {
    assert.ok(body.includes(line), 'newTable leaves behind: ' + line);
  });

  // And it is reachable - on a roaming tablet only, because a member's phone
  // sitting at Table 7 has no next table to go to.
  assert.ok(src.includes("data-act=\"newTable\""), 'nothing on screen calls it');
  const bar = src.slice(src.indexOf("} else if (s === 'sent') {"));
  assert.ok(/state\.boot\.roaming/.test(bar.slice(0, 900)),
    'the button shows on a phone that scanned a tent, where it means nothing');
});

test('a table typed in survives a manager renaming a location', () => {
  // watchTags re-resolves the code from the URL. A typed table is not in the
  // URL, so a listener that re-resolved unconditionally found null and
  // emptied the box - mid-order, whenever anyone touched the locations doc.
  const src = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');
  const watch = src.slice(src.indexOf('db.watchTags(function ()'));
  const body = watch.slice(0, watch.indexOf('\n    });'));
  assert.ok(/if \(!tagId\) return;/.test(body),
    'the locations listener still overwrites a table the server typed');
});


// -------------------------------------------------------------- the salad

/** A pasta plate, with whatever salad fields a case wants on it. */
function plate(extra) {
  return {
    kind: 'pasta', pastas: ['penne'], sauces: ['marinara'], proteins: [],
    toppings: [], sides: [], portion: 'regular', spice: 'mild',
    ...extra,
  };
}

test('"no salad" is a tile, and it is not a salad', () => {
  // The step has to be answerable with nothing, and the answer has to be a
  // real tappable id - otherwise half a table walks past the step without
  // deciding and the kitchen cannot tell them from the ones who declined.
  assert.strictEqual(menu.saladOf(plate({ salad: 'sal_none' })), null);
  assert.strictEqual(menu.saladOf(plate({})), null, 'a plate from before salads existed');
  assert.strictEqual(menu.saladOf(plate({ salad: 'sal_nonsense' })), null);
  assert.strictEqual(menu.saladOf(plate({ salad: 'sal_caesar' })).id, 'sal_caesar');
});

test('a dressing cannot outlive the salad it was for', () => {
  // A member picks Ranch, goes back a step and takes the salad off. The
  // dressing is still sitting on the plate object; nothing downstream may
  // see it, or a chit reads "Dressing: Ranch" with no salad under it and a
  // cook stops mid-service to go and ask whose ticket it is.
  const orphan = plate({ salad: 'sal_none', dressing: 'drs_ranch', saladNote: 'no tomato' });
  assert.strictEqual(menu.dressingOf(orphan), null);

  const built = order.buildLine(orphan, 0, 'pasta');
  assert.strictEqual(built.salad, null);
  assert.strictEqual(built.dressing, null);
  assert.strictEqual(built.saladNote, '', 'the note went with it');

  assert.ok(!menu.describe(orphan).includes('Ranch'));
  assert.ok(!JSON.stringify(menu.ingredientList(orphan)).includes('Ranch'));
});

test('the salad reaches the kitchen, and so does the note', () => {
  // buildLine is the gate: a field it does not name is a field chosen on a
  // phone and dropped on the way to the pass. That is exactly how the pizza
  // crust was lost once already.
  const built = order.buildLine(
    plate({ salad: 'sal_caesar', dressing: 'drs_sherry', saladNote: 'extra croutons' }),
    0, 'pasta',
  );
  assert.strictEqual(built.salad, 'sal_caesar');
  assert.strictEqual(built.dressing, 'drs_sherry');
  assert.strictEqual(built.saladNote, 'extra croutons');

  // And it is on the chit, in rows, which is what the rail and the expo
  // screen both render.
  const labels = menu.ingredientList(built).map((r) => r.label);
  assert.ok(labels.includes('Salad'), 'no salad row on the chit');
  assert.ok(labels.includes('Dressing'), 'no dressing row on the chit');
  assert.ok(labels.includes('Salad note'), 'the note never reaches the cold station');

  // A plate with no salad adds nothing at all - not an empty row.
  const plain = order.buildLine(plate({ salad: 'sal_none' }), 0, 'pasta');
  menu.ingredientList(plain).forEach((r) => {
    assert.ok(!['Salad', 'Dressing', 'Salad note'].includes(r.label),
      'a plate with no salad is printing salad rows');
  });
});

test('a salad note is capped before it is stored, not after', () => {
  const built = order.buildLine(
    plate({ salad: 'sal_house', dressing: 'drs_ranch', saladNote: 'x'.repeat(400) }), 0, 'pasta',
  );
  assert.strictEqual(built.saladNote.length, config.order.maxSaladNoteLength);
});

test('a salad brings its allergens to the plate beside it', () => {
  // The bowl was gluten free. It is still gluten free; the PLATE is not,
  // because the croutons arrived on it - and the member reads one line that
  // says what is in front of them, not two.
  const gf = plate({ pastas: ['gf_penne'], sauces: ['marinara'] });
  const bare = menu.allergensFor(gf);
  assert.ok(!bare.includes('gluten'), 'fixture is wrong - start without gluten');

  const withCaesar = menu.allergensFor({ ...gf, salad: 'sal_caesar', dressing: 'drs_ranch' });
  assert.ok(withCaesar.includes('gluten'), 'the croutons are not declared');
  assert.ok(withCaesar.includes('dairy'), 'the ranch is not declared');
  assert.ok(withCaesar.includes('egg'), 'the ranch is not declared');

  // House with a vinaigrette adds nothing, so nothing is invented either.
  const house = menu.allergensFor({ ...gf, salad: 'sal_house', dressing: 'drs_balsamic' });
  assert.deepStrictEqual(house.slice().sort(), bare.slice().sort());
});

test('a salad nobody dressed is not a finished plate', () => {
  const errs = menu.validateLine(plate({ salad: 'sal_caesar', dressing: null }), config.order);
  assert.ok(errs.some((e) => /dressing/i.test(e)), 'a salad with no dressing passed validation');

  assert.deepStrictEqual(
    menu.validateLine(plate({ salad: 'sal_caesar', dressing: 'drs_caesar' }), config.order), [],
  );
  assert.deepStrictEqual(
    menu.validateLine(plate({ salad: 'sal_none' }), config.order), [],
    'declining a salad is a complete answer',
  );
  assert.ok(
    menu.validateLine(plate({ salad: 'sal_caesar', dressing: 'drs_nope' }), config.order).length,
    'a dressing that is not on the menu went through',
  );
});

test('the salad reads as its own plate, in both languages', () => {
  const p = plate({ salad: 'sal_caesar', dressing: 'drs_ranch' });
  assert.ok(menu.describe(p).includes('salad: Caesar (Ranch)'), 'EN: ' + menu.describe(p));
  assert.ok(menu.describe(p, 'es').includes('ensalada: César (Ranch)'),
    'ES: ' + menu.describe(p, 'es'));

  // "+ Caesar" on the end of a bowl reads as something stirred into it.
  assert.ok(!menu.describe(p).includes('+ Caesar ('), 'the word "salad" is missing');

  // The stored dish is the canonical English record the CSV and the PDF read
  // back, so the English stays printable ASCII.
  assert.ok(/^[ -~]*$/.test(menu.describe(p)), 'the English dish line left ASCII');
  assert.strictEqual(menu.describe(plate({ salad: 'sal_none' })), 'Penne w/ Marinara');
});

test('a salad and a dressing with the same name are two different things', () => {
  // Both lists have a Caesar. Unprefixed they were one id in two groups: the
  // cost sheet keyed both to one price, and findAnywhere() could only ever
  // return whichever list it reached first. selftest caught it by counting.
  const salads = menu.catalog().salads.map((x) => x.id);
  const dressings = menu.catalog().dressings.map((x) => x.id);
  assert.deepStrictEqual(salads.filter((id) => dressings.includes(id)), [],
    'these ids collide across the two lists');

  assert.strictEqual(menu.findAnywhere('sal_caesar').name, 'Caesar');
  assert.strictEqual(menu.findAnywhere('drs_caesar').name, 'Caesar');
  assert.notStrictEqual(menu.findAnywhere('sal_caesar'), menu.findAnywhere('drs_caesar'));
});

test('a salad is costed as the second plate it is', () => {
  const costs = {
    penne: { price: 12, yield: 20 },
    marinara: { price: 10, yield: 20 },
    sal_caesar: { price: 24, yield: 12 },
    drs_ranch: { price: 9, yield: 30 },
  };
  const extra = 24 / 12 + 9 / 30;
  const bare = costing.lineCost(plate({ salad: 'sal_none' }), costs);
  const withSalad = costing.lineCost(plate({ salad: 'sal_caesar', dressing: 'drs_ranch' }), costs);
  assert.ok(withSalad.complete, 'priced ingredients still read as incomplete');
  assert.ok(Math.abs((withSalad.total - bare.total) - extra) < 1e-9,
    'the salad and its dressing are not both on the bill');

  // A kid bowl is 0.6 of the pasta and a WHOLE salad, the same way a side is
  // a whole piece of garlic bread.
  const kid = costing.lineCost(
    plate({ portion: 'kid', salad: 'sal_caesar', dressing: 'drs_ranch' }), costs,
  );
  const kidBare = costing.lineCost(plate({ portion: 'kid', salad: 'sal_none' }), costs);
  assert.ok(Math.abs((kid.total - kidBare.total) - extra) < 1e-9,
    'a kid-size bowl is being charged for a kid-size salad');
});

test('the salad has somewhere to be priced, and "no salad" does not', () => {
  const ids = costing.costableIds();
  assert.ok(ids.includes('sal_caesar') && ids.includes('drs_ranch'),
    'a manager cannot enter what the salad costs');
  assert.ok(!ids.includes('sal_none'),
    '"No salad" has a price box, which is money entered against nothing');
});

test('the salad step is on both lanes that serve one, and on neither otherwise', () => {
  const src = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');

  // Written once and shared, not copied into each lane - two copies of two
  // steps is two places to rename House and one place to forget.
  assert.ok(/var SALAD_STEPS = \[/.test(src), 'the steps are not declared');
  assert.strictEqual((src.match(/SALAD_STEPS\[0\], SALAD_STEPS\[1\]/g) || []).length, 2,
    'the salad belongs to exactly two lanes: pasta and pizza');

  // And they come out of the strip when the bar is self-serve. Greying them
  // would leave a step a member stops and reads before finding they cannot
  // answer it.
  const fn = src.slice(src.indexOf('function steps()'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/saladOn\(\)/.test(body), 'steps() does not ask who is making the salad');
  assert.ok(/st\.id !== 'dressing'/.test(body),
    'the dressing step survives a plate with no salad on it');
  assert.ok(body.includes('!saladOf(bowl)'),
    'the dressing step is filtered on something other than whether there IS a salad');
});

test('moving the salad to the bar takes it off the plates too', () => {
  // A manager flips the switch at 6:40. Somebody has had a Caesar on their
  // plate since 6:35 and has not sent yet. Left alone that plate rides to a
  // station that has stopped making them.
  const src = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');
  const w = src.slice(src.indexOf('db.watchSaladMode(function (mode)'));
  const body = w.slice(0, w.indexOf('\n    });'));

  assert.ok(/state\.bowls\.forEach/.test(body), 'plates already built keep their salad');
  ["b.salad = 'sal_none'", 'b.dressing = null', "b.saladNote = ''"].forEach((line) => {
    assert.ok(body.includes(line), 'switching to the bar leaves behind: ' + line);
  });
  assert.ok(/clampStep\(\)/.test(body),
    'two steps vanish and the step pointer is left past the end of the list');
});

test('the salad note has a box of its own, on the dressing step', () => {
  const src = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');
  const fn = src.slice(src.indexOf('function buildDressing(bowl)'));
  const body = fn.slice(0, fn.indexOf('\n  }'));

  assert.ok(/data-act="setSaladNote"/.test(body), 'there is nowhere to type "no tomato"');
  assert.ok(/maxSaladNoteLength/.test(body), 'the box is not bounded');
  assert.ok(/tileGrid\('dressings'/.test(body), 'the dressings are not on this step');

  // Not folded into the plate note at the end: that panel is about the bowl,
  // and a salad note read off it is a salad note the cold station never sees.
  const panel = src.slice(src.indexOf('function detailPanel(bowl)'));
  assert.ok(!/saladNote/.test(panel.slice(0, panel.indexOf('\n  }'))),
    'the salad note is being collected on the plate panel');
});

test('a step with a box under its tiles does not advance out from under it', () => {
  // Tapping a tile advances to the next step, which is right for a step that
  // asks one thing. It is wrong for a step that also has something to TYPE:
  // the tap takes the box away before anyone reaches it. That already happened
  // once - pasta arrived with nobody's name on it - and the salad note was the
  // second time, because the dressing tiles sit directly above their box.
  const src = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');
  const map = src.slice(src.indexOf('var STEPS_WITH_A_BOX'));
  const body = map.slice(0, map.indexOf('};'));
  ['finish', 'dressing'].forEach((id) => {
    assert.ok(body.includes(id + ': true'),
      'the ' + id + ' step advances away from its own text box');
  });
  assert.ok(src.includes('STEPS_WITH_A_BOX[steps()[state.buildStep].id]'),
    'nothing reads the map, so every step advances again');

  // The trip-wire: a third box on a BUILD step means a third entry here.
  // Scoped to the build renderers, because the review screen has a box too
  // and nothing advances off that one - counting it would make this test
  // red for a reason that has nothing to do with what it is guarding.
  const buildArea = src.slice(
    src.indexOf('function detailPanel(bowl)'), src.indexOf('function screenReview()'),
  );
  assert.ok(buildArea.length > 200, 'the build renderers moved - this slice is wrong');
  assert.strictEqual((buildArea.match(/<textarea/g) || []).length, 2,
    'a text box was added or removed on a build step - does its step still advance?');
});

test('both switch positions say what they do, in both languages', () => {
  ['guest.tab.salad', 'guest.tab.dressing', 'guest.step.salad', 'guest.step.salad.sub',
    'guest.step.dressing', 'guest.step.dressing.sub', 'guest.salad.note',
    'guest.salad.notePh', 'guest.salad.atBar'].forEach((k) => {
    assert.ok(STRINGS.en[k], k + ' has no English');
    assert.ok(STRINGS.es[k], k + ' has no Spanish');
  });

  // The manager screen has the switch, and it is two buttons rather than a
  // slider for the same reason the kitchen switch is.
  const admin = readFileSync(fileURLToPath(new URL('../app/admin.js', import.meta.url)), 'utf8');
  assert.ok(/data-act="setSalad"/.test(admin), 'no salad control on the manager screen');
  assert.ok(/db\.setSaladMode\(/.test(admin), 'the switch writes nothing');
  assert.ok(/db\.watchSaladMode\(/.test(admin),
    'two managers on two iPads could disagree about it');

  // Both positions, rendered from one list so neither can be dropped.
  const fn = admin.slice(admin.indexOf('function renderSaladSwitch'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  config.saladModes.forEach((m) => {
    assert.ok(body.includes("id: '" + m + "'"), 'the switch has no ' + m + ' position');
  });
});

test('an unknown salad mode never reaches a screen', () => {
  // config, the rules and db all agree on the two modes.
  assert.deepStrictEqual(config.saladModes, ['kitchen', 'bar']);
  assert.ok(config.saladModes.includes(config.defaultSaladMode));
  assert.strictEqual(config.defaultSaladMode, 'bar',
    'the resting state is the one that asks nothing of the kitchen');

  const rules = readFileSync(fileURLToPath(new URL('../firestore.rules', import.meta.url)), 'utf8');
  config.saladModes.forEach((m) => {
    assert.ok(rules.includes("'" + m + "'"), 'the rules do not allow mode ' + m);
  });

  const db = readFileSync(fileURLToPath(new URL('../app/db.js', import.meta.url)), 'utf8');
  const setter = db.slice(db.indexOf('export async function setSaladMode'));
  assert.ok(/saladModes\.indexOf\(mode\) === -1/.test(setter.slice(0, 400)),
    'setSaladMode writes whatever it is handed');
  const watcher = db.slice(db.indexOf('export function watchSaladMode'));
  assert.ok(/defaultSaladMode/.test(watcher.slice(0, 800)),
    'a value nobody set leaves the screens with no mode at all');
});

test('a review card shows the dish, the right glyph, and an unfinished plate', () => {
  const src = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');

  // dishText delegates to menu.describe() instead of deriving the sentence a
  // second time. It used to derive it, and the two drifted the way two copies
  // do: describe() learned to read a split bowl and this one did not.
  assert.ok(src.includes('return describeLine(bowl, t.lang);'),
    'the review card has its own idea of what a dish is called again');

  // The glyph reads the list of shapes. On the singular field it resolved to
  // nothing and every pasta card drew the empty plate.
  assert.ok(!src.includes("item('pastas', bowl.pasta)"),
    'the review glyph is reading the singular pasta field again');
  assert.ok(src.includes("item('pastas', pastasOf(bowl)[0])"),
    'the review glyph is not reading the list of shapes');

  // A salad nobody dressed keeps the plate unfinished, so the review screen
  // marks it and Send stays off - rather than letting Send be the thing that
  // explains it.
  assert.ok(src.includes('if (saladOn() && saladOf(bowl) && !bowl.dressing) return false;'),
    'a salad with no dressing counts as a finished plate');
});

test('the review screen lists the allergens the kitchen lists', () => {
  // This screen used to roll its own allergens by hand, off the singular
  // pasta and protein fields - both of which became lists on 23 Oct, leaving
  // this reader behind. The result was not a blank line: "This order
  // contains:" silently dropped the gluten in every bowl of pasta and
  // everything in every protein, on the one screen a member checks before
  // sending.
  const src = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');

  assert.ok(!/item\('pastas', b\.pasta\)/.test(src),
    'the review screen is reading the singular pasta field again');
  assert.ok(!/\bb\.protein\b/.test(src) && !/bowl\.protein\b/.test(src),
    'something is reading the singular protein field');
  assert.ok(/allergensFor\(b\)/.test(src),
    'the review screen is not using the same rollup as the chit');

  // The proof it was ever broken: the field that reader wanted is one no
  // plate has had since the split bowl landed.
  const split = plate({ pastas: ['spaghetti', 'penne'], proteins: ['chicken'] });
  assert.strictEqual(split.pasta, undefined, 'the field the old reader wanted does not exist');
  assert.ok(menu.allergensFor(split).includes('gluten'));
});


test('the order the app actually builds passes its own validation', () => {
  // The shared draft() fixture above carries `pasta: 'shells'` - a singular
  // field nothing has produced since the split bowl landed on 23 Oct. So
  // every validation test was asking about a shape the app had stopped
  // building, while the shape it DOES build was rejected by validateLine and
  // therefore by db.submitOrder(), which runs validateDraft before it writes.
  // Pasta ordering was refused outright on the live site and the suite was
  // green the whole time.
  //
  // This builds the line the way app/guest.js newBowl() builds it, and reads
  // the field names out of guest.js rather than restating them - a
  // restatement is exactly how the first copy came to drift.
  const src = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');
  const nb = src.slice(src.indexOf('function newBowl(index)'));
  const body = nb.slice(0, nb.indexOf('\n  }'));
  assert.ok(body.includes('pastas: []'),
    'newBowl no longer starts a bowl with a list of shapes - this test is stale');
  assert.ok(!/(^|[^a-z])pasta: /.test(body),
    'newBowl is back to one shape per bowl - this test is stale');

  const asBuilt = {
    guestLabel: 'Ada', kind: 'pasta',
    pastas: ['penne'], sauces: ['marinara'], proteins: [], toppings: [],
    sides: [], portion: 'regular', spice: 'mild',
    salad: 'sal_none', dressing: null, saladNote: '',
  };
  assert.deepStrictEqual(
    order.validateDraft({ ...draft(), lines: [asBuilt] }, config), [],
    'the app cannot send the order it just built',
  );

  // The split bowl this was all for.
  assert.deepStrictEqual(
    order.validateDraft({ ...draft(), lines: [{ ...asBuilt, pastas: ['penne', 'rigatoni'] }] },
      config), [],
  );

  // And a bowl with a salad on it, which is the shape the app builds now.
  assert.deepStrictEqual(
    order.validateDraft({ ...draft(),
      lines: [{ ...asBuilt, salad: 'sal_caesar', dressing: 'drs_ranch', saladNote: 'no tomato' }] },
    config), [],
  );

  // "Pick a pasta shape" is a real error and has to survive the fix.
  assert.ok(order.validateDraft({ ...draft(), lines: [{ ...asBuilt, pastas: [] }] }, config)
    .some((e) => /pasta shape/.test(e)), 'an empty bowl now validates');
  assert.ok(order.validateDraft({ ...draft(), lines: [{ ...asBuilt, pastas: ['nope'] }] }, config)
    .some((e) => /pasta shape/.test(e)), 'a shape that is not on the menu now validates');

  // Firestore still holds orders written before the change, so the singular
  // has to keep reading.
  const legacy = { ...asBuilt, pasta: 'shells' };
  delete legacy.pastas;
  assert.deepStrictEqual(order.validateDraft({ ...draft(), lines: [legacy] }, config), [],
    'an order taken before 23 Oct no longer validates');
});


test('the chit says which pasta, in words', () => {
  // The glyph is a picture of a noodle. It can draw one shape, a split bowl
  // holds two, and at a pass nobody is squinting at a 34-pixel drawing to
  // tell gemelli from penne. The row naming it was the FIRST row on the
  // ticket and it had quietly stopped rendering: ingredientList() asked for
  // line.pasta, got nothing, and add() drops an empty row - so the chit went
  // Sauce, Protein, Toppings, Size with no pasta named anywhere on it.
  const rows = (line) => menu.ingredientList(line).map((r) => r.label + ': ' + r.items.join(', '));
  const base = {
    kind: 'pasta', sauces: ['butter'], proteins: ['chicken'],
    toppings: ['parmesan'], sides: [], portion: 'regular', spice: 'mild',
  };

  assert.strictEqual(rows({ ...base, pastas: ['spaghetti'] })[0], 'Pasta: Spaghetti',
    'the shape is not the first thing on the ticket');

  // Both of them, because the picture can only ever show one.
  assert.strictEqual(rows({ ...base, pastas: ['penne', 'rigatoni'] })[0],
    'Pasta: Penne, Rigatoni', 'a split bowl names only half of itself');

  // Orders taken before 23 Oct are still in Firestore and still get cooked.
  assert.strictEqual(rows({ ...base, pasta: 'shells' })[0], 'Pasta: Shells');

  // Spanish chits get the shape too.
  assert.strictEqual(
    menu.ingredientList({ ...base, pastas: ['spaghetti'] }, 'es')[0].items[0], 'Espagueti',
  );

  // And a pizza has no pasta row to lose.
  const pie = menu.ingredientList({ kind: 'pizza', base: 'classic', sauces: ['pz_marinara'],
    cheeses: ['pz_shred_mozz'], proteins: [], toppings: [] });
  assert.ok(!pie.some((r) => r.label === 'Pasta'), 'a pizza is carrying a pasta row');
});

test('nothing reads the pasta shape off the field a line stopped carrying', () => {
  // The split bowl turned `pasta` into `pastas` on 23 Oct and left SIX readers
  // on the old singular field. Every one failed silently, and separately:
  //
  //   - the Next button on the pasta step never lit up, so no member could
  //     start a bowl of pasta at all - a shape ticked on screen and a dead
  //     grey button under it
  //   - validateDraft refused every pasta order at submit
  //   - the review card drew the empty glyph and named no shape
  //   - the review allergen line dropped the gluten
  //   - the 86 check could not catch a shape that had sold out
  //   - every chit on the rail drew the empty plate
  //
  // Not one of them threw, and the suite stayed green for five days because
  // its fixture still carried the old field. So this is a guard for the whole
  // class rather than six assertions, because the seventh will be somewhere
  // none of these were.
  //
  // menu.js IS scanned, with two lines named below. It was excluded wholesale
  // at first, on the grounds that pastasOf() and proteinsOf() read the old
  // field deliberately - and the seventh reader was hiding in it: the chit's
  // own Pasta row, which resolved to nothing, so the row was dropped and the
  // kitchen lost the line naming the shape. An exemption the size of a file
  // hides whatever else is in that file.
  const FILES = ['menu.js', 'guest.js', 'order.js', 'kitchen.js', 'expo.js',
    'report.js', 'report-pdf.js', 'costing.js', 'cooktime.js', 'seed.js',
    'db.js', 'admin.js'];

  // The only two reads allowed anywhere, quoted whole. They are the legacy
  // fallbacks themselves - the reason orders already in Firestore keep
  // working - and nothing else gets to claim that excuse.
  const ALLOWED = [
    'if (line.pasta) return [line.pasta];',
    "if (line.protein && line.protein !== 'none') return [line.protein];",
  ];

  // Plain substrings, not a pattern. A pattern here needed a word boundary to
  // tell `line.pasta` from the `b.pasta` inside `guest.tab.pasta`, and getting
  // that subtly wrong is how a guard sits there passing while the thing it
  // guards is broken - which is exactly what the first version of this did.
  const DEAD = ['line.pasta', 'line.protein', 'bowl.pasta', 'bowl.protein'];

  const flag = (text) => DEAD.some((bad) => {
    const at = text.indexOf(bad);
    // `pastas` and `proteins` carry the dead name as a prefix.
    return at !== -1 && text.charAt(at + bad.length) !== 's';
  });

  const offenders = [];
  const seen = new Set();
  FILES.forEach((f) => {
    const src = readFileSync(fileURLToPath(new URL('../app/' + f, import.meta.url)), 'utf8');
    src.split(String.fromCharCode(10)).forEach((text, i) => {
      const trimmed = text.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (ALLOWED.includes(trimmed)) { seen.add(trimmed); return; }
      if (flag(text)) offenders.push(f + ':' + (i + 1) + '  ' + trimmed.slice(0, 68));
    });
  });

  assert.deepStrictEqual(offenders, [],
    'these read a field no line has carried since the shapes became a list');

  // An allowance nobody uses is an allowance that has stopped describing the
  // code, and the next person reads it as permission. Both have to be real.
  assert.deepStrictEqual(ALLOWED.filter((a) => !seen.has(a)), [],
    'these lines are excused but no longer exist - drop them from ALLOWED');

  // The guard has to be able to SEE one. Without this the test is a tautology
  // the day somebody mistypes an entry in DEAD - and a tautology is what the
  // first attempt at this turned out to be.
  assert.ok(flag('        line.pasta,'), 'the guard cannot see a real offender');
  assert.ok(flag('    return pastaShape(line.pasta);'), 'the guard misses the chit glyph');
  assert.ok(!flag('    pastas: menu.pastasOf(line),'), 'the guard flags the correct plural');
  assert.ok(!flag("      { id: 'pasta', labelKey: 'guest.tab.pasta' },"),
    'the guard flags a string key, which would make it noise');

  // And the one reader that never named the field, because it reached it
  // through a variable: the Next button on the pasta step. bowl[step.id] with
  // step.id 'pasta' IS bowl.pasta, and no substring search will ever see it.
  const guest = readFileSync(fileURLToPath(new URL('../app/guest.js', import.meta.url)), 'utf8');
  assert.ok(guest.includes("step.id === 'pasta' ? pastasOf(bowl).length > 0"),
    'the pasta step has no line of its own in the Next gate, so it falls through '
    + 'to bowl[step.id] - the dead field under another name, and Next stays grey');
});


// --------------------------------------------------- the template, and lists

test('html`` renders a list of raw() markers rather than [object Object]', () => {
  // The array branch was `v.join('')`, which stringifies what it holds - and a
  // raw() marker is an object, so a list of them joined to "[object Object]".
  //
  // A list of html`` fragments is a list of STRINGS, so it rendered fine. That
  // is why this hid: the close-out's legend and axis are built that way and
  // looked right, while the bars of the same chart - the one place that mapped
  // straight to raw() - printed twelve copies of that text where the picture
  // of the night's service should have been. Nothing threw.
  const out = html`<div>${[raw('<i>a</i>'), raw('<i>b</i>')]}</div>`;
  assert.strictEqual(out, '<div><i>a</i><i>b</i></div>');
  assert.ok(!/\[object Object\]/.test(out), 'a raw() in a list is being stringified');

  // THE ONE THAT MATTERS, and the one the first version of this test missed.
  //
  // Every repeated row on every screen is a list of html`` fragments, and a
  // fragment is a string of real markup. The first fix mapped the escape over
  // list elements, which turned all of them into visible tags - and this test
  // passed anyway, because it only ever asserted on ['x', 'y'], which has
  // nothing in it to escape. A browser found it; the suite did not. So the
  // list members here carry angle brackets, which is the whole point.
  assert.strictEqual(
    html`<ul>${[html`<li>a</li>`, html`<li>b</li>`]}</ul>`,
    '<ul><li>a</li><li>b</li></ul>',
    'a list of html`` fragments is being escaped - every row on every screen '
    + 'would render as its own source code',
  );
  assert.strictEqual(html`<p>${['x', 'y']}</p>`, '<p>xy</p>', 'a list of strings');
  assert.strictEqual(html`<p>${raw('<b>')}</p>`, '<p><b></p>', 'a bare raw()');
  assert.strictEqual(html`<p>${raw('')}</p>`, '<p></p>', "raw('') renders as nothing");
  // A value on its own is still escaped. A list is already-safe HTML by
  // construction; a lone value is whatever was handed in.
  assert.strictEqual(html`<p>${'<script>'}</p>`, '<p>&lt;script&gt;</p>',
    'a plain interpolated value must still be escaped');
  assert.strictEqual(html`<p>${null}</p>`, '<p></p>', 'a missing value renders as nothing');
  // Lists of lists arrive whenever one map() returns another; the rule is
  // applied through them rather than only at the top.
  assert.strictEqual(html`<p>${[[raw('<b>')], [html`<i>x</i>`]]}</p>`, '<p><b><i>x</i></p>',
    'nested lists');
});

test('the close-out names what sold the way the club named it', () => {
  // The names of everything a manager added or renamed live in config/menu,
  // not in the catalog as written. The rail watches that document; this screen
  // read the orders and nothing else, so the prep guide printed raw ids -
  // "cw_alfredo_2" for the second-commonest sauce in the room - on the one
  // page tomorrow's cook preps from. The chit beside it said "Alfredo".
  const src = readFileSync(fileURLToPath(new URL('../app/report.js', import.meta.url)), 'utf8');

  // Code only. The first version of this guard tested the raw text, so
  // commenting the call out left it passing - the same tautology the dead-field
  // guard was, caught the same way, by mutating the thing and watching.
  const code = src.split(String.fromCharCode(10))
    .filter((l) => {
      const s = l.trim();
      return s && !s.startsWith('//') && !s.startsWith('*') && !s.startsWith('/*');
    });
  const at = (needle) => code.findIndex((l) => l.includes(needle));

  const overrides = at('db.loadMenuOverrides(');
  const firstLoad = at('await load(serviceDate())');
  assert.ok(overrides !== -1,
    "the close-out never reads the club's own names for its own menu");
  assert.ok(firstLoad !== -1, 'the close-out no longer loads a service on boot');
  // Before the orders, or the first paint names them wrong and corrects itself.
  assert.ok(overrides < firstLoad,
    'the overrides must land before the first report is built');

  // The guard has to be able to SEE the thing missing, or it is decoration.
  const blinded = code.filter((l) => !l.includes('db.loadMenuOverrides('));
  assert.strictEqual(blinded.length, code.length - 1,
    'the guard is not matching exactly the one line it claims to protect');
});

test('an added item keeps its name all the way to the prep guide', () => {
  // The end-to-end of the one above, on the real shape: an id the catalog has
  // never heard of, named only by the overrides, has to come out of
  // shiftReport() as a name rather than as itself.
  const added = {
    cw_selftest_sauce: {
      name: 'Selftest Sauce', group: 'sauces', template: 'marinara', added: true,
      // Not decoration: an added item with no allergens array is refused,
      // because nobody having answered the question is not the same answer as
      // "none". Leaving it out here is how this test first failed.
      allergens: [],
    },
  };
  assert.ok(!menu.findAnywhere('cw_selftest_sauce'),
    'the catalog already has the id this test invented');

  menu.applyMenuOverrides(added);
  try {
    const found = menu.findAnywhere('cw_selftest_sauce');
    assert.ok(found, "applyMenuOverrides did not add the club's own item");
    assert.strictEqual(found.name, 'Selftest Sauce');

    // The whole point: shiftReport() has to name it, not print its id.
    const r = order.shiftReport([{
      ticketNo: 1, kind: 'pasta', serviceDate: '2026-01-01', memberNumber: '1',
      status: STATUS.QUEUED, guestCount: 1, cookEstimateSec: 300, events: [],
      submittedAt: '2026-01-01T00:00:00.000Z',
      lines: [{ pastas: ['penne'], sauce: 'cw_selftest_sauce', portion: 'regular' }],
    }], config.sla);
    const sauce = r.mix.pasta.sauces.find((x) => x.id === 'cw_selftest_sauce');
    assert.ok(sauce, "the prep guide did not count the club's own sauce at all");
    assert.strictEqual(sauce.name, 'Selftest Sauce',
      'the prep guide printed the id instead of the name the club gave it');
  } finally {
    // Put the catalog back; every later test reads the same module object.
    menu.applyMenuOverrides({});
  }
  assert.ok(!menu.findAnywhere('cw_selftest_sauce'), 'the catalog was left dirty');
});
console.log('\n' + passed + ' passed' + (process.exitCode ? ', with failures' : '') + '\n');
