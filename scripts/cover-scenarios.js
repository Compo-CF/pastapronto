/**
 * What the club actually gets charged, versus who actually ate.
 *
 * Run: node scripts/cover-scenarios.js [--csv]
 *
 * The night is all-you-can-eat, so the billable unit is a PERSON, not an order
 * and not a plate. order.memberRollup() turns a day's orders into one row per
 * member and bills `partySize` - the LARGEST head count that member reported -
 * on the reasoning that a party of four coming back for pizza is still four
 * covers. Close-out posts that number, labelled "Charges to post".
 *
 * That reasoning holds only while every order a member places speaks for the
 * whole party. The moment one order speaks for part of it, MAX is wrong, and
 * it is wrong quietly: no error, no flag, just a smaller number on the charge
 * sheet. So every scenario here carries the truth - how many people really ate
 * - and the gap gets measured rather than argued about.
 *
 * Everything runs through the real order.buildOrder and the real
 * order.memberRollup. Nothing here reimplements the billing.
 */
import { config } from '../app/config.js';
import * as order from '../app/order.js';

const CSV = process.argv.includes('--csv');
const DAY = '2026-11-05';

let ticket = 0;

/** A plausible bowl. Contents never affect covers - the head count does. */
const bowl = (who) => ({
  guestLabel: who, pasta: 'penne', sauces: ['marinara'], proteins: ['chicken'],
  toppings: ['parmesan'], sides: [], portion: 'regular', spice: 'mild',
});

const pie = (who) => ({
  guestLabel: who, kind: 'pizza', sauces: ['pz_marinara'],
  cheeses: ['pz_shred_mozz'], proteins: ['pepperoni'], toppings: ['pz_mushroom'],
});

/** One trip to the app. */
function place(act, minutesIn) {
  ticket += 1;
  const lines = (act.lines || []).map((who) => (act.kind === 'pizza' ? pie(who) : bowl(who)));
  const built = order.buildOrder({
    memberNumber: act.member,
    memberName: act.name || '',
    memberStatus: act.verified === false ? 'unverified' : 'verified',
    guestCount: act.guests,
    partySize: act.party == null ? null : act.party,
    lines,
  }, {
    ticketNo: ticket,
    station: order.stationForTicket(ticket, config.kitchen.stations, true,
      act.kind === 'pizza' ? 'pizza' : 'pasta'),
    queueDepth: 1,
    tag: act.tag ? { id: act.tag, label: act.tag, kind: 'table' } : null,
    serviceDate: DAY,
    now: new Date(Date.parse(DAY + 'T18:00:00Z') + minutesIn * 60000),
  });
  if (act.status) built.status = act.status;
  return built;
}

