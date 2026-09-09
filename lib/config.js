'use strict';

/**
 * Single place for every tunable. Anything an operator would plausibly want to
 * change during service lives here, not scattered through the code.
 */
const config = {
  port: Number(process.env.PORT || 7070),
  host: process.env.HOST || '0.0.0.0',

  venue: {
    name: 'PastaPronto!',
    tagline: 'Build your bowl. We cook it now.',
    // Where the "member number" comes from in the real world: club/loyalty card.
    memberLabel: 'Member Number',
    currency: 'USD',
  },

  service: {
    // A "service date" rolls at 4am so a late dinner shift stays on one date.
    dayRollHour: 4,
    openHour: 11,
    closeHour: 21,
    // Ignore the clock and always accept orders (demo / dev convenience).
    alwaysOpen: true,
  },

  kitchen: {
    stations: [
      { id: 'PASTA-1', label: 'Pasta 1', pans: 3 },
      { id: 'PASTA-2', label: 'Pasta 2', pans: 3 },
    ],
    // Round-robin new orders across stations, or pin everything to one.
    autoAssignStations: true,
  },

  sla: {
    // Seconds from SUBMITTED to ACCEPTED before the chit nags.
    acceptWarnSec: 60,
    acceptLateSec: 120,
    // Cook clock is measured against the order's own estimate x these factors.
    cookWarnFactor: 1.0,
    cookLateFactor: 1.35,
    // Seconds a READY order can sit before the runner alarm escalates.
    runnerWarnSec: 60,
    runnerLateSec: 150,
    // How long an undo stays available after DELIVERED.
    undoWindowSec: 120,
  },

  order: {
    maxGuests: 8,
    maxToppingsPerBowl: 4,
    maxSidesPerBowl: 2,
    // Accept unknown member numbers but mark them unverified rather than
    // blocking a guest (a kid mistyping a digit should not hit a dead end).
    allowUnverifiedMembers: true,
    memberNumberPattern: /^[0-9]{4,6}$/,
  },

  // QR tags: each printed table tent / poster gets its own tag so the kitchen
  // knows where the food goes without the guest typing anything.
  tags: [
    { id: 'table-01', label: 'Table 1', kind: 'table' },
    { id: 'table-02', label: 'Table 2', kind: 'table' },
    { id: 'table-03', label: 'Table 3', kind: 'table' },
    { id: 'table-04', label: 'Table 4', kind: 'table' },
    { id: 'table-12', label: 'Table 12', kind: 'table' },
    { id: 'patio-a', label: 'Patio A', kind: 'table' },
    { id: 'cabana-3', label: 'Cabana 3', kind: 'table' },
    { id: 'pool-bar', label: 'Pool Bar', kind: 'bar' },
    { id: 'takeout', label: 'Takeout Counter', kind: 'pickup' },
  ],

  persistence: {
    file: 'data/state.json',
    debounceMs: 400,
  },

  demo: {
    // Seed a few chits on an empty store so the kitchen screen is never blank
    // the first time somebody opens it.
    seedWhenEmpty: true,
  },
};

function tagById(id) {
  return config.tags.find((t) => t.id === id) || null;
}

/** Service date string (YYYY-MM-DD) honouring the 4am roll. */
function serviceDate(now = new Date()) {
  const d = new Date(now.getTime());
  if (d.getHours() < config.service.dayRollHour) d.setDate(d.getDate() - 1);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isOpen(now = new Date()) {
  if (config.service.alwaysOpen) return true;
  const h = now.getHours();
  return h >= config.service.openHour && h < config.service.closeHour;
}

module.exports = { config, tagById, serviceDate, isOpen };
