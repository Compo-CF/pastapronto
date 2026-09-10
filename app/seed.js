/**
 * Demo data for the manager screen.
 *
 * Builds real order documents through the same order.buildOrder() the guest app
 * uses, then backdates the timestamps so the kitchen rail opens with a
 * believable mix: a fresh ticket, one waiting too long to be accepted, two
 * mid-cook (one already late), a rush, an allergy chit, and one plated waiting
 * on a runner - plus a handful already delivered so the metrics have averages.
 */
import { config, tagById, serviceDate } from './config.js';
import * as order from './order.js';

/** Seeded into the `members` collection so the keypad can resolve names. */
export const MEMBERS = [
  { memberNumber: '1043', name: 'Compofelice', tier: 'gold',   dietaryNotes: 'Shellfish allergy on file', defaultGuests: 4 },
  { memberNumber: '2087', name: 'Nakamura',    tier: 'silver', dietaryNotes: '', defaultGuests: 2 },
  { memberNumber: '3150', name: 'Okonkwo',     tier: 'gold',   dietaryNotes: 'Gluten free - Sam', defaultGuests: 5 },
  { memberNumber: '4421', name: 'Delgado',     tier: 'bronze', dietaryNotes: '', defaultGuests: 3 },
  { memberNumber: '5007', name: 'Whitfield',   tier: 'silver', dietaryNotes: '', defaultGuests: 2 },
  { memberNumber: '6123', name: 'Petrov',      tier: 'gold',   dietaryNotes: 'No dairy - Ana', defaultGuests: 6 },
];

