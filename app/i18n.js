/**
 * Language, per surface.
 *
 * Four independent settings - guest, kitchen, manager, report - because the
 * people reading those screens are four different sets of people. A member at
 * table 12 reading Spanish does not mean the manager wants a Spanish
 * close-out, and a Spanish-speaking line cook should get a Spanish rail
 * whatever language the guest happened to order in.
 *
 * THE PART THAT MAKES THAT POSSIBLE
 *
 * An order carries ingredient IDS, never display text, so a chit can be
 * rendered in whatever language the screen showing it is set to. The stored
 * `dish` string stays English as the canonical record - it is what the CSV,
 * the PDF and any later audit read - and the kitchen recomputes its own line
 * from the ids through menu.describe(line, lang). That is the whole reason
 * four independent toggles are possible rather than one global switch.
 *
 * Chosen per device and remembered, the same way the brand is. ?lang=es on any
 * screen sets that screen's language and sticks.
 */

export const LANGS = [
  { id: 'en', name: 'English', short: 'EN' },
  { id: 'es', name: 'Español', short: 'ES' },
];

/**
 * Only the guest surface is translated.
 *
 * The kitchen, expo, manager and close-out screens are English by policy, not
 * by omission: they are read by staff who share one working language, and a
 * rail that might be in either is a rail a cook has to read twice. Everything
 * a guest chooses is stored as an id, so those screens render English from a
 * Spanish order for free - see menu.describe(line, lang).
 */
export const SCOPES = ['guest'];
const ENGLISH_ONLY = ['kitchen', 'manager', 'report'];

const KEY = (scope) => 'pp.lang.' + scope;
const isLang = (v) => LANGS.some((l) => l.id === v);

/**
 * The language for one surface. A ?lang= in the address bar wins and is
 * remembered, so a QR code or a bookmark can pin a screen to a language.
 */
export function langFor(scope) {
  if (ENGLISH_ONLY.indexOf(scope) !== -1) return 'en';
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (isLang(q)) {
      localStorage.setItem(KEY(scope), q);
      return q;
    }
    const saved = localStorage.getItem(KEY(scope));
    return isLang(saved) ? saved : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Switch one surface and reload into it.
 *
 * Strips ?lang= on the way out for the same reason the brand switch strips
 * ?brand=: the parameter beats storage, so leaving it in the address bar would
 * quietly undo the switch on the very next load.
 */
export function setLang(scope, lang) {
  if (!isLang(lang) || ENGLISH_ONLY.indexOf(scope) !== -1) return false;
  try {
    localStorage.setItem(KEY(scope), lang);
  } catch {
    const u = new URL(location.href);
    u.searchParams.set('lang', lang);
    location.replace(u.toString());
    return true;
  }
  const u = new URL(location.href);
  u.searchParams.delete('lang');
  location.replace(u.toString());
  return true;
}

/**
 * Look up one string.
 *
 * Falls back to English, then to the key. A missing Spanish string shows
 * English rather than a blank or a raw key - one English word in a Spanish
 * sentence is a bug worth fixing, but it is not a guest staring at
 * `guest.member.title`.
 */
export function t(lang, key, vars) {
  const table = STRINGS[lang] || STRINGS.en;
  let s = table[key];
  if (s == null) s = STRINGS.en[key];
  if (s == null) return key;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      s = s.split('{' + k + '}').join(String(vars[k]));
    });
  }
  return s;
}

/** A bound lookup for one surface, so screens do not repeat the scope. */
export function translator(scope) {
  const lang = langFor(scope);
  const fn = (key, vars) => t(lang, key, vars);
  fn.lang = lang;
  fn.isEs = lang === 'es';
  return fn;
}

// ---------------------------------------------------------------- the strings
//
// Keys are prefixed by surface. The Spanish is neutral Latin-American in the
// formal register a club dining room uses, and the food terms lean to what a
// Texas club's members and kitchen would actually say.

