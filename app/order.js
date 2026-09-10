/**
 * The order model: lifecycle, validation, derived fields, metrics.
 *
 * Deliberately free of any Firebase import. Everything here is a pure function
 * over plain objects, which means:
 *   - the same code runs in the browser and in scripts/selftest.js under Node
 *   - the state machine can be unit-tested without a network or an emulator
 *   - app/db.js is the only file that knows Firestore exists
 *
 * ORDER LIFECYCLE
 *
 *            submit          accept           ready            deliver
 *   (draft) -------> QUEUED --------> COOKING -------> READY ------------> DELIVERED
 *                     |  ^              |  ^            |  ^                 |
 *              hold   |  | release      |  | unaccept   |  | unready         | undeliver
 *                     v  |              |  |            |  |                 | (time-boxed)
 *                     HELD  <-----------+  +------------+  +-----------------+
 *
 *   Any live status can be VOIDED (comp/mistake) - a terminal, auditable stop.
 */
import * as menu from './menu.js';
import * as cooktime from './cooktime.js';

export const STATUS = {
  QUEUED: 'queued',
  COOKING: 'cooking',
  READY: 'ready',
  DELIVERED: 'delivered',
  HELD: 'held',
  VOIDED: 'voided',
};

export const LIVE_STATUSES = [STATUS.QUEUED, STATUS.COOKING, STATUS.READY, STATUS.HELD];

/** action -> { from: [...], to, stamp, clears, window } */
export const TRANSITIONS = {
  accept:    { from: [STATUS.QUEUED],    to: STATUS.COOKING,   stamp: 'acceptedAt' },
  ready:     { from: [STATUS.COOKING],   to: STATUS.READY,     stamp: 'readyAt' },
  deliver:   { from: [STATUS.READY],     to: STATUS.DELIVERED, stamp: 'deliveredAt' },
  hold:      { from: [STATUS.QUEUED],    to: STATUS.HELD,      stamp: 'heldAt' },
  release:   { from: [STATUS.HELD],      to: STATUS.QUEUED,    stamp: 'releasedAt' },
  rush:      { from: LIVE_STATUSES,      to: null,             stamp: 'rushedAt' },
  void:      { from: LIVE_STATUSES,      to: STATUS.VOIDED,    stamp: 'voidedAt' },
  // Undo paths are first-class transitions, not mutations, so a mis-tap during
  // a rush is recoverable and still shows up in the audit trail.
  unaccept:  { from: [STATUS.COOKING],   to: STATUS.QUEUED,    stamp: null, clears: ['acceptedAt'] },
  unready:   { from: [STATUS.READY],     to: STATUS.COOKING,   stamp: null, clears: ['readyAt'] },
  undeliver: { from: [STATUS.DELIVERED], to: STATUS.READY,     stamp: null, clears: ['deliveredAt'], window: 'undoWindowSec' },
};

const UNDO_TARGET = { unaccept: 'accept', unready: 'ready', undeliver: 'deliver' };

/** Which buttons a screen should offer for this order right now. */
export function allowedActions(order, sla, now = Date.now()) {
  return Object.entries(TRANSITIONS)
    .filter(([action, spec]) => {
      if (!spec.from.includes(order.status)) return false;
      if (action === 'rush' && order.priority === 'rush') return false;
      if (spec.window) {
        const stampedAt = order[TRANSITIONS[UNDO_TARGET[action]].stamp];
        if (!stampedAt) return false;
        if ((now - new Date(stampedAt).getTime()) / 1000 > sla[spec.window]) return false;
      }
      return true;
    })
    .map(([action]) => action);
}

/**
 * Validate a guest draft. Returns plain-English problems, safe to display.
 *
 * `unavailable` is the list of 86'd ingredient ids. It is checked here rather
 * than only in the UI so an order cannot slip through from a stale tab that
 * still shows something the kitchen has run out of.
 */
