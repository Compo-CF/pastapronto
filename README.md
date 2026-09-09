# PastaPronto!

QR-to-kitchen pasta ordering. A guest scans the code on their table, builds a
bowl per person from a limited ingredient set, and sends it straight to a chit
on the cook's screen with live timers, an accept button, and a call-runner
button.

Simple enough that a six-year-old can drive it unaided; detailed enough that an
adult can filter allergens, set spice, add per-bowl notes, and that a manager
can read cook-time SLAs off the same data.

## Run it

No dependencies, no build step. Node 18 or newer.

```bash
node server.js
```

Then open:

| Screen | URL | Who uses it |
| --- | --- | --- |
| Guest order | `/t/table-12` | the guest, from a QR scan |
| Kitchen chit rail | `/kitchen` | the cook |
| Expo / runner board | `/expo` | expo and runners |
| Manager + QR codes | `/admin` | manager |

Start with a clean service: `node server.js --fresh`

The first boot seeds a believable rail of chits so no screen is ever blank.
Clear them from **Manager → Clear today**.

## Make the QR codes actually work

1. Open `/admin` on the machine running the server.
2. The **Base address** field is pre-filled with the detected LAN address
   (e.g. `http://10.23.0.119:7070`). A QR pointing at `localhost` only works on
   that one computer, so this matters.
3. **Print table tents** produces one page per table, fold line included.
4. Any phone on the same wifi can now scan and order.

## Test it

```bash
node scripts/selftest.js
```

Covers the order lifecycle, every illegal transition, the double-accept race,
undo, allergy flagging, cook-time batching, and the metrics roll-up.

```bash
node scripts/qr-verify.js
```

Verifies the hand-written QR encoder the way a scanner would: checks every
function pattern against ISO/IEC 18004, decodes the format information through
its BCH code, strips the mask, de-interleaves the blocks, runs a Reed-Solomon
syndrome check, and parses the payload back to the original URL - across all
ten supported versions.

## Layout

```
server.js              HTTP + static + screen routes
lib/
  config.js            every tunable: SLAs, stations, table tags, hours
  menu.js              the whole menu as data (ingredients, allergens, times)
  cooktime.js          the cook-time model, documented and arguable
  members.js           member-number lookup (swap for the real POS here)
  store.js             orders, the state machine, metrics, persistence
  bus.js               pub/sub feeding Server-Sent Events
  api.js               REST routes
  http.js, ids.js      helpers
  seed.js              demo data
public/
  index.html   guest.css   app/guest.js      guest ordering wizard
  kitchen.html kitchen.css app/kitchen.js    chit rail
  expo.html    expo.css    app/expo.js       runner board
  admin.html   admin.css   app/admin.js      manager + QR printing
  shared.css                                 design tokens
  app/art.js                                 inline SVG glyph set
  app/qr.js                                  QR encoder (no dependencies)
  app/client.js                              API, SSE, formatting, chimes
docs/                  architecture, data model, API, screen specs
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - data flow and design decisions
- [docs/DATA-MODEL.md](docs/DATA-MODEL.md) - the order object and lifecycle
- [docs/API.md](docs/API.md) - every endpoint with examples
- [docs/SCREENS.md](docs/SCREENS.md) - each screen, its states, its keyboard

## What is deliberately not built

State lives in memory with a JSON snapshot at `data/state.json`. That is
correct for a single pasta station and wrong for a chain: swap `lib/store.js`
for a real database and `lib/bus.js` for Redis pub/sub, and nothing else moves.
There is no payment capture (charges post to the member number), no staff
authentication on `/kitchen` (put it behind the venue's network or an
auth proxy), and no printer integration.
