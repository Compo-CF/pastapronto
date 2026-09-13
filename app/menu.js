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
  { id: 'gluten', name: 'Gluten / Wheat', es: 'Gluten / Trigo', code: 'WH' },
  { id: 'dairy', name: 'Dairy', es: 'Lácteos', code: 'DA' },
  { id: 'egg', name: 'Egg', es: 'Huevo', code: 'EG' },
  { id: 'tree_nuts', name: 'Tree Nuts', es: 'Frutos Secos', code: 'NU' },
  { id: 'shellfish', name: 'Shellfish', es: 'Mariscos', code: 'SH' },
  { id: 'pork', name: 'Pork', es: 'Cerdo', code: 'PK' },
  { id: 'soy', name: 'Soy', es: 'Soya', code: 'SY' },
];

const PASTAS = [
  { id: 'spaghetti',  name: 'Spaghetti', es: 'Espagueti',           shape: 'strands', boilSec: 240, allergens: ['gluten'], kid: true },
  { id: 'penne',      name: 'Penne', es: 'Penne',               shape: 'tube',    boilSec: 300, allergens: ['gluten'], kid: true },
  { id: 'rigatoni',   name: 'Rigatoni', es: 'Rigatoni',            shape: 'ridged',  boilSec: 330, allergens: ['gluten'], kid: false },
  { id: 'fettuccine', name: 'Fettuccine', es: 'Fettuccine',          shape: 'ribbon',  boilSec: 210, allergens: ['gluten', 'egg'], kid: false },
  { id: 'farfalle',   name: 'Bow Ties', es: 'Moñitos',            shape: 'bowtie',  boilSec: 270, allergens: ['gluten'], kid: true },
  { id: 'shells',     name: 'Shells', es: 'Conchitas',              shape: 'shell',   boilSec: 300, allergens: ['gluten'], kid: true },
  { id: 'tortellini', name: 'Cheese Tortellini', es: 'Tortellini de Queso',   shape: 'ring',    boilSec: 120, allergens: ['gluten', 'dairy', 'egg'], kid: true },
  { id: 'fusilli_gf', name: 'Gluten-Free Fusilli', es: 'Fusilli Sin Gluten', shape: 'spiral',  boilSec: 270, allergens: [], glutenFree: true, kid: false },
];

const SAUCES = [
  { id: 'marinara',    name: 'Marinara', es: 'Marinara',      icon: 'tomato', finishSec: 60,  allergens: [], kid: true },
  { id: 'butter',      name: 'Just Butter', es: 'Solo Mantequilla',   icon: 'butter', finishSec: 30,  allergens: ['dairy'], kid: true },
  { id: 'alfredo',     name: 'Alfredo', es: 'Alfredo',       icon: 'cream',  finishSec: 120, allergens: ['dairy'], kid: true },
  { id: 'butter_parm', name: 'Butter & Parm', es: 'Mantequilla y Parmesano', icon: 'cheese', finishSec: 45,  allergens: ['dairy'], kid: true },
  { id: 'pesto',       name: 'Basil Pesto', es: 'Pesto de Albahaca',   icon: 'herb',   finishSec: 45,  allergens: ['dairy', 'tree_nuts'], kid: false },
  { id: 'bolognese',   name: 'Bolognese', es: 'Boloñesa',     icon: 'meat',   finishSec: 90,  allergens: ['dairy'], kid: false },
  { id: 'arrabbiata',  name: 'Arrabbiata', es: 'Arrabbiata',    icon: 'chili',  finishSec: 75,  allergens: [], spicy: true, kid: false },
  { id: 'aglio_olio',  name: 'Garlic & Oil', es: 'Ajo y Aceite',  icon: 'garlic', finishSec: 45,  allergens: [], kid: false },
];