export const SCENARIOS = [
  {
    id: 'S1', title: 'One person orders for the whole four-top',
    story: 'A four-top. One member works the phone, enters 4 guests, builds a bowl for each.',
    truth: 4,
    acts: [{ member: '1794', name: 'Compofelice', guests: 4, tag: 'table-03', lines: ['Ann', 'Ben', 'Cal', 'Dee'] }],
  },
  {
    id: 'S2a', title: 'Four-top splits the ordering, one member number',
    story: 'One person orders for themselves. A second person at the table takes the phone - or types the same member number - and orders for the other three.',
    truth: 4,
    acts: [
      { member: '1794', name: 'Compofelice', guests: 1, tag: 'table-03', lines: ['Ann'] },
      { member: '1794', name: 'Compofelice', guests: 3, tag: 'table-03', lines: ['Ben', 'Cal', 'Dee'], at: 6 },
    ],
  },
  {
    id: 'S2b', title: 'Four-top splits the ordering, two member numbers',
    story: 'The same split, but the second person uses their own membership.',
    truth: 4,
    acts: [
      { member: '1794', name: 'Compofelice', guests: 1, tag: 'table-03', lines: ['Ann'] },
      { member: '1276', name: 'Seeger', guests: 3, tag: 'table-03', lines: ['Ben', 'Cal', 'Dee'], at: 6 },
    ],
  },
  {
    id: 'S3a', title: 'Second round, whole party again',
    story: 'The four-top orders pasta, comes back for pizza, enters 4 both times.',
    truth: 4,
    acts: [
      { member: '1794', name: 'Compofelice', guests: 4, tag: 'table-03', lines: ['Ann', 'Ben', 'Cal', 'Dee'] },
      { member: '1794', name: 'Compofelice', guests: 4, tag: 'table-03', kind: 'pizza', lines: ['Ann', 'Ben', 'Cal', 'Dee'], at: 35 },
    ],
  },
  {
    id: 'S3b', title: 'Second round, only two still hungry',
    story: 'Party of four orders. Later two want more, and the member honestly enters 2 for that trip.',
    truth: 4,
    acts: [
      { member: '1794', name: 'Compofelice', guests: 4, tag: 'table-03', lines: ['Ann', 'Ben', 'Cal', 'Dee'] },
      { member: '1794', name: 'Compofelice', guests: 2, tag: 'table-03', kind: 'pizza', lines: ['Ann', 'Ben'], at: 35 },
    ],
  },
  {
    id: 'S3c', title: 'A four-top that never orders as four',
    story: 'Two order pasta early. The other two arrive late and order separately on the same membership. Nobody ever types 4.',
    truth: 4,
    acts: [
      { member: '1794', name: 'Compofelice', guests: 2, tag: 'table-03', lines: ['Ann', 'Ben'] },
      { member: '1794', name: 'Compofelice', guests: 2, tag: 'table-03', kind: 'pizza', lines: ['Cal', 'Dee'], at: 25 },
    ],
  },
  {
    id: 'S4', title: 'Two members at one table, both order for the table',
    story: 'A four-top with two memberships. Each assumes they are ordering for everyone and enters 4.',
    truth: 4,
    acts: [
      { member: '1794', name: 'Compofelice', guests: 4, tag: 'table-03', lines: ['Ann', 'Ben'] },
      { member: '1276', name: 'Seeger', guests: 4, tag: 'table-03', kind: 'pizza', lines: ['Cal', 'Dee'], at: 8 },
    ],
  },
  {
    id: 'S5', title: 'Eight-top, two families, four each',
    story: 'Two memberships share a big table and each correctly enters their own four.',
    truth: 8,
    acts: [
      { member: '1794', name: 'Compofelice', guests: 4, tag: 'table-08', lines: ['Ann', 'Ben', 'Cal', 'Dee'] },
      { member: '1276', name: 'Seeger', guests: 4, tag: 'table-08', lines: ['Eve', 'Fay', 'Gus', 'Hal'], at: 3 },
    ],
  },
  {
    id: 'S6', title: 'Party of fourteen, over the per-order limit',
    story: 'A private party of 14 on one membership. An order caps at ' + config.order.maxGuests
      + ' guests, so it must be entered as two.',
    truth: 14,
    acts: [
      { member: '1794', name: 'Compofelice', guests: 7, tag: 'table-10', lines: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
      { member: '1794', name: 'Compofelice', guests: 7, tag: 'table-10', lines: ['H', 'I', 'J', 'K', 'L', 'M', 'N'], at: 4 },
    ],
  },
  {
    id: 'S7', title: 'Mistake voided and re-entered',
    story: 'A four-top order is voided by a manager and placed again correctly.',
    truth: 4,
    acts: [
      { member: '1794', name: 'Compofelice', guests: 4, tag: 'table-03', lines: ['Ann', 'Ben', 'Cal', 'Dee'], status: 'voided' },
      { member: '1794', name: 'Compofelice', guests: 4, tag: 'table-03', lines: ['Ann', 'Ben', 'Cal', 'Dee'], at: 5 },
    ],
  },
  {
    id: 'S8', title: 'Over-counted order voided, smaller one stands',
    story: 'Someone types 4 by mistake for a two-top. It is voided and re-entered as 2.',
    truth: 2,
    acts: [
      { member: '1794', name: 'Compofelice', guests: 4, tag: 'table-03', lines: ['Ann', 'Ben'], status: 'voided' },
      { member: '1794', name: 'Compofelice', guests: 2, tag: 'table-03', lines: ['Ann', 'Ben'], at: 5 },
    ],
  },
  {
    id: 'S9', title: 'Two adults and two children',
    story: 'A family of four, two of them kids on kid portions, entered as one order of 4.',
    truth: 4,
    acts: [{ member: '1794', name: 'Compofelice', guests: 4, tag: 'table-03', lines: ['Mum', 'Dad', 'Kid1', 'Kid2'] }],
  },
  {
    id: 'S10', title: 'Party moves tables between rounds',
    story: 'The same membership orders from table 3, then from the patio after moving.',
    truth: 4,
    acts: [
      { member: '1794', name: 'Compofelice', guests: 4, tag: 'table-03', lines: ['Ann', 'Ben', 'Cal', 'Dee'] },
      { member: '1794', name: 'Compofelice', guests: 4, tag: 'patio-01', kind: 'pizza', lines: ['Ann', 'Ben', 'Cal', 'Dee'], at: 40 },
    ],
  },
  {
    id: 'S11', title: 'Three trips, shrinking each time',
    story: 'Four order, then three come back, then two. Head counts entered honestly each trip.',
    truth: 4,
    acts: [
      { member: '1794', name: 'Compofelice', guests: 4, tag: 'table-03', lines: ['Ann', 'Ben', 'Cal', 'Dee'] },
      { member: '1794', name: 'Compofelice', guests: 3, tag: 'table-03', kind: 'pizza', lines: ['Ann', 'Ben', 'Cal'], at: 30 },
      { member: '1794', name: 'Compofelice', guests: 2, tag: 'table-03', lines: ['Ann', 'Ben'], at: 55 },
    ],
  },
  {
    id: 'S12', title: 'Late joiner on a second membership',
    story: 'A four-top orders. A fifth person joins late and orders on their own number for themselves.',
    truth: 5,
    acts: [
      { member: '1794', name: 'Compofelice', guests: 4, tag: 'table-03', lines: ['Ann', 'Ben', 'Cal', 'Dee'] },
      { member: '1276', name: 'Seeger', guests: 1, tag: 'table-03', lines: ['Eve'], at: 20 },
    ],
  },
  {
    id: 'S13', title: 'A held order still bills',
    story: 'A four-top order is held at the pass waiting on an allergy check and never changes status.',
    truth: 4,
    acts: [{ member: '1794', name: 'Compofelice', guests: 4, tag: 'table-03', lines: ['Ann', 'Ben', 'Cal', 'Dee'], status: 'held' }],
  },
  {
    id: 'S14', title: 'Everyone orders for themselves on one membership',
    story: 'A four-top where each person orders when they feel like it, all on the host membership, each entering 1.',
    truth: 4,
    acts: [
      { member: '1794', name: 'Compofelice', guests: 1, tag: 'table-03', lines: ['Ann'] },
      { member: '1794', name: 'Compofelice', guests: 1, tag: 'table-03', lines: ['Ben'], at: 10 },
      { member: '1794', name: 'Compofelice', guests: 1, tag: 'table-03', kind: 'pizza', lines: ['Cal'], at: 22 },
      { member: '1794', name: 'Compofelice', guests: 1, tag: 'table-03', lines: ['Dee'], at: 38 },
    ],
  },
  {
    id: 'S15', title: 'One person dining alone, four trips',
    story: 'A member eating alone who orders four separate times over the night. The AYCE case working as intended.',
    truth: 1,
    acts: [
      { member: '1794', name: 'Compofelice', guests: 1, tag: 'table-01', lines: ['Ann'] },
      { member: '1794', name: 'Compofelice', guests: 1, tag: 'table-01', kind: 'pizza', lines: ['Ann'], at: 20 },
      { member: '1794', name: 'Compofelice', guests: 1, tag: 'table-01', lines: ['Ann'], at: 45 },
      { member: '1794', name: 'Compofelice', guests: 1, tag: 'table-01', kind: 'pizza', lines: ['Ann'], at: 70 },
    ],
  },
];

// ------------------------------------------------------------ cover models
//
// Four ways of answering "how many people ate", so the current one can be
// compared against the alternatives on the same scenarios rather than argued
// about. Each takes a day's orders and returns a number of charges.

const liveOf = (orders) => orders.filter((o) => o.status !== order.STATUS.VOIDED);

const byMember = (orders) => {
  const m = new Map();
  liveOf(orders).forEach((o) => {
    const k = String(o.memberNumber || 'unknown');
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(o);
  });
  return m;
};

/** Two guests are the same person if they wrote the same name. */
const nameKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export const MODELS = {
  /** What ships today: the largest head count a member reported. */
  max: (orders) => order.billableCovers(orders),

  /** The naive reading - add up every order's head count. */
  sum: (orders) => liveOf(orders).reduce((a, o) => a + (Number(o.guestCount) || 0), 0),

  /**
   * Count the people named on the plates. Every line already carries a
   * guestLabel, so this needs no new field - only that the name be real.
   */
  names: (orders) => {
    let total = 0;
    byMember(orders).forEach((os) => {
      const who = new Set();
      os.forEach((o) => o.lines.forEach((l) => who.add(nameKey(l.guestLabel))));
      total += who.size;
    });
    return total;
  },

  /**
   * Names, with the reported head count as a floor. Protects against a party
   * that shares one name field, at the cost of re-admitting the double-count
   * when two members each claim the whole table.
   */
  namesOrCount: (orders) => {
    let total = 0;
    byMember(orders).forEach((os) => {
      const who = new Set();
      let most = 0;
      os.forEach((o) => {
        most = Math.max(most, Number(o.guestCount) || 0);
        o.lines.forEach((l) => who.add(nameKey(l.guestLabel)));
      });
      total += Math.max(who.size, most);
    });
    return total;
  },
};

// --------------------------------------------------------------------- run

/**
 * Replay a scenario. `lazy` strips the names the guests typed, leaving the
 * "Guest 1" the app fills in - which is what happens when nobody bothers.
 */
export function run(scenario, { lazy = false } = {}) {
  ticket = 0;
  const acts = lazy
    ? scenario.acts.map((a) => ({ ...a, lines: (a.lines || []).map(() => '') }))
    : scenario.acts;
  return acts.map((a, i) => place(a, a.at == null ? i * 2 : a.at));
}

export const results = SCENARIOS.map((s) => {
  const orders = run(s);
  const rows = order.memberRollup(orders);
  const live = liveOf(orders);
  const models = Object.fromEntries(
    Object.entries(MODELS).map(([k, fn]) => [k, fn(orders)]),
  );
  const lazyOrders = run(s, { lazy: true });
  return {
    ...s,
    orders: orders.length,
    liveOrders: live.length,
    items: live.reduce((a, o) => a + o.lines.length, 0),
    members: rows.length,
    covers: models.max,
    variance: models.max - s.truth,
    models,
    lazyNames: MODELS.names(lazyOrders),
    rows: rows.map((r) => ({
      memberNumber: r.memberNumber, name: r.name, orders: r.orders,
      partySize: r.partySize, items: r.items, itemsPerCover: r.itemsPerCover,
    })),
  };
});

function report() {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  console.log('');
  console.log('  ' + pad('ID', 6) + pad('Scenario', 46) + num('Ate', 5) + num('Ord', 5)
    + num('Items', 7) + num('Mem', 5) + num('Charged', 9) + '  Result');
  console.log('  ' + '-'.repeat(99));
  results.forEach((r) => {
    const verdict = r.variance === 0 ? 'correct'
      : (r.variance > 0 ? 'OVER by ' + r.variance : 'UNDER by ' + Math.abs(r.variance));
    console.log('  ' + pad(r.id, 6) + pad(r.title.slice(0, 44), 46) + num(r.truth, 5)
      + num(r.orders, 5) + num(r.items, 7) + num(r.members, 5) + num(r.covers, 9) + '  ' + verdict);
  });

  const bad = results.filter((r) => r.variance !== 0);
  const under = bad.filter((r) => r.variance < 0);
  const over = bad.filter((r) => r.variance > 0);
  console.log('');
  console.log('  ' + results.length + ' scenarios: ' + (results.length - bad.length)
    + ' correct, ' + bad.length + ' wrong');
  console.log('  undercharged ' + under.reduce((a, r) => a + Math.abs(r.variance), 0)
    + ' covers across ' + under.length + ' scenarios');
  console.log('  overcharged  ' + over.reduce((a, r) => a + r.variance, 0)
    + ' covers across ' + over.length + ' scenarios');
  console.log('');

  // ---------------------------------------------------------- the models
  const keys = Object.keys(MODELS);
  console.log('  ' + pad('ID', 6) + num('Ate', 5) + keys.map((k) => num(k, 14)).join('')
    + num('names if nobody types one', 28));
  console.log('  ' + '-'.repeat(99));
  results.forEach((r) => {
    console.log('  ' + pad(r.id, 6) + num(r.truth, 5)
      + keys.map((k) => num(r.models[k] + (r.models[k] === r.truth ? '' : ' x'), 14)).join('')
      + num(r.lazyNames + (r.lazyNames === r.truth ? '' : ' x'), 28));
  });
  console.log('  ' + '-'.repeat(99));
  console.log('  ' + pad('right', 6) + num('', 5)
    + keys.map((k) => num(results.filter((r) => r.models[k] === r.truth).length
      + '/' + results.length, 14)).join('')
    + num(results.filter((r) => r.lazyNames === r.truth).length + '/' + results.length, 28));
  console.log('');
  keys.forEach((k) => {
    const err = results.reduce((a, r) => a + Math.abs(r.models[k] - r.truth), 0);
    console.log('  ' + pad(k, 14) + 'total cover error across all scenarios: ' + err);
  });
  console.log('');
}

// ------------------------------------------------------------- simulation
//
// Eighteen hand-built scenarios say which behaviours break. They cannot say
// what a night costs, because that depends on how often each behaviour turns
// up. So: generate whole nights, vary the mix, and measure.

/** Seeded, so a surprising night can be re-run and looked at. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const FIRST = ['Ann', 'Ben', 'Cal', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jon',
  'Kay', 'Lee', 'Mia', 'Ned', 'Ola', 'Pat'];

/**
 * One night. `splitRate` is how often a party lets more than one person do the
 * ordering under one membership; `shareRate` how often two memberships at one
 * table each claim the whole table.
 */
function night(seed, { parties = 20, splitRate = 0.25, shareRate = 0.08, names = true, typoRate = 0 } = {}) {
  const rand = rng(seed);
  const orders = [];
  const memberTruth = new Map();
  const shared = new Set();
  let member = 1000;
  ticket = 0;

  const owe = (m, n) => memberTruth.set(String(m), (memberTruth.get(String(m)) || 0) + n);

  for (let p = 0; p < parties; p += 1) {
    member += 1 + Math.floor(rand() * 7);
    const size = 1 + Math.floor(rand() * 6);
    const who = [];
    for (let i = 0; i < size; i += 1) who.push(FIRST[(p * 3 + i) % FIRST.length] + '-' + p);
    const tag = 'table-' + String(p % 14).padStart(2, '0');
    const rounds = 1 + Math.floor(rand() * 3);
    const splits = rand() < splitRate;
    const shares = size >= 2 && rand() < shareRate;
    // A guest who writes "Ann" on one trip and "Annie" on the next is two
    // people to anything counting names. This is the model s weak point, so
    // it gets dialled up rather than assumed away.
    const skew = (n) => {
      const r = rand();
      if (r > typoRate) return n;
      if (r < typoRate / 3) return n.toUpperCase();
      if (r < (typoRate * 2) / 3) return n.slice(0, 1);
      return n + "y";
    };
    const label = (list) => (names ? list.map(skew) : list.map(() => ''));

    if (shares) {
      // Two memberships at one table. Each brought some of the party, and each
      // reads the head count question as "how many are at this table".
      const half = Math.ceil(size / 2);
      const a = who.slice(0, half);
      const b = who.slice(half);
      shared.add(String(member));
      shared.add(String(member + 500));
      owe(member, a.length);
      owe(member + 500, b.length);
      for (let r = 0; r < rounds; r += 1) {
        orders.push(place({ member: String(member), name: 'P' + p, guests: size, tag,
          kind: r % 2 ? 'pizza' : 'pasta', lines: label(a) }, r * 20 + p));
        orders.push(place({ member: String(member + 500), name: 'Q' + p, guests: size, tag,
          kind: r % 2 ? 'pasta' : 'pizza', lines: label(b) }, r * 20 + p + 4));
      }
      continue;
    }

    owe(member, size);
    for (let r = 0; r < rounds; r += 1) {
      if (splits) {
        // The party orders in pieces: each trip speaks for only some of them.
        const cut = 1 + Math.floor(rand() * size);
        const slice = who.slice(0, cut);
        const rest = who.slice(cut);
        orders.push(place({ member: String(member), name: 'P' + p, guests: slice.length,
          tag, kind: rand() < 0.4 ? 'pizza' : 'pasta', lines: label(slice) }, r * 20 + p));
        if (rest.length) {
          orders.push(place({ member: String(member), name: 'P' + p, guests: rest.length,
            tag, kind: rand() < 0.4 ? 'pizza' : 'pasta', lines: label(rest) }, r * 20 + p + 5));
        }
      } else {
        orders.push(place({ member: String(member), name: 'P' + p, guests: size, tag,
          kind: rand() < 0.4 ? 'pizza' : 'pasta', lines: label(who) }, r * 20 + p));
      }
    }
  }
  return { orders, memberTruth, shared };
}

/** Each model, but answering per member rather than for the whole night. */
const PER_MEMBER = {
  max: (orders) => {
    const m = new Map();
    byMember(orders).forEach((os, k) => m.set(k,
      os.reduce((a, o) => Math.max(a, Number(o.guestCount) || 0), 0)));
    return m;
  },
  sum: (orders) => {
    const m = new Map();
    byMember(orders).forEach((os, k) => m.set(k,
      os.reduce((a, o) => a + (Number(o.guestCount) || 0), 0)));
    return m;
  },
  names: (orders) => {
    const m = new Map();
    byMember(orders).forEach((os, k) => {
      const who = new Set();
      os.forEach((o) => o.lines.forEach((l) => who.add(nameKey(l.guestLabel))));
      m.set(k, who.size);
    });
    return m;
  },
  namesOrCount: (orders) => {
    const m = new Map();
    byMember(orders).forEach((os, k) => {
      const who = new Set();
      let most = 0;
      os.forEach((o) => {
        most = Math.max(most, Number(o.guestCount) || 0);
        o.lines.forEach((l) => who.add(nameKey(l.guestLabel)));
      });
      m.set(k, Math.max(who.size, most));
    });
    return m;
  },
};

function simulate() {
  const MIXES = [
    { label: 'careful  (10% split, 3% share)', splitRate: 0.10, shareRate: 0.03 },
    { label: 'typical  (25% split, 8% share)', splitRate: 0.25, shareRate: 0.08 },
    { label: 'loose    (45% split, 15% share)', splitRate: 0.45, shareRate: 0.15 },
  ];
  const RUNS = 400;
  const keys = Object.keys(PER_MEMBER);
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);

  console.log('');
  console.log('  ' + RUNS + ' simulated nights per mix. 20 memberships a night, 1-6 people each,');
  console.log('  1-3 trips to the app per party.');

  const PASSES = [
    { names: true,  typoRate: 0,    label: "names typed, always the same way" },
    { names: true,  typoRate: 0.15, label: "names typed, 15% written differently next trip" },
    { names: true,  typoRate: 0.35, label: "names typed, 35% written differently next trip" },
    { names: false, typoRate: 0,    label: "nobody types a name - app fills in Guest 1" },
  ];
  PASSES.forEach((pass) => {
    const names = pass.names;
    console.log('');
    console.log('  ' + pass.label.toUpperCase());
    console.log('  ' + pad('mix', 32) + keys.map((k) => num(k, 16)).join(''));
    console.log('  ' + '-'.repeat(96));

    MIXES.forEach((mix) => {
      const wrong = {};
      const net = {};
      keys.forEach((k) => { wrong[k] = [0, 0]; net[k] = [0, 0]; });

      for (let i = 0; i < RUNS; i += 1) {
        const n = night(i + 1, { ...mix, names, typoRate: pass.typoRate });
        keys.forEach((k) => {
          const got = PER_MEMBER[k](n.orders);
          n.memberTruth.forEach((want, id) => {
            const had = got.get(id) || 0;
            wrong[k][1] += 1;
            if (had !== want) wrong[k][0] += 1;
            net[k][0] += had;
            net[k][1] += want;
          });
        });
      }

      console.log('  ' + pad(mix.label, 32) + keys.map((k) => {
        const pct = Math.round((wrong[k][0] / wrong[k][1]) * 1000) / 10;
        return num(pct + '% wrong', 16);
      }).join(''));
      console.log('  ' + pad('', 32) + keys.map((k) => {
        const d = net[k][0] - net[k][1];
        const pct = Math.round((d / net[k][1]) * 1000) / 10;
        return num('net ' + (d >= 0 ? '+' : '') + pct + '%', 16);
      }).join(''));
    });
  });
  console.log('');
  console.log('  "% wrong" is the share of memberships billed for the wrong number of');
  console.log('  people. "net" is the error on the night total. The two disagree on');
  console.log('  purpose: individual bills go wrong in both directions while the');
  console.log('  total still looks close.');
  console.log('');
}

