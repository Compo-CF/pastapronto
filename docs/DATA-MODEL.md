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
  "id": "ord_8Kd2mQx7Vb",          // opaque; a guest cannot guess another ticket
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

## Persistence

In-memory `Map`, snapshotted to `data/state.json` with a 400ms debounce, and
reloaded on boot so a restart mid-service does not lose the rail or restart
ticket numbering. Correct for one station; see ARCHITECTURE.md for the swap.