const PROTEINS = [
  { id: 'chicken',   name: 'Grilled Chicken', es: 'Pollo a la Parrilla', icon: 'chicken',  addSec: 60, allergens: [], kid: true },
  { id: 'meatballs', name: 'Meatballs', es: 'Albóndigas',       icon: 'meatball', addSec: 90, allergens: ['gluten', 'egg'], kid: true },
  { id: 'sausage',   name: 'Italian Sausage', es: 'Salchicha Italiana', icon: 'sausage',  addSec: 90, allergens: ['pork'], kid: false },
  { id: 'shrimp',    name: 'Shrimp', es: 'Camarones',          icon: 'shrimp',   addSec: 150, allergens: ['shellfish'], kid: false },
  { id: 'beans',     name: 'White Beans', es: 'Frijoles Blancos',     icon: 'beans',    addSec: 45, allergens: [], kid: false },
];

const TOPPINGS = [
  { id: 'parmesan',   name: 'Parmesan', es: 'Parmesano',        icon: 'cheese',   addSec: 0,   allergens: ['dairy'], kid: true },
  { id: 'mozzarella', name: 'Mozzarella', es: 'Mozzarella',      icon: 'mozz',     addSec: 20, allergens: ['dairy'], kid: true },
  { id: 'broccoli',   name: 'Broccoli', es: 'Brócoli',        icon: 'broccoli', addSec: 45, allergens: [], kid: true },
  { id: 'mushrooms',  name: 'Mushrooms', es: 'Champiñones',       icon: 'mushroom', addSec: 45, allergens: [], kid: false },
  { id: 'peppers',    name: 'Sweet Peppers', es: 'Pimientos Dulces',   icon: 'pepper',   addSec: 45, allergens: [], kid: false },
  { id: 'spinach',    name: 'Spinach', es: 'Espinacas',         icon: 'spinach',  addSec: 20, allergens: [], kid: false },
  { id: 'tomatoes',   name: 'Cherry Tomatoes', es: 'Tomates Cherry', icon: 'tomato',   addSec: 15, allergens: [], kid: true },
  { id: 'olives',     name: 'Olives', es: 'Aceitunas',          icon: 'olive',    addSec: 0, allergens: [], kid: false },
  { id: 'basil',      name: 'Fresh Basil', es: 'Albahaca Fresca',     icon: 'herb',     addSec: 0,   allergens: [], kid: false },
  { id: 'chili',      name: 'Chili Flakes', es: 'Hojuelas de Chile',    icon: 'flakes',    addSec: 0,   allergens: [], spicy: true, kid: false },
];

const SIDES = [
  { id: 'garlic_bread', name: 'Garlic Bread', es: 'Pan de Ajo', icon: 'bread',  cookSec: 90, allergens: ['gluten', 'dairy'], kid: true },
  { id: 'side_salad',   name: 'Side Salad', es: 'Ensalada',   icon: 'salad',  cookSec: 0, allergens: [], kid: true },
  { id: 'breadsticks',  name: 'Breadsticks', es: 'Palitos de Pan',  icon: 'sticks', cookSec: 75, allergens: ['gluten'], kid: true },
];

const PORTIONS = [
  { id: 'kid',     name: 'Kid Size', es: 'Porción Niño', factor: 0.6, extraSec: 0,  kid: true },
  { id: 'regular', name: 'Regular', es: 'Regular',  factor: 1.0, extraSec: 0, kid: true },
  { id: 'large',   name: 'Large', es: 'Grande',    factor: 1.4, extraSec: 45, kid: false },
];

const SPICE_LEVELS = [
  { id: 'mild',   name: 'Mild', es: 'Suave',   heat: 0 },
  { id: 'medium', name: 'Medium', es: 'Medio', heat: 1 },
  { id: 'hot',    name: 'Hot', es: 'Picante',    heat: 2 },
];


// ------------------------------------------------------------------- pizza
//
// Pizzas are all one size, so there is no portion step and no crust choice -
// one 12" classic base, whose gluten and dairy every pizza inherits. Adding a
// gluten-free crust later means promoting this constant to a group and adding
// a step for it.

export const PIZZA_BASE = {
  id: 'classic',
  name: '12" Classic',
  // Gluten only. Dairy used to live here because every pie came with cheese;
  // cheese is now chosen and "No Cheese" is a real answer, so claiming dairy
  // on the crust would wrongly grey out the whole lane for someone avoiding it.
  allergens: ['gluten'],
  bakeSec: 420,
};

