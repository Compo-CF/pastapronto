'use strict';

/**
 * No-framework smoke test for the domain layer. Run: node scripts/selftest.js
 * Exercises the happy path, every illegal transition we care about, and the
 * metrics roll-up. Exits non-zero on the first failure.
 */
const assert = require('assert');
const { store, STATUS } = require('../lib/store');
const cooktime = require('../lib/cooktime');
const members = require('../lib/members');

// Keep the self-test out of the live service state file.
store.stateFile = require('path').join(require('os').tmpdir(), 'pastapronto-selftest.json');

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
  tag: 'table-12',
  lines: [
    { guestLabel: 'Ada', pasta: 'shells', sauce: 'butter', protein: 'none', toppings: ['parmesan'], sides: [], portion: 'kid', spice: 'mild' },
    { guestLabel: 'Sam', pasta: 'penne', sauce: 'arrabbiata', protein: 'chicken', toppings: ['mushrooms', 'chili'], sides: ['garlic_bread'], portion: 'regular', spice: 'hot' },
  ],
});

console.log('\nPastaPronto self-test\n');

test('member lookup resolves a known number', () => {
  assert.strictEqual(members.lookup('10432').status, 'verified');
  assert.strictEqual(members.lookup('99999').status, 'unverified');
  assert.strictEqual(members.lookup('12').status, 'invalid');
});

test('submit creates a queued chit with derived fields', () => {
  const o = store.submit(draft());
  assert.strictEqual(o.status, STATUS.QUEUED);
  assert.ok(o.ticketNo >= 1, 'ticket number assigned');
  assert.strictEqual(o.claimCode.length, 4);
  assert.strictEqual(o.lines.length, 2);
  assert.ok(o.cookEstimateSec > 0, 'cook estimate computed');
  assert.ok(o.allergenFlags.includes('gluten'), 'gluten flagged from penne');
  assert.ok(o.allergenFlags.includes('dairy'), 'dairy flagged from butter');
  assert.strictEqual(o.tagLabel, 'Table 12');
  assert.ok(o.totalPrice > 0);
});

test('submit rejects a bowl with no sauce', () => {
  const bad = draft();
  delete bad.lines[0].sauce;
  assert.throws(() => store.submit(bad), (err) => {
    assert.strictEqual(err.code, 'VALIDATION');
    assert.ok(err.errors.some((e) => /sauce/i.test(e)), 'error mentions sauce');
    return true;
  });
});

test('submit rejects too many toppings', () => {
  const bad = draft();
  bad.lines[0].toppings = ['parmesan', 'broccoli', 'olives', 'basil', 'spinach'];
  assert.throws(() => store.submit(bad), (err) => err.code === 'VALIDATION');
});

test('submit rejects a bad member number', () => {
  const bad = draft();
  bad.memberNumber = 'abc';
  assert.throws(() => store.submit(bad), (err) => err.code === 'VALIDATION');
});

test('happy path runs queued -> cooking -> ready -> delivered', () => {
  const o = store.submit(draft());
  assert.deepStrictEqual(store.allowedActions(o).sort(), ['accept', 'hold', 'rush', 'void']);
  store.transition(o.id, 'accept', { actor: 'cook:marco' });
  assert.strictEqual(store.get(o.id).status, STATUS.COOKING);
  assert.strictEqual(store.get(o.id).acceptedBy, 'cook:marco');
  store.transition(o.id, 'ready', { actor: 'cook:marco' });
  assert.strictEqual(store.get(o.id).status, STATUS.READY);
  store.transition(o.id, 'deliver', { actor: 'runner:tess' });
  assert.strictEqual(store.get(o.id).status, STATUS.DELIVERED);
  assert.strictEqual(store.get(o.id).events.length, 4, 'audit trail has 4 entries');
});

test('illegal transitions are refused', () => {
  const o = store.submit(draft());
  assert.throws(() => store.transition(o.id, 'ready'), (e) => e.code === 'ILLEGAL_TRANSITION');
  assert.throws(() => store.transition(o.id, 'deliver'), (e) => e.code === 'ILLEGAL_TRANSITION');
  assert.throws(() => store.transition(o.id, 'nope'), (e) => e.code === 'BAD_ACTION');
  assert.throws(() => store.transition('ord_missing', 'accept'), (e) => e.code === 'NOT_FOUND');
});

test('double accept from two screens cannot corrupt a chit', () => {
  const o = store.submit(draft());
  store.transition(o.id, 'accept', { actor: 'screen-a' });
  assert.throws(() => store.transition(o.id, 'accept', { actor: 'screen-b' }), (e) => e.code === 'ILLEGAL_TRANSITION');
  assert.strictEqual(store.get(o.id).acceptedBy, 'screen-a');
});

test('undo walks the chit back and clears its stamp', () => {
  const o = store.submit(draft());
  store.transition(o.id, 'accept');
  store.transition(o.id, 'unaccept');
  assert.strictEqual(store.get(o.id).status, STATUS.QUEUED);
  assert.strictEqual(store.get(o.id).acceptedAt, null);
});

test('hold and release park an order without losing it', () => {
  const o = store.submit(draft());
  store.transition(o.id, 'hold', { note: 'guest stepped away' });
  assert.strictEqual(store.get(o.id).status, STATUS.HELD);
  store.transition(o.id, 'release');
  assert.strictEqual(store.get(o.id).status, STATUS.QUEUED);
});

test('rush raises priority without changing status', () => {
  const o = store.submit(draft());
  store.transition(o.id, 'rush', { actor: 'expo' });
  assert.strictEqual(store.get(o.id).priority, 'rush');
  assert.strictEqual(store.get(o.id).status, STATUS.QUEUED);
});

test('allergy avoidance flags the chit', () => {
  const d = draft();
  d.avoidAllergens = ['shellfish'];
  const o = store.submit(d);
  assert.strictEqual(o.priority, 'allergy');
});

test('cook estimate grows with pan loads, not linearly with bowls', () => {
  const one = [draft().lines[1]];
  const six = Array.from({ length: 6 }, () => draft().lines[1]);
  const a = cooktime.orderCookSec(one);
  const b = cooktime.orderCookSec(six);
  assert.ok(b > a, 'six bowls take longer than one');
  assert.ok(b < a * 6, 'but far less than six times longer');
});

test('metrics roll up delivered orders', () => {
  const m = store.metrics();
  assert.ok(m.counts.total > 0);
  assert.ok(m.counts.delivered >= 1);
  assert.ok(m.covers > 0);
  assert.ok(m.revenue > 0);
  assert.ok(m.timings.avgCookSec >= 0);
  assert.ok(m.onTimePct === null || (m.onTimePct >= 0 && m.onTimePct <= 100));
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', with failures' : '') + '\n');
