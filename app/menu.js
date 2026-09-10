/**
 * The whole menu is data. Every screen (guest tiles, chit lines, printed
 * poster, admin reference) renders from this one catalog, so adding a sauce is
 * a one-line change with no UI edits.
 *
 * Field contract for every ingredient:
 *   id         stable key, stored on the order (never renamed)
 *   name       guest-facing label
 *   icon       art key resolved to an inline SVG glyph by the client
 *   allergens  subset of ALLERGENS ids
 *   kid        true if it shows in the short "kid mode" tile set
 *   *Sec       contribution to the cook clock (see ./cooktime.js)
 *
 * Boil times assume the pasta is PARCOOKED and held - these are finish-to-order
 * times, not from-dry times. Nothing here is priced: charges post against the
 * member number through the club's own system, so the app never quotes money.
 */

const ALLERGENS = [
  { id: 'gluten', name: 'Gluten / Wheat', code: 'WH' },
  { id: 'dairy', name: 'Dairy', code: 'DA' },
  { id: 'egg', name: 'Egg', code: 'EG' },
  { id: 'tree_nuts', name: 'Tree Nuts', code: 'NU' },
  { id: 'shellfish', name: 'Shellfish', code: 'SH' },
  { id: 'pork', name: 'Pork', code: 'PK' },
  { id: 'soy', name: 'Soy', code: 'SY' },
];

const PASTAS = [
  { id: 'spaghetti',  name: 'Spaghetti',           shape: 'strands', boilSec: 240, allergens: ['gluten'], kid: true },
  { id: 'penne',      name: 'Penne',               shape: 'tube',    boilSec: 300, allergens: ['gluten'], kid: true },
  { id: 'rigatoni',   name: 'Rigatoni',            shape: 'ridged',  boilSec: 330, allergens: ['gluten'], kid: false },
  { id: 'fettuccine', name: 'Fettuccine',          shape: 'ribbon',  boilSec: 210, allergens: ['gluten', 'egg'], kid: false },
  { id: 'farfalle',   name: 'Bow Ties',            shape: 'bowtie',  boilSec: 270, allergens: ['gluten'], kid: true },
  { id: 'shells',     name: 'Shells',              shape: 'shell',   boilSec: 300, allergens: ['gluten'], kid: true },
  { id: 'tortellini', name: 'Cheese Tortellini',   shape: 'ring',    boilSec: 120, allergens: ['gluten', 'dairy', 'egg'], kid: true },
  { id: 'fusilli_gf', name: 'Gluten-Free Fusilli', shape: 'spiral',  boilSec: 270, allergens: [], glutenFree: true, kid: false },
];

const SAUCES = [
  { id: 'marinara',    name: 'Marinara',      icon: 'tomato', finishSec: 60,  allergens: [], kid: true },
  { id: 'butter',      name: 'Just Butter',   icon: 'butter', finishSec: 30,  allergens: ['dairy'], kid: true },
  { id: 'alfredo',     name: 'Alfredo',       icon: 'cream',  finishSec: 120, allergens: ['dairy'], kid: true },
  { id: 'butter_parm', name: 'Butter & Parm', icon: 'cheese', finishSec: 45,  allergens: ['dairy'], kid: true },
  { id: 'pesto',       name: 'Basil Pesto',   icon: 'herb',   finishSec: 45,  allergens: ['dairy', 'tree_nuts'], kid: false },
  { id: 'bolognese',   name: 'Bolognese',     icon: 'meat',   finishSec: 90,  allergens: ['dairy'], kid: false },
  { id: 'arrabbiata',  name: 'Arrabbiata',    icon: 'chili',  finishSec: 75,  allergens: [], spicy: true, kid: false },
  { id: 'aglio_olio',  name: 'Garlic & Oil',  icon: 'garlic', finishSec: 45,  allergens: [], kid: false },
];

const PROTEINS = [
  { id: 'none',      name: 'No Protein',      icon: 'none',     addSec: 0,   allergens: [], kid: true },
  { id: 'chicken',   name: 'Grilled Chicken', icon: 'chicken',  addSec: 60, allergens: [], kid: true },
  { id: 'meatballs', name: 'Meatballs',       icon: 'meatball', addSec: 90, allergens: ['gluten', 'egg'], kid: true },
  { id: 'sausage',   name: 'Italian Sausage', icon: 'sausage',  addSec: 90, allergens: ['pork'], kid: false },
  { id: 'shrimp',    name: 'Shrimp',          icon: 'shrimp',   addSec: 150, allergens: ['shellfish'], kid: false },
  { id: 'beans',     name: 'White Beans',     icon: 'beans',    addSec: 45, allergens: [], kid: false },
];

const TOPPINGS = [
  { id: 'parmesan',   name: 'Parmesan',        icon: 'cheese',   addSec: 0,   allergens: ['dairy'], kid: true },
  { id: 'mozzarella', name: 'Mozzarella',      icon: 'mozz',     addSec: 20, allergens: ['dairy'], kid: true },
  { id: 'broccoli',   name: 'Broccoli',        icon: 'broccoli', addSec: 45, allergens: [], kid: true },
  { id: 'mushrooms',  name: 'Mushrooms',       icon: 'mushroom', addSec: 45, allergens: [], kid: false },
  { id: 'peppers',    name: 'Sweet Peppers',   icon: 'pepper',   addSec: 45, allergens: [], kid: false },
  { id: 'spinach',    name: 'Spinach',         icon: 'spinach',  addSec: 20, allergens: [], kid: false },
  { id: 'tomatoes',   name: 'Cherry Tomatoes', icon: 'tomato',   addSec: 15, allergens: [], kid: true },
  { id: 'olives',     name: 'Olives',          icon: 'olive',    addSec: 0, allergens: [], kid: false },
  { id: 'basil',      name: 'Fresh Basil',     icon: 'herb',     addSec: 0,   allergens: [], kid: false },
  { id: 'chili',      name: 'Chili Flakes',    icon: 'chili',    addSec: 0,   allergens: [], spicy: true, kid: false },
];