const DRAFTS = [
  {
    _age: 25, _state: 'ready',
    memberNumber: '2087', memberName: 'Nakamura', memberStatus: 'verified', memberTier: 'silver',
    guestCount: 2, tag: 'table-03',
    lines: [
      { guestLabel: 'Kenji', pasta: 'spaghetti', sauces: ['marinara'], protein: 'meatballs', toppings: ['parmesan', 'basil'], sides: [], portion: 'regular', spice: 'mild' },
      { guestLabel: 'Yuki', pasta: 'fettuccine', sauces: ['alfredo'], protein: 'chicken', toppings: ['mushrooms'], sides: ['garlic_bread'], portion: 'regular', spice: 'mild' },
    ],
  },
  {
    _age: 17, _state: 'cooking', _late: true,
    memberNumber: '3150', memberName: 'Okonkwo', memberStatus: 'verified', memberTier: 'gold',
    guestCount: 5, tag: 'patio-a', avoidAllergens: ['gluten'],
    notes: 'Sam is celiac - separate water, please',
    lines: [
      { guestLabel: 'Sam (GF)', pasta: 'fusilli_gf', sauces: ['marinara'], protein: 'chicken', toppings: ['tomatoes'], sides: [], portion: 'regular', spice: 'mild', notes: 'CELIAC - dedicated pot' },
      { guestLabel: 'Ada', pasta: 'penne', sauces: ['pesto'], protein: 'none', toppings: ['parmesan'], sides: [], portion: 'regular', spice: 'mild' },
      { guestLabel: 'Chi', pasta: 'rigatoni', sauces: ['bolognese', 'arrabbiata'], protein: 'sausage', toppings: ['chili'], sides: ['breadsticks'], portion: 'large', spice: 'hot' },
      { guestLabel: 'Tunde', pasta: 'shells', sauces: ['butter_parm'], protein: 'none', toppings: ['broccoli'], sides: [], portion: 'kid', spice: 'mild' },
      { guestLabel: 'Nia', pasta: 'tortellini', sauces: ['butter'], protein: 'none', toppings: [], sides: [], portion: 'kid', spice: 'mild' },
    ],
  },
  {
    _age: 9, _state: 'cooking',
    memberNumber: '4421', memberName: 'Delgado', memberStatus: 'verified', memberTier: 'bronze',
    guestCount: 3, tag: 'table-01',
    lines: [
      { guestLabel: 'Rosa', pasta: 'penne', sauces: ['arrabbiata'], protein: 'shrimp', toppings: ['peppers'], sides: [], portion: 'regular', spice: 'hot' },
      { guestLabel: 'Mateo', pasta: 'farfalle', sauces: ['marinara', 'alfredo'], protein: 'none', toppings: ['parmesan'], sides: ['side_salad'], portion: 'kid', spice: 'mild' },
      { guestLabel: 'Luz', pasta: 'spaghetti', sauces: ['aglio_olio'], protein: 'beans', toppings: ['spinach', 'chili'], sides: [], portion: 'regular', spice: 'medium' },
    ],
  },
  {
    _age: 4, _state: 'queued', _rush: true,
    memberNumber: '6123', memberName: 'Petrov', memberStatus: 'verified', memberTier: 'gold',
    guestCount: 2, tag: 'cabana-3', avoidAllergens: ['dairy'],
    notes: 'Ana is dairy free',
    lines: [
      { guestLabel: 'Ana (DF)', pasta: 'spaghetti', sauces: ['marinara'], protein: 'chicken', toppings: ['basil'], sides: [], portion: 'regular', spice: 'mild', notes: 'NO DAIRY - no parm' },
      { guestLabel: 'Dmitri', pasta: 'rigatoni', sauces: ['bolognese'], protein: 'none', toppings: ['parmesan'], sides: ['garlic_bread'], portion: 'large', spice: 'medium' },
    ],
  },
  {
    _age: 3, _state: 'queued',
    memberNumber: '5007', memberName: 'Whitfield', memberStatus: 'verified', memberTier: 'silver',
    guestCount: 1, tag: 'pool-bar',
    lines: [
      { guestLabel: 'Guest 1', pasta: 'tortellini', sauces: ['pesto'], protein: 'none', toppings: ['tomatoes', 'basil'], sides: [], portion: 'regular', spice: 'mild' },
    ],
  },
  {
    _age: 1, _state: 'queued',
    memberNumber: '7890', memberName: '', memberStatus: 'unverified', memberTier: 'guest',
    guestCount: 2, tag: 'takeout',
    lines: [
      { guestLabel: 'Kid 1', pasta: 'shells', sauces: ['butter'], protein: 'none', toppings: ['parmesan'], sides: ['breadsticks'], portion: 'kid', spice: 'mild' },
      { guestLabel: 'Kid 2', pasta: 'farfalle', sauces: ['marinara'], protein: 'meatballs', toppings: ['mozzarella'], sides: [], portion: 'kid', spice: 'mild' },
    ],
  },
  {
    _age: 14, _state: 'cooking',
    memberNumber: '2087', memberName: 'Nakamura', memberStatus: 'verified', memberTier: 'silver',
    guestCount: 4, tag: 'table-04',
    lines: [
      { guestLabel: 'Kenji', kind: 'pizza', sauces: ['pz_marinara'], toppings: ['pepperoni', 'pz_mushroom'], finishers: ['fin_parm', 'fin_oregano'] },
      { guestLabel: 'Yuki', kind: 'pizza', sauces: ['pz_white'], toppings: ['pz_spinach', 'ricotta'], finishers: ['fin_chili'] },
      { guestLabel: 'Rin', kind: 'pizza', sauces: ['pz_bbq'], toppings: ['pz_chicken', 'red_onion', 'bacon'], finishers: ['fin_salt'] },
    ],
  },
  {
    _age: 6, _state: 'queued',
    memberNumber: '4421', memberName: 'Delgado', memberStatus: 'verified', memberTier: 'bronze',
    guestCount: 2, tag: 'patio-a', avoidAllergens: ['pork'],
    notes: 'No pork on either pizza',
    lines: [
      { guestLabel: 'Rosa', kind: 'pizza', sauces: ['pz_marinara'], toppings: ['pz_pepper', 'pz_olives', 'pz_tomatoes'], finishers: ['fin_oregano'], notes: 'NO PORK' },
      { guestLabel: 'Mateo', kind: 'pizza', sauces: ['pz_marinara', 'pz_bbq'], toppings: ['pineapple', 'pz_chicken'], finishers: [] },
    ],
  },
  {
    _age: 2, _state: 'queued',
    memberNumber: '6123', memberName: 'Petrov', memberStatus: 'verified', memberTier: 'gold',
    guestCount: 1, tag: 'pool-bar',
    lines: [
      { guestLabel: 'Guest 1', kind: 'pizza', sauces: ['pz_white'], toppings: ['extra_mozz', 'jalapeno'], finishers: ['fin_chili', 'fin_salt'] },
    ],
  },
];

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

