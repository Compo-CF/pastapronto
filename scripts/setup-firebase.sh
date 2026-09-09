#!/usr/bin/env bash
#
# Creates a NEW, separate Firebase project for PastaPronto and wires it up.
# Deliberately separate from the tasteoff project (judging-app-dd929) so the two
# apps never share a Firestore database, rules, or quota.
#
# Prerequisite (this is the one step that needs a human - it opens a browser):
#   firebase login
#
# Then:
#   bash scripts/setup-firebase.sh [project-id]
#
# Project ids are globally unique across all of Firebase, so if the default is
# taken, pass your own.
set -euo pipefail

PROJECT_ID="${1:-pastapronto-$(date +%y%m%d)}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo
echo "PastaPronto Firebase setup"
echo "=========================="
echo "  project id : $PROJECT_ID"
echo

if ! firebase login:list 2>/dev/null | grep -q "@"; then
  echo "ERROR: not logged in. Run 'firebase login' first, then re-run this script."
  exit 1
fi

echo "[1/6] Creating the project..."
firebase projects:create "$PROJECT_ID" --display-name "PastaPronto" || {
  echo "      (project may already exist - continuing)"
}

echo "[2/6] Creating the Firestore database..."
# nam5 is the US multi-region. Change if your venue is elsewhere.
firebase firestore:databases:create "(default)" \
  --project "$PROJECT_ID" --location nam5 2>/dev/null || {
  echo "      (database may already exist - continuing)"
}

echo "[3/6] Registering the web app..."
firebase apps:create WEB "PastaPronto Web" --project "$PROJECT_ID" 2>/dev/null || {
  echo "      (web app may already exist - continuing)"
}

echo "[4/6] Writing app/firebase-config.js from the live SDK config..."
node scripts/write-firebase-config.js "$PROJECT_ID"

echo "[5/6] Pointing .firebaserc at the project..."
node -e "
const fs = require('node:fs');
fs.writeFileSync('.firebaserc', JSON.stringify({ projects: { default: '$PROJECT_ID' } }, null, 2) + '\n');
console.log('      .firebaserc -> $PROJECT_ID');
"

echo "[6/6] Deploying the security rules..."
firebase deploy --only firestore:rules --project "$PROJECT_ID"

echo
echo "Done. Two things left, both in the Firebase console:"
echo
echo "  1. Enable Anonymous sign-in (every screen signs in silently):"
echo "     https://console.firebase.google.com/project/$PROJECT_ID/authentication/providers"
echo "     -> Authentication -> Sign-in method -> Anonymous -> Enable"
echo
echo "  2. If you want Firebase Hosting as well as GitHub Pages:"
echo "     firebase deploy --only hosting --project $PROJECT_ID"
echo
echo "Then open admin.html and press 'Seed demo orders'."
echo
