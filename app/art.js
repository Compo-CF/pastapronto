/**
 * Inline SVG glyph set. Menu items carry a `shape` (pastas) or `icon` key and
 * this module turns it into artwork. Drawn rather than emoji so the tiles look
 * the same on every device, scale to any size, and stay legible on the
 * kitchen's dark screens.
 *
 * All glyphs use a 0 0 64 64 viewBox.
 */

var PASTA = '#e3ad45';
var PASTA_DARK = '#c08f2c';
var PASTA_PALE = '#f0cd85';

var SHAPES = {
  strands:
    '<g fill="none" stroke="' + PASTA + '" stroke-width="5" stroke-linecap="round">' +
    '<path d="M20 7c-6 12 6 19 0 29s6 14 0 21"/>' +
    '<path d="M32 7c-6 12 6 19 0 29s6 14 0 21"/>' +
    '<path d="M44 7c-6 12 6 19 0 29s6 14 0 21"/></g>',
  tube:
    '<g transform="rotate(30 32 32)"><rect x="21" y="12" width="22" height="40" rx="10" fill="' + PASTA + '"/>' +
    '<ellipse cx="32" cy="15" rx="11" ry="4.5" fill="' + PASTA_DARK + '"/></g>',
  ridged:
    '<rect x="20" y="10" width="24" height="44" rx="11" fill="' + PASTA + '"/>' +
    '<ellipse cx="32" cy="13" rx="12" ry="4.5" fill="' + PASTA_DARK + '"/>' +
    '<g stroke="' + PASTA_DARK + '" stroke-width="2.4" stroke-linecap="round" opacity=".55">' +
    '<path d="M25 20v28M32 20v28M39 20v28"/></g>',
  ribbon:
    '<path d="M7 33c8-15 17 15 25 0s17 15 25 0" fill="none" stroke="' + PASTA + '" stroke-width="15" stroke-linecap="round"/>',
  bowtie:
    '<g fill="' + PASTA + '"><path d="M29 32 11 19c-2.5-1.8-5.5.4-4.6 3.3L9 32l-2.6 9.7c-.9 2.9 2.1 5.1 4.6 3.3z"/>' +
    '<path d="M35 32 53 19c2.5-1.8 5.5.4 4.6 3.3L55 32l2.6 9.7c.9 2.9-2.1 5.1-4.6 3.3z"/></g>' +
    '<circle cx="32" cy="32" r="5.5" fill="' + PASTA_DARK + '"/>',
  shell:
    '<path d="M32 53C16 53 8 39 8 26c0-8 10-14 24-14s24 6 24 14c0 13-8 27-24 27z" fill="' + PASTA + '"/>' +
    '<g stroke="' + PASTA_DARK + '" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".6">' +
    '<path d="M32 50V15M21 47c-4-10-6-21-4-30M43 47c4-10 6-21 4-30"/></g>',
  ring:
    '<circle cx="32" cy="35" r="18" fill="' + PASTA + '"/>' +
    '<circle cx="32" cy="35" r="6.5" fill="#fdf8f0"/>' +
    '<path d="M19 21c4.5-6.5 21-6.5 26 0" fill="none" stroke="' + PASTA_DARK + '" stroke-width="4.5" stroke-linecap="round"/>',
  pie:
    '<circle cx="32" cy="32" r="26" fill="#e8c98f"/>' +
    '<circle cx="32" cy="32" r="21" fill="#d8402f"/>' +
    '<g fill="#f6efdc"><circle cx="24" cy="25" r="4.5"/><circle cx="40" cy="27" r="4"/>' +
    '<circle cx="27" cy="40" r="4"/><circle cx="40" cy="39" r="4.5"/></g>' +
    '<g fill="#a8281c"><circle cx="33" cy="20" r="3"/><circle cx="20" cy="33" r="3"/>' +
    '<circle cx="45" cy="33" r="3"/><circle cx="32" cy="46" r="3"/></g>',
  slice:
    '<path d="M32 6 56 50a4 4 0 0 1-4 6H12a4 4 0 0 1-4-6z" fill="#e8c98f"/>' +
    '<path d="M32 14 50 48H14z" fill="#d8402f"/>' +
    '<g fill="#f6efdc"><circle cx="32" cy="30" r="4"/><circle cx="24" cy="41" r="3.5"/>' +
    '<circle cx="40" cy="41" r="3.5"/></g>',
  spiral:
    '<path d="M32 7c-11 4.5 11 8 0 12.5s11 8 0 12.5 11 8 0 12.5 11 8 0 12.5" fill="none" stroke="' + PASTA_PALE + '" stroke-width="7.5" stroke-linecap="round"/>',
};

