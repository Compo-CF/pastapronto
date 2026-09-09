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
    { guestLabel: 'Ada', pasta: 'shells', sauce: 'butter', protein: 'none', toppings: ['parmesan'], sides: [], portion: 'kid', spice: 'mild' },
    { guestLabel: 'Sam', pasta: 'penne', sauce: 'arrabbiata', protein: 'chicken', toppings: ['mushrooms', 'chili'], sides: ['garlic_bread'], portion: 'regular', spice: 'hot' },
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

console.log('\nPastaPronto self-test\n');

test('draft validation accepts a good order', () => {
  assert.deepStrictEqual(order.validateDraft(draft(), config), []);
});

test('buildOrder derives allergens, prices, estimate and audit entry', () => {
  const o = make();
  assert.strictEqual(o.status, STATUS.QUEUED);
  assert.strictEqual(o.lines.length, 2);
  assert.ok(o.cookEstimateSec > 0, 'cook estimate computed');
  assert.ok(o.allergenFlags.includes('gluten'), 'gluten from penne');
  assert.ok(o.allergenFlags.includes('dairy'), 'dairy from butter');
  assert.strictEqual(o.tagLabel, 'Table 12');
  assert.ok(o.totalPrice > 0);
  assert.strictEqual(o.events.length, 1);
  assert.strictEqual(o.lines[1].dish, 'Penne w/ Arrabbiata + Grilled Chicken');
});

test('derived fields ignore anything the client tried to assert', () => {
  const tampered = draft();
  tampered.totalPrice = 0.01;
  tampered.cookEstimateSec = 1;
  tampered.lines[0].price = 0.01;
  const o = make(tampered);
  assert.ok(o.totalPrice > 1, 'price recomputed, not trusted');
  assert.ok(o.cookEstimateSec > 100, 'estimate recomputed, not trusted');
  assert.ok(o.lines[0].price > 1, 'line price recomputed');
});

test('validation rejects a bowl with no sauce', () => {
  const bad = draft();
  delete bad.lines[0].sauce;
  const errors = order.validateDraft(bad, config);
  assert.ok(errors.some((e) => /sauce/i.test(e)), 'error mentions sauce');
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
  ['acceptedBy', 'station', 'events', 'memberNumber', 'memberTier'].forEach((f) => {
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
  assert.ok(m.revenue > 0);
  assert.strictEqual(m.timings.avgQueueSec, 45);
  assert.strictEqual(m.timings.avgRunnerSec, 30);
  assert.strictEqual(m.onTimePct, 100, 'cooked exactly to estimate counts as on time');
});

test('menu catalog exposes every group the screens render', () => {
  const c = menu.catalog();
  ['allergens', 'pastas', 'sauces', 'proteins', 'toppings', 'sides', 'portions', 'spice']
    .forEach((k) => assert.ok(Array.isArray(c[k]) && c[k].length, k + ' present'));
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', with failures' : '') + '\n');