export function validateDraft(draft, cfg, unavailable = []) {
  const errors = [];
  const memberNumber = String(draft.memberNumber || '').trim();
  if (!cfg.order.memberNumberPattern.test(memberNumber)) {
    errors.push('Member number must be four digits.');
  }

  const guestCount = Number(draft.guestCount);
  if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > cfg.order.maxGuests) {
    errors.push(`Guest count must be between 1 and ${cfg.order.maxGuests}.`);
  }

  const lines = Array.isArray(draft.lines) ? draft.lines : [];
  if (lines.length === 0) errors.push('Add at least one item to the order.');

  // One order, one station. A table wanting both pasta and pizza sends two
  // orders, because the two are cooked by different people on different
  // equipment and neither should wait on the other.
  const kinds = [...new Set(lines.map(menu.kindOf))];
  if (kinds.length > 1) {
    errors.push('Send pasta and pizza as separate orders - they cook at different stations.');
  }
  lines.forEach((line, i) => {
    // Name the thing the guest is looking at: "Pizza 2", not "Bowl 2".
    const label = (menu.kindOf(line) === 'pizza' ? 'Pizza ' : 'Bowl ') + (i + 1);
    menu.validateLine(line, cfg.order).forEach((e) => errors.push(`${label}: ${e}`));

    if (unavailable.length) {
      const chosen = [
        line.pasta,
        ...menu.saucesOf(line),
        line.protein,
        ...(line.toppings || []),
        ...(line.sides || []),
      ].filter(Boolean);
      const gone = [...new Set(chosen.filter((id) => unavailable.includes(id)))];
      gone.forEach((id) => {
        const item = menu.findAnywhere(id);
        errors.push(`${label}: ${item ? item.name : id} just sold out - please pick something else.`);
      });
    }
  });

  return errors;
}

/**
 * Turn a validated draft into a complete order document.
 *
 * Derived fields (allergens, cook seconds, dish text, estimates) are computed
 * here rather than trusted from whatever the form posted, so a tampered client
 * cannot invent a cook time that the kitchen and the metrics then believe.
 * Nothing is priced - charges post against the member number elsewhere.
 *
 * @param {object} draft     guest input
 * @param {object} ctx       { ticketNo, claimCode, station, queueDepth, tag, serviceDate, now }
 */
export function buildOrder(draft, ctx) {
  const nowIso = (ctx.now || new Date()).toISOString();

  const kind = menu.kindOf((draft.lines || [])[0] || {});

  const lines = (draft.lines || []).map((line, i) => {
    const common = {
      lineId: 'ln' + String(i + 1).padStart(2, '0'),
      guestLabel: String(line.guestLabel || `Guest ${i + 1}`).slice(0, 24),
      kind,
      sauces: menu.saucesOf(line),
      toppings: line.toppings || [],
      notes: String(line.notes || '').slice(0, 140),
      allergens: menu.allergensFor(line),
      cookSec: cooktime.lineCookSec(line),
      dish: menu.describe(line),
    };

    if (kind === 'pizza') {
      // No portion (every pizza is the same size), no protein or sides - meats
      // are just toppings on a pizza - and finishers instead of a spice level.
      return { ...common, finishers: line.finishers || [] };
    }

    return {
      ...common,
      pasta: line.pasta,
      protein: line.protein || 'none',
      sides: line.sides || [],
      portion: line.portion,
      spice: line.spice || 'mild',
    };
  });

  const avoid = Array.isArray(draft.avoidAllergens) ? draft.avoidAllergens : [];
  const cookEstimateSec = cooktime.orderCookSec(lines);
  const promise = cooktime.promiseSec(lines, ctx.queueDepth || 0);

  return {
    ticketNo: ctx.ticketNo,
    claimCode: ctx.claimCode,
    serviceDate: ctx.serviceDate,

    memberNumber: String(draft.memberNumber || '').trim(),
    memberName: String(draft.memberName || '').slice(0, 48),
    memberStatus: draft.memberStatus || 'unverified',
    memberTier: draft.memberTier || 'guest',

    kind,
    guestCount: Number(draft.guestCount),
    tag: ctx.tag ? ctx.tag.id : null,
    tagLabel: ctx.tag ? ctx.tag.label : 'Walk-up',
    tagKind: ctx.tag ? ctx.tag.kind : 'pickup',
    source: draft.source || 'qr',

    station: ctx.station,
    status: STATUS.QUEUED,
    priority: avoid.length > 0 ? 'allergy' : 'normal',

    createdAt: draft.startedAt || nowIso,
    submittedAt: nowIso,
    acceptedAt: null, readyAt: null, deliveredAt: null,
    heldAt: null, releasedAt: null, rushedAt: null, voidedAt: null,
    acceptedBy: null, readyBy: null, deliveredBy: null,

    lines,
    allergenFlags: [...new Set(lines.flatMap((l) => l.allergens))],
    avoidAllergens: avoid,
    notes: String(draft.notes || '').slice(0, 240),

    cookEstimateSec,
    promiseSec: promise,
    promisedReadyAt: new Date((ctx.now || new Date()).getTime() + promise * 1000).toISOString(),

    events: [{ at: nowIso, action: 'submit', from: null, to: STATUS.QUEUED, actor: 'guest', note: '' }],
  };
}