var ICONS = {
  tomato:
    '<circle cx="32" cy="37" r="19" fill="#d8402f"/><path d="M32 20c-6-6-13-6-13-6 2 6 7 8 10 8z" fill="#3f8b45"/>' +
    '<path d="M32 20c6-6 13-6 13-6-2 6-7 8-10 8z" fill="#3f8b45"/><circle cx="25" cy="31" r="4" fill="#fff" opacity=".22"/>',
  butter:
    '<path d="M12 38l10-14h30l-10 14z" fill="#f4d27a"/><path d="M12 38h30v10H12z" fill="#e7bd52"/><path d="M42 38l10-14v10l-10 14z" fill="#d9a93c"/>',
  cream:
    '<path d="M18 26h28l-3 24a5 5 0 0 1-5 4H26a5 5 0 0 1-5-4z" fill="#f7f1e2"/>' +
    '<ellipse cx="32" cy="26" rx="14" ry="5" fill="#fffdf7"/><path d="M24 34c3 4 13 4 16 0" stroke="#e3d7bd" stroke-width="2" fill="none"/>',
  cheese:
    '<path d="M9 42 40 16h15v14L24 50z" fill="#f0c04a"/><path d="M9 42h15v8H9z" fill="#dda92f"/>' +
    '<g fill="#dda92f"><circle cx="33" cy="33" r="3.4"/><circle cx="44" cy="26" r="2.6"/><circle cx="24" cy="41" r="2.4"/></g>',
  mozz:
    '<circle cx="32" cy="34" r="18" fill="#fbf8f1"/><circle cx="32" cy="34" r="18" fill="none" stroke="#e6ddc9" stroke-width="2"/>' +
    '<ellipse cx="26" cy="27" rx="5" ry="3.6" fill="#fff" opacity=".9"/>',
  herb:
    '<path d="M32 54c0-16 6-28 20-34-2 18-9 28-20 34z" fill="#3f8b45"/>' +
    '<path d="M31 54c0-14-5-24-18-29 2 16 8 24 18 29z" fill="#4fa055"/>' +
    '<path d="M32 55V33" stroke="#2c6b32" stroke-width="2.6" stroke-linecap="round"/>',
  spinach:
    '<path d="M34 52c-2-14 4-26 18-31-1 17-8 27-18 31z" fill="#31783a"/>' +
    '<path d="M28 53C25 40 17 31 6 28c3 15 11 23 22 25z" fill="#43924a"/>',
  meat:
    '<path d="M14 34c0-11 9-18 20-18 12 0 18 8 18 16 0 9-7 18-19 18s-19-7-19-16z" fill="#9a4a2c"/>' +
    '<g fill="#7d3a20"><circle cx="26" cy="30" r="3.2"/><circle cx="38" cy="37" r="2.8"/><circle cx="33" cy="24" r="2.2"/></g>',
  meatball:
    '<circle cx="23" cy="40" r="11" fill="#8e4527"/><circle cx="42" cy="38" r="10" fill="#9d4e2c"/>' +
    '<circle cx="33" cy="24" r="9.5" fill="#a85630"/><circle cx="20" cy="36" r="2.6" fill="#733317" opacity=".7"/>',
  sausage:
    '<path d="M14 44c-4-12 4-26 16-28 10-2 18 4 20 12" fill="none" stroke="#9b4b2b" stroke-width="13" stroke-linecap="round"/>' +
    '<path d="M22 34c4-6 10-8 16-6" stroke="#7d3a20" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
  chicken:
    '<g fill="#c98a4e"><rect x="12" y="24" width="40" height="9" rx="4.5"/><rect x="14" y="36" width="36" height="9" rx="4.5"/></g>' +
    '<g stroke="#a06a33" stroke-width="2.2" stroke-linecap="round"><path d="M22 26v5M34 26v5M44 38v5M28 38v5"/></g>',
  shrimp:
    '<path d="M46 20c-14-4-26 4-26 16 0 8 6 13 13 13" fill="none" stroke="#eb8877" stroke-width="11" stroke-linecap="round"/>' +
    '<circle cx="46" cy="20" r="3" fill="#c9564a"/>' +
    '<path d="M33 49c4 3 9 2 11-2" stroke="#eb8877" stroke-width="7" fill="none" stroke-linecap="round"/>',
  beans:
    '<ellipse cx="24" cy="38" rx="12" ry="8" transform="rotate(-22 24 38)" fill="#e0cba0"/>' +
    '<ellipse cx="41" cy="30" rx="11" ry="7.5" transform="rotate(18 41 30)" fill="#eadab6"/>',
  chili:
    '<path d="M42 14c2 12-2 26-14 32-8 4-14 0-14-6 0-9 12-12 18-20" fill="none" stroke="#cf3327" stroke-width="11" stroke-linecap="round"/>' +
    '<path d="M42 14c0-4 3-6 6-6" fill="none" stroke="#3f8b45" stroke-width="5" stroke-linecap="round"/>',
  garlic:
    '<path d="M32 14c8 6 14 16 14 24 0 9-6 14-14 14s-14-5-14-14c0-8 6-18 14-24z" fill="#f4efe4"/>' +
    '<path d="M32 16v36M23 24c-2 8-2 20 2 26M41 24c2 8 2 20-2 26" stroke="#ddd3bd" stroke-width="2.2" fill="none"/>' +
    '<path d="M32 14c0-4-2-6-4-7 4 0 6 2 8 4" fill="#a8b07a"/>',
  olive:
    '<ellipse cx="32" cy="34" rx="13" ry="17" fill="#3f4a2a"/><ellipse cx="32" cy="26" rx="5" ry="4" fill="#c9433a"/>',
  mushroom:
    '<path d="M10 32c0-11 10-18 22-18s22 7 22 18z" fill="#b98a63"/>' +
    '<path d="M25 32h14v14a7 7 0 0 1-14 0z" fill="#eadfcd"/>',
  pepper:
    '<path d="M18 30c0-7 6-11 14-11s14 4 14 11c0 12-4 22-14 22s-14-10-14-22z" fill="#3f9b4c"/>' +
    '<path d="M32 19v-6" stroke="#2b6a34" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M25 26c-1 10 0 18 3 22" stroke="#2f7d3d" stroke-width="2.4" fill="none"/>',
  broccoli:
    '<g fill="#3f8b45"><circle cx="22" cy="24" r="9"/><circle cx="42" cy="24" r="9"/><circle cx="32" cy="18" r="9"/><circle cx="32" cy="29" r="9"/></g>' +
    '<path d="M32 33v18" stroke="#8fbf6a" stroke-width="8" stroke-linecap="round"/>',
  bread:
    '<path d="M9 41c0-13 9-21 23-21s23 8 23 21c0 5-4 8-10 8H19c-6 0-10-3-10-8z" fill="#d8a75a"/>' +
    '<path d="M9 44h46v5a5 5 0 0 1-5 5H14a5 5 0 0 1-5-5z" fill="#c08f43"/>' +
    '<g stroke="#b57f36" stroke-width="2.4" stroke-linecap="round" opacity=".7"><path d="M22 28l-4 8M34 26l-4 9M45 29l-4 7"/></g>',
  salad:
    '<path d="M8 32h48c0 12-10 22-24 22S8 44 8 32z" fill="#f2ede1"/>' +
    '<g fill="#43924a"><circle cx="22" cy="28" r="7"/><circle cx="36" cy="26" r="8"/><circle cx="46" cy="30" r="6"/></g>' +
    '<circle cx="29" cy="32" r="4" fill="#d8402f"/>',
  sticks:
    '<g fill="#dfb268"><rect x="14" y="12" width="9" height="42" rx="4.5" transform="rotate(-8 18 33)"/>' +
    '<rect x="34" y="12" width="9" height="42" rx="4.5" transform="rotate(9 38 33)"/></g>',
  bbq:
    '<path d="M14 24h36l-3 26a6 6 0 0 1-6 5H23a6 6 0 0 1-6-5z" fill="#7a3418"/>' +
    '<ellipse cx="32" cy="24" rx="18" ry="6" fill="#95441f"/>' +
    '<path d="M24 33c4 5 12 5 16 0" stroke="#5d2410" stroke-width="2.5" fill="none"/>',
  pepperoni:
    '<circle cx="32" cy="32" r="20" fill="#c0392b"/>' +
    '<g fill="#8e2b20"><circle cx="25" cy="26" r="3"/><circle cx="39" cy="29" r="2.6"/>' +
    '<circle cx="29" cy="39" r="2.8"/><circle cx="39" cy="40" r="2.2"/></g>',
  bacon:
    '<path d="M8 22c10-6 18 6 28 0s16 4 20 0v10c-6 5-12-4-20 1s-18-6-28 0z" fill="#c0563f"/>' +
    '<path d="M8 34c10-6 18 6 28 0s16 4 20 0v9c-6 5-12-4-20 1s-18-6-28 0z" fill="#e8dcc8"/>',
  ham:
    '<path d="M18 22h22a10 10 0 0 1 0 20H18a6 6 0 0 1 0-20z" fill="#e79a9a"/>' +
    '<circle cx="26" cy="32" r="3" fill="#f5d0d0"/><circle cx="36" cy="30" r="2.4" fill="#f5d0d0"/>',
  onion:
    '<circle cx="32" cy="34" r="20" fill="#c9a8d4"/><circle cx="32" cy="34" r="14" fill="#ddc4e5"/>' +
    '<circle cx="32" cy="34" r="8" fill="#efe2f3"/><circle cx="32" cy="34" r="3" fill="#c9a8d4"/>',
  pineapple:
    '<ellipse cx="32" cy="38" rx="16" ry="19" fill="#f0c33c"/>' +
    '<g stroke="#c99b1f" stroke-width="2" fill="none"><path d="M20 30l24 16M44 30L20 46"/></g>' +
    '<path d="M32 19c-3-7-9-9-9-9 5 0 8 3 9 5 1-2 4-5 9-5 0 0-6 2-9 9z" fill="#4a8f3f"/>',
  salt:
    '<path d="M22 26h20l-2 28a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4z" fill="#eef1f4"/>' +
    '<path d="M22 26c0-6 4-10 10-10s10 4 10 10z" fill="#c9d2da"/>' +
    '<g fill="#8d99a6"><circle cx="28" cy="20" r="1.6"/><circle cx="36" cy="20" r="1.6"/>' +
    '<circle cx="32" cy="17" r="1.6"/></g>',
  mozz_shred:
    '<g fill="#fbf3dd" stroke="#e2d4b4" stroke-width="1.6"><rect x="10" y="22" width="26" height="7" rx="3.5" transform="rotate(-14 23 25)"/><rect x="26" y="28" width="28" height="7" rx="3.5" transform="rotate(11 40 31)"/><rect x="12" y="36" width="25" height="7" rx="3.5" transform="rotate(7 24 39)"/><rect x="28" y="42" width="24" height="7" rx="3.5" transform="rotate(-9 40 45)"/></g>',
  sauce_none:
    '<circle cx="32" cy="32" r="22" fill="#e8c893"/><circle cx="32" cy="32" r="17" fill="#f7ecd5"/><path d="M17 47 47 17" stroke="#b8ada1" stroke-width="5" stroke-linecap="round"/>',
  sauce_light:
    '<circle cx="32" cy="32" r="22" fill="#e8c893"/><circle cx="32" cy="32" r="17" fill="#f7ecd5"/><g fill="#d8402f" opacity=".85"><ellipse cx="27" cy="27" rx="6" ry="4.5"/><ellipse cx="38" cy="35" rx="5" ry="4"/><ellipse cx="28" cy="39" rx="4" ry="3"/></g>',
  sauce_heavy:
    '<circle cx="32" cy="32" r="22" fill="#e8c893"/><circle cx="32" cy="32" r="17" fill="#f7ecd5"/><circle cx="32" cy="32" r="17" fill="#d8402f"/><circle cx="32" cy="32" r="10" fill="#c0301f" opacity=".55"/>',
  cheese_none:
    '<circle cx="32" cy="32" r="22" fill="#e8c893"/><circle cx="32" cy="32" r="17" fill="#f7ecd5"/><path d="M17 47 47 17" stroke="#b8ada1" stroke-width="5" stroke-linecap="round"/>',
  cheese_light:
    '<circle cx="32" cy="32" r="22" fill="#e8c893"/><circle cx="32" cy="32" r="17" fill="#f7ecd5"/><g fill="#f4d97e" stroke="#e0bc51" stroke-width="1"><rect x="23" y="26" width="11" height="4" rx="2" transform="rotate(-18 28 28)"/><rect x="33" y="33" width="10" height="4" rx="2" transform="rotate(24 38 35)"/><rect x="24" y="38" width="9" height="4" rx="2" transform="rotate(8 28 40)"/></g>',
  cheese_heavy:
    '<circle cx="32" cy="32" r="22" fill="#e8c893"/><circle cx="32" cy="32" r="17" fill="#f7ecd5"/><circle cx="32" cy="32" r="17" fill="#f4d97e"/><g fill="none" stroke="#e0bc51" stroke-width="2.6" stroke-linecap="round"><path d="M22 27h9M34 24h8M26 34h11M39 33h5M21 40h8M32 41h9"/></g>',
  none:
    '<circle cx="32" cy="32" r="19" fill="none" stroke="#b8ada1" stroke-width="5"/>' +
    '<path d="M19 45 45 19" stroke="#b8ada1" stroke-width="5" stroke-linecap="round"/>',
};

