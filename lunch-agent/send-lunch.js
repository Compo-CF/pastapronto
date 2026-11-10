#!/usr/bin/env node
// Sends tomorrow's John Cooper School lunch menu the night before.
//
// Usage:
//   node send-lunch.js                     # real run, "tonight" = now in school time zone
//   node send-lunch.js --dry-run           # print the message, send nothing
//   node send-lunch.js --tonight 2026-11-10 --dry-run
//
// Delivery: every channel whose secrets are set is used. With none set, it prints only.
//   Pushover : PUSHOVER_TOKEN, PUSHOVER_USER
//   ntfy     : NTFY_TOPIC (optional NTFY_SERVER, default https://ntfy.sh)
//   Twilio   : TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, TWILIO_TO
//   Console  : always

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TZ = process.env.LUNCH_TZ || 'America/Chicago';
const MENU_DIR = join(dirname(fileURLToPath(import.meta.url)), 'menus');
const REMIND_FROM_DAY = 22; // start nagging for next month's menu on this date

// ---------- dates (all as YYYY-MM-DD strings, no time zone drift) ----------

export function todayIn(tz, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const dow = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay(); // 0 Sun .. 6 Sat
const isWeekday = (iso) => dow(iso) >= 1 && dow(iso) <= 5;

export function label(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------- menu lookup ----------

export function loadMonth(ym, dir = MENU_DIR) {
  const f = join(dir, `${ym}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

function entryFor(iso, dir) {
  const m = loadMonth(iso.slice(0, 7), dir);
  if (!m) return { missing: true };
  return m.days[iso] || { none: true };
}

// ---------- the decision: what (if anything) to send tonight ----------

export function buildMessage(tonight, dir = MENU_DIR) {
  const tomorrow = addDays(tonight, 1);
  if (!isWeekday(tomorrow)) return null; // Fri/Sat nights: nothing. Sunday night covers Monday.

  const e = entryFor(tomorrow, dir);
  const when = label(tomorrow);
  let lines;

  if (e.missing) {
    lines = [`Cooper lunch: no menu loaded for ${when}.`, `Upload the ${tomorrow.slice(0, 7)} lunch PDF so texts keep coming.`];
  } else if (e.closed) {
    // Only announce the first closed day of a run (Thanksgiving week = one text, not five).
    const prev = previousWeekday(tomorrow);
    const prevEntry = entryFor(prev, dir);
    if (prevEntry.closed) return null;
    const back = nextOpenDay(tomorrow, dir);
    lines = [`No school ${when}: ${e.closed}.`];
    if (back) lines.push(`Lunch menu resumes ${label(back)}.`);
  } else if (e.note && !e.main) {
    lines = [`Cooper lunch ${when}: ${e.note}.`, 'No lunch is listed on the menu. Plan accordingly.'];
  } else if (e.none) {
    lines = [`Cooper lunch ${when}: nothing listed on the menu.`];
  } else {
    lines = [`Cooper lunch ${when}`, ...e.main.map((x) => `- ${x}`)];
    if (e.veg) lines.push(`Veg: ${e.veg}`);
    if (e.note) lines.push(e.note);
  }

  // Late in the month, flag a missing next-month file once a week (Sunday night) so it is not a surprise.
  const nextYm = addDays(tonight.slice(0, 7) + '-28', 7).slice(0, 7);
  if (Number(tonight.slice(8)) >= REMIND_FROM_DAY && dow(tonight) === 0 && !loadMonth(nextYm, dir) && !e.missing) {
    lines.push('', `Reminder: the ${nextYm} menu is not loaded yet.`);
  }
  return lines.join('\n');
}

function previousWeekday(iso) {
  let d = addDays(iso, -1);
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}

function nextOpenDay(iso, dir) {
  let d = iso;
  for (let i = 0; i < 21; i++) {
    d = addDays(d, 1);
    if (!isWeekday(d)) continue;
    const e = entryFor(d, dir);
    if (e.missing) return null;
    if (e.main) return d;
  }
  return null;
}

// ---------- delivery ----------

async function post(url, body, headers = {}) {
  const res = await fetch(url, { method: 'POST', body, headers });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${await res.text()}`);
}

const channels = {
  pushover: {
    ready: (e) => e.PUSHOVER_TOKEN && e.PUSHOVER_USER,
    send: (msg, e) => post('https://api.pushover.net/1/messages.json',
      new URLSearchParams({ token: e.PUSHOVER_TOKEN, user: e.PUSHOVER_USER, title: 'Cooper lunch', message: msg })),
  },
  ntfy: {
    ready: (e) => e.NTFY_TOPIC,
    send: (msg, e) => post(`${e.NTFY_SERVER || 'https://ntfy.sh'}/${e.NTFY_TOPIC}`, msg, { Title: 'Cooper lunch' }),
  },
  twilio: {
    ready: (e) => e.TWILIO_SID && e.TWILIO_TOKEN && e.TWILIO_FROM && e.TWILIO_TO,
    send: (msg, e) => post(`https://api.twilio.com/2010-04-01/Accounts/${e.TWILIO_SID}/Messages.json`,
      new URLSearchParams({ From: e.TWILIO_FROM, To: e.TWILIO_TO, Body: msg }),
      { Authorization: 'Basic ' + Buffer.from(`${e.TWILIO_SID}:${e.TWILIO_TOKEN}`).toString('base64') }),
  },
};

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const i = args.indexOf('--tonight');
  const tonight = (i >= 0 && args[i + 1]) || process.env.TONIGHT || todayIn(TZ);

  const msg = buildMessage(tonight);
  if (!msg) { console.log(`${tonight}: nothing to send tonight.`); return; }
  console.log(`--- ${tonight} ---\n${msg}\n`);
  if (dry) return;

  const live = Object.entries(channels).filter(([, c]) => c.ready(process.env));
  if (!live.length) { console.log('No delivery secrets set; printed only.'); return; }
  const results = await Promise.allSettled(live.map(([, c]) => c.send(msg, process.env)));
  results.forEach((r, k) => console.log(`${live[k][0]}: ${r.status === 'fulfilled' ? 'sent' : r.reason.message}`));
  if (results.every((r) => r.status === 'rejected')) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