/*
 * Sauce and cheese carry their amount in the same list the guest is already
 * looking at rather than in a second control beside it: "Heavy Sauce" is how a
 * guest says it, and a separate amount selector is one more thing to find.
 *
 * So two kinds of entry share a group, and the difference is marked in the
 * data rather than guessed from the name:
 *
 *   exclusive: true    "No Sauce" answers the whole question, so choosing it
 *                      clears and greys everything else in its group.
 *   amount: 'light'    "Light Sauce" modifies a choice instead of being one.
 *         | 'heavy'    It needs a base alongside it, and rules out the other
 *                      amount - nothing is both light and heavy.
 *
 * groupRules() below is the only implementation of those rules, and both
 * validateLine() and the guest tiles go through it, so what a screen greys out
 * and what the database refuses cannot drift apart.
 */

const PIZZA_SAUCES = [
  { id: 'pz_marinara',    name: 'House Made Marinara', es: 'Marinara de la Casa', icon: 'tomato', allergens: [], kid: true },
  { id: 'pz_alfredo',     name: 'Alfredo Sauce', es: 'Salsa Alfredo',       icon: 'cream',  allergens: ['dairy'], kid: true },
  { id: 'pz_pesto',       name: 'Basil Pesto', es: 'Pesto de Albahaca',         icon: 'herb',   allergens: ['dairy', 'tree_nuts'], kid: false },
  { id: 'pz_bbq',         name: 'BBQ Sauce', es: 'Salsa BBQ',           icon: 'bbq',    allergens: [], kid: true },
  { id: 'pz_no_sauce',    name: 'No Sauce', es: 'Sin Salsa',            icon: 'sauce_none',   allergens: [], kid: true, exclusive: true },
  { id: 'pz_sauce_light', name: 'Light Sauce', es: 'Poca Salsa',         icon: 'sauce_light',   allergens: [], kid: true, amount: 'light' },
  { id: 'pz_sauce_heavy', name: 'Heavy Sauce', es: 'Extra Salsa',         icon: 'sauce_heavy',   allergens: [], kid: true, amount: 'heavy' },
];

const PIZZA_CHEESES = [
  { id: 'pz_shred_mozz',   name: 'Shredded Mozzarella', es: 'Mozzarella Rallada', icon: 'mozz_shred',   addSec: 0,  allergens: ['dairy'], kid: true },
  { id: 'pz_fresh_mozz',   name: 'Fresh Mozzarella', es: 'Mozzarella Fresca',    icon: 'mozz',   addSec: 20, allergens: ['dairy'], kid: true },
  { id: 'pz_grated_parm',  name: 'Grated Parmesan', es: 'Parmesano Rallado',     icon: 'cheese', addSec: 0,  allergens: ['dairy'], kid: true },
  { id: 'pz_no_cheese',    name: 'No Cheese', es: 'Sin Queso',           icon: 'cheese_none',   addSec: 0,  allergens: [], kid: true, exclusive: true },
  { id: 'pz_cheese_light', name: 'Light Cheese', es: 'Poco Queso',        icon: 'cheese_light',   addSec: 0,  allergens: [], kid: true, amount: 'light' },
  // More cheese is more moisture, which is the one amount that genuinely
  // changes how long the pie needs in the oven.
  { id: 'pz_cheese_heavy', name: 'Heavy Cheese', es: 'Extra Queso',        icon: 'cheese_heavy',   addSec: 30, allergens: [], kid: true, amount: 'heavy' },
];