/**
 * Compute the field changes for a lifecycle action, or throw if the state
 * machine forbids it. Returns a patch to merge, never a mutated input - the
 * caller decides whether that becomes a Firestore update or a local edit.
 */
export function transitionPatch(order, action, { actor = 'kitchen', note = '', sla, now = new Date() } = {}) {
  const spec = TRANSITIONS[action];
  if (!spec) {
    throw Object.assign(new Error(`Unknown action: ${action}`), { code: 'BAD_ACTION' });
  }
  const allowed = allowedActions(order, sla, now.getTime());
  if (!allowed.includes(action)) {
    throw Object.assign(
      new Error(`Cannot ${action} an order that is ${order.status}`),
      { code: 'ILLEGAL_TRANSITION', status: order.status, allowed },
    );
  }

  const nowIso = now.toISOString();
  const patch = {};

  if (spec.clears) spec.clears.forEach((field) => { patch[field] = null; });
  if (spec.stamp) patch[spec.stamp] = nowIso;
  if (spec.to) patch.status = spec.to;

  if (action === 'rush') patch.priority = 'rush';
  if (action === 'accept') patch.acceptedBy = actor;
  if (action === 'ready') patch.readyBy = actor;
  if (action === 'deliver') patch.deliveredBy = actor;
  if (action === 'unaccept') patch.acceptedBy = null;
  if (action === 'unready') patch.readyBy = null;
  if (action === 'undeliver') patch.deliveredBy = null;

  patch.events = [
    ...(order.events || []),
    { at: nowIso, action, from: order.status, to: patch.status || order.status, actor, note: String(note || '').slice(0, 140) },
  ];

  return patch;
}

/** Apply a transition locally (used by tests and optimistic UI). */
export function applyTransition(order, action, opts) {
  return { ...order, ...transitionPatch(order, action, opts) };
}

/** Ticket-facing view: no staff names, no station, no audit log. */
export function publicView(order) {
  return {
    id: order.id,
    ticketNo: order.ticketNo,
    claimCode: order.claimCode,
    status: order.status,
    tagLabel: order.tagLabel,
    guestCount: order.guestCount,
    submittedAt: order.submittedAt,
    acceptedAt: order.acceptedAt,
    readyAt: order.readyAt,
    deliveredAt: order.deliveredAt,
    cookEstimateSec: order.cookEstimateSec,
    promiseSec: order.promiseSec,
    promisedReadyAt: order.promisedReadyAt,
    kind: order.kind || 'pasta',
    lines: (order.lines || []).map((l) => ({
      lineId: l.lineId, guestLabel: l.guestLabel, dish: l.dish,
      kind: menu.kindOf(l),
      sauces: menu.saucesOf(l),
      toppings: l.toppings, finishers: l.finishers,
      sides: l.sides, portion: l.portion,
      spice: l.spice, notes: l.notes,
    })),
  };
}

/**
 * One row per member number for a service date.
 *
 * The venue is all-you-can-eat: one price covers pasta AND pizza, so the
 * billable unit is a PERSON, not an order. A party of four that orders pasta
 * and later comes back for pizza is still four covers and one charge.
 *
 * That means party size is the LARGEST head count a member reported that
 * night, not the sum across their orders - summing bills the same table twice,
 * once per trip to the app. Everything else (orders, bowls, pizzas) is a
 * consumption signal rather than a billing one.
 */
