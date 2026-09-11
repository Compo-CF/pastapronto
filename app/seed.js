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

/**
 * Demo member directory - 30 members, seeded into the `members` collection so
 * the guest keypad resolves a number to a name.
 *
 * Numbers are 1 to 4 digits and the mix here is deliberate - 4 single digits,
 * 7 double, 8 triple, 11 quadruple - because a club that has issued numbers
 * for decades has founding members at 1 and 4 alongside recent ones at 6123.
 * A demo that was all four-digit numbers would never show that the keypad
 * handles the short ones.
 *
 * They are stored canonical - no leading zeros - so a guest typing 0007, 007,
 * 07 or 7 all reach member 7. The ones the demo orders below reference (2087,
 * 3150, 4421, 5007, 6123) are kept here on purpose so those chits show a name
 * rather than an unverified badge.
 *
 * 7890 is deliberately ABSENT: one demo order uses it, which is what exercises
 * the "member unverified" path - the order is still taken so nobody goes
 * hungry, and the chit carries the badge for a server to sort out.
 */
export const MEMBERS = [
  { memberNumber: '1',    name: 'Fairbanks',     dietaryNotes: '', defaultGuests: 2 },
  { memberNumber: '4',    name: 'Easton',        dietaryNotes: '', defaultGuests: 2 },
  { memberNumber: '7',    name: 'Hollingsworth', dietaryNotes: '', defaultGuests: 4 },
  { memberNumber: '9',    name: 'Bellamy',       dietaryNotes: '', defaultGuests: 2 },
  { memberNumber: '12',   name: 'Pemberton',     dietaryNotes: '', defaultGuests: 2 },
  { memberNumber: '26',   name: 'Ueda',          dietaryNotes: 'No pork', defaultGuests: 2 },
  { memberNumber: '42',   name: 'Abernathy',     dietaryNotes: '', defaultGuests: 2 },
  { memberNumber: '58',   name: 'Mancuso',       dietaryNotes: '', defaultGuests: 4 },
  { memberNumber: '63',   name: 'Ashworth',      dietaryNotes: '', defaultGuests: 2 },
  { memberNumber: '77',   name: 'Ibarra',        dietaryNotes: '', defaultGuests: 3 },
  { memberNumber: '90',   name: 'Sandoval',      dietaryNotes: '', defaultGuests: 5 },
  { memberNumber: '104',  name: 'Goswami',       dietaryNotes: 'Vegetarian - no meat proteins', defaultGuests: 4 },
  { memberNumber: '108',  name: 'Vasquez',       dietaryNotes: '', defaultGuests: 3 },
  { memberNumber: '137',  name: 'Lindqvist',     dietaryNotes: '', defaultGuests: 3 },
  { memberNumber: '250',  name: 'Kirkpatrick',   dietaryNotes: '', defaultGuests: 2 },
  { memberNumber: '316',  name: 'Rasmussen',     dietaryNotes: '', defaultGuests: 4 },
  { memberNumber: '482',  name: 'Quintero',      dietaryNotes: '', defaultGuests: 6 },
  { memberNumber: '605',  name: 'Devereaux',     dietaryNotes: 'Dairy free', defaultGuests: 2 },
  { memberNumber: '819',  name: 'Yamamoto',      dietaryNotes: '', defaultGuests: 4 },
  { memberNumber: '1352', name: 'Nazarian',      dietaryNotes: 'Tree nut allergy - Leila', defaultGuests: 6 },
  { memberNumber: '1567', name: 'Castellanos',   dietaryNotes: '', defaultGuests: 5 },
  { memberNumber: '1794', name: 'Compofelice',   dietaryNotes: 'Shellfish allergy on file', defaultGuests: 4 },
  { memberNumber: '2087', name: 'Nakamura',      dietaryNotes: '', defaultGuests: 2 },
  { memberNumber: '2475', name: 'Thackeray',     dietaryNotes: '', defaultGuests: 8 },
  { memberNumber: '3150', name: 'Okonkwo',       dietaryNotes: 'Gluten free - Sam', defaultGuests: 5 },
  { memberNumber: '3627', name: 'Oyelaran',      dietaryNotes: '', defaultGuests: 4 },
  { memberNumber: '4421', name: 'Delgado',       dietaryNotes: '', defaultGuests: 3 },
  { memberNumber: '5007', name: 'Whitfield',     dietaryNotes: '', defaultGuests: 2 },
  { memberNumber: '5182', name: 'Wentworth',     dietaryNotes: '', defaultGuests: 6 },
  { memberNumber: '6123', name: 'Petrov',        dietaryNotes: 'No dairy - Ana', defaultGuests: 6 },
];

