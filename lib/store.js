'use strict';

const fs = require('fs');
const path = require('path');
const { config, serviceDate, tagById } = require('./config');
const menu = require('./menu');
const cooktime = require('./cooktime');
const ids = require('./ids');
const bus = require('./bus');

/**
 * ORDER LIFECYCLE
 *
 *            submit          accept           ready            deliver
 *   (draft) -------> QUEUED --------> COOKING -------> READY ------------> DELIVERED
 *                     |  ^              |  ^            |  ^                 |
 *              hold   |  | release      |  | (undo)     |  | (undo)          | (undo,
 *                     v  |       (undo) v  |            v  |                 |  2 min)
 *                     HELD  <-----------+  +------------+  +-----------------+
 *
 *   Any live state can be VOIDED (comp/mistake) - a terminal, auditable stop.
 *
 * Every transition appends to order.events, so the chit carries its own audit
 * trail and the metrics screen never has to guess.
 */
const STATUS = {
  QUEUED: 'queued',
  COOKING: 'cooking',
  READY: 'ready',
  DELIVERED: 'delivered',
  HELD: 'held',
  VOIDED: 'voided',
};

const LIVE_STATUSES = [STATUS.QUEUED, STATUS.COOKING, STATUS.READY, STATUS.HELD];

/** action -> { from: [...], to, stamp } */
const TRANSITIONS = {
  accept:    { from: [STATUS.QUEUED],    to: STATUS.COOKING,   stamp: 'acceptedAt' },
  ready:     { from: [STATUS.COOKING],   to: STATUS.READY,     stamp: 'readyAt' },
  deliver:   { from: [STATUS.READY],     to: STATUS.DELIVERED, stamp: 'deliveredAt' },
  hold:      { from: [STATUS.QUEUED],    to: STATUS.HELD,      stamp: 'heldAt' },
  release:   { from: [STATUS.HELD],      to: STATUS.QUEUED,    stamp: 'releasedAt' },
  rush:      { from: LIVE_STATUSES,      to: null,             stamp: 'rushedAt' },
  void:      { from: LIVE_STATUSES,      to: STATUS.VOIDED,    stamp: 'voidedAt' },
  // Undo paths. Kept as first-class transitions rather than mutations so a
  // mis-tap on a busy line is recoverable and still shows up in the audit log.
  unaccept:  { from: [STATUS.COOKING],   to: STATUS.QUEUED,    stamp: null, clears: ['acceptedAt'] },
  unready:   { from: [STATUS.READY],     to: STATUS.COOKING,   stamp: null, clears: ['readyAt'] },
  undeliver: { from: [STATUS.DELIVERED], to: STATUS.READY,     stamp: null, clears: ['deliveredAt'], window: 'undoWindowSec' },
};

class Store {
  constructor() {
    /** @type {Map<string, object>} */
    this.orders = new Map();
    this.ticketCounters = {}; // serviceDate -> last ticket number
    this.stationCursor = 0;
    this._saveTimer = null;
    this.stateFile = path.join(__dirname, '..', config.persistence.file);
  }

  // ---------------------------------------------------------------- lifecycle

  load({ fresh = false } = {}) {
    if (fresh) return this;
    try {
      const raw = fs.readFileSync(this.stateFile, 'utf8');
      const data = JSON.parse(raw);
      (data.orders || []).forEach((o) => this.orders.set(o.id, o));
      this.ticketCounters = data.ticketCounters || {};
      console.log('[store] restored ' + this.orders.size + ' orders');
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[store] could not restore state:', err.message);
    }
    return this;
  }