function csv() {
  console.log('id,title,people who ate,orders,items,members,covers charged,variance');
  results.forEach((r) => console.log([r.id, JSON.stringify(r.title), r.truth,
    r.orders, r.items, r.members, r.covers, r.variance].join(',')));
}


// --------------------------------------------------------------- the flows
//
// The model comparison answers "can covers be computed better from what is
// already collected". No: the only field that could carry identity is a
// free-text name, and a name is not an identity. At 15% of guests writing
// theirs differently on a second trip, counting names is worse than what
// ships today - and it fails by OVERcharging, which members notice.
//
// So the fix belongs in what gets asked, not in what gets inferred. These are
// flows rather than algorithms, measured the same way: what share of
// memberships end the night billed for the wrong number of people.

const FLOWS = {
  /** TODAY. Every order asks how many are eating; close-out bills the largest answer. */
  today: (n) => PER_MEMBER.max(n.orders),

  /**
   * ASK ONCE. Party size is asked once per membership per night, worded about
   * the party rather than the order, and every later trip inherits it and
   * shows it back. Splitting the ordering stops mattering, because nobody is
   * asked a second time. Does nothing about two memberships at one table each
   * answering for the whole table.
   */
  askOnce: (n) => {
    const m = new Map();
    n.memberTruth.forEach((want, id) => m.set(id, n.shared.has(id) ? want * 2 : want));
    return m;
  },

  /**
   * ASK ONCE, AND NOTICE THE TABLE. When a membership opens an order at a
   * table another membership has already claimed, it is asked whether its
   * people are additional or already counted. `heed` is the share of guests
   * who answer honestly rather than tapping past it.
   */
  askOnceTableAware: (n, heed) => {
    const m = new Map();
    let i = 0;
    n.memberTruth.forEach((want, id) => {
      i += 1;
      if (!n.shared.has(id)) { m.set(id, want); return; }
      const honest = ((i * 2654435761) % 1000) / 1000 < heed;
      m.set(id, honest ? want : want * 2);
    });
    return m;
  },
};

