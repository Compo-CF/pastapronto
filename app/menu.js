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
  // Exclusive the same way "No Sauce" is: a bowl of buttered pasta is the
  // whole answer, and marinara on top of it is a different dish.
  { id: 'butter',      name: 'Just Butter', es: 'Solo Mantequilla',   icon: 'butter', finishSec: 30,  allergens: ['dairy'], kid: true, exclusive: true },
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
  { id: 'kid',     name: 'Kid Size', es: 'Porción Niño', factor: 0.6, extraSec: 0,  kid: true, icon: 'bowl_kid' },
  { id: 'regular', name: 'Regular', es: 'Regular',  factor: 1.0, extraSec: 0, kid: true, icon: 'bowl_regular' },
  // Retired at the club's request: pasta is regular or kid size only. It stays
  // in the catalog rather than being deleted because orders already taken name
  // it, and a close-out report for last Thursday still has to print "Large"
  // instead of dropping the word. `retired` keeps it out of what a guest is
  // offered; nothing else needs to know.
  { id: 'large',   name: 'Large', es: 'Grande',    factor: 1.4, extraSec: 45, kid: false, retired: true, icon: 'bowl_large' },
];

const SPICE_LEVELS = [
  { id: 'mild',   name: 'Mild', es: 'Suave',   heat: 0 },
  { id: 'medium', name: 'Medium', es: 'Medio', heat: 1 },
  { id: 'hot',    name: 'Hot', es: 'Picante',    heat: 2 },
];


// ------------------------------------------------------------------- pizza
//
// Pizzas are all one size, so there is no portion step. The crust IS a choice
// now - the club added a gluten-free base and a dessert pizza, and the note in
// this spot used to say that doing so meant promoting the old constant to a
// group. This is that group.
//
// Gluten lives on the crust that was actually chosen, so a gluten-free pie is
// genuinely gluten free. Dairy does not live here at all: cheese is chosen and
// "No Cheese" is a real answer, so claiming dairy on the crust would wrongly
// grey out the whole lane for someone avoiding it.
export const PIZZA_CRUSTS = [
  {
    id: 'classic',
    name: '12" Classic', es: 'Clásica de 12"',
    icon: 'pie', allergens: ['gluten'], bakeSec: 420, kid: true,
  },
  {
    id: 'pz_gf_crust',
    name: 'Gluten Free Crust', es: 'Masa Sin Gluten',
    // Longer in the oven: a gluten-free base needs the extra time to set.
    icon: 'crust_gf', allergens: [], bakeSec: 480, kid: true, glutenFree: true,
  },
  // The two dessert bases. `dessert: true` is what the rest of the file reads:
  // it decides which sauces and toppings are offered, and which steps a guest
  // is asked at all. A dessert pizza is not a normal pizza with sweet things
  // on it - there is no cheese question and no meat question, because there is
  // no answer to either that anyone would want.
  {
    id: 'pz_dessert',
    name: 'Dessert Pizza', es: 'Pizza de Postre',
    icon: 'pizza_dessert', allergens: ['gluten'], bakeSec: 360, kid: true,
    dessert: true,
    // Nutella is the sauce and it is the only one, so it is set here and the
    // rules below leave nothing else selectable. Strawberries and powdered
    // sugar come ticked; the guest can take either off, and add pineapple.
    defaults: {
      sauces: ['pz_nutella'],
      cheeses: ['pz_no_cheese'],
      toppings: ['pz_strawberry', 'pz_powdered_sugar'],
    },
  },
  {
    id: 'pz_gf_dessert',
    name: 'Gluten Free Dessert Pizza', es: 'Pizza de Postre Sin Gluten',
    icon: 'crust_gf_dessert', allergens: [], bakeSec: 420, kid: true,
    dessert: true, glutenFree: true,
    defaults: {
      sauces: ['pz_nutella'],
      cheeses: ['pz_no_cheese'],
      toppings: ['pz_strawberry', 'pz_powdered_sugar'],
    },
  },
];

/**
 * What a crust rules out, as {id: reason} - the same shape the guest tiles
 * already use to grey something out.
 *
 * Two rules, one sentence each:
 *   - a dessert pizza offers only what belongs on a dessert pizza
 *   - a savoury pizza offers nothing that belongs only on a dessert one
 *
 * `dessert: true` on an item means dessert-only. `dessertOk: true` means it
 * works on either, which today is pineapple and nothing else. Both the screen
 * and validateLine() read this, so what is greyed out and what the database
 * refuses cannot drift apart.
 */
export function crustBlocks(group, line) {
  const onDessert = Boolean(crustOf(line).dessert);
  const out = {};
  (GROUPS[group] || []).forEach((x) => {
    const dessertOnly = Boolean(x.dessert);
    const allowedOnDessert = dessertOnly || Boolean(x.dessertOk);
    if (onDessert && !allowedOnDessert) out[x.id] = 'not on a dessert pizza';
    if (!onDessert && dessertOnly) out[x.id] = 'dessert pizza only';
  });
  return out;
}

/**
 * Steps a crust makes pointless.
 *
 * A dessert pizza has no cheese worth asking about and no meat at all, so the
 * guest is never shown either question rather than being shown one with a
 * single greyed-out answer.
 */
export function crustSkips(line) {
  return crustOf(line).dessert ? ['cheeses', 'proteins'] : [];
}

/** The crust a line was built on, falling back for orders taken before the
 *  crust was a choice - they were all classic. */
