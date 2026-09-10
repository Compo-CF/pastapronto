#!/usr/bin/env bash
#
# Creates a NEW, separate Firebase project for PastaPresto and wires it up.
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

PROJECT_ID="${1:-pastapresto-$(date +%y%m%d)}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo
echo "PastaPresto Firebase setup"
echo "=========================="
echo "  project id : $PROJECT_ID"
echo

if ! firebase login:list 2>/dev/null | grep -q "@"; then
  echo "ERROR: not logged in. Run 'firebase login' first, then re-run this script."
  exit 1
fi

echo "[1/6] Creating the project..."
firebase projects:create "$PROJECT_ID" --display-name "PastaPresto" || {
  echo "      (project may already exist - continuing)"
}

echo "[2/6] Creating the Firestore database..."
# nam5 is the US multi-region. Change if your venue is elsewhere.
#
# A brand-new project has the Cloud Firestore API switched off, and it can only
# be turned on from the console or with gcloud. Do NOT swallow that failure -
# every later step depends on this one, and silently skipping it produces a
# half-configured project that looks fine until the first read fails.
DB_OUT="$(firebase firestore:databases:create '(default)' --project "$PROJECT_ID" --location nam5 2>&1 || true)"

if echo "$DB_OUT" | grep -q "already exists"; then
  echo "      database already exists - continuing"
elif echo "$DB_OUT" | grep -qE "has not been used|is disabled|SERVICE_DISABLED"; then
  echo ""
  echo "  STOP: the Cloud Firestore API is not enabled on $PROJECT_ID yet."
  echo ""
  echo "  Enable it (one click, then give it ~30s to propagate):"
  echo "    https://console.cloud.google.com/apis/api/firestore.googleapis.com/overview?project=$PROJECT_ID"
  echo ""
  echo "  Or with a working gcloud login:"
  echo "    gcloud services enable firestore.googleapis.com --project $PROJECT_ID"
  echo ""
  echo "  Then re-run this script - it is safe to run again."
  echo ""
  exit 1
elif echo "$DB_OUT" | grep -qi "error"; then
  echo "$DB_OUT"
  echo ""
  echo "  Firestore database creation failed. Fix the above and re-run."
  exit 1
else
  echo "      database created in nam5"
fi

echo "[3/6] Registering the web app..."
firebase apps:create WEB "PastaPresto Web" --project "$PROJECT_ID" 2>/dev/null || {
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
echo "Done. One thing left that only the console can do:"
echo ""
echo "  Enable Anonymous sign-in. Every screen signs in silently and the"
echo "  security rules require an auth token, so nothing works until this is on:"
echo "    https://console.firebase.google.com/project/$PROJECT_ID/authentication/providers"
echo "    -> Authentication -> Sign-in method -> Anonymous -> Enable"
echo ""
echo "Then:"
echo "  firebase deploy --only hosting --project $PROJECT_ID    # optional, gives a URL"
echo "  open admin.html and press 'Seed demo orders'"
echo ""
