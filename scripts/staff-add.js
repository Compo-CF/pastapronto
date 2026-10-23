/**
 * Let a device run the staff screens, or stop it.
 *
 *   node scripts/staff-add.js <uid|email> [label]   add
 *   node scripts/staff-add.js --list          who is on the list
 *   node scripts/staff-add.js --remove <uid>  take one off
 *
 * firestore.rules refuses every browser write to staff/, which is the point of
 * the collection: a page that could add itself to the allow-list would not be
 * an allow-list. So rows go in from here, on an admin token.
 *
 * Takes the uid from the Firebase console, or just the email address - an
 * address is what a person actually has to hand, and a 28-character uid
 * copied by eye is a typo waiting to lock the rail out.
 *
 * Passwords never come near this script. It neither sees one nor wants one.
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
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText + String.fromCharCode(10) + body.slice(0, 400));
  return body ? JSON.parse(body) : {};
}

const IDP = 'https://identitytoolkit.googleapis.com/v1/projects/' + PROJECT;

/** An email is not an identity to Firestore; the uid behind it is. */
async function uidForEmail(email) {
  const res = await fetch(IDP + '/accounts:lookup', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: [email] }),
  });
  const body = await res.text();
  // A gcloud user token carries cloud-platform but not the Identity Toolkit
  // scope this needs, so a 403 here is a missing permission rather than a
  // missing account. The uid path needs none of that and always works.
  if (!res.ok) {
    throw new Error('Could not look that address up (' + res.status + ').'
      + String.fromCharCode(10) + 'Pass the User UID instead - it is beside the account in the'
      + ' Firebase console, Authentication, Users.');
  }
  const users = (JSON.parse(body).users || []);
  if (!users.length) {
    throw new Error('No account for ' + email + '. Create it first in the Firebase'
      + ' console under Authentication, Users.');
  }
  return users[0].localId;
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

  const who = argv[0];
  if (!who || who.startsWith('--')) {
    throw new Error('Usage: node scripts/staff-add.js <uid|email> [label]');
  }
  const uid = who.includes('@') ? await uidForEmail(who) : who;
  if (who.includes('@')) console.log(who + ' is ' + uid);
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