// Meats get their own step rather than competing with the vegetables for
// topping slots - two meats on a pizza is ordinary, and it should not cost
// half the topping allowance.
const PIZZA_PROTEINS = [
  { id: 'pepperoni',  name: 'Pepperoni', es: 'Pepperoni',   icon: 'pepperoni', addSec: 15, allergens: ['pork'], kid: true },
  { id: 'pz_sausage', name: 'Sausage', es: 'Salchicha',     icon: 'sausage',   addSec: 20, allergens: ['pork'], kid: true },
  { id: 'pz_chicken', name: 'Chicken', es: 'Pollo',     icon: 'chicken',   addSec: 15, allergens: [], kid: true },
  { id: 'pz_beef',    name: 'Ground Beef', es: 'Carne Molida', icon: 'meatball',  addSec: 20, allergens: [], kid: true },
  { id: 'bacon',      name: 'Bacon', es: 'Tocino',       icon: 'bacon',     addSec: 15, allergens: ['pork'], kid: true },
  { id: 'ham',        name: 'Ham', es: 'Jamón',         icon: 'ham',       addSec: 10, allergens: ['pork'], kid: true },
];

// Vegetables. The three marked postBake go on after the pie leaves the oven -
// basil and arugula would wilt to nothing and the flakes would scorch - so
// they cost no oven time, exactly the way a finisher does.
const PIZZA_TOPPINGS = [
  { id: 'pineapple',    name: 'Pineapple', es: 'Piña',                icon: 'pineapple', addSec: 10, allergens: [], kid: true },
  { id: 'pz_olives',    name: 'Olives', es: 'Aceitunas',                   icon: 'olive',     addSec: 5,  allergens: [], kid: false },
  { id: 'pz_mushroom',  name: 'Mushrooms', es: 'Champiñones',                icon: 'mushroom',  addSec: 15, allergens: [], kid: false },
  { id: 'pz_pepper',    name: 'Bell Peppers', es: 'Pimientos',             icon: 'pepper',    addSec: 10, allergens: [], kid: false },
  { id: 'pz_artichoke', name: 'Grilled Artichokes', es: 'Alcachofas Asadas',       icon: 'artichoke', addSec: 15, allergens: [], kid: false },
  { id: 'red_onion',    name: 'Onions', es: 'Cebolla',                   icon: 'onion',     addSec: 10, allergens: [], kid: false },
  { id: 'pz_tomatoes',  name: 'Sliced Heirloom Tomatoes', es: 'Tomates Heirloom en Rodajas', icon: 'tomato',    addSec: 10, allergens: [], kid: true },
  { id: 'jalapeno',     name: 'Fresh Jalapenos', es: 'Jalapeños Frescos',          icon: 'jalapeno',     addSec: 5,  allergens: [], spicy: true, kid: false },
  { id: 'pz_basil',     name: 'Basil', es: 'Albahaca',                    icon: 'herb',      addSec: 0,  allergens: [], kid: true, postBake: true },
  { id: 'pz_arugula',   name: 'Arugula', es: 'Arúgula',                  icon: 'spinach',   addSec: 0,  allergens: [], kid: false, postBake: true },
  { id: 'pz_chili',     name: 'Red Pepper Flakes', es: 'Hojuelas de Chile',        icon: 'flakes',     addSec: 0,  allergens: [], spicy: true, kid: true, postBake: true },
  { id: 'fin_salt',     name: 'Flake Salt', es: 'Sal en Escamas',               icon: 'salt',      addSec: 0,  allergens: [], kid: true, postBake: true },
  { id: 'fin_oregano',  name: 'Oregano', es: 'Orégano',                  icon: 'oregano',      addSec: 0,  allergens: [], kid: true, postBake: true },
];

const GROUPS = {
  pastas: PASTAS, sauces: SAUCES, proteins: PROTEINS,
  toppings: TOPPINGS, sides: SIDES, portions: PORTIONS,
  pizzaSauces: PIZZA_SAUCES, pizzaCheeses: PIZZA_CHEESES,
  pizzaProteins: PIZZA_PROTEINS,
  pizzaToppings: PIZZA_TOPPINGS,
};

/** 'pasta' unless the line says otherwise. Old documents have no kind. */
export function kindOf(line) {
  return line && line.kind === 'pizza' ? 'pizza' : 'pasta';
}