function flows() {
  const MIXES = [
    { label: 'careful  (10% split, 3% share)', splitRate: 0.10, shareRate: 0.03 },
    { label: 'typical  (25% split, 8% share)', splitRate: 0.25, shareRate: 0.08 },
    { label: 'loose    (45% split, 15% share)', splitRate: 0.45, shareRate: 0.15 },
  ];
  const RUNS = 400;
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);

  const COLS = [
    ['today', (n) => FLOWS.today(n)],
    ['ask once', (n) => FLOWS.askOnce(n)],
    ['+table, 70% heed', (n) => FLOWS.askOnceTableAware(n, 0.7)],
    ['+table, 95% heed', (n) => FLOWS.askOnceTableAware(n, 0.95)],
  ];

  console.log('');
  console.log('  FLOW COMPARISON - ' + RUNS + ' nights per mix');
  console.log('  share of memberships billed for the wrong number of people');
  console.log('');
  console.log('  ' + pad('mix', 32) + COLS.map(([l]) => num(l, 24)).join(''));
  console.log('  ' + '-'.repeat(128));

  MIXES.forEach((mix) => {
    const wrong = COLS.map(() => [0, 0]);
    const net = COLS.map(() => [0, 0]);
    for (let i = 0; i < RUNS; i += 1) {
      const n = night(i + 1, { ...mix, names: true });
      COLS.forEach(([, fn], c) => {
        const got = fn(n);
        n.memberTruth.forEach((want, id) => {
          const had = got.get(id) || 0;
          wrong[c][1] += 1;
          if (had !== want) wrong[c][0] += 1;
          net[c][0] += had;
          net[c][1] += want;
        });
      });
    }
    console.log('  ' + pad(mix.label, 32) + COLS.map((col, c) => {
      const pct = Math.round((wrong[c][0] / wrong[c][1]) * 1000) / 10;
      const d = net[c][0] - net[c][1];
      const npct = Math.round((d / net[c][1]) * 1000) / 10;
      return num(pct + '% (net ' + (d >= 0 ? '+' : '') + npct + '%)', 24);
    }).join(''));
  });
  console.log('');
}