export function crustOf(line) {
  return PIZZA_CRUSTS.find((c) => c.id === line.base) || PIZZA_CRUSTS[0];
}

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
  // The dessert sauce. It is the only one a dessert pizza offers, and it is
  // offered on nothing else.
  { id: 'pz_nutella',     name: 'Nutella', es: 'Nutella',               icon: 'nutella', allergens: ['dairy', 'tree_nuts'], kid: true, dessert: true },
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
  // The one thing on this list that belongs on either kind of pizza.
  { id: 'pineapple',    name: 'Pineapple', es: 'Piña',                icon: 'pineapple', addSec: 10, allergens: [], kid: true, dessertOk: true },
  { id: 'pz_olives',    name: 'Olives', es: 'Aceitunas',                   icon: 'olive',     addSec: 5,  allergens: [], kid: false },
  { id: 'pz_mushroom',  name: 'Mushrooms', es: 'Champiñones',                icon: 'mushroom',  addSec: 15, allergens: [], kid: false },
  { id: 'pz_pepper',    name: 'Bell Peppers', es: 'Pimientos',             icon: 'pepper',    addSec: 10, allergens: [], kid: false },
  { id: 'pz_artichoke', name: 'Grilled Artichokes', es: 'Alcachofas Asadas',       icon: 'artichoke', addSec: 15, allergens: [], kid: false },
  { id: 'red_onion',    name: 'Onions', es: 'Cebolla',                   icon: 'onion',     addSec: 10, allergens: [], kid: false },
  { id: 'pz_tomatoes',  name: 'Sliced Heirloom Tomatoes', es: 'Tomates Heirloom en Rodajas', icon: 'tomato',    addSec: 10, allergens: [], kid: true },
  { id: 'jalapeno',     name: 'Fresh Jalapenos', es: 'Jalapeños Frescos',          icon: 'jalapeno',     addSec: 5,  allergens: [], spicy: true, kid: false },
  // Dessert toppings. All three go on after the bake, so they add no oven
  // time - the same reason the herbs below do not.
  { id: 'pz_strawberry', name: 'Strawberries', es: 'Fresas',             icon: 'strawberry', addSec: 0, allergens: [], kid: true, postBake: true, dessert: true },
  { id: 'pz_powdered_sugar', name: 'Powdered Sugar', es: 'Azúcar Glas',  icon: 'sugar',     addSec: 0,  allergens: [], kid: true, postBake: true, dessert: true },
  { id: 'pz_basil',     name: 'Basil', es: 'Albahaca',                    icon: 'herb',      addSec: 0,  allergens: [], kid: true, postBake: true },
  { id: 'pz_arugula',   name: 'Arugula', es: 'Arúgula',                  icon: 'spinach',   addSec: 0,  allergens: [], kid: false, postBake: true },
  { id: 'pz_chili',     name: 'Red Pepper Flakes', es: 'Hojuelas de Chile',        icon: 'flakes',     addSec: 0,  allergens: [], spicy: true, kid: true, postBake: true },
  { id: 'fin_salt',     name: 'Flake Salt', es: 'Sal en Escamas',               icon: 'salt',      addSec: 0,  allergens: [], kid: true, postBake: true },
  { id: 'fin_oregano',  name: 'Oregano', es: 'Orégano',                  icon: 'oregano',      addSec: 0,  allergens: [], kid: true, postBake: true },
];

// ------------------------------------------------------------------ burgers
//
// Burger Night replaces the pasta and pizza lanes rather than joining them -
// it is its own night, with the grill running and the pans and decks dark.
//
// Same field contract as everything above, and the same two markers that make
// a group of choices behave: `exclusive` for an answer that ends the question
// ("No Cheese"), and nothing is a `amount` chip here because a burger is not
// built in ladles.

const BURGER_BUNS = [
  { id: 'bun_brioche', name: 'Brioche Bun', es: 'Pan Brioche',        icon: 'bun_soft',   addSec: 30, allergens: ['gluten', 'dairy', 'egg'], kid: true },
  { id: 'bun_potato',  name: 'Potato Roll', es: 'Pan de Papa',        icon: 'bun_seeded', addSec: 30, allergens: ['gluten'], kid: true },
  { id: 'bun_gf',      name: 'Gluten-Free Bun', es: 'Pan Sin Gluten', icon: 'bun_gf',     addSec: 45, allergens: [], glutenFree: true, kid: false },
];

const BURGER_PATTIES = [
  { id: 'beef_single', name: 'Beef - Single', es: 'Carne de Res - Sencilla', icon: 'patty',        grillSec: 210, allergens: [], kid: true },
  { id: 'beef_double', name: 'Beef - Double', es: 'Carne de Res - Doble',   icon: 'patty_double', grillSec: 285, allergens: [], kid: false },
  { id: 'patty_bean',  name: 'Black Bean Patty', es: 'Carne de Frijol Negro', icon: 'beans',       grillSec: 240, allergens: ['soy'], kid: false },
];

const BURGER_CHEESES = [
  { id: 'ch_american', name: 'American', es: 'Americano',       icon: 'cheese_slice', addSec: 15, allergens: ['dairy'], kid: true },
  { id: 'ch_cheddar',  name: 'Sharp Cheddar', es: 'Cheddar Fuerte', icon: 'cheese', addSec: 15, allergens: ['dairy'], kid: true },
  { id: 'ch_swiss',    name: 'Swiss', es: 'Suizo',              icon: 'cheese_holes', addSec: 15, allergens: ['dairy'], kid: false },
  { id: 'ch_pepper',   name: 'Pepper Jack', es: 'Pepper Jack',  icon: 'cheese_flecks', addSec: 15, allergens: ['dairy'], spicy: true, kid: false },
  { id: 'ch_none',     name: 'No Cheese', es: 'Sin Queso',      icon: 'cheese_none', addSec: 0, allergens: [], kid: true, exclusive: true },
];

const BURGER_TOPPINGS = [
  { id: 'bt_lettuce',  name: 'Lettuce', es: 'Lechuga',              icon: 'lettuce',  addSec: 0,  allergens: [], kid: true },
  { id: 'bt_tomato',   name: 'Tomato', es: 'Tomate',                icon: 'tomato',   addSec: 0,  allergens: [], kid: true },
  { id: 'bt_onion',    name: 'Raw Onion', es: 'Cebolla Cruda',      icon: 'onion',    addSec: 0,  allergens: [], kid: false },
  { id: 'bt_grilled_onion', name: 'Grilled Onions', es: 'Cebolla Asada', icon: 'onion_grilled', addSec: 30, allergens: [], kid: true },
  { id: 'bt_pickles',  name: 'Pickles', es: 'Pepinillos',           icon: 'pickle',    addSec: 0,  allergens: [], kid: true },
  { id: 'bt_bacon',    name: 'Bacon', es: 'Tocino',                 icon: 'bacon',    addSec: 20, allergens: ['pork'], kid: true },
  { id: 'bt_mushroom', name: 'Sauteed Mushrooms', es: 'Champiñones Salteados', icon: 'mushroom', addSec: 30, allergens: [], kid: false },
  { id: 'bt_jalapeno', name: 'Jalapenos', es: 'Jalapeños',          icon: 'jalapeno', addSec: 0,  allergens: [], spicy: true, kid: false },
  { id: 'bt_avocado',  name: 'Avocado', es: 'Aguacate',             icon: 'avocado',  addSec: 10, allergens: [], kid: false },
  { id: 'bt_egg',      name: 'Fried Egg', es: 'Huevo Frito',        icon: 'fried_egg',   addSec: 75, allergens: ['egg'], kid: false },
];