export function memberRollup(orders) {
  const live = orders.filter((o) => o.status !== STATUS.VOIDED);
  const byMember = new Map();

  live.forEach((o) => {
    const key = String(o.memberNumber || 'unknown');
    if (!byMember.has(key)) {
      byMember.set(key, {
        memberNumber: key,
        name: '',
        status: 'unverified',
        orders: 0,
        partySize: 0,
        bowls: 0,
        pizzas: 0,
        items: 0,
        firstAt: o.submittedAt,
        lastAt: o.submittedAt,
        kinds: new Set(),
      });
    }
    const m = byMember.get(key);
    m.orders += 1;
    m.partySize = Math.max(m.partySize, Number(o.guestCount) || 0);

    const isPizza = (o.kind || 'pasta') === 'pizza';
    m[isPizza ? 'pizzas' : 'bowls'] += o.lines.length;
    m.items += o.lines.length;
    m.kinds.add(isPizza ? 'pizza' : 'pasta');

    if (o.memberName && !m.name) m.name = o.memberName;
    if (o.memberStatus === 'verified') m.status = 'verified';
    if (new Date(o.submittedAt) < new Date(m.firstAt)) m.firstAt = o.submittedAt;
    if (new Date(o.submittedAt) > new Date(m.lastAt)) m.lastAt = o.submittedAt;
  });

  return [...byMember.values()]
    .map((m) => ({
      ...m,
      kinds: [...m.kinds].sort(),
      itemsPerCover: m.partySize ? Math.round((m.items / m.partySize) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.items - a.items
      || b.partySize - a.partySize
      || a.memberNumber.localeCompare(b.memberNumber));
}

/** Billable AYCE covers: each member's party counted once, however many trips. */
export function billableCovers(orders) {
  return memberRollup(orders).reduce((a, m) => a + m.partySize, 0);
}

const average = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0);

function percentile(list, p) {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, idx)]);
}

/** Roll up a day's orders. Pure, so the manager screen just feeds it a query. */
export function metrics(orders, sla) {
  const secs = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 1000;
  const done = orders.filter((o) => o.status === STATUS.DELIVERED);
  const alive = orders.filter((o) => o.status !== STATUS.VOIDED);

  const queueWaits = done.filter((o) => o.acceptedAt).map((o) => secs(o.submittedAt, o.acceptedAt));
  const cookTimes = done.filter((o) => o.acceptedAt && o.readyAt).map((o) => secs(o.acceptedAt, o.readyAt));
  const runnerTimes = done.filter((o) => o.readyAt && o.deliveredAt).map((o) => secs(o.readyAt, o.deliveredAt));
  const totalTimes = done.map((o) => secs(o.submittedAt, o.deliveredAt));

  const onTime = done.filter((o) => {
    if (!o.acceptedAt || !o.readyAt) return false;
    return secs(o.acceptedAt, o.readyAt) <= o.cookEstimateSec * sla.cookLateFactor;
  }).length;

  const byQuarterHour = {};
  orders.forEach((o) => {
    const d = new Date(o.submittedAt);
    const q = `${String(d.getHours()).padStart(2, '0')}:${String(Math.floor(d.getMinutes() / 15) * 15).padStart(2, '0')}`;
    byQuarterHour[q] = (byQuarterHour[q] || 0) + 1;
  });

  const count = (s) => orders.filter((o) => o.status === s).length;

  return {
    counts: {
      total: orders.length,
      queued: count(STATUS.QUEUED),
      cooking: count(STATUS.COOKING),
      ready: count(STATUS.READY),
      delivered: done.length,
      held: count(STATUS.HELD),
      voided: count(STATUS.VOIDED),
    },
    // Billable covers, not a sum of guest counts: a member who orders pasta and
    // then pizza is one party on one AYCE charge, not two.
    covers: billableCovers(orders),
    guestCountEntries: alive.reduce((a, o) => a + o.guestCount, 0),
    bowls: alive.reduce((a, o) => a + o.lines.length, 0),
    timings: {
      avgQueueSec: average(queueWaits),
      avgCookSec: average(cookTimes),
      avgRunnerSec: average(runnerTimes),
      avgTotalSec: average(totalTimes),
      p90TotalSec: percentile(totalTimes, 90),
    },
    onTimePct: done.length ? Math.round((onTime / done.length) * 100) : null,
    byQuarterHour,
  };
}