var EXTRAS = {
  mark:
    '<circle cx="32" cy="32" r="30" fill="#d33f30"/>' +
    '<path d="M16 24c6 10 4 18 0 24M26 22c6 12 4 20 0 26M36 22c6 12 4 20 0 26M46 24c6 10 4 18 0 24" ' +
    'fill="none" stroke="#f7d98a" stroke-width="4.5" stroke-linecap="round"/>',
  bowl:
    '<path d="M6 30h52c0 14-11 25-26 25S6 44 6 30z" fill="#f4efe4"/>' +
    '<path d="M6 30h52c0 3-1 6-2 8H8c-1-2-2-5-2-8z" fill="#e6ddc9"/>' +
    '<g fill="none" stroke="#e3ad45" stroke-width="4" stroke-linecap="round">' +
    '<path d="M16 28c4-8 10-10 16-6M30 28c4-9 12-10 18-4"/></g>',
  pot:
    '<g class="steam" fill="none" stroke="#c9bfb2" stroke-width="4" stroke-linecap="round">' +
    '<path d="M24 20c-3-4 3-7 0-11"/></g>' +
    '<g class="steam steam-2" fill="none" stroke="#c9bfb2" stroke-width="4" stroke-linecap="round">' +
    '<path d="M34 18c-3-5 3-8 0-12"/></g>' +
    '<g class="steam steam-3" fill="none" stroke="#c9bfb2" stroke-width="4" stroke-linecap="round">' +
    '<path d="M44 20c-3-4 3-7 0-11"/></g>' +
    '<path d="M10 30h44v12c0 8-7 14-16 14h-12c-9 0-16-6-16-14z" fill="#8d99a6"/>' +
    '<rect x="6" y="26" width="52" height="7" rx="3.5" fill="#aeb9c4"/>' +
    '<path d="M14 40h36v3c0 6-5 10-12 10h-12c-7 0-12-4-12-10z" fill="#e3ad45" opacity=".55"/>',
  runner:
    '<circle cx="32" cy="32" r="30" fill="#2f7d4f"/>' +
    '<path d="M20 40l8-8 6 6 10-12" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>',
};

/**
 * Render one glyph.
 * @param {string} key  shape key, icon key, or extra key
 * @param {object} opts { size, className, title }
 */
function art(key, opts) {
  opts = opts || {};
  var inner = SHAPES[key] || ICONS[key] || EXTRAS[key];
  if (!inner) inner = ICONS.none;
  var size = opts.size ? ' width="' + opts.size + '" height="' + opts.size + '"' : '';
  var cls = opts.className ? ' class="' + opts.className + '"' : '';
  var title = opts.title ? '<title>' + escapeXml(opts.title) + '</title>' : '';
  var hidden = opts.title ? '' : ' aria-hidden="true"';
  return '<svg viewBox="0 0 64 64"' + size + cls + hidden + ' role="img" focusable="false">' + title + inner + '</svg>';
}

/** Resolve the right glyph for any menu item, whatever group it came from. */
function artFor(item) {
  if (!item) return art('none');
  return art(item.shape || item.icon || 'none');
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, function (c) {
    return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

export { art, artFor, SHAPES, ICONS, EXTRAS };