const STRINGS = {
  en: {
    'lang.label': 'Language',
    'lang.note': 'Remembered on this device. Each screen is set separately.',
    'common.back': 'Back',
    'common.next': 'Next',
    'common.change': 'Change',

    'guest.where.at': 'You are at',
    'guest.where.unknown': 'Scan the QR code at your table to start',
    'guest.where.badtag': 'That table code is not one of ours - a server can sort it out.',
    'guest.mode.simple': 'Simple',
    'guest.mode.detailed': 'Detailed',
    'guest.step': 'Step {n} of 4',
    'guest.memberLabel': 'member number',
    'guest.member.title': 'What is your {label}?',
    'guest.member.sub': 'However it reads on your card - up to four digits. A grown-up can help.',
    'guest.member.checking': 'Checking...',
    'guest.member.clear': 'Clear',
    'guest.member.delete': 'Delete',
    'guest.howto.1': 'Enter your {label}',
    'guest.howto.2': 'Pasta or pizza?',
    'guest.howto.3': 'Tell us how many are eating',
    'guest.howto.4': 'Build one for each person and send it',
    'guest.lane.title': 'What are we making?',
    'guest.lane.pasta.title': 'Build your <em>Pasta</em>',
    'guest.lane.pasta.blurb': 'Pick a pasta, pick a sauce, pile on toppings. We cook it fresh and bring it over.',
    'guest.lane.pizza.title': 'Build your <em>Pizza</em>',
    'guest.lane.pizza.blurb': 'One size, three sauces, all the toppings. Straight into the oven.',
    'guest.guests.title': 'How many are eating?',
    'guest.guests.sub': 'We will build one {unit} per person. You can change it later.',
    'guest.guests.justme': 'just me',
    'guest.guests.people': 'people',
    'guest.guests.allergy': 'Someone has a food allergy?',
    'guest.guests.avoidTitle': 'Anything to avoid?',
    'guest.guests.avoidSub': 'We will grey out anything that contains it.',
    'guest.guests.build': 'Build {n} {unit}',
    'guest.tab.pasta': 'Pasta',
    'guest.tab.sauce': 'Sauce',
    'guest.tab.cheese': 'Cheese',
    'guest.tab.protein': 'Protein',
    'guest.tab.toppings': 'Toppings',
    'guest.tab.size': 'Size',
    'guest.step.pasta': 'Pick your pasta',
    'guest.step.pasta.sub': 'Tap the shape you want.',
    'guest.step.sauce': 'Now the sauce',
    'guest.step.pizzasauce': 'Pick your sauce',
    'guest.step.cheese': 'And the cheese',
    'guest.step.amountsub': 'Light or heavy goes on top of your pick.',
    'guest.step.protein': 'Add a protein?',
    'guest.step.protein.sub': 'Pick as many as you like, or skip it - totally fine.',
    'guest.step.toppings': 'Toppings!',
    'guest.step.toppings.sub': 'Pick up to {n}. Or none at all.',
    'guest.step.toppings.subPizza': 'Pick up to {n}. Herbs and salt are free.',
    'guest.step.size': 'How big?',
    'guest.sauce.one': 'Pick one, or tap two to mix them.',
    'guest.sauce.chosen': '{names} - tap Next when you are happy.',
    'guest.sauce.mixing': 'Mixing {n} {what}',
    'guest.cheese.one': 'Pick one, or mix them. No Cheese is fine too.',
    'guest.exclusive': '{name} it is.',
    'guest.protein.chosen': '{n} chosen - tap Next when you are happy.',
    'guest.tabs.ready': 'ready',
    'guest.tabs.building': 'building',
    'guest.note.add': 'Add a note or spice',
    'guest.note.pasta': 'Sauce on the side, no onions, allergy details...',
    'guest.note.pizza': 'Well done, light sauce, cut in squares...',
    'guest.label.soldout': 'sold out',
    'guest.label.has': 'has {list}',
    'guest.label.showall': 'Show all {n} choices',
    'guest.review.title': 'Look good?',
    'guest.review.sub': 'Check it over, then send it to the cook.',
    'guest.review.with': 'with {list}',
    'guest.review.contains': 'This order contains: {list}',
    'guest.review.send': 'Send to the kitchen',
    'guest.review.sending': 'Sending...',
    'guest.review.reviewOrder': 'Review order',
    'guest.review.nextItem': 'Next {unit}',
    'guest.sent.ticket': 'TICKET',
    'guest.sent.code': 'SHOW THIS CODE IF A SERVER ASKS',
    'guest.sent.queued': 'Sent to the kitchen!',
    'guest.sent.queuedSub': 'Water is boiling. Hang tight.',
    'guest.sent.cooking': 'We are on it',
    'guest.sent.cookingSub': 'Your food is cooking',
    'guest.sent.ready': 'Ready!',
    'guest.sent.delivered': 'Buon appetito!',
    'guest.sent.deliveredSub': 'Enjoy. Tap below to order another round.',
    'guest.sent.again': 'Start another order',
    'guest.track.sent': 'Sent',
    'guest.track.cooking': 'Cooking',
    'guest.track.ready': 'Ready',
    'guest.track.enjoy': 'Enjoy',
    'guest.closed': 'The pasta station is closed right now.',
    'guest.offline': 'We cannot reach the kitchen right now - ask your server.',

    'kitchen.lane.queued': 'New orders',
    'kitchen.lane.cooking': 'Cooking',
    'kitchen.lane.ready': 'Ready / runner',
    'kitchen.count.queue': 'Queue',
    'kitchen.count.cooking': 'Cooking',
    'kitchen.count.ready': 'Ready',
    'kitchen.act.accept': 'Accept',
    'kitchen.act.ready': 'Food Up - Call Runner',
    'kitchen.act.deliver': 'Delivered',
    'kitchen.badge.rush': 'RUSH',
    'kitchen.badge.allergy': 'ALLERGY',
    'kitchen.badge.held': 'HELD',
    'kitchen.badge.guests': '{n} GUESTS',
    'kitchen.badge.unverified': 'UNVERIFIED',
    'kitchen.alert.allergy': 'ALLERGY - must avoid {list}',
    'kitchen.side': 'SIDE',
    'kitchen.pie': '12" PIE',
    'kitchen.sound': 'Sound',
    'kitchen.sound.title': 'Alert sounds',
    'kitchen.allStations': 'All stations',
    'kitchen.station': 'Station',
    'expo.ready.title': 'Ready to run',
    'expo.next.title': 'Coming up',

    'manager.glance': 'Today at a glance',
    'manager.qr': 'QR codes',
    'manager.menu': 'Menu, allergens & 86 list',
    'manager.demo': 'Demo controls',
    'manager.demoSub': 'Seed a believable rail of chits, or clear today and start clean.',
    'manager.seed': 'Seed demo orders',
    'manager.clear': 'Clear today',
    'manager.rebuild': 'Rebuild codes',
    'manager.printTents': 'Print table tents',
    'manager.baseLabel': 'Base address printed into every QR code',
    'manager.branding': 'Branding',
    'manager.col.item': 'Item',
    'manager.col.allergens': 'Allergens',
    'manager.col.kid': 'Kid menu',
    'manager.col.86': '86',

    'report.date': 'Service date',
    'report.tonight': 'Tonight',
    'report.yesterday': 'Yesterday',
    'report.csv': 'Download CSV',
    'report.print': 'Print',
    'report.pdf': 'Save PDF',
    'report.empty': 'No orders on this service date.',
    'report.members': 'Members to charge',
    'report.chargesToPost': 'charges to post',
    'report.membersDining': 'members dining',
    'report.stats': 'Service stats',
    'report.curve': 'Bowls and pizzas per 15 minutes',
    'report.usage': 'Food usage - prep guide for tomorrow',
    'report.late': 'Late tickets',
    'report.stations': 'By station',
    'report.exceptions': 'Exceptions to follow up',
    'report.col.member': 'Member',
    'report.col.name': 'Name',
    'report.col.charges': 'Charges',
    'report.col.orders': 'Orders',
    'report.col.bowls': 'Bowls',
    'report.col.pizzas': 'Pizzas',
    'report.col.items': 'Items',
    'report.col.perCover': 'Per cover',
    'report.col.confirm': 'Confirm',
    'report.confirmFlag': 'CHECK',
  },

  es: {
    'lang.label': 'Idioma',
    'lang.note': 'Se recuerda en este dispositivo. Cada pantalla se ajusta por separado.',
    'common.back': 'Atrás',
    'common.next': 'Siguiente',
    'common.change': 'Cambiar',

    'guest.where.at': 'Está en',
    'guest.where.unknown': 'Escanee el código QR de su mesa para comenzar',
    'guest.where.badtag': 'Ese código de mesa no es nuestro - un mesero puede ayudarle.',
    'guest.mode.simple': 'Sencillo',
    'guest.mode.detailed': 'Detallado',
    'guest.step': 'Paso {n} de 4',
    'guest.memberLabel': 'número de socio',
    'guest.member.title': '¿Cuál es su {label}?',
    'guest.member.sub': 'Como aparece en su tarjeta - hasta cuatro dígitos. Un adulto puede ayudar.',
    'guest.member.checking': 'Verificando...',
    'guest.member.clear': 'Borrar',
    'guest.member.delete': 'Borrar',
    'guest.howto.1': 'Ingrese su {label}',
    'guest.howto.2': '¿Pasta o pizza?',
    'guest.howto.3': 'Díganos cuántos van a comer',
    'guest.howto.4': 'Arme uno para cada persona y envíelo',
    'guest.lane.title': '¿Qué vamos a preparar?',
    'guest.lane.pasta.title': 'Arme su <em>Pasta</em>',
    'guest.lane.pasta.blurb': 'Elija una pasta, elija una salsa, agregue lo que guste. La preparamos al momento.',
    'guest.lane.pizza.title': 'Arme su <em>Pizza</em>',
    'guest.lane.pizza.blurb': 'Un solo tamaño, tres salsas, todos los ingredientes. Directo al horno.',
    'guest.guests.title': '¿Cuántos van a comer?',
    'guest.guests.sub': 'Prepararemos un platillo por persona. Puede cambiarlo después.',
    'guest.guests.justme': 'solo yo',
    'guest.guests.people': 'personas',
    'guest.guests.allergy': '¿Alguien tiene alergia alimentaria?',
    'guest.guests.avoidTitle': '¿Algo que debamos evitar?',
    'guest.guests.avoidSub': 'Marcaremos en gris todo lo que lo contenga.',
    'guest.guests.build': 'Armar {n} {unit}',
    'guest.tab.pasta': 'Pasta',
    'guest.tab.sauce': 'Salsa',
    'guest.tab.cheese': 'Queso',
    'guest.tab.protein': 'Proteína',
    'guest.tab.toppings': 'Ingredientes',
    'guest.tab.size': 'Tamaño',
    'guest.step.pasta': 'Elija su pasta',
    'guest.step.pasta.sub': 'Toque la forma que quiera.',
    'guest.step.sauce': 'Ahora la salsa',
    'guest.step.pizzasauce': 'Elija su salsa',
    'guest.step.cheese': 'Y el queso',
    'guest.step.amountsub': 'Poca o extra se agrega a lo que eligió.',
    'guest.step.protein': '¿Agregar proteína?',
    'guest.step.protein.sub': 'Elija las que quiera, o sáltelo - no hay problema.',
    'guest.step.toppings': '¡Ingredientes!',
    'guest.step.toppings.sub': 'Elija hasta {n}. O ninguno.',
    'guest.step.toppings.subPizza': 'Elija hasta {n}. Las hierbas y la sal son gratis.',
    'guest.step.size': '¿De qué tamaño?',
    'guest.sauce.one': 'Elija una, o toque dos para combinarlas.',
    'guest.sauce.chosen': '{names} - toque Siguiente cuando esté listo.',
    'guest.sauce.mixing': 'Combinando {n} {what}',
    'guest.cheese.one': 'Elija uno, o combínelos. Sin Queso también está bien.',
    'guest.exclusive': '{name}, entendido.',
    'guest.protein.chosen': '{n} elegidas - toque Siguiente cuando esté listo.',
    'guest.tabs.ready': 'listo',
    'guest.tabs.building': 'armando',
    'guest.note.add': 'Agregar una nota o picante',
    'guest.note.pasta': 'Salsa aparte, sin cebolla, detalles de alergia...',
    'guest.note.pizza': 'Bien cocida, poca salsa, cortada en cuadros...',
    'guest.label.soldout': 'agotado',
    'guest.label.has': 'contiene {list}',
    'guest.label.showall': 'Ver las {n} opciones',
    'guest.review.title': '¿Todo bien?',
    'guest.review.sub': 'Revise su orden y envíela a la cocina.',
    'guest.review.with': 'con {list}',
    'guest.review.contains': 'Esta orden contiene: {list}',
    'guest.review.send': 'Enviar a la cocina',
    'guest.review.sending': 'Enviando...',
    'guest.review.reviewOrder': 'Revisar la orden',
    'guest.review.nextItem': 'Siguiente {unit}',
    'guest.sent.ticket': 'ORDEN',
    'guest.sent.code': 'MUESTRE ESTE CÓDIGO SI UN MESERO SE LO PIDE',
    'guest.sent.queued': '¡Enviada a la cocina!',
    'guest.sent.queuedSub': 'El agua ya está hirviendo. Un momento.',
    'guest.sent.cooking': 'Manos a la obra',
    'guest.sent.cookingSub': 'Su comida se está preparando',
    'guest.sent.ready': '¡Lista!',
    'guest.sent.delivered': '¡Buen provecho!',
    'guest.sent.deliveredSub': 'Disfrute. Toque abajo para pedir otra ronda.',
    'guest.sent.again': 'Empezar otra orden',
    'guest.track.sent': 'Enviada',
    'guest.track.cooking': 'Preparando',
    'guest.track.ready': 'Lista',
    'guest.track.enjoy': 'Disfrute',
    'guest.closed': 'La estación de pasta está cerrada en este momento.',
    'guest.offline': 'No podemos comunicarnos con la cocina - pregunte a su mesero.',

    'kitchen.lane.queued': 'Órdenes nuevas',
    'kitchen.lane.cooking': 'Preparando',
    'kitchen.lane.ready': 'Listo / corredor',
    'kitchen.count.queue': 'Fila',
    'kitchen.count.cooking': 'Preparando',
    'kitchen.count.ready': 'Listo',
    'kitchen.act.accept': 'Aceptar',
    'kitchen.act.ready': 'Listo - Llamar corredor',
    'kitchen.act.deliver': 'Entregada',
    'kitchen.badge.rush': 'URGENTE',
    'kitchen.badge.allergy': 'ALERGIA',
    'kitchen.badge.held': 'EN PAUSA',
    'kitchen.badge.guests': '{n} COMENSALES',
    'kitchen.badge.unverified': 'SIN VERIFICAR',
    'kitchen.alert.allergy': 'ALERGIA - debe evitar {list}',
    'kitchen.side': 'ACOMP.',
    'kitchen.pie': 'PIZZA 12"',
    'kitchen.sound': 'Sonido',
    'kitchen.sound.title': 'Sonidos de aviso',
    'kitchen.allStations': 'Todas las estaciones',
    'kitchen.station': 'Estación',
    'expo.ready.title': 'Listas para llevar',
    'expo.next.title': 'Próximas',

    'manager.glance': 'Resumen de hoy',
    'manager.qr': 'Códigos QR',
    'manager.menu': 'Menú, alérgenos y lista 86',
    'manager.demo': 'Controles de demostración',
    'manager.demoSub': 'Cargue órdenes de ejemplo, o borre el día y empiece limpio.',
    'manager.seed': 'Cargar órdenes de ejemplo',
    'manager.clear': 'Borrar el día',
    'manager.rebuild': 'Regenerar códigos',
    'manager.printTents': 'Imprimir carteles de mesa',
    'manager.baseLabel': 'Dirección base impresa en cada código QR',
    'manager.branding': 'Marca',
    'manager.col.item': 'Artículo',
    'manager.col.allergens': 'Alérgenos',
    'manager.col.kid': 'Menú niños',
    'manager.col.86': '86',

    'report.date': 'Fecha de servicio',
    'report.tonight': 'Hoy',
    'report.yesterday': 'Ayer',
    'report.csv': 'Descargar CSV',
    'report.print': 'Imprimir',
    'report.pdf': 'Guardar PDF',
    'report.empty': 'No hubo órdenes en esta fecha.',
    'report.members': 'Socios por cobrar',
    'report.chargesToPost': 'cargos por aplicar',
    'report.membersDining': 'socios atendidos',
    'report.stats': 'Estadísticas del servicio',
    'report.curve': 'Pastas y pizzas cada 15 minutos',
    'report.usage': 'Consumo - guía de preparación para mañana',
    'report.late': 'Órdenes retrasadas',
    'report.stations': 'Por estación',
    'report.exceptions': 'Excepciones por revisar',
    'report.col.member': 'Socio',
    'report.col.name': 'Nombre',
    'report.col.charges': 'Cargos',
    'report.col.orders': 'Órdenes',
    'report.col.bowls': 'Pastas',
    'report.col.pizzas': 'Pizzas',
    'report.col.items': 'Platillos',
    'report.col.perCover': 'Por comensal',
    'report.col.confirm': 'Verificar',
    'report.confirmFlag': 'REVISAR',
  },
};