const DRAFTS = [
  {
    _age: 25, _state: 'ready',
    memberNumber: '2087', memberName: 'Nakamura', memberStatus: 'verified',
    guestCount: 2, tag: 'table-03',
    lines: [
      { guestLabel: 'Kenji', pasta: 'spaghetti', sauces: ['marinara'], proteins: ['meatballs'], toppings: ['parmesan', 'basil'], sides: [], portion: 'regular', spice: 'mild' },
      { guestLabel: 'Yuki', pasta: 'fettuccine', sauces: ['alfredo'], proteins: ['chicken'], toppings: ['mushrooms'], sides: ['garlic_bread'], portion: 'regular', spice: 'mild' },
    ],
  },
  {
    _age: 17, _state: 'cooking', _late: true,
    memberNumber: '3150', memberName: 'Okonkwo', memberStatus: 'verified',
    guestCount: 5, tag: 'patio-a', avoidAllergens: ['gluten'],
    notes: 'Sam is celiac - separate water, please',
    lines: [
      { guestLabel: 'Sam (GF)', pasta: 'fusilli_gf', sauces: ['marinara'], proteins: ['chicken'], toppings: ['tomatoes'], sides: [], portion: 'regular', spice: 'mild', notes: 'CELIAC - dedicated pot' },
      { guestLabel: 'Ada', pasta: 'penne', sauces: ['pesto'], proteins: [], toppings: ['parmesan'], sides: [], portion: 'regular', spice: 'mild' },
      { guestLabel: 'Chi', pasta: 'rigatoni', sauces: ['bolognese', 'arrabbiata'], proteins: ['sausage'], toppings: ['chili'], sides: ['breadsticks'], portion: 'large', spice: 'hot' },
      { guestLabel: 'Tunde', pasta: 'shells', sauces: ['butter_parm'], proteins: [], toppings: ['broccoli'], sides: [], portion: 'kid', spice: 'mild' },
      { guestLabel: 'Nia', pasta: 'tortellini', sauces: ['butter'], proteins: [], toppings: [], sides: [], portion: 'kid', spice: 'mild' },
    ],
  },
  {
    _age: 9, _state: 'cooking',
    memberNumber: '4421', memberName: 'Delgado', memberStatus: 'verified',
    guestCount: 3, tag: 'table-01',
    lines: [
      { guestLabel: 'Rosa', pasta: 'penne', sauces: ['arrabbiata'], proteins: ['shrimp'], toppings: ['peppers'], sides: [], portion: 'regular', spice: 'hot' },
      { guestLabel: 'Mateo', pasta: 'farfalle', sauces: ['marinara', 'alfredo'], proteins: [], toppings: ['parmesan'], sides: ['side_salad'], portion: 'kid', spice: 'mild' },
      { guestLabel: 'Luz', pasta: 'spaghetti', sauces: ['aglio_olio'], proteins: ['beans'], toppings: ['spinach', 'chili'], sides: [], portion: 'regular', spice: 'medium' },
    ],
  },
  {
    _age: 4, _state: 'queued', _rush: true,
    memberNumber: '6123', memberName: 'Petrov', memberStatus: 'verified',
    guestCount: 2, tag: 'cabana-3', avoidAllergens: ['dairy'],
    notes: 'Ana is dairy free',
    lines: [
      { guestLabel: 'Ana (DF)', pasta: 'spaghetti', sauces: ['marinara'], proteins: ['chicken'], toppings: ['basil'], sides: [], portion: 'regular', spice: 'mild', notes: 'NO DAIRY - no parm' },
      { guestLabel: 'Dmitri', pasta: 'rigatoni', sauces: ['bolognese'], proteins: [], toppings: ['parmesan'], sides: ['garlic_bread'], portion: 'large', spice: 'medium' },
    ],
  },
  {
    _age: 3, _state: 'queued',
    memberNumber: '5007', memberName: 'Whitfield', memberStatus: 'verified',
    guestCount: 1, tag: 'pool-bar',
    lines: [
      { guestLabel: 'Guest 1', pasta: 'tortellini', sauces: ['pesto'], proteins: [], toppings: ['tomatoes', 'basil'], sides: [], portion: 'regular', spice: 'mild' },
    ],
  },
  {
    _age: 1, _state: 'queued',
    memberNumber: '7890', memberName: '', memberStatus: 'unverified',
    guestCount: 2, tag: 'takeout',
    lines: [
      { guestLabel: 'Kid 1', pasta: 'shells', sauces: ['butter'], proteins: [], toppings: ['parmesan'], sides: ['breadsticks'], portion: 'kid', spice: 'mild' },
      { guestLabel: 'Kid 2', pasta: 'farfalle', sauces: ['marinara'], proteins: ['meatballs'], toppings: ['mozzarella'], sides: [], portion: 'kid', spice: 'mild' },
    ],
  },
  {
    _age: 14, _state: 'cooking',
    memberNumber: '2087', memberName: 'Nakamura', memberStatus: 'verified',
    guestCount: 4, tag: 'table-04',
    lines: [
      { guestLabel: 'Kenji', kind: 'pizza', sauces: ['pz_marinara'], cheeses: ['pz_shred_mozz'], proteins: ['pepperoni'], toppings: ['pz_mushroom', 'fin_oregano'] },
      { guestLabel: 'Yuki', kind: 'pizza', sauces: ['pz_alfredo'], cheeses: ['pz_fresh_mozz', 'pz_cheese_light'], proteins: [], toppings: ['pz_arugula', 'pz_chili'] },
      { guestLabel: 'Rin', kind: 'pizza', sauces: ['pz_bbq'], cheeses: ['pz_shred_mozz', 'pz_cheese_heavy'], proteins: ['pz_chicken', 'bacon'], toppings: ['red_onion', 'fin_salt'] },
    ],
  },
  {
    _age: 6, _state: 'queued',
    memberNumber: '4421', memberName: 'Delgado', memberStatus: 'verified',
    guestCount: 2, tag: 'patio-a', avoidAllergens: ['pork'],
    notes: 'No pork on either pizza',
    lines: [
      { guestLabel: 'Rosa', kind: 'pizza', sauces: ['pz_marinara'], cheeses: ['pz_no_cheese'], proteins: [], toppings: ['pz_pepper', 'pz_olives', 'pz_tomatoes', 'pz_basil', 'fin_oregano'], notes: 'NO PORK - NO CHEESE' },
      { guestLabel: 'Mateo', kind: 'pizza', sauces: ['pz_marinara', 'pz_bbq'], cheeses: ['pz_shred_mozz'], proteins: ['pz_chicken', 'ham'], toppings: ['pineapple'] },
    ],
  },
  {
    _age: 2, _state: 'queued',
    memberNumber: '6123', memberName: 'Petrov', memberStatus: 'verified',
    guestCount: 1, tag: 'pool-bar',
    lines: [
      { guestLabel: 'Guest 1', kind: 'pizza', sauces: ['pz_pesto', 'pz_sauce_light'], cheeses: ['pz_grated_parm'], proteins: ['pz_sausage'], toppings: ['jalapeno', 'pz_artichoke', 'fin_salt'] },
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