const SIDES = [
  { id: 'garlic_bread', name: 'Garlic Bread', icon: 'bread',  cookSec: 90, allergens: ['gluten', 'dairy'], kid: true },
  { id: 'side_salad',   name: 'Side Salad',   icon: 'salad',  cookSec: 0, allergens: [], kid: true },
  { id: 'breadsticks',  name: 'Breadsticks',  icon: 'sticks', cookSec: 75, allergens: ['gluten'], kid: true },
];

const PORTIONS = [
  { id: 'kid',     name: 'Kid Size', factor: 0.6, extraSec: 0,  kid: true },
  { id: 'regular', name: 'Regular',  factor: 1.0, extraSec: 0, kid: true },
  { id: 'large',   name: 'Large',    factor: 1.4, extraSec: 45, kid: false },
];

const SPICE_LEVELS = [
  { id: 'mild',   name: 'Mild',   heat: 0 },
  { id: 'medium', name: 'Medium', heat: 1 },
  { id: 'hot',    name: 'Hot',    heat: 2 },
];

const GROUPS = {
  pastas: PASTAS, sauces: SAUCES, proteins: PROTEINS,
  toppings: TOPPINGS, sides: SIDES, portions: PORTIONS,
};

/**
 * A bowl's sauces, always as an array.
 *
 * Bowls used to carry a single `sauce` string. Orders already on the rail when
 * a new build deploys still look like that, so every read goes through here
 * rather than assuming the new shape and blowing up the kitchen display
 * mid-service.
 */
export function saucesOf(line) {
  if (Array.isArray(line.sauces)) return line.sauces;
  if (line.sauce) return [line.sauce];
  return [];
}

/** Look up one ingredient in a group. Returns null rather than throwing. */
function find(group, id) {
  const list = GROUPS[group];
  if (!list) return null;
  return list.find((x) => x.id === id) || null;
}

/**
 * Find an ingredient by id without knowing its group. Used to turn a list of
 * 86'd ids back into names a guest can read.
 */
export function findAnywhere(id) {
  for (const group of Object.keys(GROUPS)) {
    const hit = find(group, id);
    if (hit) return hit;
  }
  return null;
}

/** Every allergen implied by a built bowl, de-duplicated. */
function allergensFor(line) {
  const out = new Set();
  const add = (item) => { if (item) (item.allergens || []).forEach((a) => out.add(a)); };
  add(find('pastas', line.pasta));
  saucesOf(line).forEach((id) => add(find('sauces', id)));
  add(find('proteins', line.protein));
  (line.toppings || []).forEach((t) => add(find('toppings', t)));
  (line.sides || []).forEach((s) => add(find('sides', s)));
  return [...out];
}

/** Human one-liner used on chits and review screens. */
function describe(line) {
  const parts = [];
  const pasta = find('pastas', line.pasta);
  const sauces = saucesOf(line).map((id) => find('sauces', id)).filter(Boolean);
  const protein = find('proteins', line.protein);
  if (pasta) parts.push(pasta.name);
  if (sauces.length) parts.push('w/ ' + sauces.map((x) => x.name).join(' + '));
  if (protein && protein.id !== 'none') parts.push('+ ' + protein.name);
  return parts.join(' ');
}

/** Validate an incoming bowl. Returns a list of human-readable problems. */
function validateLine(line, limits) {
  const errors = [];
  if (!find('pastas', line.pasta)) errors.push('Pick a pasta shape.');
  const sauces = saucesOf(line);
  if (sauces.length === 0) errors.push('Pick at least one sauce.');
  if (sauces.some((id) => !find('sauces', id))) errors.push('That sauce is not on the menu.');
  if (limits.maxSaucesPerBowl && sauces.length > limits.maxSaucesPerBowl) {
    errors.push('Up to ' + limits.maxSaucesPerBowl + ' sauces per bowl.');
  }
  if (line.protein && !find('proteins', line.protein)) errors.push('That protein is not on the menu.');
  if (!find('portions', line.portion)) errors.push('Pick a portion size.');
  const toppings = line.toppings || [];
  if (toppings.some((t) => !find('toppings', t))) errors.push('Unknown topping.');
  if (toppings.length > limits.maxToppingsPerBowl) {
    errors.push('Up to ' + limits.maxToppingsPerBowl + ' toppings per bowl.');
  }
  const sides = line.sides || [];
  if (sides.some((s) => !find('sides', s))) errors.push('Unknown side.');
  if (sides.length > limits.maxSidesPerBowl) {
    errors.push('Up to ' + limits.maxSidesPerBowl + ' sides per bowl.');
  }
  if (line.spice && !SPICE_LEVELS.some((s) => s.id === line.spice)) errors.push('Unknown spice level.');
  return errors;
}

export {
  ALLERGENS, PASTAS, SAUCES, PROTEINS, TOPPINGS, SIDES, PORTIONS, SPICE_LEVELS,
  find, allergensFor, describe, validateLine,
};

/** The whole menu in one object, for screens that render every group. */
export function catalog() {
  return {
    allergens: ALLERGENS, pastas: PASTAS, sauces: SAUCES, proteins: PROTEINS,
    toppings: TOPPINGS, sides: SIDES, portions: PORTIONS, spice: SPICE_LEVELS,
  };
}
