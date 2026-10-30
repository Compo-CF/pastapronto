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
import { config } from './config.js';
import * as menu from './menu.js';
import * as cooktime from './cooktime.js';

export const STATUS = {
  QUEUED: 'queued',
  // Pizza only. A pizza is assembled by one person and baked by another, so
  // between arriving and cooking it sits with the builder - and the rail has
  // to be able to say which of the two is holding it. Pasta and burgers go
  // straight from queued to cooking, because one cook owns the whole dish.
  BUILDING: 'building',
  COOKING: 'cooking',
  READY: 'ready',
  DELIVERED: 'delivered',
  HELD: 'held',
  VOIDED: 'voided',
};

export const LIVE_STATUSES = [
  STATUS.QUEUED, STATUS.BUILDING, STATUS.COOKING, STATUS.READY, STATUS.HELD,
];

/**
 * Which kinds take a build stage.
 *
 * One list, read by the state machine and by every screen that draws lanes, so
 * a night that adds another assembled dish is one entry here rather than a
 * condition in four files.
 */
export const BUILT_KINDS = ['pizza'];

export function isBuilt(kind) {
  return BUILT_KINDS.indexOf(kind || 'pasta') !== -1;
}

/**
 * action -> { from: [...], to, stamp, clears, window, kinds, notKinds }
 *
 * `kinds`/`notKinds` are how one table serves two shapes of service without
 * either screen branching on the dish. A pizza is pushed forward by whoever
 * finishes their part - the builder hands it to the oven - so it never offers
 * `accept`; a bowl has one cook from start to finish, so it never offers
 * `build`. Nothing asks "is this a pizza" outside this table.
 *
 * There is deliberately no acceptance step on either path. A ticket arriving
 * at a station with one dedicated cook is already theirs, so a tap that only
 * said "yes, mine" was screen space spent on ceremony. Every action here is
 * someone finishing a piece of work and handing it on.
 */
export const TRANSITIONS = {
  accept:    { from: [STATUS.QUEUED],    to: STATUS.COOKING,   stamp: 'acceptedAt', notKinds: BUILT_KINDS },
  build:     { from: [STATUS.QUEUED],    to: STATUS.BUILDING,  stamp: 'buildingAt', kinds: BUILT_KINDS },
  // The oven is where a pizza's cook clock starts, so it carries the same
  // stamp `accept` does on a bowl. Cook times and SLA colour read one field
  // and never learn which path got there.
  oven:      { from: [STATUS.BUILDING],  to: STATUS.COOKING,   stamp: 'acceptedAt', kinds: BUILT_KINDS },
  ready:     { from: [STATUS.COOKING],   to: STATUS.READY,     stamp: 'readyAt' },
  deliver:   { from: [STATUS.READY],     to: STATUS.DELIVERED, stamp: 'deliveredAt' },
  hold:      { from: [STATUS.QUEUED, STATUS.BUILDING], to: STATUS.HELD, stamp: 'heldAt' },
  release:   { from: [STATUS.HELD],      to: STATUS.QUEUED,    stamp: 'releasedAt' },
  rush:      { from: LIVE_STATUSES,      to: null,             stamp: 'rushedAt' },
  void:      { from: LIVE_STATUSES,      to: STATUS.VOIDED,    stamp: 'voidedAt' },
  // Undo paths are first-class transitions, not mutations, so a mis-tap during
  // a rush is recoverable and still shows up in the audit trail.
  unaccept:  { from: [STATUS.COOKING],   to: STATUS.QUEUED,    stamp: null, clears: ['acceptedAt'], notKinds: BUILT_KINDS },
  unbuild:   { from: [STATUS.BUILDING],  to: STATUS.QUEUED,    stamp: null, clears: ['buildingAt'], kinds: BUILT_KINDS },
  unoven:    { from: [STATUS.COOKING],   to: STATUS.BUILDING,  stamp: null, clears: ['acceptedAt'], kinds: BUILT_KINDS },
  unready:   { from: [STATUS.READY],     to: STATUS.COOKING,   stamp: null, clears: ['readyAt'] },
  undeliver: { from: [STATUS.DELIVERED], to: STATUS.READY,     stamp: null, clears: ['deliveredAt'], window: 'undoWindowSec' },

  // A manager reopening something that was finished with. Distinct from the
  // undo arrows beside them: undo is a cook correcting a mis-tap seconds ago
  // and is withdrawn after a couple of minutes, whereas this is a manager
  // deciding, an hour later, that a table's food is coming back or that a
  // ticket should never have been cancelled. Neither has a window.
  //
  // They land in different places because the two situations differ. Food
  // that was delivered and came back is cooked, so it goes to the runner
  // column. A ticket that was voided was never made, so it goes to the back
  // of the queue and the kitchen starts it.
  reopen:    { from: [STATUS.DELIVERED], to: STATUS.READY,     stamp: null, clears: ['deliveredAt'] },
  unvoid:    { from: [STATUS.VOIDED],    to: STATUS.QUEUED,    stamp: null, clears: ['voidedAt'] },
};