  save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      const payload = {
        savedAt: new Date().toISOString(),
        ticketCounters: this.ticketCounters,
        orders: [...this.orders.values()],
      };
      try {
        fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
        fs.writeFileSync(this.stateFile, JSON.stringify(payload, null, 2));
      } catch (err) {
        console.error('[store] save failed:', err.message);
      }
    }, config.persistence.debounceMs);
  }

  // ------------------------------------------------------------------ helpers

  nextTicket(date) {
    const last = this.ticketCounters[date] || 0;
    const next = last + 1;
    this.ticketCounters[date] = next;
    return next;
  }

  nextStation() {
    const stations = config.kitchen.stations;
    if (!config.kitchen.autoAssignStations) return stations[0].id;
    const station = stations[this.stationCursor % stations.length];
    this.stationCursor += 1;
    return station.id;
  }

  get(id) {
    return this.orders.get(id) || null;
  }

  /** Orders still in play, oldest submission first. */
  live(filter = {}) {
    return this.list({ ...filter, statuses: filter.statuses || LIVE_STATUSES });
  }

  list({ statuses, station, date, memberNumber } = {}) {
    const wantDate = date || serviceDate();
    let out = [...this.orders.values()].filter((o) => o.serviceDate === wantDate);
    if (statuses) out = out.filter((o) => statuses.includes(o.status));
    if (station) out = out.filter((o) => o.station === station);
    if (memberNumber) out = out.filter((o) => o.memberNumber === memberNumber);
    return out.sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
  }

  queueDepth(station) {
    return this.live({ station, statuses: [STATUS.QUEUED, STATUS.COOKING] }).length;
  }

  // ------------------------------------------------------------------- submit

  /**
   * Turn a guest draft into a live chit. Throws a VALIDATION error carrying a
   * list of plain-English problems - the guest UI shows them verbatim.
   */
  submit(draft, meta = {}) {
    const errors = [];
    const memberNumber = String(draft.memberNumber || '').trim();
    if (!config.order.memberNumberPattern.test(memberNumber)) {
      errors.push('Member number must be 4 to 6 digits.');
    }

    const guestCount = Number(draft.guestCount);
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > config.order.maxGuests) {
      errors.push('Guest count must be between 1 and ' + config.order.maxGuests + '.');
    }

    const rawLines = Array.isArray(draft.lines) ? draft.lines : [];
    if (rawLines.length === 0) errors.push('Add at least one bowl to the order.');
    rawLines.forEach((line, i) => {
      menu.validateLine(line, config.order).forEach((e) => errors.push('Bowl ' + (i + 1) + ': ' + e));
    });

    const tag = draft.tag ? tagById(draft.tag) : null;
    if (draft.tag && !tag) errors.push('Unknown table code - rescan the QR at your table.');

    if (errors.length > 0) {
      const err = new Error('Order failed validation');
      err.code = 'VALIDATION';
      err.errors = errors;
      throw err;
    }

    const date = serviceDate();
    const now = new Date().toISOString();
    const station = draft.station || this.nextStation();

    const lines = rawLines.map((line, i) => ({
      lineId: ids.lineId(i + 1),
      guestLabel: String(line.guestLabel || 'Guest ' + (i + 1)).slice(0, 24),
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

    const allergenFlags = [...new Set(lines.flatMap((l) => l.allergens))];
    const avoid = Array.isArray(draft.avoidAllergens) ? draft.avoidAllergens : [];
    const cookEstimateSec = cooktime.orderCookSec(lines);
    const promise = cooktime.promiseSec(lines, this.queueDepth(station));

    const order = {
      id: ids.orderId(),
      ticketNo: this.nextTicket(date),
      claimCode: ids.claimCode(),
      serviceDate: date,

      memberNumber,
      memberName: String(draft.memberName || '').slice(0, 48),
      memberStatus: draft.memberStatus || 'unverified',
      memberTier: draft.memberTier || 'guest',

      guestCount,
      tag: tag ? tag.id : null,
      tagLabel: tag ? tag.label : 'Walk-up',
      tagKind: tag ? tag.kind : 'pickup',
      source: draft.source || 'qr',
      userAgent: String(meta.userAgent || '').slice(0, 120),

      station,
      status: STATUS.QUEUED,
      priority: avoid.length > 0 ? 'allergy' : 'normal',

      createdAt: draft.startedAt || now,
      submittedAt: now,
      acceptedAt: null, readyAt: null, deliveredAt: null,
      heldAt: null, releasedAt: null, rushedAt: null, voidedAt: null,
      acceptedBy: null, readyBy: null, deliveredBy: null,

      lines,
      allergenFlags,
      avoidAllergens: avoid,
      notes: String(draft.notes || '').slice(0, 240),

      cookEstimateSec,
      promiseSec: promise,
      promisedReadyAt: new Date(Date.now() + promise * 1000).toISOString(),
      totalPrice: Math.round(lines.reduce((a, l) => a + l.price, 0) * 100) / 100,

      events: [{ at: now, action: 'submit', from: null, to: STATUS.QUEUED, actor: 'guest', note: '' }],
    };

    this.orders.set(order.id, order);
    this.save();
    bus.publish('order.created', { order });
    return order;
  }

  // --------------------------------------------------------------- transitions

  /** Which buttons the kitchen UI should offer for an order right now. */
  allowedActions(order) {
    return Object.entries(TRANSITIONS)
      .filter(([action, spec]) => {
        if (!spec.from.includes(order.status)) return false;
        if (action === 'rush' && order.priority === 'rush') return false;
        if (spec.window) {
          const stampedAt = order[TRANSITIONS[undoTarget(action)].stamp];
          if (!stampedAt) return false;
          const age = (Date.now() - new Date(stampedAt).getTime()) / 1000;
          if (age > config.sla[spec.window]) return false;
        }
        return true;
      })
      .map(([action]) => action);
  }

  /**
   * Apply a lifecycle action. Rejects anything the state machine does not
   * allow, so a double-tap on ACCEPT from two screens cannot corrupt a chit.
   */
  transition(id, action, { actor = 'kitchen', note = '' } = {}) {
    const order = this.get(id);
    if (!order) {
      const err = new Error('Order not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    const spec = TRANSITIONS[action];
    if (!spec) {
      const err = new Error('Unknown action: ' + action);
      err.code = 'BAD_ACTION';
      throw err;
    }

    if (!this.allowedActions(order).includes(action)) {
      const err = new Error('Cannot ' + action + ' an order that is ' + order.status);
      err.code = 'ILLEGAL_TRANSITION';
      err.status = order.status;
      err.allowed = this.allowedActions(order);
      throw err;
    }

    const now = new Date().toISOString();
    const from = order.status;

    if (spec.clears) spec.clears.forEach((field) => { order[field] = null; });
    if (spec.stamp) order[spec.stamp] = now;
    if (spec.to) order.status = spec.to;

    if (action === 'rush') order.priority = 'rush';
    if (action === 'accept') order.acceptedBy = actor;
    if (action === 'ready') order.readyBy = actor;
    if (action === 'deliver') order.deliveredBy = actor;
    if (action === 'unaccept') order.acceptedBy = null;
    if (action === 'unready') order.readyBy = null;
    if (action === 'undeliver') order.deliveredBy = null;

    order.events.push({ at: now, action, from, to: order.status, actor, note: String(note || '').slice(0, 140) });

    this.save();
    bus.publish('order.updated', { order, action, from, actor });
    return order;
  }

  // ------------------------------------------------------------------ metrics

  metrics(date = serviceDate()) {
    const all = this.list({ date });
    const done = all.filter((o) => o.status === STATUS.DELIVERED);
    const secs = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 1000;

    const queueWaits = done.filter((o) => o.acceptedAt).map((o) => secs(o.submittedAt, o.acceptedAt));
    const cookTimes = done.filter((o) => o.acceptedAt && o.readyAt).map((o) => secs(o.acceptedAt, o.readyAt));
    const runnerTimes = done.filter((o) => o.readyAt && o.deliveredAt).map((o) => secs(o.readyAt, o.deliveredAt));
    const totalTimes = done.map((o) => secs(o.submittedAt, o.deliveredAt));

    const onTimeCount = done.filter((o) => {
      if (!o.acceptedAt || !o.readyAt) return false;
      return secs(o.acceptedAt, o.readyAt) <= o.cookEstimateSec * config.sla.cookLateFactor;
    }).length;

    const byQuarterHour = {};
    all.forEach((o) => {
      const d = new Date(o.submittedAt);
      const q = String(d.getHours()).padStart(2, '0') + ':' + String(Math.floor(d.getMinutes() / 15) * 15).padStart(2, '0');
      byQuarterHour[q] = (byQuarterHour[q] || 0) + 1;
    });

    return {
      serviceDate: date,
      counts: {
        total: all.length,
        queued: all.filter((o) => o.status === STATUS.QUEUED).length,
        cooking: all.filter((o) => o.status === STATUS.COOKING).length,
        ready: all.filter((o) => o.status === STATUS.READY).length,
        delivered: done.length,
        held: all.filter((o) => o.status === STATUS.HELD).length,
        voided: all.filter((o) => o.status === STATUS.VOIDED).length,
      },
      covers: all.filter((o) => o.status !== STATUS.VOIDED).reduce((a, o) => a + o.guestCount, 0),
      bowls: all.filter((o) => o.status !== STATUS.VOIDED).reduce((a, o) => a + o.lines.length, 0),
      revenue: Math.round(all.filter((o) => o.status !== STATUS.VOIDED).reduce((a, o) => a + o.totalPrice, 0) * 100) / 100,
      timings: {
        avgQueueSec: average(queueWaits),
        avgCookSec: average(cookTimes),
        avgRunnerSec: average(runnerTimes),
        avgTotalSec: average(totalTimes),
        p90TotalSec: percentile(totalTimes, 90),
      },
      onTimePct: done.length ? Math.round((onTimeCount / done.length) * 100) : null,
      byQuarterHour,
    };
  }

  /** Wipe the current service date. Demo/admin only. */
  reset() {
    const date = serviceDate();
    [...this.orders.values()].filter((o) => o.serviceDate === date).forEach((o) => this.orders.delete(o.id));
    this.ticketCounters[date] = 0;
    this.save();
    bus.publish('store.reset', { serviceDate: date });
  }
}

function undoTarget(action) {
  return { unaccept: 'accept', unready: 'ready', undeliver: 'deliver' }[action] || action;
}

function average(list) {
  if (!list.length) return 0;
  return Math.round(list.reduce((a, b) => a + b, 0) / list.length);
}

function percentile(list, p) {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, idx)]);
}

const store = new Store();

module.exports = { store, Store, STATUS, LIVE_STATUSES, TRANSITIONS };
