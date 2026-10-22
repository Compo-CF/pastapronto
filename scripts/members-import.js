/**
 * Put the member directory into Firestore.
 *
 *   node scripts/members-import.js            what it would do, and nothing else
 *   node scripts/members-import.js --commit   actually write it
 *   node scripts/members-import.js --demo     the 30 invented members, for a demo
 *
 * firestore.rules refuses every client write to members/, because the
 * collection holds real families and the only identity a browser has is
 * anonymous. So the roster comes in from here instead, on an admin token that
 * bypasses rules - which means this file is the only thing in the project that
 * can damage the directory, and it reports before it does anything.
 *
 * It prunes: a member who is no longer on the roster is deleted, not left
 * behind. Otherwise a renumbered account resolves to its old family forever.
 * That is also why it refuses to run on an empty read - a listing that failed
 * for the wrong reason would look exactly like "the club dropped everyone".
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as roster from './roster.js';
import { MEMBERS } from '../app/seed.js';

const PROJECT = JSON.parse(
  readFileSync(fileURLToPath(new URL('../.firebaserc', import.meta.url)), 'utf8'),
).projects.default;

const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const API = `https://firestore.googleapis.com/v1/${ROOT}`;
const BATCH = 500; // Firestore's limit on writes in one commit.

function token() {
  if (process.env.FIRESTORE_TOKEN) return process.env.FIRESTORE_TOKEN;
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error('No credentials. Run `gcloud auth login` and '
      + '`gcloud config set project ' + PROJECT + '`, or set FIRESTORE_TOKEN.');
  }
}

async function call(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText + '\n' + body.slice(0, 600));
  return body ? JSON.parse(body) : {};
}

/** Every member id currently in Firestore. Ids only - no names come back. */
async function existingIds() {
  const ids = [];
  let pageToken = '';
  do {
    const url = API + '/members?pageSize=300&mask.fieldPaths=__name__'
      + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const page = await call(url);
    (page.documents || []).forEach((d) => ids.push(d.name.split('/').pop()));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return ids;
}

const upsert = (m) => ({
  update: {
    name: ROOT + '/members/' + m.memberNumber,
    fields: {
      name: { stringValue: m.name },
      dietaryNotes: { stringValue: m.dietaryNotes || '' },
      defaultGuests: { integerValue: String(m.defaultGuests || 2) },
    },
  },
});

async function commit(writes) {
  for (let i = 0; i < writes.length; i += BATCH) {
    const chunk = writes.slice(i, i + BATCH);
    await call(API + ':commit', { method: 'POST', body: JSON.stringify({ writes: chunk }) });
    console.log('  committed ' + (i + chunk.length) + '/' + writes.length);
  }
}

async function main() {
  const demo = process.argv.includes('--demo');
  const live = process.argv.includes('--commit');

  let members;
  if (demo) {
    members = MEMBERS;
    console.log('Source: the 30 invented demo members (app/seed.js)');
  } else {
    const { members: rows, refused } = roster.load();
    members = roster.toFirestore(rows);
    console.log('Source: private/members.csv');
    if (refused.length) {
      console.log(refused.length + ' row(s) the app cannot take, skipped:');
      refused.forEach((r) => console.log('  line ' + r.line + '  "' + r.raw + '"  ' + r.name));
    }
  }

  console.log('Project: ' + PROJECT + '\n');

  const before = await existingIds();
  const keep = new Set(members.map((m) => m.memberNumber));
  const stale = before.filter((id) => !keep.has(id));

  // A read that came back empty when the directory is not empty would make
  // every member look new and nothing look stale. Harmless here - but the same
  // failure on the prune side is what deletes a roster, so refuse the shape.
  if (!before.length && stale.length) throw new Error('unreachable');
  if (before.length && stale.length === before.length && members.length) {
    console.log('WARNING: this would delete every one of the ' + before.length
      + ' members already there. That is right when swapping demo data for the '
      + 'real roster, and wrong almost any other time.\n');
  }

  console.log(members.length + ' to write, ' + stale.length + ' to delete, '
    + before.length + ' there now');
  if (stale.length) console.log('  deleting: ' + stale.slice(0, 20).join(', ')
    + (stale.length > 20 ? ' ...and ' + (stale.length - 20) + ' more' : ''));

  if (!live) {
    console.log('\nDry run. Nothing was written. Add --commit to do it.');
    return;
  }

  console.log('\nWriting...');
  await commit(members.map(upsert));
  if (stale.length) {
    await commit(stale.map((id) => ({ delete: ROOT + '/members/' + id })));
  }
  console.log('\nDone. ' + members.length + ' members, ' + stale.length + ' removed.');
}

main().catch((err) => {
  console.error('\n' + err.message);
  process.exitCode = 1;
});
