# PastaPresto!

QR-to-kitchen pasta ordering. A guest scans the code on their table, builds a
bowl per person from a limited ingredient set, and it lands as a chit on the
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