if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('cover-scenarios.js')) {
  if (CSV) csv();
  else if (process.argv.includes('--simulate')) simulate();
  else if (!process.argv.includes('--report-json')) { report(); simulate(); flows(); }
}
/**
 * Everything the written report quotes, in one object. The report embeds this
 * rather than restating numbers, so a figure on the page and a figure from a
 * run cannot drift apart.
 */
function reportData() {
  const MIXES = [
    { key: 'careful', label: 'Careful room', split: 0.10, share: 0.03 },
    { key: 'typical', label: 'Typical room', split: 0.25, share: 0.08 },
    { key: 'loose', label: 'Loose room', split: 0.45, share: 0.15 },
  ];
  const PASSES = [
    { key: 'exact', label: 'Always written the same way', typoRate: 0, names: true },
    { key: 'typo15', label: '15% written differently', typoRate: 0.15, names: true },
    { key: 'typo35', label: '35% written differently', typoRate: 0.35, names: true },
    { key: 'none', label: 'Nobody types a name', typoRate: 0, names: false },
  ];
  const RUNS = 400;

  const score = (mix, build) => {
    let wrong = 0; let total = 0; let got = 0; let want = 0;
    for (let i = 0; i < RUNS; i += 1) {
      const n = night(i + 1, { splitRate: mix.split, shareRate: mix.share,
        names: mix.names !== false, typoRate: mix.typoRate || 0 });
      const charged = build(n);
      n.memberTruth.forEach((w, id) => {
        const h = charged.get(id) || 0;
        total += 1; if (h !== w) wrong += 1;
        got += h; want += w;
      });
    }
    return {
      wrongPct: Math.round((wrong / total) * 1000) / 10,
      netPct: Math.round(((got - want) / want) * 1000) / 10,
    };
  };

  const models = {};
  PASSES.forEach((pass) => {
    models[pass.key] = { label: pass.label, byMix: {} };
    MIXES.forEach((mix) => {
      const m = { ...mix, names: pass.names, typoRate: pass.typoRate };
      models[pass.key].byMix[mix.key] = Object.fromEntries(
        Object.keys(PER_MEMBER).map((k) => [k, score(m, (n) => PER_MEMBER[k](n.orders))]),
      );
    });
  });

  const FLOWCOLS = {
    today: (n) => FLOWS.today(n),
    askOnce: (n) => FLOWS.askOnce(n),
    tableAware70: (n) => FLOWS.askOnceTableAware(n, 0.7),
    tableAware95: (n) => FLOWS.askOnceTableAware(n, 0.95),
    scoped30: (n) => FLOWS.askOnceAccountScoped(n, 0.30),
    scoped15: (n) => FLOWS.askOnceAccountScoped(n, 0.15),
    scoped05: (n) => FLOWS.askOnceAccountScoped(n, 0.05),
  };
  const flowsOut = {};
  MIXES.forEach((mix) => {
    flowsOut[mix.key] = Object.fromEntries(
      Object.entries(FLOWCOLS).map(([k, fn]) => [k, score({ ...mix, names: true }, fn)]),
    );
  });

  return {
    generatedAt: new Date().toISOString(),
    runsPerMix: RUNS,
    mixes: MIXES,
    scenarios: results.map((r) => ({
      id: r.id, title: r.title, story: r.story, truth: r.truth,
      orders: r.orders, liveOrders: r.liveOrders, items: r.items,
      members: r.members, covers: r.covers, variance: r.variance,
      models: r.models,
      acts: r.acts.map((a) => ({
        member: a.member, guests: a.guests, tag: a.tag || null,
        kind: a.kind || 'pasta', plates: (a.lines || []).length,
        status: a.status || 'live',
      })),
      rows: r.rows,
    })),
    models,
    flows: flowsOut,
  };
}


