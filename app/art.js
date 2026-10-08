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
  flakes:
    '<rect x="19" y="25" width="26" height="31" rx="5" fill="#f7f1e2" stroke="#e0d5bd" stroke-width="1.6"/><g fill="#cf3327"><rect x="23" y="33" width="7" height="3" rx="1.5" transform="rotate(-24 26 34)"/><rect x="33" y="36" width="6" height="3" rx="1.5" transform="rotate(18 36 37)"/><rect x="24" y="42" width="6" height="3" rx="1.5" transform="rotate(12 27 43)"/><rect x="33" y="46" width="7" height="3" rx="1.5" transform="rotate(-16 36 47)"/><rect x="25" y="50" width="6" height="3" rx="1.5" transform="rotate(-6 28 51)"/></g><rect x="17" y="13" width="30" height="12" rx="4" fill="#8c4a3f"/><g fill="#f7f1e2"><circle cx="25" cy="19" r="1.7"/><circle cx="32" cy="19" r="1.7"/><circle cx="39" cy="19" r="1.7"/></g>',
  jalapeno:
    '<path d="M32 19c7 0 12 6 12 14 0 13-5 23-12 23s-12-10-12-23c0-8 5-14 12-14z" fill="#4a9a3f"/><path d="M26 27c-2 7-2 15 0 21" fill="none" stroke="#7bc06a" stroke-width="3" stroke-linecap="round" opacity=".75"/><ellipse cx="32" cy="19" rx="8" ry="3.4" fill="#2f6b34"/><path d="M32 17c1-5 4-8 8-8" fill="none" stroke="#2f6b34" stroke-width="4" stroke-linecap="round"/>',
  oregano:
    '<path d="M32 56V20" fill="none" stroke="#6b7a3e" stroke-width="3" stroke-linecap="round"/><g fill="#7f9149"><ellipse cx="23" cy="26" rx="7" ry="4.5" transform="rotate(-28 23 26)"/><ellipse cx="41" cy="30" rx="7" ry="4.5" transform="rotate(28 41 30)"/><ellipse cx="23" cy="37" rx="6.5" ry="4.2" transform="rotate(-24 23 37)"/><ellipse cx="41" cy="41" rx="6.5" ry="4.2" transform="rotate(24 41 41)"/><ellipse cx="25" cy="47" rx="5.5" ry="3.6" transform="rotate(-20 25 47)"/></g><ellipse cx="32" cy="19" rx="5" ry="3.4" fill="#6b7a3e"/>',
  artichoke:
    '<path d="M32 56c-9 0-15-7-15-17 0-13 7-24 15-30 8 6 15 17 15 30 0 10-6 17-15 17z" fill="#7f9149"/><g fill="#94a65c" stroke="#5f7238" stroke-width="1.4"><path d="M32 24c-5 4-8 10-8 15 0 6 4 9 8 9s8-3 8-9c0-5-3-11-8-15z"/></g><g fill="none" stroke="#5f7238" stroke-width="2" stroke-linecap="round"><path d="M20 34c4 3 8 4 12 4s8-1 12-4M21 44c4 3 7 4 11 4s7-1 11-4"/></g><g stroke="#4a3a22" stroke-width="2.6" stroke-linecap="round" opacity=".55"><path d="M24 30h5M35 40h5M26 48h4"/></g><path d="M32 15v-6" fill="none" stroke="#5f7238" stroke-width="3.4" stroke-linecap="round"/>',
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

  // --------------------------------------------------------------- burgers
  //
  // Drawn so any two tiles in one list differ in SILHOUETTE, not only in fill.
  // A guest taps a 90px tile and a cook reads the rail on a dark screen at a
  // glance; two shapes that differ by a shade are two tiles nobody can tell
  // apart, which is what the shared-glyph test exists to stop.

  // One beef patty: a disc from slightly above, with a seared edge.
  patty:
    '<ellipse cx="32" cy="36" rx="22" ry="14" fill="#6f4126"/>' +
    '<ellipse cx="32" cy="32" rx="22" ry="14" fill="#8a5330"/>' +
    '<g fill="#a9693c" opacity=".8"><ellipse cx="24" cy="29" rx="4" ry="2.4"/>' +
    '<ellipse cx="38" cy="33" rx="5" ry="2.6"/><ellipse cx="31" cy="37" rx="3.5" ry="2"/></g>',
  // Two of them, stacked. The difference is countable rather than a tint.
  patty_double:
    '<ellipse cx="32" cy="46" rx="21" ry="12" fill="#6f4126"/>' +
    '<ellipse cx="32" cy="42" rx="21" ry="12" fill="#8a5330"/>' +
    '<ellipse cx="32" cy="28" rx="21" ry="12" fill="#6f4126"/>' +
    '<ellipse cx="32" cy="24" rx="21" ry="12" fill="#8a5330"/>' +
    '<g fill="#a9693c" opacity=".75"><ellipse cx="25" cy="22" rx="4" ry="2.2"/>' +
    '<ellipse cx="38" cy="25" rx="4.5" ry="2.4"/></g>',

  // Buns that differ by crown and crumb rather than by tint.
  bun_soft:
    '<path d="M10 40c0-14 10-22 22-22s22 8 22 22z" fill="#e0b068"/>' +
    '<path d="M10 40h44v6a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6z" fill="#c9954c"/>' +
    '<path d="M16 32c5-6 27-6 32 0" stroke="#efc98f" stroke-width="3" fill="none" stroke-linecap="round"/>',
  bun_seeded:
    '<path d="M10 40c0-14 10-22 22-22s22 8 22 22z" fill="#d9a558"/>' +
    '<path d="M10 40h44v6a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6z" fill="#c08f43"/>' +
    '<g fill="#fdf0d2"><ellipse cx="22" cy="31" rx="2.6" ry="1.5"/>' +
    '<ellipse cx="32" cy="26" rx="2.6" ry="1.5"/><ellipse cx="42" cy="31" rx="2.6" ry="1.5"/>' +
    '<ellipse cx="27" cy="36" rx="2.4" ry="1.4"/><ellipse cx="38" cy="36" rx="2.4" ry="1.4"/></g>',
  // Gluten free: the same bun with a leaf, which is the convention everywhere.
  bun_gf:
    '<path d="M8 38c0-13 10-20 21-20s21 7 21 20z" fill="#dcb682"/>' +
    '<path d="M8 38h42v6a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6z" fill="#c49a62"/>' +
    '<path d="M44 52c0-9 6-15 14-16-1 10-6 15-14 16z" fill="#3f9150"/>' +
    '<path d="M46 52c3-5 7-8 11-10" stroke="#2c6c3a" stroke-width="2" fill="none" stroke-linecap="round"/>',

  // A plain slice, a holed slice and a flecked slice read apart at tile size
  // in a way that four wedges never will.
  cheese_slice:
    '<rect x="12" y="16" width="40" height="32" rx="3" fill="#f2b327"/>' +
    '<path d="M12 16h40l-9 9H21z" fill="#ffd166" opacity=".75"/>' +
    '<rect x="12" y="16" width="40" height="32" rx="3" fill="none" stroke="#c98d12" stroke-width="2"/>',
  cheese_holes:
    '<rect x="12" y="16" width="40" height="32" rx="3" fill="#f6d98a"/>' +
    '<g fill="#dcb757"><circle cx="23" cy="27" r="4.5"/><circle cx="39" cy="24" r="3.2"/>' +
    '<circle cx="33" cy="38" r="5"/><circle cx="45" cy="38" r="2.8"/></g>' +
    '<rect x="12" y="16" width="40" height="32" rx="3" fill="none" stroke="#c9a94e" stroke-width="2"/>',
  cheese_flecks:
    '<rect x="12" y="16" width="40" height="32" rx="3" fill="#f7dea0"/>' +
    '<g fill="#b8342a"><circle cx="22" cy="26" r="2.2"/><circle cx="36" cy="23" r="1.8"/>' +
    '<circle cx="29" cy="34" r="2"/><circle cx="43" cy="33" r="2.2"/>' +
    '<circle cx="20" cy="40" r="1.8"/><circle cx="38" cy="42" r="2"/></g>' +
    '<rect x="12" y="16" width="40" height="32" rx="3" fill="none" stroke="#caa54e" stroke-width="2"/>',

  // Grilled onions: browned strands in a heap. Nothing like the raw onion's
  // concentric rings, which is the entire point of drawing it separately.
  onion_grilled:
    '<g fill="none" stroke="#c98f4e" stroke-width="5" stroke-linecap="round">' +
    '<path d="M12 42c8-10 18-10 26-2"/><path d="M16 50c9-9 21-12 32-6"/></g>' +
    '<g fill="none" stroke="#e0b887" stroke-width="4" stroke-linecap="round">' +
    '<path d="M14 34c9-8 20-7 28 1"/><path d="M20 25c8-5 17-3 24 3"/></g>',
  lettuce:
    '<path d="M32 50c-14 0-24-9-24-19 0-3 2-5 5-4 2-6 8-8 12-5 3-6 11-6 14 0 4-3 10-1 12 5 3-1 5 1 5 4 0 10-10 19-24 19z" fill="#4faa4f"/>' +
    '<g stroke="#2f7a34" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8">' +
    '<path d="M20 30c3 7 7 11 12 13"/><path d="M44 30c-3 7-7 11-12 13"/></g>',
  avocado:
    '<path d="M32 10c10 0 17 10 17 22 0 13-8 22-17 22s-17-9-17-22c0-12 7-22 17-22z" fill="#4e7c2f"/>' +
    '<path d="M32 16c7 0 12 8 12 17 0 10-6 16-12 16s-12-6-12-16c0-9 5-17 12-17z" fill="#cfe08a"/>' +
    '<ellipse cx="32" cy="36" rx="8" ry="9" fill="#7a4a21"/>',

  // Squeeze bottles. The two condiments differ by colour and by cap.
  ketchup:
    '<path d="M27 9h10v7l4 5v33a4 4 0 0 1-4 4H27a4 4 0 0 1-4-4V21l4-5z" fill="#cf2e26"/>' +
    '<rect x="27" y="4" width="10" height="6" rx="2" fill="#8f1d18"/>' +
    '<rect x="26" y="29" width="12" height="13" rx="2" fill="#ffffff" opacity=".88"/>',
  mustard:
    '<path d="M24 21l6-7h4l6 7v29a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4z" fill="#e8b713"/>' +
    '<rect x="30" y="5" width="4" height="9" rx="1.5" fill="#a37f08"/>' +
    '<rect x="26" y="30" width="12" height="13" rx="2" fill="#ffffff" opacity=".9"/>',
  // Mayo was cream drawn on cream and vanished against the tile. Same jar,
  // now with a coloured lid and an outline that survive a pale background.
  mayo:
    '<rect x="18" y="20" width="28" height="34" rx="5" fill="#fdfaf0" stroke="#9a8f74" stroke-width="2.4"/>' +
    '<rect x="15" y="11" width="34" height="10" rx="3" fill="#3f6fb5"/>' +
    '<rect x="23" y="31" width="18" height="13" rx="2" fill="#e8dfc6"/>',

  // Three baskets, three different shapes.
  fries:
    '<path d="M18 26h28l-3 26a6 6 0 0 1-6 5H27a6 6 0 0 1-6-5z" fill="#d6413a"/>' +
    '<g fill="#f0c463"><rect x="20" y="8" width="7" height="24" rx="3.5"/>' +
    '<rect x="29" y="4" width="7" height="28" rx="3.5"/>' +
    '<rect x="38" y="8" width="7" height="24" rx="3.5"/></g>',
  tots:
    '<g fill="#deb071">' +
    '<rect x="11" y="29" width="16" height="13" rx="4.5"/><rect x="31" y="24" width="16" height="13" rx="4.5"/>' +
    '<rect x="21" y="44" width="16" height="13" rx="4.5"/><rect x="40" y="41" width="14" height="13" rx="4.5"/></g>' +
    '<g stroke="#b5833f" stroke-width="1.6" opacity=".7" fill="none" stroke-linecap="round">' +
    '<path d="M15 33h8"/><path d="M35 28h8"/><path d="M25 48h8"/><path d="M44 45h6"/></g>',
  // Not on the list of asked-for fixes, but miscast in the same way: the egg
  // was drawn with the butter glyph and the pickle with the olive.
  fried_egg:
    '<path d="M14 36c-6-10 2-20 12-20 4-8 16-10 22-3 8 2 11 11 6 17 3 8-4 15-12 14-6 6-16 5-20-2-4 1-8-2-8-6z" fill="#fffdf6" stroke="#e6ddc6" stroke-width="1.6"/>' +
    '<circle cx="31" cy="31" r="9" fill="#f2b22c"/>' +
    '<circle cx="28" cy="28" r="3" fill="#f8cf6a" opacity=".8"/>',
  pickle:
    '<g transform="rotate(-24 32 32)">' +
    '<rect x="23" y="10" width="18" height="44" rx="9" fill="#4e8c37"/>' +
    '<rect x="26" y="14" width="12" height="36" rx="6" fill="#6fae4d"/>' +
    '<g fill="#3d6f2a" opacity=".7"><circle cx="30" cy="22" r="1.6"/><circle cx="35" cy="29" r="1.6"/>' +
    '<circle cx="29" cy="36" r="1.6"/><circle cx="34" cy="43" r="1.6"/></g></g>',
  onion_ring:
    '<g fill="#dfae6a" stroke="#b9873e" stroke-width="2">' +
    '<ellipse cx="24" cy="25" rx="14" ry="11"/><ellipse cx="40" cy="43" rx="14" ry="11"/></g>' +
    '<g fill="#fbf0dc"><ellipse cx="24" cy="25" rx="6" ry="4.5"/>' +
    '<ellipse cx="40" cy="43" rx="6" ry="4.5"/></g>',
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
  // A crust with no wheat in it. The letters do the work - there is no shape
  // that reads as "gluten free" on its own, and a cook scanning a tile needs
  // to be sure rather than nearly sure.
  crust_gf:
    '<circle cx="32" cy="32" r="22" fill="#e9d6b4"/>' +
    '<circle cx="32" cy="32" r="15" fill="#f6ecd8"/>' +
    '<text x="32" y="38" font-family="system-ui,sans-serif" font-size="15" font-weight="800" ' +
    'text-anchor="middle" fill="#9a7b45">GF</text>',

  // Dessert pizza: a slice under a chocolate drizzle with a berry on it.
  // Built on the same slice outline as the savoury one, so it reads as pizza
  // first and dessert second. A fresh triangle looked like a hazard sign at
  // tile size, which is not what you want on a menu.
  pizza_dessert:
    '<path d="M32 6 56 50a4 4 0 0 1-4 6H12a4 4 0 0 1-4-6z" fill="#e8c98f"/>' +
    '<path d="M32 14 50 48H14z" fill="#f3e3c0"/>' +
    '<g fill="none" stroke="#6b4423" stroke-width="3.2" stroke-linecap="round">' +
    '<path d="M24 44c4-4 5-9 3-13M34 46c4-5 5-11 2-15M43 46c2-4 2-8 1-11"/></g>' +
    '<circle cx="32" cy="31" r="5.5" fill="#e0413c"/>' +
    '<path d="M28.5 26.5h7l-3.5 3.5z" fill="#4e8a3c"/>',

  // The dessert slice again, with the letters that say which dough it is on.
  // Two dessert bases sit side by side on the crust step, so they have to be
  // tellable apart at a glance and not only by reading the label under them.
  crust_gf_dessert:
    '<path d="M32 6 56 50a4 4 0 0 1-4 6H12a4 4 0 0 1-4-6z" fill="#e8c98f"/>' +
    '<path d="M32 14 50 48H14z" fill="#f3e3c0"/>' +
    '<g fill="none" stroke="#6b4423" stroke-width="3" stroke-linecap="round">' +
    '<path d="M24 45c3-3 4-7 2-10M41 46c2-3 2-6 1-9"/></g>' +
    '<circle cx="32" cy="41" r="11" fill="#f6efdc"/>' +
    '<text x="32" y="46" font-family="system-ui,sans-serif" font-size="13" ' +
    'font-weight="800" text-anchor="middle" fill="#9a7b45">GF</text>',

  // Chocolate hazelnut spread: the jar, because a brown swirl alone reads as
  // sauce and this list already has four of those.
  nutella:
    '<path d="M19 22h26v28a6 6 0 0 1-6 6H25a6 6 0 0 1-6-6z" fill="#f3efe7" stroke="#d8d0c4" stroke-width="2"/>' +
    '<path d="M24 31h16v17H24z" fill="#5b3a21"/>' +
    '<path d="M27 38c3-3 7 3 10 0" fill="none" stroke="#8a5a33" stroke-width="2.6" stroke-linecap="round"/>' +
    '<rect x="17" y="13" width="30" height="10" rx="3" fill="#b9ae9f"/>',

  strawberry:
    '<path d="M32 56c-11 0-18-9-18-19 0-7 8-11 18-11s18 4 18 11c0 10-7 19-18 19z" fill="#e0413c"/>' +
    '<g fill="#b32f2b"><circle cx="26" cy="34" r="1.9"/><circle cx="38" cy="34" r="1.9"/>' +
    '<circle cx="32" cy="42" r="1.9"/><circle cx="23" cy="44" r="1.9"/><circle cx="41" cy="44" r="1.9"/></g>' +
    '<path d="M22 24c4-3 7-3 10-1 3-2 6-2 10 1-4 3-7 3-10 2-3 1-6 1-10-2z" fill="#4e8a3c"/>' +
    '<path d="M31 18h2v7h-2z" fill="#4e8a3c"/>',

  // Powdered sugar: a sieve letting it fall. Dots alone looked like salt,
  // which is already on this menu and goes somewhere very different.
  sugar:
    '<path d="M18 20h28l-4 10H22z" fill="#c9bfb2"/>' +
    '<rect x="16" y="13" width="32" height="8" rx="3" fill="#9b9084"/>' +
    '<g fill="#ded6c8"><circle cx="24" cy="39" r="2.8"/><circle cx="33" cy="44" r="2.8"/>' +
    '<circle cx="41" cy="38" r="2.8"/><circle cx="28" cy="51" r="2.5"/><circle cx="38" cy="52" r="2.5"/>' +
    '<circle cx="32" cy="34" r="2.3"/></g>',

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

  // The portion sizes, which had no artwork at all and so fell through to the
  // "none" glyph - two tiles reading "Kid Size" and "Regular" under a crossed
  // circle, which looks exactly like being told neither is available. The same
  // bowl at three sizes, so the picture carries the meaning the label does.
  bowl_kid:
    '<g transform="translate(32 34) scale(0.6) translate(-32 -34)">' +
    '<path d="M6 30h52c0 14-11 25-26 25S6 44 6 30z" fill="#f4efe4"/>' +
    '<path d="M6 30h52c0 3-1 6-2 8H8c-1-2-2-5-2-8z" fill="#e6ddc9"/>' +
    '<g fill="none" stroke="#e3ad45" stroke-width="6" stroke-linecap="round">' +
    '<path d="M16 28c4-8 10-10 16-6M30 28c4-9 12-10 18-4"/></g></g>',
  bowl_regular:
    '<g transform="translate(32 33) scale(0.84) translate(-32 -33)">' +
    '<path d="M6 30h52c0 14-11 25-26 25S6 44 6 30z" fill="#f4efe4"/>' +
    '<path d="M6 30h52c0 3-1 6-2 8H8c-1-2-2-5-2-8z" fill="#e6ddc9"/>' +
    '<g fill="none" stroke="#e3ad45" stroke-width="4.6" stroke-linecap="round">' +
    '<path d="M16 28c4-8 10-10 16-6M30 28c4-9 12-10 18-4"/></g></g>',
  bowl_large:
    '<path d="M3 28h58c0 16-12 28-29 28S3 44 3 28z" fill="#f4efe4"/>' +
    '<path d="M3 28h58c0 3-1 7-2 9H5c-1-2-2-6-2-9z" fill="#e6ddc9"/>' +
    '<g fill="none" stroke="#e3ad45" stroke-width="4" stroke-linecap="round">' +
    '<path d="M14 26c4-9 11-11 18-7M30 26c5-10 13-11 20-4"/></g>',
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
  // An unknown key falls back to the "no" glyph, which on a menu tile reads as
  // a deliberate "none" choice rather than a missing picture. art.has() lets
  // the test suite catch that instead of a guest finding it.
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

/** True when this key has artwork of its own rather than the fallback. */
function has(key) {
  return Boolean(SHAPES[key] || ICONS[key] || EXTRAS[key]);
}

export { art, artFor, has, SHAPES, ICONS, EXTRAS };
