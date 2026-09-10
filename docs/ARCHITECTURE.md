# Architecture

## The whole system in one picture

```
   [ printed QR tent ]
      ?t=table-12
          |  phone camera
          v
   index.html?t=table-12   (a static file - GitHub Pages / Firebase Hosting)
          |
          |  app/config.js + app/menu.js  ->  the old GET /api/bootstrap,
          |                                   now assembled on the device
          v
   +----------------------+
   |  Guest app           |  db.lookupMember()  -> members/{number}
   |  app/guest.js        |  app/cooktime.js    -> price + cook time
   +----------------------+  db.submitOrder()   -> transaction
          |                                  |
          |                                  v
          |                     Firestore transaction
          |                   read counters/{date}, +1 ticket,
          |                   write orders/{id} with derived
          |                   fields from app/order.js
          |                                  |
          |            +---------------------+---------------------+
          |            |                                           |
          |   onSnapshot(doc)                          onSnapshot(query)
          |   one ticket only                          whole service day
          v            |                                           |
   live status track   |                                    +------------------+
   queued -> ready  <--+                                    | Kitchen  kitchen |
                                                            | Expo     expo    |
                                                            | Manager  admin   |
                                                            +------------------+
                                                                     |
                                                          db.transition()
                                                                     |
                                                     Firestore transaction:
                                                   read the doc, run the state
                                                   machine against *current*
                                                   server state, write the patch
                                                                     |
                                             every listener updates in ~200ms
```

The loop closes without a server: a cook pressing **Accept** changes the
guest's phone in a few hundred milliseconds, over the same Firestore listener
that redraws the other kitchen screens.

## What replaced what

| Was (Node) | Now |
| --- | --- |
| `server.js` HTTP server | nothing - static files |
| `GET /api/bootstrap` | `app/config.js` + `app/menu.js`, read on the device |
| `GET /api/stream` (SSE) | `onSnapshot` listeners |
| `POST /api/orders` | `db.submitOrder()` in a Firestore transaction |
| `POST /api/orders/:id/transition` | `db.transition()` in a transaction |
| HTTP `409 Conflict` | transaction re-read plus `ILLEGAL_TRANSITION` |
| `lib/store.js` in-memory Map | the `orders` collection |
| `data/state.json` snapshot | Firestore, plus an IndexedDB cache per device |
| `GET /api/metrics` | `order.metrics()` over the live snapshot |
| no auth on `/kitchen` | anonymous auth, rules, and a staff passcode gate |

## Why these choices

**The domain layer has no Firebase import.** `app/menu.js`, `app/cooktime.js`
and `app/order.js` are pure functions over plain objects. That is what lets
`scripts/selftest.js` run the entire state machine under Node with no emulator,
no network and no credentials - 19 checks in about a second. `app/db.js` is the
only file that knows Firestore exists.

**Transactions, not last-write-wins.** `db.transition()` re-reads the order
inside a transaction and runs `order.transitionPatch()` against the *current*
server state. Two screens racing on the same chit produce one winner and one
`ILLEGAL_TRANSITION`; the loser re-syncs from its listener instead of clobbering
the winner. Ticket numbering works the same way against `counters/{date}`, so
two phones ordering in the same instant cannot collide on a number.

**Derived fields are computed, never trusted.** Prices, cook times, allergen
sets and dish text are recomputed in `order.buildOrder()` from the ingredient
ids. A client that posts `totalPrice: 0.01` gets the real price stored. There is
a test for exactly that.

**One listener per screen, filtered in memory.** Every screen subscribes to
`orders where serviceDate == today` and does its own filtering and sorting. A
service day is tens to a few hundred documents, so this is cheap - and it means
no composite indexes to deploy and keep in sync, which is why
`firestore.indexes.json` is empty on purpose.

**Offline-first.** `persistentLocalCache` with multi-tab support means a guest
on bad hotel wifi can still send an order - the write queues and syncs - and the
kitchen rail survives a blip. Firestore handles the queue; there is no
hand-rolled retry anywhere in this codebase.

**Clock skew is corrected from data we already write.** Each order carries both
`submittedAt` (an ISO string from the ordering device) and `submittedAtServer`
(Firestore's `serverTimestamp()`). The gap between them is that device's clock
error, so `ui.noteClockSkew()` learns it from the first resolved pair and
corrects every elapsed timer on the screen. A tablet with a wrong clock still
shows the right cook time.

**Timers tick without re-rendering.** The kitchen updates only the timer text
and colour band each second. Re-rendering a chit would move the button a cook
was reaching for.

**Relative asset paths everywhere.** GitHub Pages serves from a `/pastapronto/`
subpath, so an absolute `/shared.css` would 404. Every link, script and the
service worker registration use relative URLs, which is also what lets the same
files run from Firebase Hosting at a domain root.

## The QR routing change

A static host has no request routing, so the old `/t/table-12` path cannot
resolve. Tables now travel as a query parameter:

```
https://compo-cf.github.io/pastapronto/?t=table-12
```

`app/guest.js` reads `?t=`, and still honours a legacy `/t/<tag>` path if an old
link turns up. The manager screen builds codes from whatever address the page
itself was opened at, which is by definition an address a phone can reach.

These URLs are longer than the old localhost ones, which pushes the codes from
QR version 3 to version 4 (33x33 modules). `scripts/qr-verify.js` tests the real
deployed URLs for exactly that reason.

## Failure behaviour

| Failure | What happens |
| --- | --- |
| Connection drops | Firestore retries and resyncs itself; the header dot shows `offline` |
| Two screens act on one chit | first wins; second gets `ILLEGAL_TRANSITION` and re-syncs |
| Guest submits an invalid bowl | `VALIDATION` error, plain-English messages shown verbatim |
| Guest offline at send | the write queues in IndexedDB and syncs when signal returns |
| Unknown member number | accepted as `unverified` and badged on the chit - a child mistyping a digit still gets fed |
| Unknown table code | order still accepted, `tagLabel` falls back, guest told to ask a server |
| Firebase not configured | every screen says so plainly instead of white-screening |
| Service worker fails | caught and logged; the app works without it |

## Pasta and pizza

`kind` lives on the order (and is copied to every line). It decides three
things: which build wizard the guest sees, which catalog groups the sauces and
toppings come from (`menu.GROUPS_FOR`), and which pool of stations the ticket
can be routed to. Stations declare the kind they cook, so routing is a filter
rather than a convention.

The two share the entire state machine, chit rail, expo board and report. What
differs is confined to the menu data and one branch in `cooktime.js`, because
the batching is genuinely different: pasta runs three pans that turn over, pizza
runs a two-deck oven holding one pie each. That single fact is why six pizzas
take longer than six bowls, and why it would be wrong to reuse one model.

`menu.kindOf()` defaults to `'pasta'` when a document has no `kind`, so orders
written before this shipped keep rendering.

**One order is one kind.** That is a deliberate simplification, and the one
place it shows is a table wanting pasta and pizza together: they send two
orders. Supporting a single mixed ticket properly means per-station sub-status
on the order - each station accepting and bumping its own lines, and the order
only reaching `ready` when both are done - which touches the state machine, the
rules, the kitchen rail and expo. It is the right design for a bigger kitchen;
it is not a small edit.

## Where to go next

| Concern | How |
| --- | --- |
| Price integrity | move `buildOrder` into a Cloud Function (Blaze plan) |
| Guests can read the rail | split staff reads behind custom claims or Functions |
| Bot traffic | Firebase App Check |
| Real member directory | replace `members/{number}` with a POS sync; `db.lookupMember()` is the seam |
| Payment | charges post against `memberNumber` today; nothing is captured |
