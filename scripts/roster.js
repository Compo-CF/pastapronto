/**
 * Read the club's member roster.
 *
 *   node scripts/roster.js            summary, and every row the app would refuse
 *   node scripts/roster.js 1794       look one number up
 *   node scripts/roster.js --json     the Firestore `members` payload, to stdout
 *
 * The roster is 700-odd real families and their account numbers, so it lives in
 * private/, which is outside git and outside what Firebase Hosting uploads. This
 * script is the only thing that reads it, and it prints rather than writes: the
 * decision to put real names into Firestore is a separate one, taken knowingly.
 *
 * The number a guest types is normalised by the app, not here - normalizeMemberNumber
 * is imported rather than reimplemented, because a roster that disagreed with the
 * keypad about what "0042" means would resolve half the club to nobody.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as order from '../app/order.js';

const CSV = fileURLToPath(new URL('../private/members.csv', import.meta.url));

/** Minimal RFC-4180 reader: the club's export quotes any name holding a comma. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') { field += ch; continue; }
      if (text[i + 1] === '"') { field += '"'; i += 1; continue; }
      quoted = false;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function load(path = CSV) {
  if (!existsSync(path)) {
    throw new Error('No roster at ' + path + '. It is deliberately not in git - '
      + 'convert the club\'s latest .xlsx into it.');
  }
  const [header, ...rows] = parseCsv(readFileSync(path, 'utf8'));
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const members = [];
  const refused = [];
  const seen = new Map();

  rows.forEach((r, i) => {
    const raw = (r[col.memberNumber] || '').trim();
    const entry = {
      line: i + 2,
      raw,
      memberNumber: order.normalizeMemberNumber(raw),
      // The directory holds the family, not the person: the greeting reads
      // "Buonasera, Compofelice Party!".
      name: (r[col.lastName] || '').trim(),
      firstName: (r[col.firstName] || '').trim(),
      title: (r[col.title] || '').trim(),
      suffix: (r[col.suffix] || '').trim(),
    };
    if (!entry.memberNumber || !entry.name) { refused.push(entry); return; }
    if (seen.has(entry.memberNumber)) {
      refused.push({ ...entry, clash: seen.get(entry.memberNumber) });
      return;
    }
    seen.set(entry.memberNumber, entry);
    members.push(entry);
  });

  return { members, refused };
}

/** What `db.seedMembers()` expects. Names only - no titles, no first names. */
export function toFirestore(members) {
  return members.map((m) => ({
    memberNumber: m.memberNumber,
    name: m.name,
    dietaryNotes: '',
    defaultGuests: 2,
  }));
}

const full = (m) => [m.title, m.firstName, m.name, m.suffix].filter(Boolean).join(' ');

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const arg = process.argv[2];
  const { members, refused } = load();

  if (arg === '--json') {
    console.log(JSON.stringify(toFirestore(members), null, 2));
  } else if (arg) {
    const want = order.normalizeMemberNumber(arg);
    if (!want) {
      console.log(arg + ' is not a member number the keypad would accept.');
      process.exitCode = 1;
    } else {
      const hit = members.find((m) => m.memberNumber === want);
      console.log(hit
        ? want + '  ' + full(hit) + '   (greets as "Buonasera, ' + hit.name + ' Party!")'
        : 'No member ' + want + ' on this roster.');
      if (!hit) process.exitCode = 1;
    }
  } else {
    const nums = members.map((m) => Number(m.memberNumber));
    console.log(members.length + ' members, numbered '
      + Math.min(...nums) + ' to ' + Math.max(...nums));
    if (refused.length) {
      console.log('\n' + refused.length + ' row(s) the app cannot take:');
      refused.forEach((r) => console.log('  line ' + r.line + '  "' + r.raw + '"  '
        + full(r) + (r.clash ? '  - same number as line ' + r.clash.line : '')));
      console.log('\nMember numbers are 1 to 4 digits (app/config.js memberNumberPattern).');
    } else {
      console.log('\nEvery row is one the keypad would accept.');
    }
  }
}
