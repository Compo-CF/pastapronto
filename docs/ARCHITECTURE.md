# Architecture

## The whole system in one picture

```
   [ printed QR tent ]
      table-12
          |  phone camera
          v
   GET /t/table-12  ------------------>  server.js
          |                                 |
          |  GET /api/bootstrap?tag=table-12
          |  (menu, limits, SLAs, tag label, server clock)
          v
   +---------------------+
   |  Guest app          |   POST /api/members/lookup
   |  public/app/guest.js|   POST /api/estimate     (price + cook time)
   +---------------------+   POST /api/orders       (submit)
          |                                 |
          |                                 v
          |                          lib/store.js
          |                        validate -> assign
          |                        ticket no, station,
          |                        cook estimate, price
          |                                 |
          |                                 v
          |                            lib/bus.js
          |                        publish order.created
          |                        /                   \
          |          GET /api/stream?order=<id>     GET /api/stream
          |          (this ticket only)             (whole rail)
          v                  |                            |
   live status track         |                            v
   "cooking" -> "ready"  <---+                    +------------------+
                                                  | Kitchen  /kitchen|
                                                  | Expo     /expo   |
                                                  | Manager  /admin  |
                                                  +------------------+
                                                          |
                                        POST /api/orders/<id>/transition
                                        { action: accept | ready | deliver
                                          | hold | release | rush | void
                                          | unaccept | unready | undeliver }
                                                          |
                                                          v
                                                  lib/store.js
                                             state machine gate, audit
                                             entry, publish order.updated
                                                          |
                                        broadcast back to every screen
```

The loop closes: a cook pressing **Accept** changes the guest's phone within
a few hundred milliseconds, over the same event stream that redraws the other
kitchen screens. Nobody polls, nobody refreshes.

## Why these choices

**Zero dependencies, no build step.** A pasta station cannot wait on an npm
install or a broken toolchain during service. `node server.js` is the whole
deployment. It also means the QR encoder and the SVG glyph set are written out
in `public/app/` rather than pulled from a CDN, so the app works on a venue
network with no internet.

**Server-Sent Events, not WebSockets.** The traffic is one-directional
(server tells screens what changed) and SSE reconnects by itself, which matters
on hotel wifi. Actions travel as ordinary POSTs, so every mutation gets a real
HTTP status code a client can reason about.

**Guests get a filtered stream.** `/api/stream?order=<id>` only forwards events
for that one ticket, and shapes them through `publicOrder()`, which strips
staff names, station, member tier, and the audit log. A guest watching their
pasta cannot enumerate the room.

**The menu is data, not markup.** `lib/menu.js` is the single source for the
guest tiles, the chit lines, the printed menu reference, the allergen roll-up,
and the cook-time model. Adding a sauce is one line and no UI edits.

**The state machine is a table.** `TRANSITIONS` in `lib/store.js` declares
which actions are legal from which statuses. Buttons are generated from
`allowedActions(order)`, so the UI cannot offer an illegal move, and the
server re-checks anyway - two cooks double-tapping **Accept** produces one
accept and one honest 409.

**Every action is reversible.** Undo paths (`unaccept`, `unready`,
`undeliver`) are first-class transitions, not mutations, so a mis-tap during a
rush is recoverable and still appears in the audit trail. Nothing in the
kitchen needs a confirmation dialog.

**Timers tick without re-rendering.** The kitchen updates only the timer text
and colour band each second. Re-rendering a chit under a cook's finger would
move the button they were reaching for.

**Clocks are server-corrected.** Every API response carries `serverTime`; the
client stores the offset and computes elapsed time from it. A tablet with a
wrong clock still shows the right cook time.

## Two audiences, one app

The guest app runs in `simple` or `pro` mode, toggled in the header and
remembered per device.

| | simple (default) | pro |
| --- | --- | --- |
| Tile sets | kid-friendly subset, "Show all N" reveals the rest | everything |
| Steps per bowl | 4 taps, auto-advancing | same, plus detail panel |
| Spice, notes, per-bowl names | hidden | shown |
| Allergen avoidance | one-line prompt | full chip filter |
| Tile metadata | price only | price, cook time, GF, spicy |

Allergen conflicts never silently hide a choice. The tile stays visible,
disabled, and captioned with what it contains, so a parent can see *why* the
thing their child wants is unavailable.

## Failure behaviour

| Failure | What happens |
| --- | --- |
| SSE drops | client reconnects with backoff; kitchen also polls every 60s so the rail can never silently freeze |
| Server restarts | `data/state.json` restores orders and ticket numbers |
| Two screens act on one chit | first wins; second gets 409 and re-syncs |
| Guest submits an invalid bowl | 422 with plain-English messages shown verbatim |
| Unknown member number | accepted as `unverified`, flagged on the chit - a child mistyping a digit still gets fed |
| Unknown table code | order still accepted, `tagLabel` falls back, guest warned to ask a server |
| `/api/estimate` unreachable | review screen falls back to a locally computed subtotal |

## Where to swap in real infrastructure

| Concern | File | Replace with |
| --- | --- | --- |
| Orders, tickets | `lib/store.js` | Postgres; keep `TRANSITIONS` as the gate |
| Fan-out | `lib/bus.js` | Redis pub/sub for multi-node |
| Members | `lib/members.js` | POS / CRM lookup; the return shape is the contract |
| Menu | `lib/menu.js` | menu service, same field names |
| Payment | not present | charge posts against `memberNumber` today |
