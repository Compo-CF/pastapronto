# Screens

## 1. Guest order - `index.html?t=<tag>`

Five screens, one state object, delegated events. `app/guest.js`.

```
 member -> lane -> guests -> build (x N items) -> review -> sent
                               |                    |
                               +---- Change --------+
```

### member
Where the QR code lands. A green confirmation of which table the code came from
("You are at Table 12"), or an amber "Scan the QR code at your table" if the
code is unknown, then the keypad, then four numbered how-it-works steps.

The member number is asked before anything else. Two reasons: it is the one
answer a guest can give before deciding anything, and knowing who is at the
table is what lets the next screen greet them by name. No Back button - there
is nowhere behind it.

### lane
"What are we making?", with **Build your Pasta** and **Build your Pizza**.

Its kicker is the greeting, not a step number: a recognised member sees
"Buonasera, Compofelice Party!" above the question. An unrecognised number
falls back to the venue name, so the screen never looks broken for a guest
whose number is not on the roster yet.

### member
Big keypad display and a 3x4 keypad - no system keyboard, so a child never
lands in autocorrect. Physical digits and Backspace also work. **Next**
unlocks at 4 digits.

- verified: green "Buonasera, Compofelice Party!" - the directory holds
  family names, so the greeting addresses the party - and the guest count pre-fills
  from the member record
- unverified: amber note that a server will confirm; the order proceeds
- invalid: red message, cannot continue

### guests
Tiles 1-8 with stacked-people glyphs (four figures max, then "+N"). In pro
mode an allergen chip panel appears; in simple mode a single link,
"Someone has a food allergy?", switches to pro. Button reads **Build 4 bowls**.

### build - the core loop
A bowl tab strip across the top (per-guest, marked *building* / *ready*) and a
five-step underline: Pasta, Sauce, Protein, Toppings, Size.

Single-choice steps (pasta, protein, size) **advance automatically** - one tap
and you are on the next step, no Next button to hunt for.

Sauce and toppings are multi-select, so **Next** is explicit there. A bowl takes
up to three sauces; the sub-heading changes from "Pick one, or tap two to mix
them" to "Mixing 2 sauces - tap Next when you are happy", and Next stays
disabled until at least one is chosen. Two sauces cost the slowest of them plus
20s of handling, not the sum, so a half-and-half bowl is not over-quoted.

Simple mode shows the kid subset (5 pastas, 4 sauces, 4 toppings) with a
**Show all N choices** button. Pro mode shows everything plus cook times, GF
and spicy markers, and a detail panel for name, spice level and bowl notes.

Any tile clashing with an avoided allergen stays visible but disabled and
captioned "has Dairy" - a parent can see why the thing their kid wants is out.
An ingredient the kitchen has 86'd behaves the same way, captioned **sold out**,
and updates live if it goes out mid-build.

### review
One card per bowl with its pasta glyph, dish line, extras and a **Change**
button. An allergen roll-up for the whole order, then bowls, guests, table and
the cook time - which sits where a total would on a till receipt, because
nothing here is priced. **Send to the kitchen** is green and full-width.

