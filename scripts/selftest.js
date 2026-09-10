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
  memberNumber: '10432',
  memberName: 'Compofelice',
  memberStatus: 'verified',
  guestCount: 2,
  lines: [
    { guestLabel: 'Ada', pasta: 'shells', sauces: ['butter'], protein: 'none', toppings: ['parmesan'], sides: [], portion: 'kid', spice: 'mild' },
    { guestLabel: 'Sam', pasta: 'penne', sauces: ['arrabbiata', 'marinara'], protein: 'chicken', toppings: ['mushrooms', 'chili'], sides: ['garlic_bread'], portion: 'regular', spice: 'hot' },
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
  assert.strictEqual(o.lines[1].dish, 'Penne w/ Arrabbiata + Marinara + Grilled Chicken');
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
  const one = { pasta: 'penne', sauces: ['marinara'], protein: 'none', toppings: [], sides: [], portion: 'regular' };
  const two = { ...one, sauces: ['marinara', 'alfredo'] };
  const marinara = menu.find('sauces', 'marinara').finishSec;
  const alfredo = menu.find('sauces', 'alfredo').finishSec;
  const delta = cooktime.bowlCookSec(two) - cooktime.bowlCookSec(one);
  assert.strictEqual(delta, (alfredo - marinara) + cooktime.MODEL.extraSaucePenaltySec);
  assert.ok(cooktime.bowlCookSec(two) < cooktime.bowlCookSec(one) + alfredo, 'not a naive sum');
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
  assert.ok(errors.some((e) => /Grilled Chicken just sold out/.test(e)), 'names the protein');
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
  assert.strictEqual(m.covers, 10);
  assert.strictEqual(m.bowls, 10);
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
  assert.strictEqual(r.totals.covers, 10, '5 live orders x 2 guests');
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

  // The curve accounts for every live bowl.
  assert.strictEqual(r.curve.reduce((a, b) => a + b.bowls, 0), 10);
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
  memberNumber: '10432',
  memberName: 'Compofelice',
  memberStatus: 'verified',
  guestCount: 2,
  lines: [
    { guestLabel: 'Ada', kind: 'pizza', sauces: ['pz_bbq'], toppings: ['pz_chicken', 'red_onion', 'bacon'], finishers: ['fin_chili', 'fin_parm'] },
    { guestLabel: 'Sam', kind: 'pizza', sauces: ['pz_marinara', 'pz_white'], toppings: ['pepperoni'], finishers: [] },
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

test('a pizza is built with no portion, protein or sides', () => {
  assert.deepStrictEqual(order.validateDraft(pizzaDraft(), config), []);
  const o = makePizza();
  assert.strictEqual(o.kind, 'pizza');
  const line = o.lines[0];
  assert.strictEqual(line.kind, 'pizza');
  assert.deepStrictEqual(line.finishers, ['fin_chili', 'fin_parm']);
  ['portion', 'protein', 'sides', 'spice'].forEach((f) => {
    assert.ok(!(f in line), 'a pizza line has no ' + f);
  });
  assert.strictEqual(line.dish, 'BBQ Pizza w/ Grilled Chicken, Red Onion, Bacon');
  assert.strictEqual(o.lines[1].dish, 'Marinara + White Sauce Pizza w/ Pepperoni');
});

test('every pizza inherits the crust allergens', () => {
  const plain = { kind: 'pizza', sauces: ['pz_marinara'], toppings: [], finishers: [] };
  const a = menu.allergensFor(plain);
  assert.ok(a.includes('gluten'), 'crust');
  assert.ok(a.includes('dairy'), 'cheese');
  assert.ok(menu.allergensFor({ ...plain, toppings: ['bacon'] }).includes('pork'));
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

test('pizza allows five toppings and four finishers', () => {
  const many = pizzaDraft();
  many.lines[0].toppings = ['pepperoni', 'bacon', 'ham', 'pineapple', 'jalapeno'];
  assert.deepStrictEqual(order.validateDraft(many, config), [], 'five is fine on a pizza');
  many.lines[0].toppings.push('red_onion');
  assert.ok(order.validateDraft(many, config).some((e) => /5 toppings per pizza/.test(e)));

  const fin = pizzaDraft();
  fin.lines[0].finishers = ['fin_parm', 'fin_chili', 'fin_salt', 'fin_oregano'];
  assert.deepStrictEqual(order.validateDraft(fin, config), []);
  fin.lines[0].finishers.push('fin_parm');
  assert.ok(order.validateDraft(fin, config).some((e) => /finishers per pizza/.test(e)));
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
  const pie = { kind: 'pizza', sauces: ['pz_marinara'], toppings: ['pepperoni'], finishers: [] };
  const at = (n) => cooktime.orderCookSec(Array.from({ length: n }, () => pie));
  const reload = cooktime.MODEL.pizza.deckReloadSec;
  assert.strictEqual(cooktime.MODEL.pizza.decks * cooktime.MODEL.pizza.piesPerDeck, 2);
  assert.ok(at(2) - at(1) < 60, 'second pie rides along in the other deck');
  assert.ok(at(3) - at(2) >= reload, 'third waits for a deck to clear');
  assert.ok(at(5) - at(3) >= reload, 'and so does the fifth');
  const finished = { ...pie, finishers: ['fin_parm', 'fin_chili', 'fin_salt', 'fin_oregano'] };
  assert.strictEqual(cooktime.lineCookSec(finished), cooktime.lineCookSec(pie),
    'finishers go on after the bake, so they cost no oven time');
});

test('shift report splits the prep guide by station', () => {
  const r = order.shiftReport([makePizza(), makePizza(), make()], sla);
  assert.strictEqual(r.byKind.pizza.orders, 2);
  assert.strictEqual(r.byKind.pizza.items, 4);
  assert.strictEqual(r.byKind.pasta.orders, 1);
  assert.strictEqual(r.byKind.pasta.items, 2);
  assert.ok(r.mix.pizza.sauces.some((x) => x.name === 'BBQ'));
  assert.ok(!r.mix.pasta.sauces.some((x) => x.name === 'BBQ'), 'BBQ never lands in the pasta list');
  assert.strictEqual(r.mix.pizza.sauces.reduce((a, x) => a + x.count, 0), 6, '2 orders x (1 + 2 sauces)');
  assert.ok(r.mix.pizza.finishers.length > 0, 'finishers tallied');
});

test('menu catalog exposes every group the screens render', () => {
  const c = menu.catalog();
  ['allergens', 'pastas', 'sauces', 'proteins', 'toppings', 'sides', 'portions', 'spice',
    'pizzaSauces', 'pizzaToppings', 'finishers']
    .forEach((k) => assert.ok(Array.isArray(c[k]) && c[k].length, k + ' present'));
  assert.strictEqual(c.pizzaSauces.length, 3, 'marinara, bbq, white only');
  assert.ok(c.pizzaBase && c.pizzaBase.bakeSec > 0, 'one crust, one size');
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', with failures' : '') + '\n');