/**
 * Actions only the manager screen offers.
 *
 * allowedActions() still reports them, because the state machine is the one
 * answer to what is legal - but the rail filters them out, so a cook is not
 * handed a button for a decision that is not theirs.
 */
export const MANAGER_ACTIONS = ['reopen', 'unvoid', 'void'];

const UNDO_TARGET = {
  unaccept: 'accept', unbuild: 'build', unoven: 'oven',
  unready: 'ready', undeliver: 'deliver',
};

/** Can a manager pick this ticket back up? */
export function isReopenable(order) {
  return Boolean(order)
    && (order.status === STATUS.DELIVERED || order.status === STATUS.VOIDED);
}

/** Which action reopens it, given where it ended up. */
export function reopenAction(order) {
  if (!order) return null;
  if (order.status === STATUS.DELIVERED) return 'reopen';
  if (order.status === STATUS.VOIDED) return 'unvoid';
  return null;
}

/** Which buttons a screen should offer for this order right now. */
export function allowedActions(order, sla, now = Date.now()) {
  return Object.entries(TRANSITIONS)
    .filter(([action, spec]) => {
      if (!spec.from.includes(order.status)) return false;
      const kind = order.kind || 'pasta';
      if (spec.kinds && !spec.kinds.includes(kind)) return false;
      if (spec.notKinds && spec.notKinds.includes(kind)) return false;
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
 * Canonical form of a member number, or null if it is not one.
 *
 * Member numbers are 1 to 4 digits, and a guest types whatever they remember:
 * "2", "02", "002" and "0002" are all member 2. Leading zeros are stripped so
 * one member is one row and one document id, however it was entered.
 *
 * There is no member zero, so "0", "00" and "0000" are rejected rather than
 * collapsing onto a member that cannot exist.
 */
export function normalizeMemberNumber(raw) {
  const digits = String(raw == null ? '' : raw).trim();
  if (!/^[0-9]{1,4}$/.test(digits)) return null;
  const canonical = digits.replace(/^0+/, '');
  return canonical === '' ? null : canonical;
}

/**
 * Validate a guest draft. Returns plain-English problems, safe to display.
 *
 * `unavailable` is the list of 86'd ingredient ids. It is checked here rather
 * than only in the UI so an order cannot slip through from a stale tab that
 * still shows something the kitchen has run out of.
 */
// Name the thing the guest is looking at: "Pizza 2", not "Bowl 2".
const LINE_LABEL = { pasta: 'Bowl ', pizza: 'Pizza ', burger: 'Burger ' };

export function validateDraft(draft, cfg, unavailable = []) {
  const errors = [];
  if (!normalizeMemberNumber(draft.memberNumber)) {
    errors.push('Member number must be 1 to 4 digits.');
  }

  const guestCount = Number(draft.guestCount);
  const party = draft.partySize;
  if (party != null && (!Number.isInteger(Number(party)) || Number(party) < 1
    || Number(party) > cfg.order.maxPartySize)) {
    errors.push(`A party is 1 to ${cfg.order.maxPartySize} people.`);
  }
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
    errors.push('Send each kind as a separate order - they cook at different stations.');
  }
  lines.forEach((line, i) => {
    // Name the thing the guest is looking at: "Pizza 2", not "Bowl 2".
    const label = LINE_LABEL[menu.kindOf(line)] + (i + 1);
    menu.validateLine(line, cfg.order).forEach((e) => errors.push(`${label}: ${e}`));

    if (unavailable.length) {
      const chosen = [
        ...menu.pastasOf(line),
        ...menu.saucesOf(line),
        ...menu.cheesesOf(line),
        ...menu.proteinsOf(line),
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
 * @param {object} ctx       { ticketNo, station, queueDepth, tag, serviceDate, now }
 */
/**
 * One line of a ticket, normalised into what the kitchen reads.
 *
 * Shared by buildOrder() and editPatch() on purpose. A manager correcting an
 * order has to produce a line indistinguishable from one a guest built - if
 * these two ever diverged, an edited bowl would carry a stale cook time or a
 * stale allergen list, and the chit would describe food nobody is making.
 *
 * @param {object} line  the raw choices
 * @param {number} i     position in the ticket, which names the line
 * @param {string} kind  pasta | pizza | burger, decided once for the ticket
 */
export function buildLine(line, i, kind) {
  const common = {
    lineId: 'ln' + String(i + 1).padStart(2, '0'),
    guestLabel: String(line.guestLabel || `Guest ${i + 1}`).slice(0, 24),
    kind,
    sauces: menu.saucesOf(line),
    proteins: menu.proteinsOf(line),
    toppings: line.toppings || [],
    notes: String(line.notes || '').slice(0, 140),
    allergens: menu.allergensFor(line),
    cookSec: cooktime.lineCookSec(line),
    dish: menu.describe(line),

    // The salad, on every kind rather than per-kind, because it is not part
    // of any of them - it is a second plate that goes out beside whatever was
    // built. Stored null when there is none, so a chit never has to tell
    // "no salad" apart from "salad bar is self-serve tonight": neither puts
    // anything on the ticket.
    //
    // Read through menu, not off the line, so a dressing left behind by a
    // member who changed their mind cannot reach the pass.
    salad: menu.saladOf(line) ? line.salad : null,
    dressing: (menu.dressingOf(line) || {}).id || null,
    saladNote: menu.saladOf(line)
      ? String(line.saladNote || '').slice(0, config.order.maxSaladNoteLength)
      : '',
  };

  if (kind === 'burger') {
    // The bun is the base, the patty is the protein, and one basket rides
    // along as a side. No portion and no spice level - a burger is one size.
    return {
      ...common,
      base: line.base,
      cheeses: menu.cheesesOf(line),
      sides: line.sides || [],
    };
  }

  if (kind === 'pizza') {
    // No portion (every pizza is the same size), no protein or sides - meats
    // are just toppings on a pizza - and no spice level.
    //
    // The crust IS carried, and this line is the reason to say so: it was
    // written when there was only one, so when the gluten-free and dessert
    // bases arrived the choice was made on the phone, shown on the review
    // screen, and then dropped on the way to the kitchen. The chit said
    // '12" Classic' for a pie somebody ordered gluten free.
    return { ...common, base: line.base || 'classic', cheeses: menu.cheesesOf(line) };
  }

  return {
    ...common,
    pastas: menu.pastasOf(line),
    sides: line.sides || [],
    portion: line.portion,
    spice: line.spice || 'mild',
  };
}

/**
 * What a line amounts to, for telling "this changed" from "this did not".
 *
 * Only the parts a cook would act on. lineId is excluded because moving a bowl
 * up the ticket does not change the food, and cookSec/dish/allergens are
 * excluded because they are derived - including them would report every line
 * as edited the day the cook-time model is retuned.
 */
export function lineFingerprint(line) {
  const scalars = ['guestLabel', 'kind', 'pasta', 'base', 'portion', 'spice', 'notes']
    .map((k) => k + '=' + (line[k] == null ? '' : String(line[k])));
  const lists = ['sauces', 'cheeses', 'proteins', 'toppings', 'sides']
    .map((k) => k + '=' + (line[k] || []).slice().sort().join('|'));
  return scalars.concat(lists).join(';');
}

export function buildOrder(draft, ctx) {
  const nowIso = (ctx.now || new Date()).toISOString();

  const kind = menu.kindOf((draft.lines || [])[0] || {});

  const lines = (draft.lines || []).map((line, i) => buildLine(line, i, kind));

  const avoid = Array.isArray(draft.avoidAllergens) ? draft.avoidAllergens : [];
  const cookEstimateSec = cooktime.orderCookSec(lines);
  const promise = cooktime.promiseSec(lines, ctx.queueDepth || 0);

  return {
    ticketNo: ctx.ticketNo,
    serviceDate: ctx.serviceDate,

    // Stored canonical, so 0002 and 2 are one member on the report.
    memberNumber: normalizeMemberNumber(draft.memberNumber) || '',
    memberName: String(draft.memberName || '').slice(0, 48),
    memberStatus: draft.memberStatus || 'unverified',
    // The language the guest ordered in, so the kitchen knows whether a free
    // text note needs reading as Spanish.
    lang: draft.lang === 'es' ? 'es' : 'en',

    kind,
    guestCount: Number(draft.guestCount),
    // How many people this membership is feeding tonight: asked once, carried
    // on every order after. guestCount says how many THIS TRIP is for;
    // partySize says how many to CHARGE. The two stopped being the same number
    // the moment one person was allowed to order for part of a table.
    // Null on an order placed before this existed - memberRollup falls back.
    partySize: draft.partySize == null ? null : Number(draft.partySize),
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
export function transitionPatch(order, action, {
  actor = 'kitchen', note = '', sla, now = new Date(),
  // Where the screen taking this action is standing, and the whole station
  // list for the fallback. Both optional: a screen that does not know either
  // leaves the assignment exactly as it found it.
  station = null, stations = null,
} = {}) {
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

  // Whoever starts it, owns it. Only on the way out of Sent, and only if
  // nobody has it yet - re-opening a ticket and starting it again must not
  // move it to whichever screen happened to press the button.
  if (CLAIMING_ACTIONS.includes(action) && !order.station) {
    if (station) {
      patch.station = station;
    } else if (stations) {
      // A cook who has not told the rail where they are standing still gets a
      // working ticket; it falls back to the alternating assignment this used
      // to do at creation.
      patch.station = stationForTicket(
        order.ticketNo, stations, true, order.kind || 'pasta',
      );
    }
  }

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
      proteins: menu.proteinsOf(l),
      toppings: l.toppings,
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
 * The charge comes from `partySize`: asked once a night per membership, worded
 * about the account rather than the table, and carried on every order after.
 * Where a membership declared it more than once - someone used the change link
 * - the LATEST answer wins, because that is the correction.
 *
 * Orders written before partySize existed fall back to the old rule, the
 * LARGEST guestCount that membership reported. That rule is wrong whenever one
 * order speaks for part of a party (it bills the biggest subset, not the
 * party), which is exactly why partySize exists; it stays only so a historical
 * night still rolls up rather than billing nothing.
 *
 * Everything else (orders, bowls, pizzas) is a consumption signal, not a
 * billing one.
 */
// Which counter on a member row each kind feeds.
const ROLLUP_FIELD = { pasta: 'bowls', pizza: 'pizzas', burger: 'burgers' };

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
        burgers: 0,
        items: 0,
        firstAt: o.submittedAt,
        lastAt: o.submittedAt,
        kinds: new Set(),
        declaredAt: null,
        declared: null,
        largestCount: 0,
      });
    }
    const m = byMember.get(key);
    m.orders += 1;

    // Two numbers kept side by side, and which one bills is decided after
    // every order has been seen - a later trip can carry a correction.
    m.largestCount = Math.max(m.largestCount, Number(o.guestCount) || 0);
    if (o.partySize != null && Number.isFinite(Number(o.partySize))) {
      if (!m.declaredAt || new Date(o.submittedAt) >= new Date(m.declaredAt)) {
        m.declaredAt = o.submittedAt;
        m.declared = Number(o.partySize);
      }
    }

    const k = menu.kindOf({ kind: o.kind });
    m[ROLLUP_FIELD[k]] += o.lines.length;
    m.items += o.lines.length;
    m.kinds.add(k);

    if (o.memberName && !m.name) m.name = o.memberName;
    if (o.memberStatus === 'verified') m.status = 'verified';
    if (new Date(o.submittedAt) < new Date(m.firstAt)) m.firstAt = o.submittedAt;
    if (new Date(o.submittedAt) > new Date(m.lastAt)) m.lastAt = o.submittedAt;
  });

  return [...byMember.values()]
    .map((m) => {
      const partySize = m.declared == null ? m.largestCount : m.declared;
      return {
        ...m,
        partySize,
        // What the charge rests on, so close-out can say so rather than making
        // a manager guess which nights are which.
        chargeBasis: m.declared == null ? 'legacy-headcount' : 'declared',
        kinds: [...m.kinds].sort(),
        itemsPerCover: partySize ? Math.round((m.items / partySize) * 10) / 10 : 0,
      };
    })
    .sort((a, b) => b.items - a.items
      || b.partySize - a.partySize
      || a.memberNumber.localeCompare(b.memberNumber));
}

/** Billable AYCE covers: each member's party counted once, however many trips. */
export function billableCovers(orders) {
  return memberRollup(orders).reduce((a, m) => a + m.partySize, 0);
}

/**
 * Memberships that were at the same table at the same time.
 *
 * Asking "how many go on YOUR account" stops two memberships at one table from
 * both answering for the table, but it cannot stop one of them answering for
 * the table anyway. This is the net that catches what is left, and close-out
 * shows it for a manager to clear before posting.
 *
 * Overlap, not adjacency. Two memberships ordering at table 3 between 18:10
 * and 19:40 were one seating; a membership starting there at 20:30, after the
 * first had finished, is a table that turned over. Nothing in this system
 * records a seating or a cleared table - an order carries a tag and its
 * timestamps and that is all - so the windows those timestamps describe are
 * the only evidence there is, and overlap is the one question they can answer.
 */
export function overlappingParties(orders) {
  const live = (orders || []).filter((o) => o.status !== STATUS.VOIDED && o.tag);
  const byTag = new Map();

  live.forEach((o) => {
    const key = String(o.memberNumber || 'unknown');
    if (!byTag.has(o.tag)) byTag.set(o.tag, new Map());
    const members = byTag.get(o.tag);
    const at = new Date(o.submittedAt).getTime();
    const until = new Date(o.deliveredAt || o.submittedAt).getTime();
    if (!members.has(key)) {
      members.set(key, {
        memberNumber: key, name: o.memberName || '', tagLabel: o.tagLabel || o.tag,
        from: at, to: Math.max(at, until), orders: 0,
      });
    }
    const m = members.get(key);
    m.orders += 1;
    m.from = Math.min(m.from, at);
    m.to = Math.max(m.to, at, until);
    if (!m.name && o.memberName) m.name = o.memberName;
  });

  const out = [];
  byTag.forEach((members, tag) => {
    const list = [...members.values()].sort((a, b) => a.from - b.from);
    if (list.length < 2) return;
    const clash = list.filter((m, i) => list.some((other, j) =>
      i !== j && m.from <= other.to && other.from <= m.to));
    if (clash.length < 2) return;
    out.push({
      tag,
      tagLabel: clash[0].tagLabel,
      members: clash.map((m) => ({
        memberNumber: m.memberNumber, name: m.name, orders: m.orders,
        from: new Date(m.from).toISOString(), to: new Date(m.to).toISOString(),
      })),
    });
  });

  return out.sort((a, b) => a.tagLabel.localeCompare(b.tagLabel));
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
export function stationsFor(stations, kind) {
  return stations.filter((s) => (s.kind || 'pasta') === kind);
}

export function stationForTicket(ticketNo, stations, autoAssign = true, kind = 'pasta') {
  const eligible = stationsFor(stations, kind);
  if (!eligible.length) return null;
  if (!autoAssign) return eligible[0].id;
  return eligible[(Math.max(1, ticketNo) - 1) % eligible.length].id;
}

/**
 * The station a ticket is born at, which for pasta is nowhere yet.
 *
 * Where a kind has one station there is nothing to decide, so the ticket is
 * stamped with it immediately. Where it has two - the club's pasta range -
 * the ticket arrives unassigned and shows at both, and the cook who starts it
 * takes it. That is how a kitchen with two cooks and one queue actually works:
 * whoever has a free pan reaches for the next ticket.
 *
 * Deciding it up front by round-robin looked like load balancing and was not.
 * It handed every other ticket to a cook who might be buried, while the one
 * standing idle watched it sit in a column they could see and could not take.
 */
export function initialStation(ticketNo, stations, autoAssign = true, kind = 'pasta') {
  const eligible = stationsFor(stations, kind);
  if (!eligible.length) return null;
  // A venue that turned auto-assignment off wants everything pinned to one
  // station, and that is still what it gets - leaving those tickets for a cook
  // to claim would be the opposite of what the flag asks for.
  if (!autoAssign) return eligible[0].id;
  if (eligible.length === 1) return eligible[0].id;
  return null;
}

/**
 * Actions that claim an unassigned ticket: the first one that moves it out of
 * Sent. There is no separate "take it" tap, by the club's instruction - the
 * tap that starts the work is the tap that says whose work it is.
 */
const CLAIMING_ACTIONS = ['accept', 'build'];

/**
 * Change an order that already exists, and record what changed.
 *
 * A manager fields a verbal correction - the member moved to another table, a
 * bowl should have had no onion, a sixth person sat down - and the chit on the
 * rail has to catch up without losing its ticket number or its place in the
 * queue. So this is a patch, never a rebuild: identity (ticket number, claim
 * code, service date, kind) is untouched, and firestore.rules enforces that
 * independently of whatever a client believes.
 *
 * Returns null when nothing actually differs. A manager who opens an order,
 * reads it and saves must not light up the kitchen screen - the highlight is
 * only worth anything while it means something changed.
 *
 * @param {object} current   the order as it stands
 * @param {object} changes   {lines?, guestCount?, notes?}
 * @param {object} ctx       {actor, now, tag} - `tag` only when the table
 *                           moves, and explicitly null to make it a walk-up
 */
export function editPatch(current, changes = {}, ctx = {}) {
  const { actor = 'manager', now = new Date() } = ctx;

  // Delivered food cannot be un-cooked and a voided ticket is not a ticket.
  // Either would light up a rail nobody is working.
  if (current.status === STATUS.VOIDED || current.status === STATUS.DELIVERED) {
    throw Object.assign(
      new Error(`Cannot edit an order that is ${current.status}`),
      { code: 'NOT_EDITABLE', status: current.status },
    );
  }

  const nowIso = now.toISOString();
  const patch = {};
  const what = [];
  let editedLineIds = [];
  let addedLineIds = [];

  if (Array.isArray(changes.lines)) {
    if (!changes.lines.length) {
      throw Object.assign(new Error('An order needs at least one item.'), { code: 'EMPTY_ORDER' });
    }
    // Rebuilt through the same path a new order takes, so an edited bowl
    // carries a cook time and an allergen list that match what it now is.
    const rebuilt = changes.lines.map((line, i) => buildLine(line, i, current.kind));
    const was = new Map((current.lines || []).map((l) => [l.lineId, lineFingerprint(l)]));

    editedLineIds = rebuilt
      .filter((l) => was.get(l.lineId) !== lineFingerprint(l))
      .map((l) => l.lineId);

    // A line the ticket did not have before is new, not altered. Worth
    // telling apart on the rail: a cook who has already started reads
    // "Changed" as "check what moved" and "Added" as "there is one more".
    addedLineIds = rebuilt
      .filter((l) => !was.has(l.lineId))
      .map((l) => l.lineId);

    const countChanged = rebuilt.length !== (current.lines || []).length;
    if (editedLineIds.length || countChanged) {
      patch.lines = rebuilt;
      patch.cookEstimateSec = cooktime.orderCookSec(rebuilt);
      patch.allergenFlags = [...new Set(rebuilt.flatMap((l) => l.allergens))];
      what.push('items');
    }
  }

  // `tag` being present at all means the table moved - including to null,
  // which is how an order becomes a walk-up. Absent means leave it alone,
  // which is why this reads the key rather than the value.
  if ('tag' in ctx) {
    const tag = ctx.tag;
    const label = tag ? tag.label : 'Walk-up';
    if (label !== current.tagLabel) {
      patch.tag = tag ? tag.id : null;
      patch.tagLabel = label;
      patch.tagKind = tag ? tag.kind : 'pickup';
      what.push('table');
    }
  }

  if (changes.guestCount != null) {
    const n = Number(changes.guestCount);
    if (!Number.isInteger(n) || n < 1) {
      throw Object.assign(new Error('Guest count must be a whole number of people.'), { code: 'BAD_GUESTS' });
    }
    if (n !== current.guestCount) { patch.guestCount = n; what.push('guests'); }
  }

  if (changes.notes != null) {
    const note = String(changes.notes).slice(0, 240);
    if (note !== (current.notes || '')) { patch.notes = note; what.push('note'); }
  }

  if (!what.length) return null;

  patch.editedAt = nowIso;
  patch.editedBy = actor;
  // Which lines to light up. Replaced rather than accumulated: a cook needs
  // "what changed just now", not every line ever touched - a second edit that
  // kept the first one lit would point them at food that is already right.
  patch.editedLineIds = editedLineIds;
  patch.addedLineIds = addedLineIds;
  patch.editCount = (current.editCount || 0) + 1;
  patch.events = [
    ...(current.events || []),
    {
      at: nowIso,
      action: 'edit',
      from: current.status,
      to: current.status,
      actor,
      note: what.join(', ').slice(0, 140),
    },
  ];

  return patch;
}

/** True while an edit is still worth showing a cook. */
export function isEdited(order) {
  return Boolean(order && order.editedAt)
    && order.status !== STATUS.DELIVERED
    && order.status !== STATUS.VOIDED;
}

/**
 * The order a lane is worked in: oldest first, and the top one stays there
 * until somebody moves it on.
 *
 * That promise is the whole value of the list. A cook glances down, takes the
 * top ticket, and does not have to check whether the thing they were part way
 * through has been pushed down by something that arrived since.
 *
 * Two deliberate exceptions, in this order:
 *
 *  - A held ticket drops to the foot. Parking an order must not hide it; an
 *    invisible order is a lost order.
 *  - A rush ticket goes to the head, because rush is a person deciding this
 *    one comes first. That is what the exception is for.
 *
 * An allergy ticket is NOT promoted. It used to be, which broke the promise
 * above and bought nothing in return - it already arrives carrying a badge and
 * a banner across the top of the chit. Jumping the queue is not the same thing
 * as being careful with it.
 *
 * Pure and exported so the rail and the test agree by construction rather than
 * by two copies of the same comparator staying in step.
 */
export function workOrder(orders) {
  return orders.slice().sort((a, b) => {
    const held = (x) => x.status === STATUS.HELD;
    if (held(a) !== held(b)) return held(a) ? 1 : -1;
    const rank = (x) => (x.priority === 'rush' ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return new Date(a.submittedAt) - new Date(b.submittedAt);
  });
}

/**
 * Which tickets belong on a screen filtered to one station.
 *
 * The club's whole request in one rule: a ticket nobody has started belongs to
 * every station that could cook it, so both pasta cooks see it and either can
 * take it; a ticket somebody has started belongs to them alone, and leaves the
 * other screen the moment they take it.
 *
 * Pure and exported so the rail and the test are reading one rule rather than
 * two copies of it that have to be kept in step.
 */
export function visibleAtStation(orders, stationId, stations) {
  if (!stationId) return orders.slice();
  const station = stations.find((s) => s.id === stationId);
  const cooks = station ? (station.kind || 'pasta') : null;
  return orders.filter((o) => {
    if (!o.station) return cooks !== null && cooks === (o.kind || 'pasta');
    return o.station === stationId;
  });
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

  // ---- tickets nobody was watching ---------------------------------------
  //
  // A ticket that sat in 'cooking' for several times its estimate was not
  // being cooked. Its readyAt records the moment somebody came back and
  // cleared the rail, usually at shutdown, and its deliveredAt lands a second
  // later because both bumps were one action. Left in, one of these drags the
  // cook average up, becomes the worst-case figure a manager quotes the club,
  // and counts as the kitchen missing an SLA it never had a chance at.
  //
  // Taken out of the timings and reported on its own instead - never dropped
  // quietly, because a ticket nobody watched is the more interesting fact.
  //
  // The test for this is the cook clock, NOT the one-second gap between ready
  // and delivered. Six of fifty tickets on the night this came from had that
  // gap and five were ordinary - expo marks both when the runner is already
  // standing there. Only the cook clock separated the abandoned one.
  const abandoned = (o) => o.acceptedAt && o.readyAt
    && secs(o.acceptedAt, o.readyAt) > o.cookEstimateSec * sla.cookAbandonFactor;
  const unattended = done.filter(abandoned).map((o) => ({
    ticketNo: o.ticketNo,
    tagLabel: o.tagLabel,
    station: o.station,
    cookSec: Math.round(secs(o.acceptedAt, o.readyAt)),
    estimateSec: o.cookEstimateSec,
  })).sort((a, b) => b.cookSec - a.cookSec);
  const cooked = done.filter((o) => !abandoned(o));

  // ---- timings, over delivered tickets somebody actually cooked ----------
  //
  // The accept clock is the exception: it ran before any of this and was real
  // even on a ticket that was then forgotten, so it keeps every ticket.
  const queueWaits = done.filter((o) => o.acceptedAt).map((o) => secs(o.submittedAt, o.acceptedAt));
  const cookTimes = cooked.filter((o) => o.acceptedAt && o.readyAt).map((o) => secs(o.acceptedAt, o.readyAt));
  const runnerTimes = cooked.filter((o) => o.readyAt && o.deliveredAt).map((o) => secs(o.readyAt, o.deliveredAt));
  const totalTimes = cooked.map((o) => secs(o.submittedAt, o.deliveredAt));

  // ---- how long tickets sat before anyone picked them up -----------------
  //
  // The on-time figure below measures cooking, and only cooking: its clock
  // starts at accept. A room can therefore read 100% on time while every
  // ticket in it spent longer than the SLA allows waiting to be picked up,
  // which is exactly what happened the night this was written - 98% on time,
  // and 27 of 50 tickets past the late threshold before the kitchen touched
  // them. One number cannot answer both questions, so the wait gets its own.
  const acceptLate = queueWaits.filter((s) => s > sla.acceptLateSec).length;
  const acceptWarn = queueWaits.filter((s) => s > sla.acceptWarnSec && s <= sla.acceptLateSec).length;

  // ---- who blew the cook SLA, and by how much ---------------------------
  const late = cooked
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

  const onTimeCount = cooked.filter((o) => o.acceptedAt && o.readyAt).length - late.length;

  // ---- service curve in quarter-hours -----------------------------------
  // Split the curve by kind: a manager wants to see that the pizza rush lands
  // later than the pasta rush, which a single total hides.
  const buckets = {};
  alive.forEach((o) => {
    const d = new Date(o.submittedAt);
    const key = `${String(d.getHours()).padStart(2, '0')}:${String(Math.floor(d.getMinutes() / 15) * 15).padStart(2, '0')}`;
    if (!buckets[key]) {
      buckets[key] = { bucket: key, orders: 0, bowls: 0, pizzas: 0, burgers: 0, items: 0, covers: 0 };
    }
    buckets[key].orders += 1;
    buckets[key][ROLLUP_FIELD[menu.kindOf({ kind: o.kind })]] += o.lines.length;
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
    .filter((o) => menu.kindOf({ kind: o.kind }) === kind)
    .flatMap((o) => o.lines);

  const pastaLines = linesOfKind('pasta');
  const pizzaLines = linesOfKind('pizza');
  const burgerLines = linesOfKind('burger');

  const mix = {
    pasta: {
      pastas: tally(pastaLines, (l) => menu.pastasOf(l)),
      sauces: tally(pastaLines, (l) => menu.saucesOf(l)),
      proteins: tally(pastaLines, (l) => menu.proteinsOf(l)),
      toppings: tally(pastaLines, (l) => l.toppings || []),
      sides: tally(pastaLines, (l) => l.sides || []),
      portions: tally(pastaLines, (l) => [l.portion]),
    },
    pizza: {
      sauces: tally(pizzaLines, (l) => menu.saucesOf(l)),
      cheeses: tally(pizzaLines, (l) => menu.cheesesOf(l)),
      proteins: tally(pizzaLines, (l) => menu.proteinsOf(l)),
      toppings: tally(pizzaLines, (l) => l.toppings || []),
    },
    // Buns and patties lead, because those are the two counts a grill cook
    // needs before service: how many to thaw, how many to warm.
    burger: {
      buns: tally(burgerLines, (l) => [l.base]),
      patties: tally(burgerLines, (l) => menu.proteinsOf(l)),
      cheeses: tally(burgerLines, (l) => menu.cheesesOf(l)),
      toppings: tally(burgerLines, (l) => l.toppings || []),
      sauces: tally(burgerLines, (l) => menu.saucesOf(l)),
      sides: tally(burgerLines, (l) => l.sides || []),
    },
  };

  const byKind = menu.KINDS.reduce((acc, kind) => {
    const mine = alive.filter((o) => menu.kindOf({ kind: o.kind }) === kind);
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
  // Tables where two memberships were seated together. Each may have answered
  // the party question for the whole table instead of their own people, which
  // would bill those people twice - so a manager looks before posting.
  const sharedTables = overlappingParties(orders);

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
      sharedTables: sharedTables.length,
    },
    members,
    sharedTables,
    timings: {
      avgQueueSec: average(queueWaits),
      avgCookSec: average(cookTimes),
      avgRunnerSec: average(runnerTimes),
      avgTotalSec: average(totalTimes),
      p90TotalSec: percentile(totalTimes, 90),
      worstTotalSec: totalTimes.length ? Math.round(Math.max(...totalTimes)) : 0,
    },
    // Cooking, and only cooking: this clock starts at accept. Read it beside
    // `accepts` below, never instead of it.
    onTime: {
      pct: cooked.length ? Math.round((onTimeCount / Math.max(1, onTimeCount + late.length)) * 100) : null,
      count: onTimeCount,
      lateCount: late.length,
    },
    // The half the figure above cannot see: how long tickets sat before the
    // kitchen picked them up.
    accepts: {
      count: queueWaits.length,
      warnCount: acceptWarn,
      lateCount: acceptLate,
      pct: queueWaits.length
        ? Math.round(((queueWaits.length - acceptLate) / queueWaits.length) * 100)
        : null,
    },
    late,
    unattended,
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