If an ingredient was 86'd while the guest sat on this screen, Send is refused
with the ingredient named ("Bowl 1: Marinara just sold out - please pick
something else") and no ticket is created.

### sent
Ticket number at display size, a 4-character claim code for staff, and a
four-segment progress track (Sent / Cooking / Ready / Enjoy) with the current
segment animating. Live over SSE, scoped to this one ticket:

| Status | Headline | Extra |
| --- | --- | --- |
| queued | Sent to the kitchen! | "Ready in about 15 min" |
| cooking | Your pasta is cooking | steaming-pot animation |
| ready | Ready! | green pulsing "Ticket #14 is up!", chime + vibrate |
| delivered | Buon appetito! | offers another round |

**Start another order** returns to the **lane** screen, not the keypad. The
same party is still at the same table and has already identified itself, so it
picks pasta or pizza and goes. That is the common second order - the table that
just had pasta now wants a pizza - and under AYCE it adds nothing to their
bill, so the path should be short. A guest who somehow has no member on file
is sent back to the keypad instead.

## 2. Kitchen chit rail - `kitchen.html`

Dark, dense, readable at 6-8 feet. `app/kitchen.js`. Behind the staff
passcode gate, like expo and manager.

Three lanes: **New Orders**, **Cooking**, **Ready - Call Runner**. The header
carries live counts, a station filter, a sound toggle, the clock and a
connection dot. Held orders sit dimmed at the foot of New Orders with a paused
clock and a **Back to queue** button.

### The chit

```
+--------------------------------------------------+
| [1]  #11    Cabana 3              12:45          |   bump key, ticket,
|             Petrov - 61234                       |   where, member, timer
| RUSH  PASTA-1  2 GUESTS                          |   badges
| ALLERGY - must avoid Dairy                       |   red banner
|--------------------------------------------------|
| (art) ANA (DF)                                   |
|       Spaghetti w/ Marinara + Grilled Chicken    |
|       Fresh Basil                                |
|       REGULAR - GLUTEN                           |
|       ! NO DAIRY - no parm                       |   amber bowl note
|--------------------------------------------------|
| (art) DMITRI                                     |
|       Rigatoni w/ Bolognese                      |
|       Parmesan - SIDE: Garlic Bread              |
|       LARGE - MEDIUM - GLUTEN/DAIRY              |
|--------------------------------------------------|
| Ana is dairy free                                |   order note
|--------------------------------------------------|
|         Accept          | undo | rush | hold     |
+--------------------------------------------------+
```

The left border and the timer escalate on the SLA for the current stage (see
DATA-MODEL.md). A late timer blinks. Rush and allergy chits sort to the front
of their lane.

### Keyboard (bump bar)

| Key | Action |
| --- | --- |
| 1-9 | send the numbered chit forward (accept / food up / delivered) |
| Shift + 1-9 | undo that chit's last step |
| H | hold or release the selected chit |
| R | mark the selected chit rush |
| S | toggle alert sounds |
| Esc | clear selection |

Numbers run across the whole rail, left lane first, and re-flow as chits move.
Click a chit to select it; click again to deselect.

Timers update in place every second - a chit is never re-rendered under a
cook's finger. Sounds are synthesised, so there are no audio files to ship: a
two-note rise for a new order, a triple chime for food up, a low double tone
when a chit goes late.

## 3. Expo / runner board - `expo.html`

Deliberately narrower than the kitchen screen: a runner carrying four bowls
needs the ticket number, the destination, what is on the tray, and one button.

Large **Run These Now** cards, oldest first, with a runner-wait timer that goes
amber at 60s and red with a nudge animation at 150s. Allergy orders repeat the
warning so it gets confirmed at the table. One button per card:
**Delivered to Table 3**.

A **Coming Up** sidebar lists cooking orders with a countdown against their
estimate, flipping to red "over 4:28" when a cook is running behind - so expo
can warn a table before it complains.

## 4. Manager - `admin.html`

**Today at a glance** - eight stat tiles: orders, covers, open now, average wait
to accept, average cook time, average runner time, p90 ticket time and on-time
percentage (green at 90 or above, red below 75). No revenue tile: the app never
handles money. Refreshes on every order event.

**QR codes** - a base-address field pre-filled with the detected LAN address,
because a QR pointing at localhost is useless on a phone. Codes are generated
in the browser by `app/qr.js`, so no external service ever sees the venue's
URLs and it works with the internet unplugged. The footnote states the QR
version and that error-correction level M recovers roughly 15% damage - which
matters for a card that will eventually collect marinara.

**Print table tents** - one page per tag with the brand, table name, a 105mm
code, instructions, and a fold line. Codes are built from whatever address the
manager screen was opened at, so printing from the deployed URL prints codes
that resolve from a phone.

**Menu, cook times and the 86 list** - the full catalog as tables with allergen
codes and stage times, straight from `app/menu.js`, so the chef's reference
cannot drift from what the guest app offers. Each row carries an **86** switch:
flip it and the ingredient shows as sold out on every guest phone, with a
summary strip above listing everything currently off.

Boil times shown are for parcooked pasta - finish-to-order, not from-dry.

**Demo controls** - seed a believable rail (and the member directory), or clear
the day. Clearing asks for confirmation, because it deletes documents.

## 5. Close-out report - `report.html`

What a manager reads at the end of service, and the only screen that looks at
past dates - everything else is scoped to today.

A date picker (plus **Tonight** / **Yesterday**), then: headline tiles; a
**bowls per 15 minutes** bar chart with the peak directly labelled; **what
sold** as counts per group, which is the section that drives tomorrow's prep;
**late tickets** worst-first with estimate vs actual and how far over; a
per-station split; and **exceptions to follow up** - voids, orders left on
hold, rushes, allergy orders with what was avoided, and unverified member
numbers whose charge needs confirming.

**Download CSV** stacks every section into one file with proper quoting.
**Print** uses its own stylesheet, so sections do not break across pages.

Chart notes: one series, so there is no legend - the heading names it - and only
the peak carries a value label rather than every bar. Each column has a hover
tooltip, and a `Show as a table` disclosure carries the identical numbers for
anyone who cannot read the chart.

All the arithmetic is `order.shiftReport()`, a pure function covered by
`scripts/selftest.js`, so the page only renders.

## Accessibility and input

- Touch targets are at least 60px; primary buttons 76px
- Selected state is a ring plus a check mark, never colour alone
- `aria-pressed` on every tile and chip, `aria-current` on step indicators
- Live regions announce toasts and status changes
- Full keyboard operation on the kitchen screen
- `prefers-reduced-motion` disables the pot steam, progress crawl, late blink
  and runner nudge animations
- The guest app reflows to one column below 430px, where the decorative
  progress dots drop out first - the step kicker already says "Step 2 of 4"
