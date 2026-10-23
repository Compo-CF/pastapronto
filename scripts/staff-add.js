/**
 * Let a device run the staff screens, or stop it.
 *
 *   node scripts/staff-add.js <uid> [label]   add
 *   node scripts/staff-add.js --list          who is on the list
 *   node scripts/staff-add.js --remove <uid>  take one off
 *
 * firestore.rules refuses every browser write to staff/, which is the point of
 * the collection: a page that could add itself to the allow-list would not be
 * an allow-list. So rows go in from here, on an admin token.
 *
 * The uid comes from the Firebase console, Authentication, beside the account.
 * Passwords never come near this script - it never sees one and does not want
 * one.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PROJECT = JSON.parse(
  readFileSync(fileURLToPath(new URL('../.firebaserc', import.meta.url)), 'utf8'),
).projects.default;
const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const API = `https://firestore.googleapis.com/v1/${ROOT}`;

function token() {
  if (process.env.FIRESTORE_TOKEN) return process.env.FIRESTORE_TOKEN;
  try {
    return execSync('gcloud auth print-access-token', {
      encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'],
    }).trim();
  } catch {
    throw new Error('gcloud would not give us a token; its reason is above.\n'
      + 'Run `gcloud auth print-access-token` in this window and answer it, then retry.');
  }
}

async function call(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText + '\n' + body.slice(0, 500));
  return body ? JSON.parse(body) : {};
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--list')) {
    const page = await call(API + '/staff?pageSize=100');
    const rows = page.documents || [];
    if (!rows.length) {
      console.log('Nobody is on the staff list, so every staff screen is locked out.');
      return;
    }
    console.log(rows.length + ' device account(s):');
    rows.forEach((d) => {
      const f = d.fields || {};
      console.log('  ' + d.name.split('/').pop()
        + (f.label ? '  ' + f.label.stringValue : ''));
    });
    return;
  }

  if (argv[0] === '--remove') {
    const uid = argv[1];
    if (!uid) throw new Error('Which uid?');
    await call(API + '/staff/' + encodeURIComponent(uid), { method: 'DELETE' });
    console.log(uid + ' can no longer run a staff screen.');
    console.log('It stays signed in until it next reloads, then it is asked again.');
    return;
  }

  const uid = argv[0];
  if (!uid || uid.startsWith('--')) {
    throw new Error('Usage: node scripts/staff-add.js <uid> [label]');
  }
  const label = argv.slice(1).join(' ') || 'staff device';

  await call(API + '/staff/' + encodeURIComponent(uid), {
    method: 'PATCH',
    body: JSON.stringify({ fields: {
      label: { stringValue: label },
      addedAt: { timestampValue: new Date().toISOString() },
    } }),
  });
  console.log(uid + ' (' + label + ') can now run the staff screens.');
}

main().catch((err) => {
  console.error('\n' + err.message);
  process.exitCode = 1;
});