function stripMeta(draft) {
  const copy = JSON.parse(JSON.stringify(draft));
  delete copy._age; delete copy._state; delete copy._late; delete copy._rush;
  return copy;
}

let ticket = 0;

function build(spec) {
  const draft = stripMeta(spec);
  const ticketNo = (ticket += 1);
  const kind = (spec.lines[0] || {}).kind === 'pizza' ? 'pizza' : 'pasta';
  return order.buildOrder(draft, {
    ticketNo,
    claimCode: order.claimCode(),
    // Same routing the live app uses, so seeded chits land on the right rails.
    station: order.stationForTicket(ticketNo, config.kitchen.stations, true, kind),
    queueDepth: 2,
    tag: spec.tag ? tagById(spec.tag) : null,
    serviceDate: serviceDate(),
    now: new Date(),
  });
}

/** Orders already closed out, so the metrics panel has real averages. */
function deliveredHistory(count = 7) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const spec = DRAFTS[i % DRAFTS.length];
    const o = build(spec);
    const age = 120 - i * 12;
    const queueWait = 30 + (i % 4) * 25;
    const cook = Math.round(o.cookEstimateSec * (0.8 + (i % 5) * 0.12));
    const runner = 25 + (i % 3) * 30;

    o.submittedAt = minutesAgo(age);
    o.acceptedAt = new Date(new Date(o.submittedAt).getTime() + queueWait * 1000).toISOString();
    o.readyAt = new Date(new Date(o.acceptedAt).getTime() + cook * 1000).toISOString();
    o.deliveredAt = new Date(new Date(o.readyAt).getTime() + runner * 1000).toISOString();
    o.status = 'delivered';
    o.acceptedBy = 'cook:marco';
    o.readyBy = 'cook:marco';
    o.deliveredBy = 'runner:tess';
    o.events = [
      { at: o.submittedAt, action: 'submit', from: null, to: 'queued', actor: 'guest', note: '' },
      { at: o.acceptedAt, action: 'accept', from: 'queued', to: 'cooking', actor: 'cook:marco', note: '' },
      { at: o.readyAt, action: 'ready', from: 'cooking', to: 'ready', actor: 'cook:marco', note: '' },
      { at: o.deliveredAt, action: 'deliver', from: 'ready', to: 'delivered', actor: 'runner:tess', note: '' },
    ];
    out.push(o);
  }
  return out;
}

/** The full demo set: closed-out history plus a live rail. */
export function buildDemoOrders() {
  ticket = 0;
  const orders = deliveredHistory();

  DRAFTS.forEach((spec, i) => {
    const o = build(spec);
    o.submittedAt = minutesAgo(spec._age);
    o.events[0].at = o.submittedAt;

    if (spec._state === 'cooking' || spec._state === 'ready') {
      const acceptedAt = spec._late
        ? minutesAgo(spec._age - 1)
        : new Date(new Date(o.submittedAt).getTime() + 55000).toISOString();
      o.acceptedAt = acceptedAt;
      o.status = 'cooking';
      o.acceptedBy = 'cook:marco';
      o.events.push({ at: acceptedAt, action: 'accept', from: 'queued', to: 'cooking', actor: 'cook:marco', note: '' });
    }

    if (spec._state === 'ready') {
      const readyAt = new Date(new Date(o.acceptedAt).getTime() + o.cookEstimateSec * 1000).toISOString();
      o.readyAt = readyAt;
      o.status = 'ready';
      o.readyBy = 'cook:marco';
      o.events.push({ at: readyAt, action: 'ready', from: 'cooking', to: 'ready', actor: 'cook:marco', note: '' });
    }

    if (spec._rush) o.priority = 'rush';
    orders.push(o);
  });

  return orders;
}
