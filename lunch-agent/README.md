# Cooper lunch text

Every school night, sends tomorrow's John Cooper School lunch menu to your phone.

* Sunday to Thursday nights: tomorrow's entrées, sides and the vegetarian option.
* Friday and Saturday nights: nothing.
* Closed stretches (Thanksgiving week): one "No school" notice with the date the menu resumes, then silence.
* Early release days: a heads up that no lunch is listed.
* Missing month: tells you to load the next menu. From the 22nd, Sunday's text also reminds you if next month is not loaded.

## Files

| File | Purpose |
|---|---|
| `menus/YYYY-MM.json` | One file per month, transcribed from the school's PDF |
| `send-lunch.js` | Picks tomorrow's entry and sends it. No dependencies, Node 18+ |
| `test.js` | Checks the weekend, holiday, early release and month rollover rules |
| `.github/workflows/lunch-text.yml` | Nightly schedule on GitHub Actions |

## Setup (about 15 minutes)

1. Create a **private** GitHub repo (for example `cooper-lunch`) and copy everything in this folder into its root, including `.github/`. GitHub only runs scheduled workflows from a repo's default branch, so this has to be its own repo.
2. Set up Twilio (see "Twilio setup" below) and add four secrets under **Settings > Secrets and variables > Actions**:
   * `TWILIO_SID`: Account SID from the Twilio Console home page (starts with `AC`)
   * `TWILIO_TOKEN`: Auth Token from the same page
   * `TWILIO_FROM`: your Twilio number, for example `+18885551234`
   * `TWILIO_TO`: your cell, for example `+12815551234`

   Pushover (`PUSHOVER_TOKEN`, `PUSHOVER_USER`) and ntfy (`NTFY_TOPIC`) also work if you ever want a backup channel; every channel with secrets set gets the message.
3. Test it: **Actions > Cooper lunch text > Run workflow**, enter a date such as `2026-11-10`, and leave dry run off. You should get Wednesday's menu.

## Monthly refresh

When the new menu PDF arrives, give it to Claude with: "Add this month to `menus/` in the same format as `2026-11.json`, then run `node test.js`." Check the preview with `node send-lunch.js --tonight YYYY-MM-DD --dry-run`, then commit.

Entry formats:

```json
"2026-12-01": { "main": ["Entrée", "Side"], "veg": "Vegetarian entrée" },
"2026-12-18": { "note": "Early Release" },
"2026-12-21": { "closed": "Winter Break" }
```

A weekday with no entry sends "nothing listed on the menu".

## Twilio setup

1. Sign up at twilio.com and upgrade from trial (add a payment method). Trial accounts prefix every message and only text verified numbers.
2. Buy a **toll free** number (Phone Numbers > Buy a number > Toll Free). For one personal recipient this is simpler than local 10DLC registration.
3. Submit **toll free verification** for that number (Messaging > Regulatory Compliance > Toll Free Verification). Describe the use case plainly: "Personal reminder: one nightly text of my child's school lunch menu to my own phone. Recipient is the account owner; opt in is self." Until it is approved, carriers may block or filter the texts.
4. Opt in is you, and replying STOP to the number unsubscribes you (Twilio handles that automatically), so do not reply STOP.

Messages are plain ASCII on purpose: a single non GSM character (like a bullet or curly quote) switches the whole text to a more expensive encoding with 70 character segments. Most nights fit in one or two segments.