const BURGER_SAUCES = [
  { id: 'bs_burger',  name: 'Burger Sauce', es: 'Salsa de la Casa', icon: 'sauce_light', allergens: ['egg'], kid: true },
  { id: 'bs_ketchup', name: 'Ketchup', es: 'Catsup',                icon: 'ketchup',  allergens: [], kid: true },
  { id: 'bs_mustard', name: 'Mustard', es: 'Mostaza',               icon: 'mustard',  allergens: [], kid: true },
  { id: 'bs_mayo',    name: 'Mayo', es: 'Mayonesa',                 icon: 'mayo',   allergens: ['egg'], kid: true },
  { id: 'bs_bbq',     name: 'BBQ Sauce', es: 'Salsa BBQ',           icon: 'bbq',     allergens: [], kid: true },
  { id: 'bs_aioli',   name: 'Garlic Aioli', es: 'Alioli de Ajo',    icon: 'garlic',  allergens: ['egg'], kid: false },
  { id: 'bs_none',    name: 'No Sauce', es: 'Sin Salsa',            icon: 'sauce_none', allergens: [], kid: true, exclusive: true },
];

// Three, and only three. The fryer runs one basket at a time at this volume,
// so the side list is deliberately short rather than aspirational.
const BURGER_SIDES = [
  { id: 'side_fries', name: 'Fries', es: 'Papas Fritas',        icon: 'fries', cookSec: 210, allergens: [], kid: true },
  { id: 'side_tots',  name: 'Tater Tots', es: 'Tater Tots',      icon: 'tots', cookSec: 240, allergens: [], kid: true },
  { id: 'side_rings', name: 'Onion Rings', es: 'Aros de Cebolla', icon: 'onion_ring', cookSec: 270, allergens: ['gluten'], kid: true },
];

/**
 * The salad that rides along with a plate, when the club is making them.
 *
 * Two of them, because this is a pop-up pasta night and not a salad bar: the
 * kitchen plates a Caesar or a House and sends it with the bowl. Which of the
 * two - or neither - is a per-plate choice, so a table of four can take two
 * salads and two not.
 *
 * 'none' is a real tile rather than a skipped step. A guest who wants no
 * salad has to say so, the same way they pick a portion, because a step that
 * can be walked past without answering is a step half a table walks past.
 */
const SALADS = [
  { id: 'sal_none', name: 'No salad', es: 'Sin ensalada', icon: 'none', allergens: [], exclusive: true },
  // Romaine, parmesan and croutons on the plate. The anchovy lives in the
  // dressing, not here.
  { id: 'sal_caesar', name: 'Caesar', es: 'César', icon: 'salad', allergens: ['gluten', 'dairy'] },
  { id: 'sal_house', name: 'House', es: 'De la Casa', icon: 'spinach', allergens: [] },
];

/**
 * Dressings, served on the side of either salad.
 *
 * Any dressing on either salad - a member who wants ranch on a Caesar gets
 * ranch on a Caesar. Pairing them would be the kitchen telling a club member
 * what they are allowed to like.
 *
 * ALLERGEN GAP, on purpose and worth knowing: Caesar dressing is made with
 * anchovy, and this app's allergen list has no 'fish'. The egg and dairy in
 * it are declared below; the fish is not, because inventing an allergen id
 * here would put a chip on the avoid screen that nothing else in the menu
 * has been audited against. Adding fish is a menu-wide decision, not a
 * salad one.
 */
const DRESSINGS = [
  { id: 'drs_balsamic', name: 'Balsamic', es: 'Balsámico', icon: 'olive' },
  { id: 'drs_ranch', name: 'Ranch', es: 'Ranch', icon: 'cream', allergens: ['dairy', 'egg'] },
  { id: 'drs_bluecheese', name: 'Blue Cheese', es: 'Queso Azul', icon: 'cheese', allergens: ['dairy', 'egg'] },
  { id: 'drs_caesar', name: 'Caesar', es: 'César', icon: 'garlic', allergens: ['dairy', 'egg'] },
  { id: 'drs_honeymustard', name: 'Honey Mustard', es: 'Miel y Mostaza', icon: 'butter', allergens: ['egg'] },
  { id: 'drs_sherry', name: 'Sherry Vinaigrette', es: 'Vinagreta de Jerez', icon: 'herb' },
];

const GROUPS = {
  pastas: PASTAS, sauces: SAUCES, proteins: PROTEINS,
  toppings: TOPPINGS, sides: SIDES, portions: PORTIONS,
  pizzaCrusts: PIZZA_CRUSTS,
  pizzaSauces: PIZZA_SAUCES, pizzaCheeses: PIZZA_CHEESES,
  pizzaProteins: PIZZA_PROTEINS,
  pizzaToppings: PIZZA_TOPPINGS,
  burgerBuns: BURGER_BUNS, burgerPatties: BURGER_PATTIES,
  burgerCheeses: BURGER_CHEESES, burgerToppings: BURGER_TOPPINGS,
  burgerSauces: BURGER_SAUCES, burgerSides: BURGER_SIDES,
  salads: SALADS, dressings: DRESSINGS,
};

/** Every kind any night can serve. */
export const KINDS = ['pasta', 'pizza', 'burger'];

/** 'pasta' unless the line says otherwise. Old documents have no kind. */
export function kindOf(line) {
  const k = line && line.kind;
  return KINDS.indexOf(k) === -1 ? 'pasta' : k;
}