/**
 * Which station cooks this ticket.
 *
 * Stations are declared with the kind they cook, so a pizza can never be
 * routed to a pasta rail. Within a kind the choice is derived from the ticket
 * number rather than a live count of each station's load: that needs no
 * database read on the path that places an order, it is deterministic so it can
 * be computed inside the transaction that allocates the number, and with a
 * monotonic sequence it is exact round-robin anyway.
 */
export function stationForTicket(ticketNo, stations, autoAssign = true, kind = 'pasta') {
  const eligible = stations.filter((s) => (s.kind || 'pasta') === kind);
  if (!eligible.length) return null;
  if (!autoAssign) return eligible[0].id;
  return eligible[(Math.max(1, ticketNo) - 1) % eligible.length].id;
}

/** Short claim code shown to the guest so a server can find their ticket. */
export function claimCode(random = Math.random) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

// ------------------------------------------------------- end-of-night report

/**
 * The close-out report a manager reads at the end of service.
 *
 * Pure, like everything else in this file, so scripts/selftest.js can assert
 * the arithmetic without a database. `metrics()` above answers "how is service
 * going right now"; this answers "how did the night go, and what do we prep
 * tomorrow".
 */
export function shiftReport(orders, sla) {
  const secs = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 1000;

  const alive = orders.filter((o) => o.status !== STATUS.VOIDED);
  const done = orders.filter((o) => o.status === STATUS.DELIVERED);
  const voided = orders.filter((o) => o.status === STATUS.VOIDED);
  const held = orders.filter((o) => o.status === STATUS.HELD);

  // ---- timings, over delivered tickets only ------------------------------
  const queueWaits = done.filter((o) => o.acceptedAt).map((o) => secs(o.submittedAt, o.acceptedAt));
  const cookTimes = done.filter((o) => o.acceptedAt && o.readyAt).map((o) => secs(o.acceptedAt, o.readyAt));
  const runnerTimes = done.filter((o) => o.readyAt && o.deliveredAt).map((o) => secs(o.readyAt, o.deliveredAt));
  const totalTimes = done.map((o) => secs(o.submittedAt, o.deliveredAt));

  // ---- who blew the cook SLA, and by how much ---------------------------
  const late = done
    .filter((o) => o.acceptedAt && o.readyAt)
    .map((o) => {
      const cookSec = secs(o.acceptedAt, o.readyAt);
      const allowed = o.cookEstimateSec * sla.cookLateFactor;
      return {
        ticketNo: o.ticketNo,
        tagLabel: o.tagLabel,
        station: o.station,
        bowls: o.lines.length,
        cookSec: Math.round(cookSec),
        estimateSec: o.cookEstimateSec,
        overSec: Math.round(cookSec - allowed),
      };
    })
    .filter((x) => x.overSec > 0)
    .sort((a, b) => b.overSec - a.overSec);

  const onTimeCount = done.filter((o) => o.acceptedAt && o.readyAt).length - late.length;

  // ---- service curve in quarter-hours -----------------------------------
  // Split the curve by kind: a manager wants to see that the pizza rush lands
  // later than the pasta rush, which a single total hides.
  const buckets = {};
  alive.forEach((o) => {
    const d = new Date(o.submittedAt);
    const key = `${String(d.getHours()).padStart(2, '0')}:${String(Math.floor(d.getMinutes() / 15) * 15).padStart(2, '0')}`;
    if (!buckets[key]) {
      buckets[key] = { bucket: key, orders: 0, bowls: 0, pizzas: 0, items: 0, covers: 0 };
    }
    const isPizza = (o.kind || 'pasta') === 'pizza';
    buckets[key].orders += 1;
    buckets[key][isPizza ? 'pizzas' : 'bowls'] += o.lines.length;
    buckets[key].items += o.lines.length;
    buckets[key].covers += o.guestCount;
  });
  const curve = Object.values(buckets).sort((a, b) => a.bucket.localeCompare(b.bucket));
  const peak = curve.reduce((best, b) => (!best || b.items > best.items ? b : best), null);

  // ---- what actually sold, which is what drives tomorrow's prep ---------
  //
  // Split by kind: the pasta cook and the pizza cook prep different lists, and
  // "Marinara x14" means nothing until you know how much of it went on pies.
  const tally = (lines, pick) => {
    const counts = {};
    lines.forEach((line) => {
      pick(line).forEach((id) => { if (id) counts[id] = (counts[id] || 0) + 1; });
    });
    return Object.entries(counts)
      .map(([id, count]) => {
        const item = menu.findAnywhere(id);
        return { id, name: item ? item.name : id, count };
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  };

  const linesOfKind = (kind) => alive
    .filter((o) => (o.kind || 'pasta') === kind)
    .flatMap((o) => o.lines);

  const pastaLines = linesOfKind('pasta');
  const pizzaLines = linesOfKind('pizza');

  const mix = {
    pasta: {
      pastas: tally(pastaLines, (l) => [l.pasta]),
      sauces: tally(pastaLines, (l) => menu.saucesOf(l)),
      proteins: tally(pastaLines, (l) => [l.protein]),
      toppings: tally(pastaLines, (l) => l.toppings || []),
      sides: tally(pastaLines, (l) => l.sides || []),
      portions: tally(pastaLines, (l) => [l.portion]),
    },
    pizza: {
      sauces: tally(pizzaLines, (l) => menu.saucesOf(l)),
      toppings: tally(pizzaLines, (l) => l.toppings || []),
      finishers: tally(pizzaLines, (l) => l.finishers || []),
    },
  };

  const byKind = ['pasta', 'pizza'].reduce((acc, kind) => {
    const mine = alive.filter((o) => (o.kind || 'pasta') === kind);
    acc[kind] = {
      orders: mine.length,
      items: mine.reduce((a, o) => a + o.lines.length, 0),
      covers: mine.reduce((a, o) => a + o.guestCount, 0),
    };
    return acc;
  }, {});

  // ---- per station -------------------------------------------------------
  const stationIds = [...new Set(alive.map((o) => o.station).filter(Boolean))].sort();
  const stations = stationIds.map((id) => {
    const mine = alive.filter((o) => o.station === id);
    const mineCooked = mine.filter((o) => o.acceptedAt && o.readyAt).map((o) => secs(o.acceptedAt, o.readyAt));
    return {
      id,
      orders: mine.length,
      bowls: mine.reduce((a, o) => a + o.lines.length, 0),
      avgCookSec: average(mineCooked),
    };
  });

  const bowls = alive.reduce((a, o) => a + o.lines.length, 0);
  const members = memberRollup(orders);
  const covers = members.reduce((a, m) => a + m.partySize, 0);

  return {
    serviceDate: orders.length ? orders[0].serviceDate : null,
    generatedAt: new Date().toISOString(),
    totals: {
      orders: alive.length,
      delivered: done.length,
      voided: voided.length,
      held: held.length,
      stillOpen: alive.filter((o) => LIVE_STATUSES.includes(o.status)).length,
      covers,
      members: members.length,
      repeatOrders: Math.max(0, alive.length - members.length),
      bowls,
      bowlsPerCover: covers ? Math.round((bowls / covers) * 100) / 100 : 0,
    },
    members,
    timings: {
      avgQueueSec: average(queueWaits),
      avgCookSec: average(cookTimes),
      avgRunnerSec: average(runnerTimes),
      avgTotalSec: average(totalTimes),
      p90TotalSec: percentile(totalTimes, 90),
      worstTotalSec: totalTimes.length ? Math.round(Math.max(...totalTimes)) : 0,
    },
    onTime: {
      pct: done.length ? Math.round((onTimeCount / Math.max(1, onTimeCount + late.length)) * 100) : null,
      count: onTimeCount,
      lateCount: late.length,
    },
    late,
    curve,
    peak,
    mix,
    byKind,
    stations,
    exceptions: {
      voided: voided.map((o) => ({ ticketNo: o.ticketNo, tagLabel: o.tagLabel })),
      held: held.map((o) => ({ ticketNo: o.ticketNo, tagLabel: o.tagLabel })),
      rushed: alive.filter((o) => o.priority === 'rush').map((o) => ({ ticketNo: o.ticketNo, tagLabel: o.tagLabel })),
      allergy: alive.filter((o) => (o.avoidAllergens || []).length)
        .map((o) => ({ ticketNo: o.ticketNo, tagLabel: o.tagLabel, avoid: o.avoidAllergens })),
      unverifiedMembers: alive.filter((o) => o.memberStatus === 'unverified')
        .map((o) => ({ ticketNo: o.ticketNo, memberNumber: o.memberNumber })),
    },
  };
}