/** Which group a kind's sauces and toppings come from. */
export const GROUPS_FOR = {
  pasta: { sauces: 'sauces', proteins: 'proteins', toppings: 'toppings' },
  pizza: {
    sauces: 'pizzaSauces', cheeses: 'pizzaCheeses',
    proteins: 'pizzaProteins', toppings: 'pizzaToppings',
  },
};

/**
 * The rules for a group that mixes real choices with "none" and amounts.
 *
 * One implementation, two callers: validateLine() decides whether an order may
 * be written, and the guest screen decides which tiles to grey out. Those two
 * answers have to agree, and the only way to be sure of that is for them to be
 * the same answer.
 *
 * @param {string} groupKey   e.g. 'pizzaSauces'
 * @param {string[]} chosen   ids currently selected
 * @returns {{bases: string[], amount: object|null, exclusive: object|null,
 *            blocked: Object<string,string>, error: string|null}}
 *          `blocked` maps an id to the reason it cannot be picked right now.
 */
export function groupRules(groupKey, chosen) {
  const list = GROUPS[groupKey] || [];
  const picked = (chosen || []).map((id) => list.find((x) => x.id === id)).filter(Boolean);

  const exclusive = picked.find((x) => x.exclusive) || null;
  const amount = picked.find((x) => x.amount) || null;
  const bases = picked.filter((x) => !x.exclusive && !x.amount).map((x) => x.id);

  const blocked = {};
  let error = null;

  if (exclusive) {
    // "No Sauce" answers the question, so nothing else in the group applies.
    list.forEach((x) => {
      if (x.id !== exclusive.id) blocked[x.id] = exclusive.name.toLowerCase();
    });
  } else {
    // Nothing is both light and heavy.
    if (amount) {
      list.forEach((x) => {
        if (x.amount && x.id !== amount.id) blocked[x.id] = amount.name.toLowerCase();
      });
    }
    // An amount with nothing under it is not an order anyone can cook.
    if (amount && bases.length === 0) {
      error = amount.name + ' needs something to go on.';
    }
  }

  return { bases, amount, exclusive, blocked, error };
}

/** A pizza's cheeses, always as an array. Older documents have none. */
export function cheesesOf(line) {
  if (Array.isArray(line && line.cheeses)) return line.cheeses.filter(Boolean);
  return [];
}

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

/**
 * A line's proteins, always as an array.
 *
 * Lines used to carry a single `protein` string, with 'none' as a real value.
 * Multi-select makes an empty array the way to say "no protein", so 'none' is
 * dropped here for old documents rather than surfacing as a phantom topping.
 */
