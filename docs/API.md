# API

JSON over HTTP. Every response carries `ok`, and every successful response
carries `serverTime` so clients can correct clock skew. Errors return
`{ ok: false, error: "...", errors?: [...] }`. Request bodies cap at 64KB.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/bootstrap?tag=` | menu, limits, SLAs, stations, table label, clock |
| POST | `/api/members/lookup` | resolve a member number |
| POST | `/api/estimate` | price and cook time for a draft |
| POST | `/api/orders` | submit an order |
| GET | `/api/orders/:id` | guest view of one ticket |
| GET | `/api/kitchen/orders` | the rail (`?station=`, `?scope=all`) |
| POST | `/api/orders/:id/transition` | advance / undo a chit |
| GET | `/api/metrics` | service metrics for today |
| GET | `/api/tags` | table tags plus detected LAN base URL |
| GET | `/api/stream` | Server-Sent Events (`?order=` scopes to one ticket) |
| POST | `/api/demo/seed` | add demo chits |
| POST | `/api/demo/reset` | clear today |

---

## GET /api/bootstrap

Everything a screen needs to render, in one call. `tag` is the QR's table code.

```json
{
  "ok": true,
  "serverTime": "2026-09-09T20:46:18.380Z",
  "venue": { "name": "PastaPronto!", "memberLabel": "Member Number", "currency": "USD" },
  "serviceDate": "2026-09-09",
  "open": true,
  "limits": { "maxGuests": 8, "maxToppingsPerBowl": 4, "maxSidesPerBowl": 2 },
  "sla": { "acceptWarnSec": 60, "acceptLateSec": 120, "cookWarnFactor": 1,
           "cookLateFactor": 1.35, "runnerWarnSec": 60, "runnerLateSec": 150,
           "undoWindowSec": 120 },
  "stations": [ { "id": "PASTA-1", "label": "Pasta 1", "pans": 3 } ],
  "tag": { "id": "table-12", "label": "Table 12", "kind": "table" },
  "tagUnknown": false,
  "menu": { "allergens": [], "pastas": [], "sauces": [], "proteins": [],
            "toppings": [], "sides": [], "portions": [], "spice": [] }
}
```

An unrecognised `tag` returns `tag: null, tagUnknown: true`. The guest is
warned but not blocked.

## POST /api/members/lookup

```json
{ "memberNumber": "10432" }
```

```json
{ "ok": true, "status": "verified", "memberNumber": "10432",
  "name": "Compofelice", "tier": "gold",
  "dietaryNotes": "Shellfish allergy on file", "defaultGuests": 4,
  "message": "Welcome back, Compofelice!" }
```

| `status` | HTTP | Meaning |
| --- | --- | --- |
| `verified` | 200 | found; name and default guest count returned |
| `unverified` | 200 | not in the directory, order still allowed, chit flagged |
| `invalid` | 422 | not 4-6 digits |

Accepting unknown numbers is deliberate: a child mistyping a digit should not
hit a dead end, and the kitchen sees a **Member unverified** badge on the chit.

## POST /api/estimate

Prices and times a draft without creating anything. The server owns these
numbers; the client never asserts them.

```json
{ "lines": [ { "pasta": "shells", "sauce": "butter", "protein": "none",
               "toppings": ["parmesan"], "sides": [], "portion": "kid" } ] }
```

```json
{ "ok": true, "queueDepth": 5, "cookEstimateSec": 650, "promiseSec": 875,
  "subtotal": 7.5,
  "breakdown": {
    "bowls": [ { "dish": "Shells w/ Just Butter", "cookSec": 630 } ],
    "panLoads": 1, "orderCookSec": 650,
    "model": { "pansPerStation": 3, "batchPenaltySec": 120, "platePerBowlSec": 20,
               "queueDragPerOrderSec": 45, "minPromiseSec": 240 } } }
```

## POST /api/orders

```json
{
  "memberNumber": "10432",
  "memberName": "Compofelice",
  "memberStatus": "verified",
  "guestCount": 2,
  "tag": "table-12",
  "source": "qr",
  "avoidAllergens": ["shellfish"],
  "notes": "birthday - candle please",
  "lines": [
    { "guestLabel": "Ada", "pasta": "shells", "sauce": "marinara",
      "protein": "meatballs", "toppings": ["parmesan", "broccoli"], "sides": [],
      "portion": "kid", "spice": "mild", "notes": "" },
    { "guestLabel": "Sam", "pasta": "penne", "sauce": "arrabbiata",
      "protein": "chicken", "toppings": ["mushrooms", "chili"],
      "sides": ["garlic_bread"], "portion": "regular", "spice": "hot",
      "notes": "extra spicy" }
  ]
}
```

**201** returns the guest view: ticket number, claim code, promise time and the
bowls - never staff names, station, or the audit log.

**422** returns every problem at once, in language safe to show a guest:

```json
{ "ok": false, "error": "Please fix these first",
  "errors": ["Member number must be 4 to 6 digits.",
             "Guest count must be between 1 and 8.",
             "Bowl 1: Pick a pasta shape.",
             "Bowl 1: Pick a sauce.",
             "Bowl 1: Pick a portion size."] }
