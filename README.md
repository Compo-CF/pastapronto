# PastaPresto!

QR-to-kitchen ordering for a pasta and pizza station. A guest scans the code on
their table, picks a lane - **build your bowl** or **build your pizza** - builds
one per person from a limited ingredient set, and it lands as a chit on the right
cook's screen with live timers, an accept button, and a call-runner button.

Simple enough that a six-year-old can drive it unaided; detailed enough that an
adult can filter allergens, set spice and add per-bowl notes, and that a manager
can read cook-time SLAs off the same data.

**Static site + Firestore. No server, no build step.** Same stack as
[tasteoffjudging.com](https://tasteoffjudging.com): the four screens are plain
HTML/CSS/ES modules, and everything live goes through Firestore.

**Live:** <https://pastapresto.web.app>

| Screen | URL | Who uses it |
| --- | --- | --- |
| Guest order | [`/?t=table-12`](https://pastapresto.web.app/?t=table-12) | the guest, from a QR scan |
| Kitchen chit rail | [`/kitchen.html`](https://pastapresto.web.app/kitchen.html) | the cook |
| Expo / runner board | [`/expo.html`](https://pastapresto.web.app/expo.html) | expo and runners |
| Manager, QR codes, 86 list | [`/admin.html`](https://pastapresto.web.app/admin.html) | manager |
| End-of-night close-out | [`/report.html`](https://pastapresto.web.app/report.html) | manager |

The older `pastapronto-260909.web.app` host still serves the same build, so any
table tent printed before the rename keeps working. The Firebase **project id**
cannot be renamed, which is why it still reads `pastapronto`; likewise the
GitHub repo name is unchanged on purpose.

The kitchen, expo and manager screens sit behind a staff passcode
(`config.kitchen.staffPasscode`, default `2468`). That is a convenience lock,
not security - see **Security posture** below.

## First-time setup

One human step, because it opens a browser:

```bash
firebase login
```

Then create the project, wire the config and deploy the rules:

```bash
bash scripts/setup-firebase.sh
```

That creates a **new, separate** Firebase project (deliberately not the
tasteoff one), creates Firestore, registers a web app, writes
`app/firebase-config.js`, points `.firebaserc` at it, and deploys
`firestore.rules`.

Two things it cannot do for you, both one click in the console:

1. **Enable Anonymous sign-in** - Authentication → Sign-in method → Anonymous.
   Every screen signs in silently; the rules require it.
2. Choose where to host (below).

Finally open `admin.html` and press **Seed demo orders** to fill the rail and
the member directory.

## Two lanes, four stations

The landing screen asks what you are making, and everything downstream follows
from that answer.

| | Pasta | Pizza |
| --- | --- | --- |
| Stations | `PASTA-1`, `PASTA-2` | `PIZZA-1`, `PIZZA-2` |
| Equipment | 3 pans per station | 2-deck oven, one 12" pie per deck |
| Build steps | pasta, sauce, protein, toppings, size | sauce, protein, toppings, finish |
| Sauces | 8, pick up to 3 | marinara, BBQ, white - pick up to 3 |
| Proteins | 5, pick up to 3 | 6, pick up to 3 |
| Size | kid / regular / large | one size, always |
| Extras | sides, spice level | finishers: parmesan, red pepper flakes, flake salt, oregano |
| Topping cap | 4 | 5 (vegetables and cheese only - meats are proteins) |

Sauces and proteins are both multi-select on both lanes: chicken *and*
meatballs, pepperoni *and* bacon. Selecting nothing on the protein step is how
you say "no protein" - there is no "none" tile to contradict a real choice.
Multiple proteins cost the slowest plus a little handling, not the sum, because
they share the pan.

**Routing is by kind, and it cannot go wrong**: every station declares the kind
it cooks, and `order.stationForTicket()` only ever picks from the matching pool.
A test walks 40 ticket numbers to prove a pizza never lands on a pasta rail.

**One order is one kind.** A table wanting both sends two orders - they are
cooked by different people on different equipment and neither should wait on
the other. The guest app makes that easy: finishing an order drops you back on
the lane picker. If you would rather one ticket span both stations, that is a
real change and a bigger one - see the note at the end of
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Throughput differs sharply**, which is the point of modelling them
separately. Three pans turn over quickly; a two-deck oven does not. Six bowls
is an 11-minute ticket, six pizzas is nearly 15 - the third pizza already waits
for a deck to clear.

## Running out of something (86)

The manager screen's menu tables carry an **86** switch per ingredient ("86" is
the line-cook shorthand for "we are out of it"). Flipping one writes to
`config/availability`, which every guest phone and the kitchen rail watch:

- the tile greys out on every guest's phone within a moment, captioned **sold
  out** - disabled but still visible, so a child can see *why* the thing they
  wanted is unavailable rather than wondering where it went
- the kitchen footer shows the current 86 list
- an order is re-checked at submit, so a phone that has been sitting on the
  review screen cannot slip through an ingredient that ran out meanwhile

## End of the night

`report.html` is the close-out. The manager screen answers "how is service going
right now" and only ever shows today; this reads **any past service date** and is
built to be printed for the folder or exported to a spreadsheet.

- headline tiles: covers, bowls, delivered, on-time %, avg ticket, p90, avg cook,
  avg wait to accept
- **bowls per 15 minutes** with the peak labelled, plus the same numbers as a
  table for anyone who cannot use the chart
- **what sold** - counts per pasta, sauce, protein, topping, side and portion.
  This is the section that drives tomorrow's prep. Sauce counts exceed bowl
  counts where a bowl was mixed.
- **late tickets** worst-first, with estimate, actual and how far over
- **by station**, so you can see if one side of the line is dragging
- **exceptions to follow up**: voids, orders left on hold, rushes, allergy
  orders with what was avoided, and unverified member numbers whose charge
  still needs confirming
- **Download CSV** stacks every section into one file; **Print** uses a
  dedicated stylesheet

The arithmetic is `order.shiftReport()`, a pure function with its own tests, so
the numbers on this page are checked without a database.

## Venue branding

The app ships unbranded. A venue brand is **data plus a stylesheet of
custom-property overrides** - no screen logic knows a brand exists.

| Brand | Guest link |
| --- | --- |
| Default (PastaPresto) | `/?t=table-12` |
| The Club at Carlton Woods | `/?t=table-12&brand=carltonwoods` |

`?brand=<id>` is remembered per device, so staff screens stay branded once set.
`?brand=default` clears it.

### Switching brands

There is a **Branding** toggle in the quiet corner at the bottom of the
[Manager screen](admin.html) - the settings end of the app, below everything a
live service needs. Pick a brand and the page reloads into it.

Staff-only on purpose, and only on that one screen. A guest should never meet a
control that changes whose restaurant they think they are in.

The choice is per device, which is what makes it safe to flip on a laptop
mid-pitch without touching anyone's phone. It also gets **printed into the QR
codes** on the same screen (`&brand=<id>`), because a guest's phone has never
been to the site and so has nothing in storage to brand itself from - without
that, codes printed for a branded venue would open the default palette at every
table. The printable table tents follow the active brand's wordmark too.

### Adding a brand

1. Add an entry to `BRANDS` in [app/brand.js](app/brand.js): venue name, org
   name, tagline, logo path.
2. Add `brands/<id>.css` overriding the custom properties in
   [shared.css](shared.css) under `:root[data-brand="<id>"]`.
3. Drop any logo in `brands/<id>/`.

The stylesheet is attached by a small inline script in each page's `<head>`
rather than by the app, so a branded screen never flashes the default palette
before repainting.

### The Carlton Woods brand

Palette and type were taken from the club's own site, not invented:

| Token | Value | Where it came from |
| --- | --- | --- |
| primary | `#530000` | their `h2`/`h4` colour and site header background |
| secondary | `#8e8f6b` | sage accent on their forms |
| ink | `#2d2d2d` / `#444444` | their `h1` and body text |
| display type | Lora | on their site |
| UI type | Montserrat | on their site |

Their logo is **white on transparent**, which is why the branded chrome is
maroon - it is the background the mark was drawn for.

**The logo is their trademark**, included here for a pitch demo. Get the club's
sign-off before running a branded build anywhere they might read as official,
and note this repo is public.

## Covers are charges, not orders

The venue is **all-you-can-eat: one price per person covers both pasta and
pizza.** So the billable unit is a guest, not an order:

> Four guests at a table are four charges, no matter how many bowls or pizzas
> they order.

`order.billableCovers()` counts each member's party **once**, taking the
largest head count they reported that service date - never the sum across
their orders. A party that eats pasta and comes back for pizza is still one
charge each. Orders and items are consumption signals, useful for spotting a
table that ran the kitchen hard; they are not billing.

This matters more now that there are two lanes, because coming back for the
other one is the normal case. On a seeded day the naive sum read 41 covers
against a true 17.

### Member numbers

One to four digits, and a guest types whatever they remember - **`2`, `02`,
`002` and `0002` are all member 2.** `order.normalizeMemberNumber()` strips
leading zeros, so one member is one row and one document id however it was
entered, and two guests entering the same member differently are one charge on
the report rather than two.

There is no member zero, so `0`, `00` and `0000` are refused rather than
collapsing onto a member that cannot exist. Anything outside 1-4 digits is
refused too.

Two patterns, on purpose: `memberNumberInputPattern` is what the keypad will
accept, `memberNumberPattern` is the canonical stored form (`^[1-9][0-9]{0,3}$`).
`firestore.rules` enforces the canonical one, so a padded number cannot be
written straight to the database.

## A note on money

There is none. Nothing in the app is priced - charges post against the member
number through the club's own system. The guest sees a cook time where a total
would normally go, and the manager screen reports covers and timings rather
than revenue.

## Run it locally

```bash
node scripts/dev-serve.js
```

Serves the repo at <http://localhost:5173> (ES modules and service workers need
`http://`, not `file://`). It talks to the real Firestore project.

To work against the emulators instead, set `projectId` to something starting
with `demo-` in `app/firebase-config.js` and run `firebase emulators:start`
— `app/db.js` auto-connects on localhost for `demo-` projects only, so a
production deploy can never fall into that branch. (The emulator suite needs
Java installed.)

## Deploying

**Firebase Hosting** - works with this repo private:

```bash
firebase deploy --only hosting
```

Gives you `https://<project-id>.web.app`.

**GitHub Pages** - what tasteoff uses, but note Pages only serves **public**
repos on a free plan. This repo is currently private, so either make it public
or use Firebase Hosting:

```bash
gh repo edit --visibility public      # only if you want the Pages route
gh api -X POST repos/:owner/:repo/pages -f source[branch]=main -f source[path]=/
```

Gives you `https://<user>.github.io/pastapronto/`.

Either way, open `admin.html` on the deployed URL and press **Rebuild codes** so
the printed QR codes point at the live address rather than localhost.

## Tests

```bash
npm test
```

- `scripts/selftest.js` (19 checks) - order lifecycle, every illegal
  transition, the double-accept race, undo windows, allergy flagging,
  tamper-resistance of derived fields, cook-time batching, metrics roll-up.
  Runs with no network, no emulator and no credentials, because the domain
  modules are deliberately Firebase-free.
- `scripts/qr-verify.js` (9 checks) - verifies the hand-written QR encoder the
  way a scanner reads it: every function pattern against ISO/IEC 18004, format
  info through its BCH code, mask stripped, blocks de-interleaved, a
  Reed-Solomon syndrome check, and the payload parsed back - across all ten
  supported versions.

## What runs on what

Each screen is built for the device it actually runs on, and the layouts were
measured on those sizes rather than guessed at.

| Screen | Device | What it is tuned for |
|---|---|---|
| `index.html` | Guest's phone, 320-430px | Every control at the 44px a fingertip needs, and each step on one screen where it fits. No horizontal scroll down to 320px. |
| `kitchen.html` | iPad, landscape | One full-height column per state at 1024px and up, a single-row topbar, and chits compact enough that a whole ticket is visible at once. |
| `expo.html` | iPad, either way up | Two ready cards per row from 1024px, single-row topbar. |
| `admin.html`, `report.html` | Laptop | Also printed - see [End of the night](#end-of-the-night). |

Two rules worth knowing before changing any of it. **The kitchen and expo
topbars have to hold one row** - they wrapped to three and ate 115-158px of a
768px-tall iPad, which is rail the cook needs. Anything added there has to earn
its width or drop out below 1400px, which is why the bar's queue/cooking/ready
counts are hidden on a tablet: the lane heads a few centimetres below already
say the same thing. And **`kitchen.css` keeps its media queries at the very
end**, because the file has plain rules after them and an equal-specificity
rule later in the file silently wins.

## Layout

```
index.html  kitchen.html  expo.html  admin.html     the four screens
shared.css  guest.css  kitchen.css  expo.css  admin.css
manifest.webmanifest  sw.js  icon.svg              PWA shell
firestore.rules  firebase.json  .firebaserc        Firebase config
app/
  config.js          every tunable: SLAs, stations, table tags, passcode
  menu.js            the whole menu as data (ingredients, allergens, times)
  cooktime.js        the cook-time model, documented and arguable
  order.js           lifecycle, validation, derived fields, metrics (pure)
  db.js              the only file that knows Firestore exists
  firebase-config.js generated by scripts/setup-firebase.sh
  guest.js  kitchen.js  expo.js  admin.js           screen logic
  art.js             inline SVG glyph set
  qr.js              QR encoder, no dependencies
  ui.js              formatting, storage, chimes, clock-skew correction
  seed.js            demo data
  pwa.js             service worker registration
scripts/             setup, dev server, tests
docs/                architecture, data model, screens, deploy notes
```

## Security posture

Every screen signs in anonymously, and `firestore.rules` requires an auth
token, which blocks drive-by internet traffic. On top of that the rules make an
order's **contents, price and ticket number immutable after creation** - a
client can advance a chit through the lifecycle but cannot rewrite the food or
the amount charged.

What is *not* covered:

- Rules cannot re-run the pricing or cook-time model, so a hand-crafted client
  could create an order whose price disagrees with its contents.
- Any signed-in client can read the whole day's rail.
- The staff passcode ships in `app/config.js`. Anyone can read it.

Closing those properly means moving writes behind Cloud Functions and adding
Firebase App Check, which needs the Blaze plan. The same caveat applies to the
tasteoff app.

## History

Commit `36fb976` and earlier are a Node/Express-style implementation of the same
app (an HTTP server, in-memory store and Server-Sent Events). The domain logic
carried over almost unchanged; `app/db.js` replaced the server. The old
`server.js`, `lib/` and `public/` trees are superseded - remove them with:

```bash
git rm -r lib public seed server.js
```