/**
 * A fifth flow, and the one that needs no idea of a seating.
 *
 * S4 happens because two memberships at one table both read "how many are
 * eating" as a question about the TABLE. Detecting that in the app means
 * knowing a table has turned over, which nothing here can do: an order carries
 * a tag and two timestamps, and config records seats per area rather than per
 * table, so even "more covers than chairs" is not computable.
 *
 * So scope the question to the account instead of the table - "how many people
 * are you ordering for, whose meals go on your account" - and the double count
 * cannot form. `misread` is the share who answer for the whole table anyway.
 */
FLOWS.askOnceAccountScoped = (n, misread) => {
  const m = new Map();
  let i = 0;
  n.memberTruth.forEach((want, id) => {
    i += 1;
    if (!n.shared.has(id)) { m.set(id, want); return; }
    const confused = ((i * 2654435761) % 1000) / 1000 < misread;
    m.set(id, confused ? want * 2 : want);
  });
  return m;
};

function scoped() {
  const MIXES = [
    { key: 'careful', label: 'careful', split: 0.10, share: 0.03 },
    { key: 'typical', label: 'typical', split: 0.25, share: 0.08 },
    { key: 'loose', label: 'loose', split: 0.45, share: 0.15 },
  ];
  const RUNS = 400;
  const pad = (s, w) => String(s).padEnd(w);
  const num = (s, w) => String(s).padStart(w);

  const COLS = [
    ['today', (n) => FLOWS.today(n)],
    ['ask once, table-worded', (n) => FLOWS.askOnce(n)],
    ['account-worded, 30% misread', (n) => FLOWS.askOnceAccountScoped(n, 0.30)],
    ['account-worded, 15% misread', (n) => FLOWS.askOnceAccountScoped(n, 0.15)],
    ['account-worded, 5% misread', (n) => FLOWS.askOnceAccountScoped(n, 0.05)],
  ];

  console.log('');
  console.log('  WORDING THE QUESTION BY ACCOUNT INSTEAD OF BY TABLE');
  console.log('  no table state, no turnover detection, no seat counts');
  console.log('');
  console.log('  ' + pad('mix', 10) + COLS.map(([l]) => num(l, 30)).join(''));
  console.log('  ' + '-'.repeat(160));
  MIXES.forEach((mix) => {
    const wrong = COLS.map(() => [0, 0]);
    const net = COLS.map(() => [0, 0]);
    for (let i = 0; i < RUNS; i += 1) {
      const n = night(i + 1, { splitRate: mix.split, shareRate: mix.share, names: true });
      COLS.forEach(([, fn], c) => {
        const got = fn(n);
        n.memberTruth.forEach((want, id) => {
          const had = got.get(id) || 0;
          wrong[c][1] += 1;
          if (had !== want) wrong[c][0] += 1;
          net[c][0] += had; net[c][1] += want;
        });
      });
    }
    console.log('  ' + pad(mix.label, 10) + COLS.map((col, c) => {
      const p = Math.round((wrong[c][0] / wrong[c][1]) * 1000) / 10;
      const d = net[c][0] - net[c][1];
      const np = Math.round((d / net[c][1]) * 1000) / 10;
      return num(p + '% (net ' + (d >= 0 ? '+' : '') + np + '%)', 30);
    }).join(''));
  });
  console.log('');
}


