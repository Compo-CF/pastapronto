/**
 * Ask the rules what they would do, without signing anyone in.
 *
 * Run: node scripts/rules-test.cjs
 *
 * The difference between the kitchen rail and a phone at a table is one
 * document: staff/{uid}. Proving that from a browser would mean typing the
 * shared password into a production app, so instead this asks Google to
 * evaluate firestore.rules against a made-up request, with exists() mocked
 * both ways. It checks the file on disk, so run it BEFORE deploying.
 *
 * Needs a gcloud token and the quota-project header - an ADC user token has
 * no project of its own, and firebaserules refuses without one.
 */
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const PROJECT = JSON.parse(fs.readFileSync('.firebaserc', 'utf8')).projects.default;
const SRC = fs.readFileSync('firestore.rules', 'utf8');
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const DB = `/databases/(default)/documents`;
const STAFF_UID = 'K2JTJ7M9IqSIqIk5t1U5jBEkl8z1';

// exists(staff/<uid>) is mocked per case: that single lookup is the whole
// difference between a rail and a phone at a table.
const staffMock = (isStaff) => ([{
  function: 'exists',
  args: [{ exactValue: `${DB}/staff/${STAFF_UID}` }],
  result: { value: isStaff },
}]);

const svcMock = {
  function: 'get',
  args: [{ exactValue: `${DB}/config/service` }],
  result: { value: { data: { open: true, openFor: '2026-10-23' } } },
};

const cases = [
  ['staff may LIST orders', 'ALLOW', `${DB}/orders/abc`, 'list', true],
  ['guest may NOT list orders', 'DENY', `${DB}/orders/abc`, 'list', false],
  ['staff may DELETE an order', 'ALLOW', `${DB}/orders/abc`, 'delete', true],
  ['guest may NOT delete an order', 'DENY', `${DB}/orders/abc`, 'delete', false],
  ['staff may read one member', 'ALLOW', `${DB}/members/1794`, 'get', true],
  ['guest may read one member', 'ALLOW', `${DB}/members/1794`, 'get', false],
  ['staff may read the menu', 'ALLOW', `${DB}/config/menu`, 'get', true],
  ['guest may read the menu', 'ALLOW', `${DB}/config/menu`, 'get', false],
];

const testCases = cases.map(([name, expectation, path, method, isStaff]) => ({
  expectation,
  request: {
    auth: { uid: STAFF_UID, token: { firebase: { sign_in_provider: isStaff ? 'password' : 'anonymous' } } },
    path,
    method,
    time: new Date().toISOString(),
  },
  functionMocks: [...staffMock(isStaff), svcMock],
}));

(async () => {
  const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT },
    body: JSON.stringify({
      source: { files: [{ name: 'firestore.rules', content: SRC }] },
      testSuite: { testCases },
    }),
  });
  const body = await res.text();
  if (!res.ok) { console.log(res.status, body.slice(0, 600)); return; }
  const out = JSON.parse(body);
  (out.issues || []).forEach((i) => console.log('ISSUE', i.severity, i.description));
  let bad = 0;
  (out.testResults || []).forEach((r, i) => {
    const ok = r.state === 'SUCCESS';
    if (!ok) bad += 1;
    console.log((ok ? '  ok   ' : '  FAIL ') + cases[i][0]);
  });
  console.log('\n' + (bad ? bad + ' failed' : 'all ' + cases.length + ' as intended'));
})();
