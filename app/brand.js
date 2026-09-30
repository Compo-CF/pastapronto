/**
 * Brand layer.
 *
 * A brand overrides colours, type, the wordmark and the venue name without
 * touching any screen logic - it is data plus a stylesheet of custom-property
 * overrides, nothing more.
 *
 * ONE BRAND, PINNED. This used to resolve per device from ?brand= and
 * localStorage, which meant the answer depended on how you arrived: a link
 * sent without the parameter, or opened on a phone that had never seen one,
 * came up as unbranded PastaPresto. Nobody opening a link should have to know
 * about a query parameter, and a guest landing on the wrong identity is the
 * wrong answer on the one screen that is not ours.
 *
 * The stylesheet is attached by a plain <link> in each page's <head>, so the
 * branded palette is there on first paint with no script involved at all.
 */

export const BRANDS = {
  default: {
    id: 'default',
    venueName: 'PastaPresto!',
    orgName: '',
    tagline: 'Build your bowl. We cook it now.',
    taglineEs: 'Arme su plato. Lo preparamos al momento.',
    // Rendered from the inline SVG glyph set rather than an image file.
    logo: null,
    wordmark: 'Pasta<em>Presto!</em>',
  },

  carltonwoods: {
    id: 'carltonwoods',
    venueName: 'Neapolitan Night',
    orgName: 'The Club at Carlton Woods',
    tagline: 'All you can eat pizza and pasta, every Thursday',
    taglineEs: 'Pizza y pasta a discreción, todos los jueves',
    // Their own asset: white on transparent, so it needs the maroon chrome
    // the brand stylesheet applies.
    logo: 'brands/carltonwoods/logo.png',
    logoAlt: 'The Club at Carlton Woods',
    wordmark: 'Neapolitan Night',
  },
};

/**
 * The brand every screen runs under, on every link, for everyone.
 *
 * Each page's <head> carries the matching `data-brand` attribute and brand
 * stylesheet as plain markup, so if this ever names a different venue, those
 * five files change with it. That duplication is the price of having the
 * palette right on the first paint rather than after a script runs.
 *
 * BRANDS.default stays below. It is the product's own identity and what a
 * second venue would start from, and reaching it again means turning this
 * constant back into a lookup - not rebuilding the brand.
 */
export const ACTIVE_BRAND_ID = 'carltonwoods';

/** The brand this page is running under. */
export function activeBrand() {
  return BRANDS[ACTIVE_BRAND_ID] || BRANDS.default;
}

/** The brand's tagline in one language, falling back to English. */
export function taglineFor(lang) {
  const b = activeBrand();
  return (lang === 'es' && b.taglineEs) ? b.taglineEs : b.tagline;
}

/*
 * switchBrand(), brandList(), brandParam() and isBranded() used to live here.
 *
 * They all existed to answer "which brand is this?", and now there is only one
 * answer. In particular brandParam() hung &brand=... off every QR code so a
 * guest's phone - which has never been to this site and has nothing stored -
 * would open branded; that is exactly what the pinned brand does for free, so
 * the codes are shorter now as well as always right.
 */

/**
 * The masthead for a screen: a venue's logo when it has one, otherwise the
 * built-in glyph and wordmark.
 *
 * Identity only - it does not name the screen. Every staff screen carries the
 * staff nav, whose current-page pill already says where you are, and saying it
 * again beside the wordmark was three "Close-out"s in one header. The screen
 * name still reaches the browser tab through pageTitle().
 *
 * @param {string} markSvg  inline SVG for the default brand
 */
export function mastheadHtml(markSvg) {
  const brand = activeBrand();

  if (brand.logo) {
    return `<img class="brand-logo" src="${brand.logo}" alt="${brand.logoAlt || brand.orgName}">`
      + `<span class="brand-event">${brand.venueName}</span>`;
  }
  return `<span class="brand-mark">${markSvg}</span><span>${brand.wordmark}</span>`;
}

/** Page title, so a branded tab does not say PastaPresto. */
export function pageTitle(screen) {
  const brand = activeBrand();
  const lead = brand.orgName ? `${brand.venueName} - ${brand.orgName}` : brand.venueName;
  return screen ? `${lead} - ${screen}` : lead;
}
