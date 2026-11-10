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
2. Pick a delivery channel and add its values under **Settings > Secrets and variables > Actions**:
   * **Pushover** (recommended): install the app ($5 one time), create an application at pushover.net, then add `PUSHOVER_TOKEN` (application token) and `PUSHOVER_USER` (your user key).
   * **ntfy** (free): install the ntfy app, subscribe to a long random topic name, then add `NTFY_TOPIC`. Anyone who knows the topic name can read it.
   * **Twilio** (real SMS): add `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM` and `TWILIO_TO` (+1XXXXXXXXXX). The sending number has to pass carrier registration (toll free verification or A2P 10DLC) before texts are delivered.
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
