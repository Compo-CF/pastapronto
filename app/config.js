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
    // Every station in the building, across every night. A station cooks
    // exactly one kind, and order.stationForTicket() picks from the stations
    // whose kind matches - so the grill sits idle on a Neapolitan night and
    // the pans sit idle on a burger night, with no routing change either way.
    //
    // This is the real line at Carlton Woods: two pasta ranges and one pizza
    // oven. Do not add a station here to "balance" the rail - an id in this
    // list is a physical piece of equipment someone stands at, and inventing
    // one silently halves the tickets each real cook sees.
    //
    // `area` is where the station physically stands, and the kinds are not in
    // the same room - pasta and the grill are in the main kitchen, the pizza
    // oven is out on the patio - so anything drawing a floor plan has to read
    // this rather than assume one kitchen.
    stations: [
      { id: 'PASTA-1', label: 'Pasta 1', kind: 'pasta', pans: 3, area: 'Main kitchen' },
      { id: 'PASTA-2', label: 'Pasta 2', kind: 'pasta', pans: 3, area: 'Main kitchen' },
      { id: 'PIZZA-1', label: 'Pizza 1', kind: 'pizza', decks: 2, area: 'Patio' },
      { id: 'GRILL-1', label: 'Grill 1', kind: 'burger', patties: 6, area: 'Main kitchen' },
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
    // The club seats a maximum of 12 to a table, so a ticket can never be for
    // more. This is the number that becomes covers at close-out.
    maxGuests: 12,
    // Toppings have no hard cap. The club was explicit about this: a member who
    // wants everything on it should get everything on it, and being refused by
    // a screen is a worse experience than a crowded bowl. What is left is a
    // number the kitchen thinks is sensible, shown as advice and never
    // enforced - menu.validateLine() deliberately does not check it, so the
    // screen and the validator cannot disagree about what is allowed.
    toppingAdvice: 10,
    maxCheesesPerPizza: 3,
    // A bowl can be half-and-half, or a three-way. More than this and the
    // pan stops tasting like anything.
    maxSaucesPerBowl: 3,
    // More than one protein is ordinary - chicken and sausage, pepperoni and
    // bacon. Past three the pan or the pie stops working.
    maxProteinsPerItem: 3,
    maxSidesPerBowl: 2,
    // A burger takes one patty, one cheese, one basket.
    maxSidesPerBurger: 1,
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
  // `area` is the room the tent sits in. Two areas take orders - the dining
  // room and the patio - and the patio is also where the pizza stations are,
  // so a pizza for a patio table barely travels while the same pizza for the
  // dining room crosses the building.
  /**
   * The nights this venue runs. One is active at a time, and which one is a
   * live setting in Firestore (config/service) that a manager flips - not a
   * deploy, and not a date calculation. A themed night gets moved, and a night
   * only the calendar knows about is a night nobody can move.
   *
   * A night declares the kinds of item it serves. Everything else follows:
   * which lanes a guest is offered, which stations tickets route to, which
   * groups the cost sheet prices. A third night is an entry here plus its
   * menu groups.
   */
  nights: {
    neapolitan: {
      id: 'neapolitan',
      label: 'Neapolitan Night',
      kinds: ['pasta', 'pizza'],
      tagline: 'All you can eat pizza and pasta, every Thursday',
      taglineEs: 'Pizza y pasta a discreción, todos los jueves',
    },
    burger: {
      id: 'burger',
      label: 'Burger Night',
      kinds: ['burger'],
      tagline: 'All you can eat burgers, straight off the grill',
      taglineEs: 'Hamburguesas a discreción, recién hechas a la parrilla',
    },
  },

  // What the app runs as until someone says otherwise, and what it falls back
  // to when the setting cannot be read.
  defaultNight: 'neapolitan',

  // Seats per area, which no tent can tell us. Table counts are deliberately
  // NOT stored here - an area has however many tents it has in `tags` below,
  // so the two cannot drift apart. selftest.js asserts every area named here
  // actually has tents.
  areaCovers: {
    'Dining room': 80,
    Patio: 35,
  },

  // One tent per row, and one printed page per tent. Listed out rather than
  // generated because these are physical cards on physical tables: a venue
  // renumbering a booth should be able to edit the one line that names it.
  tags: [
    { id: 'table-01', label: 'Table 1', kind: 'table', area: 'Dining room' },
    { id: 'table-02', label: 'Table 2', kind: 'table', area: 'Dining room' },
    { id: 'table-03', label: 'Table 3', kind: 'table', area: 'Dining room' },
    { id: 'table-04', label: 'Table 4', kind: 'table', area: 'Dining room' },
    { id: 'table-05', label: 'Table 5', kind: 'table', area: 'Dining room' },
    { id: 'table-06', label: 'Table 6', kind: 'table', area: 'Dining room' },
    { id: 'table-07', label: 'Table 7', kind: 'table', area: 'Dining room' },
    { id: 'table-08', label: 'Table 8', kind: 'table', area: 'Dining room' },
    { id: 'table-09', label: 'Table 9', kind: 'table', area: 'Dining room' },
    { id: 'table-10', label: 'Table 10', kind: 'table', area: 'Dining room' },
    { id: 'table-11', label: 'Table 11', kind: 'table', area: 'Dining room' },
    { id: 'table-12', label: 'Table 12', kind: 'table', area: 'Dining room' },
    { id: 'table-13', label: 'Table 13', kind: 'table', area: 'Dining room' },
    { id: 'table-14', label: 'Table 14', kind: 'table', area: 'Dining room' },
    { id: 'table-15', label: 'Table 15', kind: 'table', area: 'Dining room' },
    { id: 'table-16', label: 'Table 16', kind: 'table', area: 'Dining room' },
    { id: 'table-17', label: 'Table 17', kind: 'table', area: 'Dining room' },
    { id: 'table-18', label: 'Table 18', kind: 'table', area: 'Dining room' },
    { id: 'table-19', label: 'Table 19', kind: 'table', area: 'Dining room' },
    { id: 'patio-01', label: 'Patio 1', kind: 'table', area: 'Patio' },
    { id: 'patio-02', label: 'Patio 2', kind: 'table', area: 'Patio' },
    { id: 'patio-03', label: 'Patio 3', kind: 'table', area: 'Patio' },
    { id: 'patio-04', label: 'Patio 4', kind: 'table', area: 'Patio' },
    { id: 'patio-05', label: 'Patio 5', kind: 'table', area: 'Patio' },
    { id: 'patio-06', label: 'Patio 6', kind: 'table', area: 'Patio' },
    { id: 'patio-07', label: 'Patio 7', kind: 'table', area: 'Patio' },
    { id: 'takeout', label: 'Takeout Counter', kind: 'pickup', area: 'Counter' },
  ],
};

export function tagById(id) {
  return config.tags.find((t) => t.id === id) || null;
}

/**
 * A night by id, falling back to the default rather than returning nothing.
 *
 * Every screen calls this, including before the live setting has arrived from
 * Firestore. Returning null would mean every caller writing the same fallback,
 * and one of them eventually forgetting to.
 */
export function nightById(id) {
  return config.nights[id] || config.nights[config.defaultNight];
}

/** The kinds a night serves - ['pasta','pizza'] or ['burger']. */
export function kindsForNight(id) {
  return nightById(id).kinds.slice();
}

/** Every night, for a chooser. */
export function nightList() {
  return Object.values(config.nights).map((n) => ({
    id: n.id, label: n.label, kinds: n.kinds.slice(),
  }));
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
