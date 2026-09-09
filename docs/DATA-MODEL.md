# Data model

## Lifecycle

```
            submit          accept           ready            deliver
  (draft) -------> QUEUED --------> COOKING -------> READY ------------> DELIVERED
                    |  ^              |  ^            |  ^                 |
             hold   |  | release      |  | unaccept   |  | unready         | undeliver
                    v  |              |  |            |  |                 | (2 min window)
                    HELD  <-----------+  +------------+  +-----------------+

  Any live status ---- void ----> VOIDED     (comp or mistake; terminal)
```

`rush` is not a status. It raises `priority` and re-sorts the chit to the front
of its lane while leaving the status untouched.

Held orders keep rendering at the foot of the New Orders lane, dimmed, with a
paused clock. An invisible order is a lost order.

## Which clock is showing

Each chit displays the clock for the stage it is in, so the number always
answers "how long has this been *my* problem":

| Status | Timer measures | Warn at | Late at |
| --- | --- | --- | --- |
| `queued` | since `submittedAt` | `sla.acceptWarnSec` (60s) | `sla.acceptLateSec` (120s) |
| `cooking` | since `acceptedAt` | `cookEstimateSec x 1.0` | `cookEstimateSec x 1.35` |
| `ready` | since `readyAt` | `sla.runnerWarnSec` (60s) | `sla.runnerLateSec` (150s) |
| `held` | since `submittedAt`, no escalation | - | - |

## The order object

```jsonc
{
  "id": "aB3xK9…",                  // the Firestore document id
  "ticketNo": 14,                   // human number, resets each service date
  "claimCode": "RL5F",              // 4 chars, shown to the guest for a server
  "serviceDate": "2026-09-09",      // rolls at 4am so a late shift stays on one date

  "memberNumber": "10432",
  "memberName": "Compofelice",
  "memberStatus": "verified",       // verified | unverified
  "memberTier": "gold",

  "guestCount": 2,
  "tag": "table-12",                // which QR was scanned
  "tagLabel": "Table 12",
  "tagKind": "table",               // table | bar | pickup
  "source": "qr",

  "station": "PASTA-1",             // round-robin assigned
  "status": "cooking",
  "priority": "normal",             // normal | rush | allergy

  "createdAt":   "2026-09-09T20:41:02.114Z",
  "submittedAt": "2026-09-09T20:44:18.902Z",
  "acceptedAt":  "2026-09-09T20:45:01.550Z",
  "readyAt":     null,
  "deliveredAt": null,
  "heldAt": null, "releasedAt": null, "rushedAt": null, "voidedAt": null,

  "acceptedBy": "cook:marco",
  "readyBy": null,
  "deliveredBy": null,

  "lines": [
    {
      "lineId": "ln01",
      "guestLabel": "Ada",           // free text, or "Guest 1"
      "pasta": "shells",
      "sauce": "marinara",
      "protein": "meatballs",        // "none" is a real value, not null
      "toppings": ["parmesan", "broccoli"],
      "sides": [],
      "portion": "kid",              // kid | regular | large
      "spice": "mild",               // mild | medium | hot
      "notes": "sauce on the side",
      "allergens": ["gluten", "dairy", "egg"],   // derived
      "cookSec": 630,                             // derived
      "price": 9.0,                               // derived
      "dish": "Shells w/ Marinara + Meatballs"    // derived, for chits
    }
  ],

  "allergenFlags": ["gluten", "dairy", "egg"],   // union across all bowls
  "avoidAllergens": ["shellfish"],               // what the guest asked to avoid
  "notes": "birthday - candle please",

  "cookEstimateSec": 1130,          // from ACCEPT; what the kitchen SLA grades
  "promiseSec": 1355,               // what the guest was told (adds queue drag)
  "promisedReadyAt": "2026-09-09T21:06:53.902Z",
  "totalPrice": 33.5,

  "events": [                       // append-only audit trail
    { "at": "...", "action": "submit", "from": null,     "to": "queued",  "actor": "guest",      "note": "" },
    { "at": "...", "action": "accept", "from": "queued", "to": "cooking", "actor": "cook:marco", "note": "" }
  ]
}
```

Derived fields (`allergens`, `cookSec`, `price`, `dish`, `allergenFlags`,
`cookEstimateSec`, `promiseSec`, `totalPrice`) are computed server-side at
submit. The client never gets to assert a price or a cook time.

## Cook-time model

Defined in `lib/cooktime.js` and deliberately explicit so a chef can argue
with the numbers in one place.

**One bowl:**

```
cookSec = max(
  boil(pasta) + finish(sauce) + add(protein) + prep(toppings) + extra(portion),
  slowest side          // sides bake in parallel with the boil
)
```

**A whole order** is not the sum of its bowls, because a station boils several
pans at once:

