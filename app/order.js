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

/** Validate a guest draft. Returns plain-English problems, safe to display. */
export function validateDraft(draft, cfg) {
  const errors = [];
  const memberNumber = String(draft.memberNumber || '').trim();
  if (!cfg.order.memberNumberPattern.test(memberNumber)) {
    errors.push('Member number must be 4 to 6 digits.');
  }

  const guestCount = Number(draft.guestCount);
  if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > cfg.order.maxGuests) {
    errors.push(`Guest count must be between 1 and ${cfg.order.maxGuests}.`);
  }

  const lines = Array.isArray(draft.lines) ? draft.lines : [];
  if (lines.length === 0) errors.push('Add at least one bowl to the order.');
  lines.forEach((line, i) => {
    menu.validateLine(line, cfg.order).forEach((e) => errors.push(`Bowl ${i + 1}: ${e}`));
  });

  return errors;
}

/**
 * Turn a validated draft into a complete order document.
 *
 * Derived fields (allergens, cook seconds, prices, dish text, estimates) are
 * computed here rather than trusted from whatever the form posted, so a
 * tampered client cannot invent a price or a cook time that the kitchen and
 * the metrics then believe.
 *
 * @param {object} draft     guest input
 * @param {object} ctx       { ticketNo, claimCode, station, queueDepth, tag, serviceDate, now }
 */
export function buildOrder(draft, ctx) {
  const nowIso = (ctx.now || new Date()).toISOString();

  const lines = (draft.lines || []).map((line, i) => ({
    lineId: 'ln' + String(i + 1).padStart(2, '0'),
    guestLabel: String(line.guestLabel || `Guest ${i + 1}`).slice(0, 24),
    pasta: line.pasta,
    sauce: line.sauce,
    protein: line.protein || 'none',
    toppings: line.toppings || [],
    sides: line.sides || [],
    portion: line.portion,
    spice: line.spice || 'mild',
    notes: String(line.notes || '').slice(0, 140),
    allergens: menu.allergensFor(line),
    cookSec: cooktime.bowlCookSec(line),
    price: menu.priceFor(line),
    dish: menu.describe(line),
  }));

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
    totalPrice: Math.round(lines.reduce((a, l) => a + l.price, 0) * 100) / 100,

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
    totalPrice: order.totalPrice,
    lines: (order.lines || []).map((l) => ({
      lineId: l.lineId, guestLabel: l.guestLabel, dish: l.dish,
      toppings: l.toppings, sides: l.sides, portion: l.portion,
      spice: l.spice, notes: l.notes, price: l.price,
    })),
  };
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
    covers: alive.reduce((a, o) => a + o.guestCount, 0),
    bowls: alive.reduce((a, o) => a + o.lines.length, 0),
    revenue: Math.round(alive.reduce((a, o) => a + o.totalPrice, 0) * 100) / 100,
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
 * Derived from the ticket number rather than from a live count of each
 * station's load. That trades a little cleverness for two real wins: it needs
 * no database read on the path that places an order, and it is deterministic,
 * so it can be computed inside the same transaction that allocates the number.
 * With a monotonic ticket sequence this is exact round-robin anyway.
 */
export function stationForTicket(ticketNo, stations, autoAssign = true) {
  if (!stations.length) return null;
  if (!autoAssign) return stations[0].id;
  return stations[(Math.max(1, ticketNo) - 1) % stations.length].id;
}

/** Short claim code shown to the guest so a server can find their ticket. */
export function claimCode(random = Math.random) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}