export function proteinsOf(line) {
  if (Array.isArray(line.proteins)) return line.proteins;
  if (line.protein && line.protein !== 'none') return [line.protein];
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

/** Every allergen implied by a built bowl or pizza, de-duplicated. */
export function allergensFor(line) {
  const out = new Set();
  const add = (item) => { if (item) (item.allergens || []).forEach((a) => out.add(a)); };
  const g = GROUPS_FOR[kindOf(line)];

  if (kindOf(line) === 'pizza') {
    // Every pizza inherits the crust. Dairy now comes from the cheese that was
    // actually chosen, so a no-cheese pie is genuinely dairy free.
    PIZZA_BASE.allergens.forEach((a) => out.add(a));
    cheesesOf(line).forEach((id) => add(find('pizzaCheeses', id)));
  } else {
    add(find('pastas', line.pasta));
    (line.sides || []).forEach((id) => add(find('sides', id)));
  }

  saucesOf(line).forEach((id) => add(find(g.sauces, id)));
  proteinsOf(line).forEach((id) => add(find(g.proteins, id)));
  (line.toppings || []).forEach((id) => add(find(g.toppings, id)));
  return [...out];
}

/**
 * The display name of one item, in one language.
 *
 * Falls back to English when a translation is missing, so a newly added
 * ingredient shows its English name rather than nothing at all.
 */
export function nameOf(group, id, lang) {
  const item = find(group, id);
  if (!item) return null;
  return (lang === 'es' && item.es) ? item.es : item.name;
}

/**
 * Human one-liner used on chits and review screens.
 *
 * Takes a language, and defaults to English on purpose: order.buildOrder()
 * calls this to store `dish` on the document, and that stored string is the
 * canonical English record the CSV, the PDF and any later audit read. A screen
 * wanting another language recomputes from the ids it already has - which is
 * what lets a Spanish guest's order arrive on an English kitchen rail, and
 * the reverse.
 */
export function describe(line, lang) {
  const g = GROUPS_FOR[kindOf(line)];
  const name = (group) => (id) => nameOf(group, id, lang);
  const sauces = saucesOf(line).map(name(g.sauces)).filter(Boolean);
  const proteins = proteinsOf(line).map(name(g.proteins)).filter(Boolean);
  const sauceText = sauces.join(' + ');

  if (kindOf(line) === 'pizza') {
    // The crust is a constant, so the sauce leads - that is what a cook reads
    // first when they pull the ticket. Then cheese, then meats, then veg.
    //
    // Amounts are folded into the thing they modify rather than listed beside
    // it: "Marinara (heavy)" is one instruction, "Marinara, Heavy Sauce" reads
    // like two and invites a cook to wonder which.
    const es = lang === 'es';
    const sauceRule = groupRules('pizzaSauces', saucesOf(line));
    const cheeseRule = groupRules('pizzaCheeses', cheesesOf(line));
    // The amount is a word, not a token: "(heavy)" has to become "(extra)".
    const AMOUNT = es ? { light: 'poca', heavy: 'extra' } : { light: 'light', heavy: 'heavy' };
    const qualify = (text, rule) => (rule.amount
      ? text + ' (' + (AMOUNT[rule.amount.amount] || rule.amount.amount) + ')'
      : text);

    const sauceLabel = sauceRule.exclusive
      ? nameOf('pizzaSauces', sauceRule.exclusive.id, lang)
      : qualify(sauceRule.bases.map(name('pizzaSauces')).filter(Boolean).join(' + '), sauceRule);

    const cheeseLabel = cheeseRule.exclusive
      ? nameOf('pizzaCheeses', cheeseRule.exclusive.id, lang)
      : qualify(cheeseRule.bases.map(name('pizzaCheeses')).filter(Boolean).join(' + '), cheeseRule);

    const toppings = (line.toppings || []).map(name('pizzaToppings')).filter(Boolean);
    const on = proteins.concat(toppings);

    // Word order, not word substitution. English puts the sauce in front of
    // the noun ("BBQ Pizza"); Spanish puts it after ("Pizza con salsa BBQ"),
    // and a "no sauce" pie reads as a comma clause rather than "con Sin Salsa".
    if (es) {
      const parts = ['Pizza'];
      if (sauceRule.exclusive) parts.push(sauceLabel.toLowerCase());
      else if (sauceLabel) parts.push('con ' + sauceLabel);
      if (cheeseRule.exclusive) parts.push('- ' + cheeseLabel.toLowerCase());
      else if (cheeseLabel) parts.push('+ ' + cheeseLabel);
      if (on.length) parts.push('+ ' + on.join(', '));
      return parts.join(' ');
    }
    const parts = [sauceLabel ? sauceLabel + ' Pizza' : 'Pizza'];
    if (cheeseLabel) parts.push('w/ ' + cheeseLabel);
    if (on.length) parts.push((cheeseLabel ? '+ ' : 'w/ ') + on.join(', '));
    return parts.join(' ');
  }

  const parts = [];
  const pasta = nameOf('pastas', line.pasta, lang);
  if (pasta) parts.push(pasta);
  if (sauceText) parts.push((lang === 'es' ? 'con ' : 'w/ ') + sauceText);
  if (proteins.length) parts.push('+ ' + proteins.join(', '));
  return parts.join(' ');
}

/** Validate an incoming bowl or pizza. Returns human-readable problems. */
export function validateLine(line, limits) {
  const errors = [];
  const kind = kindOf(line);
  const g = GROUPS_FOR[kind];

  const sauces = saucesOf(line);
  if (sauces.length === 0) errors.push('Pick at least one sauce.');
  if (sauces.some((id) => !find(g.sauces, id))) errors.push('That sauce is not on the menu.');

  // On pizza the sauce list also holds "No Sauce" and the two amounts, so the
  // cap counts real sauces - Marinara + Alfredo + Heavy is two sauces, not
  // three - and the same rules the tiles grey out are enforced here.
  const sauceRule = groupRules(g.sauces, sauces);
  if (sauceRule.error) errors.push(sauceRule.error);
  if (sauces.some((id) => sauceRule.blocked[id])) {
    errors.push('Those sauce choices contradict each other.');
  }
  if (limits.maxSaucesPerBowl && sauceRule.bases.length > limits.maxSaucesPerBowl) {
    errors.push('Up to ' + limits.maxSaucesPerBowl + ' sauces each.');
  }

  const proteins = proteinsOf(line);
  if (proteins.some((id) => !find(g.proteins, id))) errors.push('That protein is not on the menu.');
  if (limits.maxProteinsPerItem && proteins.length > limits.maxProteinsPerItem) {
    errors.push('Up to ' + limits.maxProteinsPerItem + ' proteins each.');
  }

  const toppings = line.toppings || [];
  if (toppings.some((t) => !find(g.toppings, t))) errors.push('Unknown topping.');

  if (kind === 'pizza') {
    const cheeses = cheesesOf(line);
    if (cheeses.length === 0) errors.push('Pick a cheese, or No Cheese.');
    if (cheeses.some((id) => !find('pizzaCheeses', id))) errors.push('That cheese is not on the menu.');
    const cheeseRule = groupRules('pizzaCheeses', cheeses);
    if (cheeseRule.error) errors.push(cheeseRule.error);
    if (cheeses.some((id) => cheeseRule.blocked[id])) {
      errors.push('Those cheese choices contradict each other.');
    }
    if (limits.maxCheesesPerPizza && cheeseRule.bases.length > limits.maxCheesesPerPizza) {
      errors.push('Up to ' + limits.maxCheesesPerPizza + ' cheeses per pizza.');
    }

    const baked = toppings.filter((id) => !(find('pizzaToppings', id) || {}).postBake);
    if (baked.length > limits.maxToppingsPerPizza) {
      errors.push('Up to ' + limits.maxToppingsPerPizza + ' toppings per pizza.');
    }
    return errors;
  }

  if (!find('pastas', line.pasta)) errors.push('Pick a pasta shape.');
  if (!find('portions', line.portion)) errors.push('Pick a portion size.');
  if (toppings.length > limits.maxToppingsPerBowl) {
    errors.push('Up to ' + limits.maxToppingsPerBowl + ' toppings per bowl.');
  }
  const sides = line.sides || [];
  if (sides.some((x) => !find('sides', x))) errors.push('Unknown side.');
  if (sides.length > limits.maxSidesPerBowl) {
    errors.push('Up to ' + limits.maxSidesPerBowl + ' sides per bowl.');
  }
  if (line.spice && !SPICE_LEVELS.some((x) => x.id === line.spice)) errors.push('Unknown spice level.');
  return errors;
}

export {
  ALLERGENS, PASTAS, SAUCES, PROTEINS, TOPPINGS, SIDES, PORTIONS, SPICE_LEVELS,
  PIZZA_SAUCES, PIZZA_CHEESES, PIZZA_PROTEINS, PIZZA_TOPPINGS,
  find,
};

/** The whole menu in one object, for screens that render every group. */
export function catalog() {
  return {
    allergens: ALLERGENS, pastas: PASTAS, sauces: SAUCES, proteins: PROTEINS,
    toppings: TOPPINGS, sides: SIDES, portions: PORTIONS, spice: SPICE_LEVELS,
    pizzaSauces: PIZZA_SAUCES, pizzaCheeses: PIZZA_CHEESES,
    pizzaProteins: PIZZA_PROTEINS,
    pizzaToppings: PIZZA_TOPPINGS,
    pizzaBase: PIZZA_BASE,
  };
}
