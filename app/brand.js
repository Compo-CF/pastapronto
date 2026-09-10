/**
 * Brand layer.
 *
 * The app ships unbranded by default. A venue brand overrides colours, type,
 * the wordmark and the venue name without touching any screen logic - a brand
 * is data plus a stylesheet of custom-property overrides, nothing more.
 *
 * Selected with ?brand=<id>, remembered per device so the staff screens stay
 * branded once set. ?brand=default clears it.
 *
 * The stylesheet itself is attached by a tiny inline script in each page's
 * <head> rather than here, so the branded colours are present on first paint
 * instead of flashing the default palette first.
 */

export const BRANDS = {
  default: {
    id: 'default',
    venueName: 'PastaPresto!',
    orgName: '',
    tagline: 'Build your bowl. We cook it now.',
    // Rendered from the inline SVG glyph set rather than an image file.
    logo: null,
    wordmark: 'Pasta<em>Presto!</em>',
  },

  carltonwoods: {
    id: 'carltonwoods',
    venueName: 'Neapolitan Night',
    orgName: 'The Club at Carlton Woods',
    tagline: 'All you can eat pizza and pasta, every Thursday',
    // Their own asset: white on transparent, so it needs the maroon chrome
    // the brand stylesheet applies.
    logo: 'brands/carltonwoods/logo.png',
    logoAlt: 'The Club at Carlton Woods',
    wordmark: 'Neapolitan Night',
  },
};

/** The brand this page is running under. Falls back to default. */
export function activeBrand() {
  let id = 'default';
  try {
    const q = new URLSearchParams(location.search).get('brand');
    id = q || localStorage.getItem('pp.brand') || 'default';
  } catch {
    id = 'default';
  }
  return BRANDS[id] || BRANDS.default;
}

export const isBranded = () => activeBrand().id !== 'default';

/**
 * The masthead for a screen: a venue's logo when it has one, otherwise the
 * built-in glyph and wordmark.
 *
 * @param {string} markSvg  inline SVG for the default brand
 * @param {string} suffix   screen label shown after the wordmark, e.g. "Kitchen"
 */
export function mastheadHtml(markSvg, suffix = '') {
  const brand = activeBrand();
  const tail = suffix ? `<span class="brand-screen">${suffix}</span>` : '';

  if (brand.logo) {
    return `<img class="brand-logo" src="${brand.logo}" alt="${brand.logoAlt || brand.orgName}">`
      + `<span class="brand-event">${brand.venueName}</span>${tail}`;
  }
  return `<span class="brand-mark">${markSvg}</span><span>${brand.wordmark}</span>${tail}`;
}

/** Page title, so a branded tab does not say PastaPresto. */
export function pageTitle(screen) {
  const brand = activeBrand();
  const lead = brand.orgName ? `${brand.venueName} - ${brand.orgName}` : brand.venueName;
  return screen ? `${lead} - ${screen}` : lead;
}
