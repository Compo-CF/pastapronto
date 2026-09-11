/**
 * Domain self-test. Run: node scripts/selftest.js
 *
 * Exercises the order lifecycle, every illegal transition we care about, the
 * cook-time model and the metrics roll-up. These modules are deliberately
 * Firebase-free, so this runs with no emulator, no network and no credentials.
 */
import assert from 'node:assert';
import { config } from '../app/config.js';
import * as order from '../app/order.js';
import * as cooktime from '../app/cooktime.js';
import * as menu from '../app/menu.js';
import * as seed from '../app/seed.js';

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

let seq = 0;
const make = (d = draft(), ctx = {}) => ({
  id: 'ord_test_' + (seq += 1),
  ...order.buildOrder(d, {
    ticketNo: seq,
    claimCode: 'TEST',
    station: 'PASTA-1',
    queueDepth: 0,
    tag: { id: 'table-12', label: 'Table 12', kind: 'table' },
    serviceDate: '2026-09-09',
    ...ctx,
  }),
});

console.log('\nPastaPresto self-test\n');

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
  tooMany.lines[0].sauces = ['marinara', 'alfredo', 'pesto', 'butter'];
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

  // The cap applies to both lanes.
  assert.ok(menu.validateLine({ ...bowl, proteins: ['chicken', 'meatballs', 'sausage', 'shrimp'] }, L)
    .some((e) => /3 proteins each/.test(e)));
  assert.ok(menu.validateLine({ ...pie, proteins: ['pepperoni', 'bacon', 'ham', 'pz_chicken'] }, L)
    .some((e) => /3 proteins each/.test(e)));

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

test('validation rejects too many toppings', () => {
  const bad = draft();
  bad.lines[0].toppings = ['parmesan', 'broccoli', 'olives', 'basil', 'spinach'];
  assert.ok(order.validateDraft(bad, config).some((e) => /toppings/i.test(e)));
});

test('validation rejects a bad member number and guest count', () => {
  const bad = draft();
  bad.memberNumber = 'abc';
  bad.guestCount = 99;
  const errors = order.validateDraft(bad, config);
  assert.ok(errors.some((e) => /Member number/.test(e)));
  assert.ok(errors.some((e) => /Guest count/.test(e)));
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
  assert.strictEqual(r.mix.pasta.pastas.reduce((a, x) => a + x.count, 0), 10, 'one pasta per bowl');
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
    claimCode: 'TEST',
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

test('pizza and pasta cannot share one order', () => {
  const mixed = pizzaDraft();
  mixed.lines.push({ pasta: 'penne', sauces: ['marinara'], portion: 'regular' });
  assert.ok(order.validateDraft(mixed, config).some((e) => /separate orders/.test(e)));
});

test('pizza sauces and pasta sauces are not interchangeable', () => {
  const wrong = pizzaDraft();
  wrong.lines[0].sauces = ['pesto'];
  assert.ok(order.validateDraft(wrong, config).some((e) => /not on the menu/.test(e)));
  const alsoWrong = draft();
  alsoWrong.lines[0].sauces = ['pz_bbq'];
  assert.ok(order.validateDraft(alsoWrong, config).some((e) => /not on the menu/.test(e)));
});

test('the pizza topping cap counts what goes in the oven', () => {
  const many = pizzaDraft();
  many.lines[0].toppings = ['pz_olives', 'pz_artichoke', 'pz_mushroom', 'pineapple', 'jalapeno'];
  assert.deepStrictEqual(order.validateDraft(many, config), [], 'five is fine on a pizza');
  many.lines[0].toppings.push('red_onion');
  assert.ok(order.validateDraft(many, config).some((e) => /5 toppings per pizza/.test(e)));

  const fin = pizzaDraft();
  // Garnish is free: five baked toppings plus three post-bake is fine.
  fin.lines[0].toppings = ['pz_olives', 'pz_artichoke', 'pz_mushroom', 'pineapple', 'jalapeno',
    'pz_basil', 'fin_salt', 'fin_oregano'];
  assert.deepStrictEqual(order.validateDraft(fin, config), []);
  assert.deepStrictEqual(order.validateDraft(fin, config), []);
  // A sixth baked topping is not.
  fin.lines[0].toppings.push('pz_pepper');
  assert.ok(order.validateDraft(fin, config).some((e) => /toppings per pizza/.test(e)));
});

test('orders route to the station pool matching their kind', () => {
  const st = config.kitchen.stations;
  assert.strictEqual(order.stationForTicket(1, st, true, 'pizza'), 'PIZZA-1');
  assert.strictEqual(order.stationForTicket(2, st, true, 'pizza'), 'PIZZA-2');
  for (let n = 1; n <= 40; n += 1) {
    assert.ok(order.stationForTicket(n, st, true, 'pizza').startsWith('PIZZA'), 'pizza ticket ' + n);
    assert.ok(order.stationForTicket(n, st, true, 'pasta').startsWith('PASTA'), 'pasta ticket ' + n);
  }
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
    ticketNo: 1, claimCode: 'AAAA', serviceDate: '2026-09-11',
    station: 'PIZZA-1', tag: null, queueDepth: 0,
  });
  assert.deepStrictEqual(o.lines[0].cheeses, ['pz_fresh_mozz', 'pz_cheese_light']);
  assert.match(o.lines[0].dish, /Fresh Mozzarella \(light\)/);
});

test('menu catalog exposes every group the screens render', () => {
  const c = menu.catalog();
  ['allergens', 'pastas', 'sauces', 'proteins', 'toppings', 'sides', 'portions', 'spice',
    'pizzaSauces', 'pizzaCheeses', 'pizzaToppings']
    .forEach((k) => assert.ok(Array.isArray(c[k]) && c[k].length, k + ' present'));
  assert.strictEqual(c.pizzaSauces.length, 7, 'four sauces, no-sauce, light, heavy');
  assert.strictEqual(c.pizzaCheeses.length, 6, 'three cheeses, no-cheese, light, heavy');
  assert.ok(c.pizzaBase && c.pizzaBase.bakeSec > 0, 'one crust, one size');
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', with failures' : '') + '\n');
