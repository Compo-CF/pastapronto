/**
 * Firebase web config for PastaPronto.
 *
 * These values are NOT secret - Firebase web config is designed to ship to the
 * browser, and every visitor can read it. What protects your data is
 * firestore.rules, not this file. (Same posture as the tasteoff app.)
 *
 * TO FILL THIS IN:
 *   1. firebase login
 *   2. firebase projects:create pastapronto-<something-unique>
 *   3. firebase apps:create WEB pastapronto-web --project pastapronto-<...>
 *   4. firebase apps:sdkconfig WEB --project pastapronto-<...>
 *   5. paste the resulting object below and commit
 *
 * scripts/setup-firebase.sh runs steps 2-5 for you.
 */
export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.firebasestorage.app',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};

/** True once real values are in place, so screens can show a helpful message. */
export const isConfigured = !Object.values(firebaseConfig).some(
  (v) => typeof v === 'string' && v.includes('REPLACE_ME'),
);