```

**409** if the station is closed.

## GET /api/kitchen/orders

Full chits plus the buttons each one should show right now.

```json
{ "ok": true, "serverTime": "...", "serviceDate": "2026-09-09",
  "orders": [ { "id": "ord_...", "ticketNo": 11, "status": "queued",
                "allowedActions": ["accept", "hold", "rush", "void"] } ],
  "counts": { "total": 14, "queued": 2, "cooking": 3, "ready": 1,
              "delivered": 7, "held": 1, "voided": 0 } }
```

`?station=PASTA-1` filters to one station. `?scope=all` includes delivered and
voided orders for the day.

## POST /api/orders/:id/transition

```json
{ "action": "accept", "actor": "cook:marco", "note": "" }
```

Actions: `accept`, `ready`, `deliver`, `hold`, `release`, `rush`, `void`, and
the undo paths `unaccept`, `unready`, `undeliver`.

**200** returns the updated chit with fresh `allowedActions`.

**409** when the state machine forbids it - including two screens racing on the
same chit. The response says what the chit *can* do, so the client re-syncs
instead of guessing:

```json
{ "ok": false, "error": "Cannot accept an order that is cooking",
  "status": "cooking", "allowed": ["ready", "void", "unaccept"] }
```

**404** unknown id. **400** unknown action.

`undeliver` is only offered inside `sla.undoWindowSec` (120s) of delivery.

## GET /api/metrics

```json
{ "ok": true, "metrics": {
  "serviceDate": "2026-09-09",
  "counts": { "total": 14, "queued": 2, "cooking": 3, "ready": 1,
              "delivered": 7, "held": 1, "voided": 0 },
  "covers": 34, "bowls": 34, "revenue": 540.5,
  "timings": { "avgQueueSec": 62, "avgCookSec": 734, "avgRunnerSec": 51,
               "avgTotalSec": 847, "p90TotalSec": 1132 },
  "onTimePct": 100,
  "byQuarterHour": { "18:45": 3, "19:00": 5 } } }
```

`onTimePct` counts delivered orders whose cook time stayed within
`cookEstimateSec x cookLateFactor`. It is `null` before anything is delivered.

## GET /api/tags

Used by the manager screen to build QR codes that actually resolve from a phone.

```json
{ "ok": true,
  "requestBase": "http://localhost:7070",
  "lanBase": "http://192.168.1.50:7070",
  "lanAddresses": [ { "iface": "Wi-Fi", "address": "192.168.1.50" } ],
  "tags": [ { "id": "table-12", "label": "Table 12", "kind": "table",
              "path": "/t/table-12" } ] }
```

## GET /api/stream

Server-Sent Events. `retry: 2000` plus a comment ping every 20s keeps proxies
from closing the connection.

```
event: hello
data: {"serverTime":"2026-09-09T20:46:18.380Z"}

event: order.created
data: {"order":{...}}

event: order.updated
data: {"order":{...},"action":"accept","from":"queued","actor":"cook:marco"}
```

Event types: `hello`, `order.created`, `order.updated`, `store.reset`,
`store.seeded`.

**`?order=<id>` is the guest subscription.** It forwards only events for that
one ticket and shapes them through the guest view. Without it you get the whole
rail in kitchen shape - keep that on the venue network.

## Demo endpoints

`POST /api/demo/seed` adds a believable rail plus delivered history so the
metrics panel has real averages. `POST /api/demo/reset` clears the current
service date and resets ticket numbering. Both are unauthenticated and should
be removed or gated before this runs anywhere real.

## Try it

```bash
curl -s localhost:7070/api/bootstrap?tag=table-12

curl -s -X POST localhost:7070/api/members/lookup \
  -H 'Content-Type: application/json' -d '{"memberNumber":"10432"}'

curl -s -X POST localhost:7070/api/orders \
  -H 'Content-Type: application/json' -d @seed/examples.json

curl -s localhost:7070/api/kitchen/orders

curl -N -s localhost:7070/api/stream
```