/**
 * Guest free text, pushed toward English for the kitchen.
 *
 * This is NOT machine translation and does not pretend to be. It is a glossary
 * of the things people actually write in this box - no onion, sauce on the
 * side, well done, allergy - matched whole-word and case-insensitively.
 *
 * Anything it does not recognise passes through untouched, and the kitchen
 * always shows the guest's original words underneath, because a cook acting on
 * a half-understood note is worse than a cook reading Spanish and asking. A
 * real translation service would do better, but it would also mean a member's
 * note leaving the building, a network round trip in the order path, and a
 * dependency this app does not otherwise have.
 */
const NOTE_ES_EN = [
  ['sin cebolla', 'no onion'], ['sin cebollas', 'no onions'],
  ['sin queso', 'no cheese'], ['sin salsa', 'no sauce'], ['sin gluten', 'gluten free'],
  ['sin ajo', 'no garlic'], ['sin picante', 'not spicy'], ['sin sal', 'no salt'],
  ['sin carne', 'no meat'], ['sin puerco', 'no pork'], ['sin cerdo', 'no pork'],
  ['sin champiñones', 'no mushrooms'], ['sin tomate', 'no tomato'],
  ['salsa aparte', 'sauce on the side'], ['aderezo aparte', 'dressing on the side'],
  ['bien cocida', 'well done'], ['bien cocido', 'well done'], ['poco cocida', 'lightly cooked'],
  ['extra salsa', 'extra sauce'], ['extra queso', 'extra cheese'], ['muy picante', 'very spicy'],
  ['poco picante', 'mild'], ['cortada en cuadros', 'cut in squares'],
  ['cortado en cuadros', 'cut in squares'], ['para llevar', 'to go'],
  ['alergia', 'ALLERGY'], ['alergico', 'ALLERGIC'], ['alérgico', 'ALLERGIC'],
  ['alérgica', 'ALLERGIC'], ['nuez', 'nut'], ['nueces', 'nuts'], ['cacahuate', 'peanut'],
  ['mariscos', 'shellfish'], ['camarón', 'shrimp'], ['camarones', 'shrimp'],
  ['huevo', 'egg'], ['leche', 'milk'], ['lácteos', 'dairy'], ['trigo', 'wheat'],
  ['por favor', 'please'], ['gracias', 'thank you'], ['niño', 'child'], ['niña', 'child'],
  ['caliente', 'hot'], ['frío', 'cold'], ['aparte', 'on the side'], ['poco', 'light'],
  ['mucho', 'extra'], ['nada de', 'no'],
];

/**
 * Best-effort English for a guest note written in Spanish.
 *
 * @returns {{text: string, changed: boolean}} `changed` is false when nothing
 *          was recognised, which is the kitchen's cue to show it as-is.
 */
export function glossNote(text) {
  const raw = String(text == null ? '' : text);
  if (!raw.trim()) return { text: raw, changed: false };

  // Whole-word matching done by hand rather than by regex: the phrases are
  // plain words, and a letter test is easier to read - and to get right - than
  // a Unicode property escape built inside a string.
  const isLetter = (ch) => ch !== undefined && /[a-zA-ZÀ-ɏ]/.test(ch);

  let out = raw;
  let changed = false;
  NOTE_ES_EN.forEach((pair) => {
    const es = pair[0];
    const en = pair[1];
    let from = 0;
    for (;;) {
      const at = out.toLowerCase().indexOf(es, from);
      if (at === -1) break;
      const before = at === 0 ? undefined : out[at - 1];
      const after = out[at + es.length];
      if (!isLetter(before) && !isLetter(after)) {
        out = out.slice(0, at) + en + out.slice(at + es.length);
        changed = true;
        from = at + en.length;
      } else {
        from = at + es.length;
      }
    }
  });
  return { text: out, changed };
}

export { STRINGS };