```
orderCookSec = slowest bowl
             + (ceil(bowls / pansPerStation) - 1) * batchPenaltySec
             + bowls * platePerBowlSec

pansPerStation   3
batchPenaltySec  120
platePerBowlSec  20
```

One bowl of rigatoni bolognese comes out at 12:50; six of them at 16:30, not
the 75:00 a naive sum would predict. Full curve for that bowl:

| Bowls | Estimate | Naive sum |
| --- | --- | --- |
| 1 | 12:50 | 12:30 |
| 3 | 13:30 | 37:30 |
| 4 | 15:50 | 50:00 |
| 6 | 16:30 | 75:00 |
| 8 | 19:10 | 100:00 |

The jump at four bowls is the second pan load. `scripts/selftest.js` asserts
this stays sub-linear.

**What the guest is told** adds the queue ahead of them, and is kept separate
from the kitchen's SLA on purpose: the kitchen is graded on cook time, not on
how busy the dining room was.

```
promiseSec = max(240, orderCookSec + queueDepth * 45)
```

## Menu item contract

Every ingredient in `lib/menu.js` carries:

| Field | Meaning |
| --- | --- |
| `id` | stable key stored on the order; never rename |
| `name` | guest-facing label |
| `shape` / `icon` | art key resolved to an inline SVG by `app/art.js` |
| `allergens` | subset of `ALLERGENS` ids |
| `kid` | shows in the short simple-mode tile set |
| `boilSec` / `finishSec` / `addSec` / `cookSec` | contribution to the cook clock |
| `price` | upcharge; portion carries the base price |

Allergen ids: `gluten`, `dairy`, `egg`, `tree_nuts`, `shellfish`, `pork`, `soy`.

## Firestore layout

```
orders/{orderId}          one document per order - the whole chit
counters/{serviceDate}    { lastTicket, serviceDate } - allocates ticket numbers
members/{memberNumber}    { name, tier, dietaryNotes, defaultGuests }
```

Two extra fields exist on the stored document that the pure model does not
produce:

| Field | Written by | Why |
| --- | --- | --- |
| `submittedAtServer` | `serverTimestamp()` | Firestore's own clock. Compared against `submittedAt` to learn a device's clock error, so elapsed timers are right on a tablet with a wrong clock. |
| `createdBy` | the anonymous auth uid | Which device sent it. Useful for support ("the phone at table 12"). |
| `demo` | the seeder | Marks demo rows so they are obvious in the console. |

### Queries

Every screen uses exactly one query:

```js
query(collection(db, 'orders'), where('serviceDate', '==', serviceDate()))
```

Filtering by status and station, and all sorting, happens in memory. A service
day is tens to a few hundred documents, so this is cheaper than the alternative
and needs **no composite indexes** - `firestore.indexes.json` is empty on
purpose. If a venue ever runs thousands of orders a day, that is the first thing
to revisit.

### Ticket numbering

`counters/{serviceDate}` holds `lastTicket`. `db.submitOrder()` reads it,
adds one, and writes both the counter and the new order **in a single
transaction**, so two phones ordering in the same instant cannot take the same
number - one transaction simply retries.

### Concurrency

`db.transition()` is also a transaction: it re-reads the order, runs
`order.transitionPatch()` against the state Firestore currently holds, and
writes the patch. Two cooks pressing **Accept** on the same chit produce one
accept and one `ILLEGAL_TRANSITION` - the Firestore equivalent of the HTTP 409
the Node version returned.

## What the rules enforce

`firestore.rules` requires an auth token for everything (every screen signs in
anonymously on load), and on top of that:

| Rule | Effect |
| --- | --- |
| `validNewOrder()` | a new order must arrive as `queued`, with a 4-6 digit member number, 1-8 guests, 1-8 bowls, a positive ticket number and estimate, and exactly one audit entry |
| `contentsUnchanged()` | after creation, `ticketNo`, `claimCode`, `memberNumber`, `guestCount`, `lines`, `totalPrice`, `cookEstimateSec`, `submittedAt` and `tag` are **immutable** |
| `validUpdate()` | status must be a known value, and the `events` array can only grow |

So a client can walk a chit through its lifecycle, but cannot rewrite the food
or the amount charged after the fact.

**Not** enforced: the rules cannot re-run the pricing or cook-time model, so a
hand-crafted client could create an order whose price disagrees with its
contents. Fixing that means moving `buildOrder` behind a Cloud Function.

## Offline behaviour

`initializeFirestore` uses `persistentLocalCache` with
`persistentMultipleTabManager`, so every device keeps an IndexedDB copy:

- a guest can complete and send an order with no signal; the write queues and
  syncs when the connection returns
- the kitchen rail keeps rendering from cache through a dropout, and catches up
  on reconnect
- multiple tabs on the same device share one cache without fighting over it