/** Which group a kind's sauces and toppings come from. */
export const GROUPS_FOR = {
  pasta: { sauces: 'sauces', proteins: 'proteins', toppings: 'toppings' },
  pizza: {
    base: 'pizzaCrusts',
    sauces: 'pizzaSauces', cheeses: 'pizzaCheeses',
    proteins: 'pizzaProteins', toppings: 'pizzaToppings',
  },
  // A burger's patty is its protein and its bun is its base, so they map onto
  // the slots the other kinds already use rather than inventing new ones. That
  // is what lets validateLine(), the cost sheet and the close-out handle a
  // burger without any of them knowing it is a burger.
  burger: {
    sauces: 'burgerSauces', cheeses: 'burgerCheeses',
    proteins: 'burgerPatties', toppings: 'burgerToppings',
    sides: 'burgerSides', base: 'burgerBuns',
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
/**
 * A bowl's pasta shapes, always as an array.
 *
 * A bowl used to carry one `pasta` string. It can now be split - half penne,
 * half linguine - so the shapes are a list, and every order written before
 * that still reads correctly through here rather than through six separate
 * fallbacks at the places that consume it.
 */
export function pastasOf(line) {
  if (Array.isArray(line.pastas)) return line.pastas;
  if (line.pasta) return [line.pasta];
  return [];
}

/**
 * Has a split bowl put a gluten-free shape in with a wheat one?
 *
 * Shapes became a list so a bowl could be split, and the split that matters
 * is this one: a gluten-free shape sharing a bowl with a wheat shape is not
 * a gluten-free bowl, whatever the guest thought they were ordering.
 * allergensFor() already says so - the bowl carries gluten - but a chip on a
 * review screen is not the same as being told while you are choosing.
 *
 * Returns the names on each side, or null when there is nothing to say. It
 * does not refuse the combination: two people sharing one order, one of whom
 * wants the gluten-free shape, is an ordinary thing to want.
 */
export function glutenClash(line) {
  const shapes = pastasOf(line).map((id) => find('pastas', id)).filter(Boolean);
  const free = shapes.filter((x) => x.glutenFree);
  const wheat = shapes.filter((x) => (x.allergens || []).includes('gluten'));
  if (!free.length || !wheat.length) return null;
  return { free: free.map((x) => x.name), wheat: wheat.map((x) => x.name) };
}

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

/**
 * The salad on a plate, or null when there is not one.
 *
 * 'none' is how the tiles say "no salad"; null is how every screen after them
 * says it, so this is the one place that translation happens. A line written
 * before salads existed carries no field at all and reads the same way.
 */
export function saladOf(line) {
  const item = find('salads', line && line.salad);
  // "No salad" is a real tile with a real id - that is what makes it
  // tappable - but it is not a salad. `exclusive` is how this menu already
  // marks a tile that answers a question with nothing ("No Sauce", "No
  // Cheese"), and it is the same flag that keeps it off the cost sheet. One
  // flag, so renaming the id cannot make the two disagree.
  return item && !item.exclusive ? item : null;
}

/**
 * The dressing beside it, or null.
 *
 * Gated on there BEING a salad rather than read straight off the line: a
 * member who picks ranch and then goes back and takes the salad off would
 * otherwise leave a dressing behind, and a chit reading "Dressing: Ranch"
 * with no salad on it is a cook stopping to ask somebody.
 */
export function dressingOf(line) {
  if (!saladOf(line)) return null;
  return find('dressings', line && line.dressing);
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

// ------------------------------------------------------- manager overrides

/**
 * The groups a manager may edit, in the order the manager screen lists them.
 *
 * Allergens, portions and spice are absent on purpose: they are not
 * ingredients a kitchen stocks, and renaming "Kid Size" is not the kind of
 * change this is for.
 */
export const EDITABLE_GROUPS = [
  ['pastas', 'Pasta shapes'],
  ['sauces', 'Pasta sauces'],
  ['proteins', 'Pasta proteins'],
  ['toppings', 'Pasta toppings'],
  ['sides', 'Pasta sides'],
  ['pizzaCrusts', 'Pizza crusts'],
  ['pizzaSauces', 'Pizza sauces'],
  ['pizzaCheeses', 'Pizza cheeses'],
  ['pizzaProteins', 'Pizza meats'],
  ['pizzaToppings', 'Pizza toppings'],
  ['burgerBuns', 'Burger buns'],
  ['burgerPatties', 'Burger patties'],
  ['burgerCheeses', 'Burger cheeses'],
  ['burgerToppings', 'Burger toppings'],
  ['burgerSauces', 'Burger sauces'],
  ['burgerSides', 'Burger sides'],
  ['salads', 'Salads'],
  ['dressings', 'Salad dressings'],
];

/**
 * Which kind each editable group belongs to.
 *
 * GROUPS_FOR is the build-step map - which slot a kind fills from which group
 * - and it leaves out the pasta shape and the sides, because neither is
 * toggled the way a sauce or a topping is. Deriving the editor from it
 * therefore dropped Pasta shapes and Pasta sides off the screen entirely,
 * which is the editor's whole point.
 *
 * So the ownership is stated here instead, and the test holds it to
 * EDITABLE_GROUPS in both directions: a group nobody claims would quietly
 * disappear from the editor, and a claim for a group that no longer exists
 * would sit here looking like it did something.
 */
export const GROUP_KIND = {
  pastas: 'pasta',
  sauces: 'pasta',
  proteins: 'pasta',
  toppings: 'pasta',
  sides: 'pasta',

  pizzaCrusts: 'pizza',
  pizzaSauces: 'pizza',
  pizzaCheeses: 'pizza',
  pizzaProteins: 'pizza',
  pizzaToppings: 'pizza',

  burgerBuns: 'burger',
  burgerPatties: 'burger',
  burgerCheeses: 'burger',
  burgerToppings: 'burger',
  burgerSauces: 'burger',
  burgerSides: 'burger',

  // A salad is served beside a bowl AND beside a pie, so it is the first
  // group owned by more than one kind - which is why these are lists. It
  // shows in the editor while either lane is running and disappears with
  // both, the same as everything else here.
  salads: ['pasta', 'pizza'],
  dressings: ['pasta', 'pizza'],
};

/**
 * The groups a manager is offered in the menu editor: only the ones a running
 * night can serve.
 *
 * With burger night switched off, five lists of buns and patties were still
 * there to scroll past on the way to the pasta. Turning the night back on
 * brings its groups back with it, because this reads the kinds rather than a
 * second list of what to hide.
 */
export function editableGroupsFor(kinds) {
  const running = new Set(kinds || []);
  return EDITABLE_GROUPS.filter(([group]) => ownersOf(group).some((k) => running.has(k)));
}

/** Which kinds claim a group. Always a list, however GROUP_KIND spells it. */
export function ownersOf(group) {
  const owner = GROUP_KIND[group];
  if (!owner) return [];
  return Array.isArray(owner) ? owner : [owner];
}

/**
 * What an item said before anybody renamed it.
 *
 * Captured once, at load, from the arrays themselves - so clearing an
 * override restores the real name rather than whatever the last override
 * happened to be. Without this, reverting would mean knowing the original,
 * and the only copy of it would already have been overwritten.
 */
const ORIGINAL = new Map();
EDITABLE_GROUPS.forEach(([group]) => {
  (GROUPS[group] || []).forEach((item) => {
    ORIGINAL.set(item.id, { name: item.name, es: item.es, retired: Boolean(item.retired) });
  });
});

/** Is this an ingredient, or one of the mechanics that shares its list? */
export function isEditableItem(item) {
  return Boolean(item) && !item.exclusive && !item.amount;
}

/**
 * Items the club added themselves.
 *
 * A new item is never typed from nothing: it is modelled on one already on
 * that list. The template supplies the things the club has no way to know and
 * the app cannot do without - the cook-time field for that group (a pasta has
 * a boil time, a crust has a bake time), the artwork, and whether a kid
 * portion exists. What the club supplies is the name and the allergens.
 *
 * That is why there is no "blank new item" path. One without a boil time
 * would cost the kitchen nothing on the clock and quietly skew every estimate
 * the rail makes; one without artwork would draw the crossed-out circle,
 * which on a tile reads as "we are out of this".
 */
const ADDED_PREFIX = 'cw_';

/** Ids currently injected into the catalog by an override. */
const ADDED = new Set();

/** Did the club add this, rather than it shipping with the app? */
export function isAddedItem(item) {
  return Boolean(item) && item.added === true;
}

/**
 * Items in a group that a new one can be modelled on.
 *
 * Mechanics are excluded for the same reason they cannot be retired: "No
 * Sauce" is how a guest says no, and an item cloned from it would inherit
 * that behaviour and silently cancel everything else on the step.
 */
export function templatesFor(group) {
  return (GROUPS[group] || []).filter(
    (x) => isEditableItem(x) && !isAddedItem(x) && !x.retired,
  );
}

/** A stable id for a new item. Prefixed, so it can never collide with ours. */
export function newItemId(name, taken) {
  const slug = String(name || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  const base = ADDED_PREFIX + (slug || 'item');
  const used = typeof taken === 'function' ? taken : () => false;
  let id = base;
  let n = 2;
  while (used(id)) { id = base + '_' + n; n += 1; }
  return id;
}

/**
 * Turn one override entry into a live menu item, or null if it cannot be.
 *
 * Returns null rather than a half-made item: a pasta with no boil time or an
 * item whose allergens were never answered must not reach a guest's phone,
 * and the editor and overrideProblems() both refuse it long before here.
 */
function buildAddedItem(id, o) {
  const group = typeof o.group === 'string' ? o.group : '';
  if (!EDITABLE_GROUPS.some(([g]) => g === group)) return null;

  const pool = templatesFor(group);
  const tpl = pool.find((x) => x.id === o.template) || pool[0];
  if (!tpl) return null;

  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 40) : '';
  // An unanswered allergen question is not the same as "no allergens", and
  // the difference is the whole point of asking. Absent means nobody said.
  if (!name || !Array.isArray(o.allergens)) return null;

  const allergens = o.allergens.filter((a) => ALLERGENS.some((x) => x.id === a));
  const item = { ...tpl, id, name, allergens, added: true, addedFrom: tpl.id };

  if (typeof o.es === 'string' && o.es.trim()) item.es = o.es.trim().slice(0, 40);
  else delete item.es;
  if (o.retired === true) item.retired = true; else delete item.retired;

  // Derived from the answer, never inherited. Cloning the gluten-free fusilli
  // to make a wheat linguini must not carry the badge across with it.
  if ('glutenFree' in tpl) item.glutenFree = !allergens.includes('gluten');

  return { group, item };
}

/**
 * Apply a manager's renames and removals to the live menu.
 *
 * Written onto the item objects rather than layered over them, because every
 * screen holds a reference to these same arrays - several captured
 * menu.catalog() when their module loaded. Mutating in place is what makes a
 * rename reach a chit, a cost sheet and a guest's phone at once, without any
 * of them needing to know an override exists.
 *
 * Reverts to ORIGINAL first, so removing an override is simply leaving it out
 * of the map.
 *
 * @param {Object<string, {name?: string, es?: string, retired?: boolean}>} map
 */
export function applyMenuOverrides(map) {
  const safe = map && typeof map === 'object' ? map : {};

  // Take out whatever a previous override added, so re-applying cannot stack
  // duplicates. Spliced rather than reassigned, for the same reason the
  // renames below are written onto the items: every screen is holding a
  // reference to these very arrays.
  EDITABLE_GROUPS.forEach(([group]) => {
    const arr = GROUPS[group] || [];
    for (let i = arr.length - 1; i >= 0; i -= 1) {
      if (ADDED.has(arr[i].id)) arr.splice(i, 1);
    }
  });
  ADDED.clear();

  // The club's own items go on first, so everything below sees a complete
  // list - including the check that a group has not been emptied.
  Object.keys(safe).forEach((id) => {
    const o = safe[id];
    if (!o || o.added !== true) return;
    const made = buildAddedItem(id, o);
    if (!made) return;
    (GROUPS[made.group] || []).push(made.item);
    ADDED.add(id);
  });

  EDITABLE_GROUPS.forEach(([group]) => {
    (GROUPS[group] || []).forEach((item) => {
      const was = ORIGINAL.get(item.id);
      if (!was) return;

      item.name = was.name;
      if (was.es === undefined) delete item.es; else item.es = was.es;
      if (was.retired) item.retired = true; else delete item.retired;

      const o = safe[item.id];
      if (!o) return;
      if (typeof o.name === 'string' && o.name.trim()) item.name = o.name.trim().slice(0, 40);
      if (typeof o.es === 'string' && o.es.trim()) item.es = o.es.trim().slice(0, 40);
      // A mechanic cannot be retired: "No Sauce" is how a guest says no, not
      // something the kitchen runs out of.
      if (o.retired === true && isEditableItem(item)) item.retired = true;
    });
  });

  return safe;
}

/** Everything a manager has changed, as it would be saved. */
export function menuOverrides() {
  const out = {};
  EDITABLE_GROUPS.forEach(([group]) => {
    (GROUPS[group] || []).forEach((item) => {
      // An added item has no original to differ from - the entry that made it
      // is the whole of it, and is rebuilt here so a save round-trips.
      if (isAddedItem(item)) {
        const entry = {
          added: true,
          group,
          template: item.addedFrom,
          name: item.name,
          allergens: [...(item.allergens || [])],
        };
        if (item.es) entry.es = item.es;
        if (item.retired) entry.retired = true;
        out[item.id] = entry;
        return;
      }
      const was = ORIGINAL.get(item.id);
      if (!was) return;
      const o = {};
      if (item.name !== was.name) o.name = item.name;
      if (item.es !== was.es) o.es = item.es;
      if (Boolean(item.retired) !== was.retired) o.retired = Boolean(item.retired);
      if (Object.keys(o).length) out[item.id] = o;
    });
  });
  return out;
}

/** The item a manager would be editing, with its group. */
export function editableItem(id) {
  for (const [group] of EDITABLE_GROUPS) {
    const hit = (GROUPS[group] || []).find((x) => x.id === id);
    if (hit) return { group, item: hit, original: ORIGINAL.get(id) };
  }
  return null;
}

/**
 * Why this set of overrides cannot be saved, or an empty list.
 *
 * One rule, and it is the one that matters: a group cannot be emptied.
 * Retiring every cheese leaves a pizza nobody can order, and the failure
 * shows up as a guest stuck on a step with no tiles on it and nothing to say
 * why.
 */
export function overrideProblems(map) {
  const safe = map && typeof map === 'object' ? map : {};
  const out = [];

  /*
   * A new item has to answer the allergen question before it can be saved,
   * and "No allergens" is an answer - an unanswered one is not. The two look
   * identical once stored if the answer is an empty list, so the shape says
   * which: the key being absent means nobody was asked.
   *
   * This matters more than any other rule here. An item that reaches a chit
   * with no allergens on it reads as safe, and the member who asked whether
   * it contains nuts is told by the screen that it does not.
   */
  Object.keys(safe).forEach((id) => {
    const o = safe[id];
    if (!o || o.added !== true) return;
    const name = (typeof o.name === 'string' ? o.name.trim() : '');
    const label = name || 'A new item';

    if (!EDITABLE_GROUPS.some(([g]) => g === o.group)) {
      out.push(label + ' is on a list the club cannot change.');
      return;
    }
    if (!name) out.push('A new item needs a name before it can be saved.');
    if (!templatesFor(o.group).length) {
      out.push(label + ' has nothing on its list to be modelled on.');
    }

    if (!Array.isArray(o.allergens)) {
      out.push(label + ' needs its allergens answered - either "No allergens",'
        + ' or the ones it contains.');
    } else if (o.allergens.some((a) => !ALLERGENS.some((x) => x.id === a))) {
      out.push(label + ' lists something that is not on the allergen list.');
    }
  });

  EDITABLE_GROUPS.forEach(([group, label]) => {
    const items = (GROUPS[group] || []).filter(isEditableItem);
    if (!items.length) return;

    const left = items.filter((item) => {
      const o = safe[item.id];
      if (o && typeof o.retired === 'boolean') return !o.retired;
      return !(ORIGINAL.get(item.id) || {}).retired;
    });
    // Counted on a draft, before anything is applied - so a list the club has
    // retired entirely but refilled with items of their own is not empty.
    const incoming = Object.keys(safe).filter((id) => {
      const o = safe[id];
      return o && o.added === true && o.group === group && o.retired !== true;
    });
    if (!left.length && !incoming.length) {
      out.push(label + ' would have nothing left on it.');
    }
  });

  return out;
}

/** Every allergen implied by a built bowl or pizza, de-duplicated. */
export function allergensFor(line) {
  const out = new Set();
  const add = (item) => { if (item) (item.allergens || []).forEach((a) => out.add(a)); };
  const g = GROUPS_FOR[kindOf(line)];

  if (kindOf(line) === 'pizza') {
    // The crust is chosen now, which is the whole point of putting a
    // gluten-free base on the menu: a pie is only gluten free if its crust is.
    add(crustOf(line));
    cheesesOf(line).forEach((id) => add(find('pizzaCheeses', id)));
  } else if (kindOf(line) === 'burger') {
    // The bun is chosen, not assumed - which is the whole reason the lettuce
    // wrap and the gluten-free bun are on the menu. A burger is only gluten
    // free if the bun it was built on is.
    add(find('burgerBuns', line.base));
    cheesesOf(line).forEach((id) => add(find('burgerCheeses', id)));
    (line.sides || []).forEach((id) => add(find('burgerSides', id)));
  } else {
    // Every shape in the bowl. A gluten-free shape beside a wheat one does
    // not make the bowl gluten free - it makes it a bowl with gluten in it.
    pastasOf(line).forEach((id) => add(find('pastas', id)));
    (line.sides || []).forEach((id) => add(find('sides', id)));
  }

  saucesOf(line).forEach((id) => add(find(g.sauces, id)));
  proteinsOf(line).forEach((id) => add(find(g.proteins, id)));
  // The salad and what is poured on it. Croutons are gluten and a creamy
  // dressing is dairy, and neither is on the plate the bowl came from - so a
  // bowl that was gluten free stops being a gluten-free PLATE the moment a
  // Caesar lands beside it.
  add(saladOf(line));
  add(dressingOf(line));
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
 * A line broken into labelled rows, for screens that read it rather than
 * speak it.
 *
 * describe() produces one sentence, which is right for a close-out line or a
 * guest's confirmation and wrong for a cook standing at a pass. "Spaghetti w/
 * Marinara + Grilled Chicken, Broccoli, Cherry Tomatoes" is a sentence you
 * have to parse; a cook needs to find the protein without reading the sauce.
 *
 * Rows come back in the order the station works in - base first, then what
 * goes on it, then size - and a row with nothing in it is left out rather
 * than printed empty. The two renderings share this one source so a chit and
 * the expo screen can never describe the same bowl differently.
 *
 * @returns {{label: string, items: string[]}[]}
 */
export function ingredientList(line, lang) {
  const kind = kindOf(line);
  const g = GROUPS_FOR[kind] || GROUPS_FOR.pasta;
  const name = (group) => (id) => nameOf(group, id, lang);
  const es = lang === 'es';
  const rows = [];
  const add = (label, items) => {
    const kept = (items || []).filter(Boolean);
    if (kept.length) rows.push({ label, items: kept });
  };

  if (kind === 'pasta') {
    add(es ? 'Pasta' : 'Pasta', [nameOf('pastas', line.pasta, lang)]);
  } else if (kind === 'burger') {
    add(es ? 'Pan' : 'Bun', [nameOf('burgerBuns', line.base, lang)]);
  } else {
    // The crust is a choice, and it is the one a cook has to get right: a
    // gluten-free base that reads as "12 inch pie" on the ticket is a pizza
    // made on the wrong dough for someone who asked carefully.
    const crust = crustOf(line);
    add(es ? 'Masa' : 'Crust', [es && crust.es ? crust.es : crust.name]);
  }

  add(es ? 'Salsa' : 'Sauce', saucesOf(line).map(name(g.sauces)));
  if (g.cheeses) add(es ? 'Queso' : 'Cheese', cheesesOf(line).map(name(g.cheeses)));
  add(es ? (kind === 'burger' ? 'Carne' : 'Proteína') : (kind === 'burger' ? 'Patty' : 'Protein'),
    proteinsOf(line).map(name(g.proteins)));
  add(es ? 'Ingredientes' : 'Toppings', (line.toppings || []).map(name(g.toppings)));
  add(es ? 'Acompañante' : 'Side', (line.sides || []).map(name(g.sides || 'sides')));

  if (kind === 'pasta') {
    add(es ? 'Tamaño' : 'Size', [nameOf('portions', line.portion, lang)]);
  }

  // Last, because it is the last thing plated - and its own rows rather than
  // folded into the Side row, because a salad goes out on its own plate from
  // a different station and the note on it belongs to the salad, not to the
  // bowl. A plate with no salad adds nothing here at all.
  const salad = saladOf(line);
  if (salad) {
    add(es ? 'Ensalada' : 'Salad', [nameOf('salads', salad.id, lang)]);
    add(es ? 'Aderezo' : 'Dressing', [nameOf('dressings', (dressingOf(line) || {}).id, lang)]);
    add(es ? 'Nota de ensalada' : 'Salad note', [String(line.saladNote || '').trim()]);
  }

  return rows;
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
 *
 * The salad is added out here rather than inside describeDish. That has one
 * branch per kind and a return in each, so a fourth kind would have been a
 * fourth place to forget - which is exactly how the pizza crust came to be
 * chosen on the phone and dropped on the way to the kitchen.
 */
export function describe(line, lang) {
  const dish = describeDish(line, lang);
  const salad = saladOf(line);
  if (!salad) return dish;

  const es = lang === 'es';
  const dressing = dressingOf(line);
  const name = nameOf('salads', salad.id, lang);
  const poured = dressing ? name + ' (' + nameOf('dressings', dressing.id, lang) + ')' : name;
  // "+ Caesar" on the end of a bowl reads as something stirred into it. The
  // word says which plate it is. ASCII on purpose: this string is stored on
  // the document as the canonical English record and gets re-read by the CSV
  // and the close-out PDF, neither of which should have to carry a bullet.
  return dish + (es ? ' + ensalada: ' : ' + salad: ') + poured;
}

function describeDish(line, lang) {
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
    // Only when it is not the house dough: saying "12 inch Classic" on every
    // ticket is noise, saying nothing on a gluten-free one is a mistake.
    const crust = crustOf(line);
    const crustNote = crust.id === PIZZA_CRUSTS[0].id
      ? ''
      : ' [' + (es && crust.es ? crust.es : crust.name) + ']';

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
      return parts.join(' ') + crustNote;
    }
    const parts = [sauceLabel ? sauceLabel + ' Pizza' : 'Pizza'];
    if (cheeseLabel) parts.push('w/ ' + cheeseLabel);
    if (on.length) parts.push((cheeseLabel ? '+ ' : 'w/ ') + on.join(', '));
    return parts.join(' ') + crustNote;
  }

  if (kindOf(line) === 'burger') {
    // The patty leads, because that is what goes on the grill and the grill is
    // the clock. Bun, cheese and the rest follow in the order they are built.
    const es = lang === 'es';
    const cheeseRule = groupRules('burgerCheeses', cheesesOf(line));
    const sauceRule = groupRules('burgerSauces', saucesOf(line));

    const patty = proteins.length ? proteins.join(' + ') : (es ? 'Hamburguesa' : 'Burger');
    const bun = nameOf('burgerBuns', line.base, lang);
    const cheese = cheeseRule.exclusive
      ? nameOf('burgerCheeses', cheeseRule.exclusive.id, lang)
      : cheeseRule.bases.map(name('burgerCheeses')).filter(Boolean).join(' + ');
    const toppings = (line.toppings || []).map(name('burgerToppings')).filter(Boolean);
    const sauceLabel = sauceRule.exclusive
      ? nameOf('burgerSauces', sauceRule.exclusive.id, lang)
      : sauceRule.bases.map(name('burgerSauces')).filter(Boolean).join(' + ');
    const sides = (line.sides || []).map(name('burgerSides')).filter(Boolean);

    const out = [patty];
    if (bun) out.push((es ? 'en ' : 'on ') + bun);
    if (cheese) out.push((cheeseRule.exclusive ? '- ' : '+ ') + cheese);
    if (toppings.length) out.push('+ ' + toppings.join(', '));
    if (sauceLabel) out.push((sauceRule.exclusive ? '- ' : '+ ') + sauceLabel);
    if (sides.length) out.push((es ? 'con ' : 'w/ ') + sides.join(', '));
    return out.join(' ');
  }

  const parts = [];
  const shapes = pastasOf(line).map(name('pastas')).filter(Boolean);
  // "Penne + Linguine" is one dish split two ways, and reads as one
  // instruction on the pass.
  if (shapes.length) parts.push(shapes.join(' + '));
  if (sauceText) parts.push((lang === 'es' ? 'con ' : 'w/ ') + sauceText);
  if (proteins.length) parts.push('+ ' + proteins.join(', '));
  return parts.join(' ');
}

/** Validate an incoming bowl or pizza. Returns human-readable problems. */
/**
 * Is a count over its cap? The one place that decides, because the guest's
 * screen and this validator both ask.
 *
 * A null or missing cap means no cap, which is how the club removed the
 * limit on toppings and then on proteins. Comparing against it directly is
 * a trap: `0 >= null` is true, so a bare `>=` refuses the very first pick
 * and tells the guest "up to null". That shipped, and nobody could add a
 * protein at all.
 */
export function overCap(count, cap) {
  return cap != null && count > cap;
}

/** Is one more pick going to be refused? What a tile asks before it accepts. */
export function atCap(count, cap) {
  return overCap(count + 1, cap);
}

/** How a cap reads on a printed sheet, when there may not be one. */
export function capLabel(cap) {
  return cap == null ? 'no limit' : 'up to ' + cap;
}

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
  if (overCap(sauceRule.bases.length, limits.maxSaucesPerBowl)) {
    errors.push('Up to ' + limits.maxSaucesPerBowl + ' sauces each.');
  }

  const proteins = proteinsOf(line);
  if (proteins.some((id) => !find(g.proteins, id))) errors.push('That protein is not on the menu.');
  if (overCap(proteins.length, limits.maxProteinsPerItem)) {
    errors.push('Up to ' + limits.maxProteinsPerItem + ' proteins each.');
  }

  const toppings = line.toppings || [];
  if (toppings.some((t) => !find(g.toppings, t))) errors.push('Unknown topping.');

  // The salad, checked on every kind because it belongs to none of them.
  // A dressing with no salad is caught by dressingOf() on the way out; what
  // is caught HERE is the other way round - a salad nobody dressed, which is
  // a plate the cold station cannot finish and would have to come and ask
  // about mid-service.
  if (line.salad && !find('salads', line.salad)) errors.push('That salad is not on the menu.');
  if (saladOf(line)) {
    if (!line.dressing) errors.push('Pick a dressing for the salad.');
    else if (!find('dressings', line.dressing)) errors.push('That dressing is not on the menu.');
  }

  if (kind === 'pizza') {
    const cheeses = cheesesOf(line);
    if (cheeses.length === 0) errors.push('Pick a cheese, or No Cheese.');
    if (cheeses.some((id) => !find('pizzaCheeses', id))) errors.push('That cheese is not on the menu.');
    const cheeseRule = groupRules('pizzaCheeses', cheeses);
    if (cheeseRule.error) errors.push(cheeseRule.error);
    if (cheeses.some((id) => cheeseRule.blocked[id])) {
      errors.push('Those cheese choices contradict each other.');
    }
    if (overCap(cheeseRule.bases.length, limits.maxCheesesPerPizza)) {
      errors.push('Up to ' + limits.maxCheesesPerPizza + ' cheeses per pizza.');
    }

    if (!find('pizzaCrusts', line.base || 'classic')) errors.push('Pick a crust.');

    // What the crust rules out, checked here as well as greyed out on the
    // screen. Both read crustBlocks(), so a dessert pizza carrying marinara
    // is refused for the same reason the tile would not let you pick it -
    // and a screen and a validator that disagree is how a guest builds
    // something the kitchen then rejects.
    [['pizzaSauces', saucesOf(line)], ['pizzaToppings', line.toppings || []]]
      .forEach(([group, chosen]) => {
        const blocked = crustBlocks(group, line);
        if (chosen.some((id) => blocked[id])) {
          errors.push(crustOf(line).dessert
            ? 'That does not go on a dessert pizza.'
            : 'That is for a dessert pizza only.');
        }
      });

    // No topping cap, by the club's instruction. The guest screen offers
    // advice at config.order.toppingAdvice and nothing here contradicts it: a
    // validator stricter than the screen refuses an order the guest was
    // invited to build, which is the one failure worth never having.
    return errors;
  }

  if (kind === 'burger') {
    // A burger must have exactly one patty. The protein cap above allows
    // several, which is right for a bowl and wrong for a bun.
    if (proteins.length !== 1) errors.push('Pick one patty.');
    if (!find('burgerBuns', line.base)) errors.push('Pick a bun.');

    const cheeses = cheesesOf(line);
    if (cheeses.length === 0) errors.push('Pick a cheese, or No Cheese.');
    if (cheeses.some((id) => !find('burgerCheeses', id))) errors.push('That cheese is not on the menu.');
    const cheeseRule = groupRules('burgerCheeses', cheeses);
    if (cheeseRule.error) errors.push(cheeseRule.error);
    if (cheeses.some((id) => cheeseRule.blocked[id])) {
      errors.push('Those cheese choices contradict each other.');
    }
    if (cheeseRule.bases.length > 1) errors.push('One cheese per burger.');

    const bSides = line.sides || [];
    if (bSides.some((x) => !find('burgerSides', x))) errors.push('Unknown side.');
    // One basket. The fryer runs one at a time at this volume.
    if (overCap(bSides.length, limits.maxSidesPerBurger)) {
      errors.push('Pick one side.');
    }
    return errors;
  }

  // pastasOf, not line.pasta.
  //
  // The shape became a LIST when the split bowl landed and this reader was
  // left on the old singular field, so this rejected every bowl the app has
  // built since - and db.submitOrder() runs validateDraft before it writes,
  // which means pasta ordering has been refused outright. Nothing caught it
  // because the fixture every validation test uses still carries the old
  // singular field, so the suite was only ever asking about a shape the app
  // had stopped producing.
  const shapes = pastasOf(line);
  if (!shapes.length || shapes.some((id) => !find('pastas', id))) {
    errors.push('Pick a pasta shape.');
  }
  if (!find('portions', line.portion)) errors.push('Pick a portion size.');
  const sides = line.sides || [];
  if (sides.some((x) => !find('sides', x))) errors.push('Unknown side.');
  if (overCap(sides.length, limits.maxSidesPerBowl)) {
    errors.push('Up to ' + limits.maxSidesPerBowl + ' sides per bowl.');
  }
  if (line.spice && !SPICE_LEVELS.some((x) => x.id === line.spice)) errors.push('Unknown spice level.');
  return errors;
}

export {
  ALLERGENS, PASTAS, SAUCES, PROTEINS, TOPPINGS, SIDES, PORTIONS, SPICE_LEVELS,
  PIZZA_SAUCES, PIZZA_CHEESES, PIZZA_PROTEINS, PIZZA_TOPPINGS,
  BURGER_BUNS, BURGER_PATTIES, BURGER_CHEESES, BURGER_TOPPINGS,
  BURGER_SAUCES, BURGER_SIDES,
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
    pizzaCrusts: PIZZA_CRUSTS,
    burgerBuns: BURGER_BUNS, burgerPatties: BURGER_PATTIES,
    burgerCheeses: BURGER_CHEESES, burgerToppings: BURGER_TOPPINGS,
    burgerSauces: BURGER_SAUCES, burgerSides: BURGER_SIDES,
    salads: SALADS, dressings: DRESSINGS,
  };
}
