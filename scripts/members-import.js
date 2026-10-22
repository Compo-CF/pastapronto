/**
 * Put the member directory into Firestore.
 *
 *   node scripts/members-import.js            what it would do, and nothing else
 *   node scripts/members-import.js --commit   actually write it
 *   node scripts/members-import.js --demo     the 30 invented members, for a demo
 *   node scripts/members-import.js --force    allow a run that keeps none of them
 *
 * firestore.rules refuses every client write to members/, because the
 * collection holds real families and the only identity a browser has is
 * anonymous. So the roster comes in from here instead, on an admin token that
 * bypasses rules - which means this file is the only thing in the project that
 * can damage the directory, and it reports before it does anything.
 *
 * It prunes: a member who is no longer on the roster is deleted, not left
 * behind. Otherwise a renumbered account resolves to its old family forever.
 *
 * Two things sit in front of that prune. A run that would keep none of what is
 * already there needs --force, because that is right exactly once - when the
 * demo members give way to the real roster - and otherwise means the source was
 * wrong. And whatever was there is copied into private/ before anything is
 * written, since the roster is the one thing here we cannot rebuild from the
 * repo.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as roster from './roster.js';
import { MEMBERS } from '../app/seed.js';

const PROJECT = JSON.parse(
  readFileSync(fileURLToPath(new URL('../.firebaserc', import.meta.url)), 'utf8'),
).projects.default;

const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const API = `https://firestore.googleapis.com/v1/${ROOT}`;
const BATCH = 500; // Firestore's limit on writes in one commit.

/**
 * An access token for the Firestore REST API, from whoever is logged into
 * gcloud. Admin credentials, so this bypasses firestore.rules - which is the
 * point, since those rules refuse every client write to members/.
 *
 * It goes through a shell because on Windows gcloud is a .cmd wrapper: Node
 * will not resolve it (ENOENT) and, since v20, will not spawn it directly
 * either (EINVAL). The command is a constant, so there is nothing to inject.
 */
function token() {
  if (process.env.FIRESTORE_TOKEN) return process.env.FIRESTORE_TOKEN;

  let out;
  try {
    // One string, not a command plus arguments: with a shell in play Node
    // only concatenates them anyway, and says so loudly.
    out = execSync('gcloud auth print-access-token', {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    const said = String(err.stderr || err.message);
    // gcloud can ask you to re-prove who you are, and it can only ask a
    // terminal. Run this script yourself rather than through something that
    // cannot answer - that is the whole of the fix, not a missing login.
    if (/non-interactive|[Rr]eauthentication/.test(said)) {
      throw new Error('gcloud needs you to re-authenticate, and it can only ask '
        + 'an interactive terminal.\nRun this script from your own PowerShell '
        + 'window and answer the prompt.');
    }
    if (/ENOENT|not recognized|not found/.test(said)) {
      throw new Error('gcloud is not on PATH for this shell. Open a new terminal '
        + 'after installing it, or set FIRESTORE_TOKEN.');
    }
    throw new Error('Could not get a token from gcloud:\n' + said.trim().split('\n').slice(0, 4).join('\n'));
  }

  if (!out) throw new Error('gcloud returned an empty token. Run `gcloud auth login`.');
  return out;
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

/** Every member document currently in Firestore. */
async function existing() {
  const docs = [];
  let pageToken = '';
  do {
    const url = API + '/members?pageSize=300'
      + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const page = await call(url);
    (page.documents || []).forEach((d) => docs.push({ id: d.name.split('/').pop(), fields: d.fields || {} }));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return docs;
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
  const force = process.argv.includes('--force');

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

  const before = await existing();
  const keep = new Set(members.map((m) => m.memberNumber));
  const stale = before.filter((d) => !keep.has(d.id));

  console.log(members.length + ' to write, ' + stale.length + ' to delete, '
    + before.length + ' there now');
  if (stale.length) {
    console.log('  deleting: ' + stale.slice(0, 20).map((d) => d.id).join(', ')
      + (stale.length > 20 ? ' ...and ' + (stale.length - 20) + ' more' : ''));
  }

  // Replacing the directory wholesale is right exactly once - when the demo
  // members give way to the real roster. Every other time it means the source
  // was wrong, and the prune is about to delete 700 real families to prove it.
  const wipes = before.length > 0 && stale.length === before.length;
  if (wipes && !force) {
    throw new Error('This would delete all ' + before.length + ' members already there '
      + 'and keep none of them.\nIf that is what you want - swapping demo data for the '
      + 'real roster, or back - add --force.\nA copy is written to private/ first either way.');
  }

  if (!live) {
    console.log('\nDry run. Nothing was written. Add --commit to do it.');
    return;
  }

  // Taken before anything is touched. The roster is the one thing here we
  // cannot rebuild from the repo.
  if (before.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const path = fileURLToPath(new URL('../private/members-before-' + stamp + '.json', import.meta.url));
    writeFileSync(path, JSON.stringify(before, null, 1));
    console.log('\nBacked up ' + before.length + ' members to ' + path);
  }

  console.log('\nWriting...');
  await commit(members.map(upsert));
  if (stale.length) {
    await commit(stale.map((d) => ({ delete: ROOT + '/members/' + d.id })));
  }
  console.log('\nDone. ' + members.length + ' members, ' + stale.length + ' removed.');
}

main().catch((err) => {
  console.error('\n' + err.message);
  process.exitCode = 1;
});
