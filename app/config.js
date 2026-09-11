/**
 * Every tunable the app has, in one place. This used to be server-side; on a
 * static host it ships to the browser, so treat it as public configuration -
 * nothing secret belongs here.
 */
export const config = {
  venue: {
    name: 'PastaPresto!',
    tagline: 'Build your bowl. We cook it now.',
    memberLabel: 'Member Number',
  },

  service: {
    // A "service date" rolls at 4am so a late dinner shift stays on one date.
    dayRollHour: 4,
    openHour: 11,
    closeHour: 21,
    alwaysOpen: true,
  },

  kitchen: {
    // Every station cooks exactly one kind. Orders are routed by their kind,
    // so a pizza can never land on a pasta rail.
    stations: [
      { id: 'PASTA-1', label: 'Pasta 1', kind: 'pasta', pans: 3 },
      { id: 'PASTA-2', label: 'Pasta 2', kind: 'pasta', pans: 3 },
      { id: 'PIZZA-1', label: 'Pizza 1', kind: 'pizza', decks: 2 },
      { id: 'PIZZA-2', label: 'Pizza 2', kind: 'pizza', decks: 2 },
    ],
    autoAssignStations: true,
    // Client-side gate on the kitchen/expo/admin screens. A convenience lock so
    // a guest who guesses the URL does not land on the rail - NOT hard security.
    // See firestore.rules for what actually protects the data.
    staffPasscode: '2468',
  },

  sla: {
    acceptWarnSec: 60,
    acceptLateSec: 120,
    cookWarnFactor: 1.0,
    cookLateFactor: 1.35,
    runnerWarnSec: 60,
    runnerLateSec: 150,
    undoWindowSec: 120,
  },

  order: {
    maxGuests: 8,
    maxToppingsPerBowl: 4,
    // Pizzas are all one size, so the only limit that matters is how much you
    // can pile on before the middle goes soggy.
    maxCheesesPerPizza: 3,
    maxToppingsPerPizza: 5,
    // A bowl can be half-and-half, or a three-way. More than this and the
    // pan stops tasting like anything.
    maxSaucesPerBowl: 3,
    // More than one protein is ordinary - chicken and sausage, pepperoni and
    // bacon. Past three the pan or the pie stops working.
    maxProteinsPerItem: 3,
    maxSidesPerBowl: 2,
    allowUnverifiedMembers: true,
    // Member numbers run from 1 to 4 digits. Guests type them however they
    // remember them - 2, 02, 002 and 0002 are all member 2 - so there are two
    // patterns: what the keypad will accept, and the canonical form that gets
    // stored and looked up. order.normalizeMemberNumber() converts between them.
    maxMemberNumberLength: 4,
    memberNumberInputPattern: /^[0-9]{1,4}$/,
    memberNumberPattern: /^[1-9][0-9]{0,3}$/,
  },

  // Each printed table tent gets its own tag, so the kitchen knows where the
  // food goes without the guest typing anything.
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
};

export function tagById(id) {
  return config.tags.find((t) => t.id === id) || null;
}

/** Service date string (YYYY-MM-DD) honouring the 4am roll. */
export function serviceDate(now = new Date()) {
  const d = new Date(now.getTime());
  if (d.getHours() < config.service.dayRollHour) d.setDate(d.getDate() - 1);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isOpen(now = new Date()) {
  if (config.service.alwaysOpen) return true;
  const h = now.getHours();
  return h >= config.service.openHour && h < config.service.closeHour;
}