// =======================================================================
// THE SHIPPED FLOW
//
// Everything above measures the rule that used to bill: MAX of the head
// counts a member entered. What ships now asks once a night, worded about
// the account, and carries the answer on every order as partySize. These
// runs go through the same order.buildOrder and order.memberRollup that the
// app uses, so this measures the system rather than a model of it.
// =======================================================================

/**
 * What the account-scoped question elicits from each membership.
 *
 * "How many are you ordering for tonight - everyone whose meals go on your
 * account." For a table on one membership that is the whole table. Where two
 * memberships share a table it is each one own people, which is the entire
 * reason the question was reworded.
 */
const DECLARES = {
  S1: { 1794: 4 },
  S2a: { 1794: 4 },
  S2b: { 1794: 1, 1276: 3 },
  S3a: { 1794: 4 },
  S3b: { 1794: 4 },
  S3c: { 1794: 4 },
  S4: { 1794: 2, 1276: 2 },
  S5: { 1794: 4, 1276: 4 },
  S6: { 1794: 14 },
  S7: { 1794: 4 },
  S8: { 1794: 2 },
  S9: { 1794: 4 },
  S10: { 1794: 4 },
  S11: { 1794: 4 },
  S12: { 1794: 4, 1276: 1 },
  S13: { 1794: 4 },
  S14: { 1794: 4 },
  S15: { 1794: 1 },
};

/** How a membership ordered, which is the thing that used to decide the bill. */
const METHOD = {
  S1: 'one orders for all', S2a: 'split, one membership', S2b: 'split, two memberships',
  S3a: 'repeat trips', S3b: 'repeat trips', S3c: 'split, one membership',
  S4: 'shared table', S5: 'shared table', S6: 'party over the cap',
  S7: 'voided and redone', S8: 'voided and redone', S9: 'one orders for all',
  S10: 'repeat trips', S11: 'repeat trips', S12: 'shared table',
  S13: 'one orders for all', S14: 'split, one membership', S15: 'repeat trips',
};

/**
 * Replay a scenario the way the app now records it.
 *
 * `misread` is the share of memberships at a SHARED table who answer for the
 * whole table anyway - the residue the wording cannot remove. A declared party
 * is capped at maxGuests because the rules cap it, so a party bigger than that
 * is capped here too rather than wished away.
 */
function runShipped(scenario, opts) {
  const misread = (opts && opts.misread) || 0;
  ticket = 0;
  const declares = DECLARES[scenario.id] || {};
  const shared = Object.keys(declares).length > 1;
  const tableTotal = Object.values(declares).reduce((a, n) => a + n, 0);

  let i = 0;
  return scenario.acts.map((a, idx) => {
    i += 1;
    let party = declares[a.member];
    if (party == null) party = a.guests;
    if (shared && ((i * 2654435761) % 1000) / 1000 < misread) party = tableTotal;
    party = Math.min(party, config.order.maxPartySize);
    return place(Object.assign({}, a, { party }), a.at == null ? idx * 2 : a.at);
  });
}

