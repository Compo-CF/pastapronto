'use strict';

const bus = require('./bus');

/**
 * Demo data. Submits real orders through the real validator, then backdates
 * the timestamps so the kitchen rail opens with a believable mix: a fresh
 * ticket, one that has been waiting too long to be accepted, two mid-cook
 * (one of them already late), a rush, an allergy chit, and one plated and
 * waiting on a runner.
 */
const DRAFTS = [
  {
    _age: 25, _state: 'ready',
    memberNumber: '20871', memberName: 'Nakamura', memberStatus: 'verified', memberTier: 'silver',
    guestCount: 2, tag: 'table-03',
    lines: [
      { guestLabel: 'Kenji', pasta: 'spaghetti', sauce: 'marinara', protein: 'meatballs', toppings: ['parmesan', 'basil'], sides: [], portion: 'regular', spice: 'mild' },
      { guestLabel: 'Yuki', pasta: 'fettuccine', sauce: 'alfredo', protein: 'chicken', toppings: ['mushrooms'], sides: ['garlic_bread'], portion: 'regular', spice: 'mild' },
    ],
  },
  {
    _age: 17, _state: 'cooking', _late: true,
    memberNumber: '31500', memberName: 'Okonkwo', memberStatus: 'verified', memberTier: 'gold',
    guestCount: 5, tag: 'patio-a', avoidAllergens: ['gluten'],
    notes: 'Sam is celiac - separate water, please',
    lines: [
      { guestLabel: 'Sam (GF)', pasta: 'fusilli_gf', sauce: 'marinara', protein: 'chicken', toppings: ['tomatoes'], sides: [], portion: 'regular', spice: 'mild', notes: 'CELIAC - dedicated pot' },
      { guestLabel: 'Ada', pasta: 'penne', sauce: 'pesto', protein: 'none', toppings: ['parmesan'], sides: [], portion: 'regular', spice: 'mild' },
      { guestLabel: 'Chi', pasta: 'rigatoni', sauce: 'bolognese', protein: 'sausage', toppings: ['chili'], sides: ['breadsticks'], portion: 'large', spice: 'hot' },
      { guestLabel: 'Tunde', pasta: 'shells', sauce: 'butter_parm', protein: 'none', toppings: ['broccoli'], sides: [], portion: 'kid', spice: 'mild' },
      { guestLabel: 'Nia', pasta: 'tortellini', sauce: 'butter', protein: 'none', toppings: [], sides: [], portion: 'kid', spice: 'mild' },
    ],
  },
  {
    _age: 9, _state: 'cooking',
    memberNumber: '44219', memberName: 'Delgado', memberStatus: 'verified', memberTier: 'bronze',
    guestCount: 3, tag: 'table-01',
    lines: [
      { guestLabel: 'Rosa', pasta: 'penne', sauce: 'arrabbiata', protein: 'shrimp', toppings: ['peppers'], sides: [], portion: 'regular', spice: 'hot' },
      { guestLabel: 'Mateo', pasta: 'farfalle', sauce: 'butter', protein: 'none', toppings: ['parmesan'], sides: ['side_salad'], portion: 'kid', spice: 'mild' },
      { guestLabel: 'Luz', pasta: 'spaghetti', sauce: 'aglio_olio', protein: 'beans', toppings: ['spinach', 'chili'], sides: [], portion: 'regular', spice: 'medium' },
    ],
  },
  {
    _age: 4, _state: 'queued', _rush: true,
    memberNumber: '61234', memberName: 'Petrov', memberStatus: 'verified', memberTier: 'gold',
    guestCount: 2, tag: 'cabana-3', avoidAllergens: ['dairy'],
    notes: 'Ana is dairy free',
    lines: [
      { guestLabel: 'Ana (DF)', pasta: 'spaghetti', sauce: 'marinara', protein: 'chicken', toppings: ['basil'], sides: [], portion: 'regular', spice: 'mild', notes: 'NO DAIRY - no parm' },
      { guestLabel: 'Dmitri', pasta: 'rigatoni', sauce: 'bolognese', protein: 'none', toppings: ['parmesan'], sides: ['garlic_bread'], portion: 'large', spice: 'medium' },
    ],
  },
  {
    _age: 3, _state: 'queued',
    memberNumber: '50077', memberName: 'Whitfield', memberStatus: 'verified', memberTier: 'silver',
    guestCount: 1, tag: 'pool-bar',
    lines: [
      { guestLabel: 'Guest 1', pasta: 'tortellini', sauce: 'pesto', protein: 'none', toppings: ['tomatoes', 'basil'], sides: [], portion: 'regular', spice: 'mild' },
    ],
  },
  {
    _age: 1, _state: 'queued',
    memberNumber: '78901', memberName: '', memberStatus: 'unverified', memberTier: 'guest',
    guestCount: 2, tag: 'takeout',
    lines: [
      { guestLabel: 'Kid 1', pasta: 'shells', sauce: 'butter', protein: 'none', toppings: ['parmesan'], sides: ['breadsticks'], portion: 'kid', spice: 'mild' },
      { guestLabel: 'Kid 2', pasta: 'farfalle', sauce: 'marinara', protein: 'meatballs', toppings: ['mozzarella'], sides: [], portion: 'kid', spice: 'mild' },
    ],
  },
];

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