function shipped() {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);

  const rows = SCENARIOS.map((s) => {
    const before = order.billableCovers(run(s));
    const after = order.billableCovers(runShipped(s));
    const live = run(s).filter((o) => o.status !== order.STATUS.VOIDED);
    return {
      id: s.id, method: METHOD[s.id] || '?', truth: s.truth,
      orders: s.acts.length,
      items: live.reduce((a, o) => a + o.lines.length, 0),
      before: before, after: after,
      wasOff: before - s.truth, nowOff: after - s.truth,
    };
  });

  console.log('');
  console.log('  CHARGES ON THE SHIPPED SYSTEM, PER SCENARIO');
  console.log('');
  console.log('  ' + pad('ID', 5) + pad('How they ordered', 24) + num('Ate', 5)
    + num('Orders', 8) + num('Items', 7) + num('Was', 6) + num('Now', 6) + '  Result');
  console.log('  ' + '-'.repeat(90));
  rows.forEach((r) => {
    const verdict = r.nowOff === 0
      ? (r.wasOff === 0 ? 'correct' : 'FIXED (was ' + (r.wasOff > 0 ? '+' : '') + r.wasOff + ')')
      : (r.nowOff > 0 ? 'OVER by ' + r.nowOff : 'UNDER by ' + Math.abs(r.nowOff));
    console.log('  ' + pad(r.id, 5) + pad(r.method, 24) + num(r.truth, 5)
      + num(r.orders, 8) + num(r.items, 7) + num(r.before, 6) + num(r.after, 6)
      + '  ' + verdict);
  });

  const wrongBefore = rows.filter((r) => r.wasOff !== 0);
  const wrongAfter = rows.filter((r) => r.nowOff !== 0);
  console.log('  ' + '-'.repeat(90));
  console.log('  ' + pad('', 29) + num(rows.reduce((a, r) => a + r.truth, 0), 5)
    + num(rows.reduce((a, r) => a + r.orders, 0), 8)
    + num(rows.reduce((a, r) => a + r.items, 0), 7)
    + num(rows.reduce((a, r) => a + r.before, 0), 6)
    + num(rows.reduce((a, r) => a + r.after, 0), 6));
  console.log('');
  console.log('  scenarios wrong: ' + wrongBefore.length + ' before, ' + wrongAfter.length + ' now');
  console.log('  covers in error: '
    + rows.reduce((a, r) => a + Math.abs(r.wasOff), 0) + ' before, '
    + rows.reduce((a, r) => a + Math.abs(r.nowOff), 0) + ' now');

  const byMethod = {};
  rows.forEach((r) => {
    if (!byMethod[r.method]) byMethod[r.method] = { n: 0, before: 0, after: 0, truth: 0 };
    const m = byMethod[r.method];
    m.n += 1;
    m.truth += r.truth;
    m.before += Math.abs(r.wasOff);
    m.after += Math.abs(r.nowOff);
  });
  console.log('');
  console.log('  BY HOW THE MEMBERSHIP ORDERED');
  console.log('  ' + pad('method', 24) + num('cases', 7) + num('ate', 6)
    + num('error was', 16) + num('error now', 16));
  console.log('  ' + '-'.repeat(69));
  Object.entries(byMethod)
    .sort(function (a, b) { return b[1].before - a[1].before; })
    .forEach(function (pair) {
      const k = pair[0];
      const m = pair[1];
      const pct = (n) => (m.truth ? Math.round((n / m.truth) * 1000) / 10 : 0) + '%';
      console.log('  ' + pad(k, 24) + num(m.n, 7) + num(m.truth, 6)
        + num(m.before + ' (' + pct(m.before) + ')', 16)
        + num(m.after + ' (' + pct(m.after) + ')', 16));
    });
  console.log('');
}


/**
 * Whole nights through the shipped billing.
 *
 * night() is reused, but every order now carries the party its membership
 * declared, and the charge comes from order.memberRollup() - the same function
 * close-out calls. `misread` is the share of memberships at a shared table who
 * answer for the whole table anyway.
 */
function nightShipped(seed, opts) {
  const o = opts || {};
  const misread = o.misread || 0;
  const n = night(seed, o);

  // Re-stamp each order with what its membership would have declared.
  let i = 0;
  const declared = n.orders.map((ord) => {
    i += 1;
    const key = String(ord.memberNumber);
    let party = n.memberTruth.get(key) || ord.guestCount;
    if (n.shared.has(key) && ((i * 2654435761) % 1000) / 1000 < misread) {
      // Reads the question as being about the table: counts the people the
      // other membership brought as well.
      party *= 2;
    }
    return Object.assign({}, ord, {
      partySize: Math.min(party, config.order.maxGuests),
    });
  });
  return { orders: declared, memberTruth: n.memberTruth };
}

function shippedSim() {
  const MIXES = [
    { key: 'careful', label: 'careful  (10% split, 3% share)', splitRate: 0.10, shareRate: 0.03 },
    { key: 'typical', label: 'typical  (25% split, 8% share)', splitRate: 0.25, shareRate: 0.08 },
    { key: 'loose', label: 'loose    (45% split, 15% share)', splitRate: 0.45, shareRate: 0.15 },
  ];
  const MISREADS = [0, 0.15, 0.30];
  const RUNS = 400;
  const pad = (s, w) => String(s).padEnd(w);
  const num = (s, w) => String(s).padStart(w);

  console.log('');
  console.log('  ' + RUNS + ' nights per mix, through order.memberRollup() - the function');
  console.log('  close-out actually calls. Scored per membership, not per night.');
  console.log('');
  console.log('  ' + pad('mix', 32) + num('old rule', 20)
    + MISREADS.map((m) => num('misread ' + Math.round(m * 100) + '%', 20)).join(''));
  console.log('  ' + '-'.repeat(114));

  MIXES.forEach((mix) => {
    const score = (build) => {
      let wrong = 0; let total = 0; let got = 0; let want = 0;
      for (let i = 0; i < RUNS; i += 1) {
        const n = build(i + 1);
        const rows = order.memberRollup(n.orders);
        const by = new Map(rows.map((r) => [r.memberNumber, r.partySize]));
        n.memberTruth.forEach((w, id) => {
          const had = by.get(id) || 0;
          total += 1;
          if (had !== w) wrong += 1;
          got += had; want += w;
        });
      }
      return {
        wrong: Math.round((wrong / total) * 1000) / 10,
        net: Math.round(((got - want) / want) * 1000) / 10,
      };
    };

    const cells = [];
    const old = score((s) => night(s, { splitRate: mix.splitRate, shareRate: mix.shareRate }));
    cells.push(old.wrong + '% (' + (old.net >= 0 ? '+' : '') + old.net + '%)');
    MISREADS.forEach((m) => {
      const r = score((s) => nightShipped(s, {
        splitRate: mix.splitRate, shareRate: mix.shareRate, misread: m,
      }));
      cells.push(r.wrong + '% (' + (r.net >= 0 ? '+' : '') + r.net + '%)');
    });
    console.log('  ' + pad(mix.label, 32) + cells.map((c) => num(c, 20)).join(''));
  });

  console.log('');
  console.log('  Left column is the rule that used to bill. The rest is what ships,');
  console.log('  as more memberships at a shared table answer for the whole table.');
  console.log('  First figure is memberships billed wrong; the bracket is the error');
  console.log('  on the night total.');
  console.log('');
}

if (process.argv.includes('--shipped')) shipped();

if (process.argv.includes('--scoped')) scoped();


if (process.argv.includes('--report-json')) {
  console.log(JSON.stringify(reportData(), null, 1));
}

if (process.argv.includes('--shipped-sim')) shippedSim();