/**
 * Also lays down a handful of already-delivered tickets so the metrics panel
 * has real averages to show on first load.
 */
function seedDelivered(store, count = 7) {
  for (let i = 0; i < count; i += 1) {
    const base = DRAFTS[i % DRAFTS.length];
    const order = store.submit(stripMeta(base));
    const age = 120 - i * 12;
    const queueWait = 30 + (i % 4) * 25;
    const cook = Math.round(order.cookEstimateSec * (0.8 + (i % 5) * 0.12));
    const runner = 25 + (i % 3) * 30;

    order.submittedAt = minutesAgo(age);
    order.acceptedAt = new Date(new Date(order.submittedAt).getTime() + queueWait * 1000).toISOString();
    order.readyAt = new Date(new Date(order.acceptedAt).getTime() + cook * 1000).toISOString();
    order.deliveredAt = new Date(new Date(order.readyAt).getTime() + runner * 1000).toISOString();
    order.status = 'delivered';
    order.acceptedBy = 'cook:marco';
    order.readyBy = 'cook:marco';
    order.deliveredBy = 'runner:tess';
    order.events = [
      { at: order.submittedAt, action: 'submit', from: null, to: 'queued', actor: 'guest', note: '' },
      { at: order.acceptedAt, action: 'accept', from: 'queued', to: 'cooking', actor: 'cook:marco', note: '' },
      { at: order.readyAt, action: 'ready', from: 'cooking', to: 'ready', actor: 'cook:marco', note: '' },
      { at: order.deliveredAt, action: 'deliver', from: 'ready', to: 'delivered', actor: 'runner:tess', note: '' },
    ];
  }
}

function stripMeta(draft) {
  const copy = JSON.parse(JSON.stringify(draft));
  delete copy._age; delete copy._state; delete copy._late; delete copy._rush;
  return copy;
}

/** Build the live rail. Returns the number of orders created. */
function seedDemo(store) {
  seedDelivered(store);

  DRAFTS.forEach((spec) => {
    const order = store.submit(stripMeta(spec));
    order.submittedAt = minutesAgo(spec._age);
    order.events[0].at = order.submittedAt;

    if (spec._state === 'cooking' || spec._state === 'ready') {
      // Accepted about a minute after it landed.
      const acceptedAt = new Date(new Date(order.submittedAt).getTime() + 55000).toISOString();
      order.acceptedAt = acceptedAt;
      order.status = 'cooking';
      order.acceptedBy = 'cook:marco';
      order.events.push({ at: acceptedAt, action: 'accept', from: 'queued', to: 'cooking', actor: 'cook:marco', note: '' });

      if (spec._late) {
        // Push the accept back far enough that the cook clock is already red.
        order.acceptedAt = minutesAgo(spec._age - 1);
        order.events[1].at = order.acceptedAt;
      }
    }

    if (spec._state === 'ready') {
      const readyAt = new Date(new Date(order.acceptedAt).getTime() + order.cookEstimateSec * 1000).toISOString();
      order.readyAt = readyAt;
      order.status = 'ready';
      order.readyBy = 'cook:marco';
      order.events.push({ at: readyAt, action: 'ready', from: 'cooking', to: 'ready', actor: 'cook:marco', note: '' });
    }

    if (spec._rush) order.priority = 'rush';
  });

  store.save();
  bus.publish('store.seeded', { count: store.live().length });
  return store.live().length;
}

module.exports = { seedDemo, DRAFTS };
