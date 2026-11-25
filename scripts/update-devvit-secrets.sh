#!/usr/bin/env bash
set -Eeuo pipefail

# Refresh the GitHub Actions Devvit credentials from this machine's local Devvit login.
# This script never prints either secret. GitHub CLI encrypts the values before upload.

REPO="${1:-awesome118/infinity-orbs-v2}"
DEVVIT_DIR="${DEVVIT_DIR:-$HOME/.devvit}"
TOKEN_FILE="${DEVVIT_TOKEN_FILE:-$DEVVIT_DIR/token}"
SESSION_FILE="${DEVVIT_SESSION_ID_FILE:-$DEVVIT_DIR/session-id}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

command -v gh >/dev/null 2>&1 || fail "GitHub CLI (gh) is required. Install it from https://cli.github.com/."
command -v npx >/dev/null 2>&1 || fail "Node.js/npm is required so this project can run the Devvit CLI."
command -v tr >/dev/null 2>&1 || fail "The tr command is required."

[[ -r "$TOKEN_FILE" && -s "$TOKEN_FILE" ]] || fail "Devvit token file is missing or empty: $TOKEN_FILE. Run 'npx devvit login --copy-paste' first."
[[ -r "$SESSION_FILE" && -s "$SESSION_FILE" ]] || fail "Devvit session ID file is missing or empty: $SESSION_FILE. Run 'npx devvit login --copy-paste' first."

# Validate the expected full token JSON without printing it.
node - "$TOKEN_FILE" <<'NODE' || fail "The Devvit token file is not the expected full JSON token. Re-login with 'npx devvit login --copy-paste'."
const fs = require('node:fs');
const file = process.argv[2];
try {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || typeof value.token !== 'string' || !value.token.trim()) {
    process.exit(1);
  }
} catch {
  process.exit(1);
}
NODE

gh auth status --hostname github.com >/dev/null 2>&1 || fail "GitHub CLI is not logged in. Run 'gh auth login' and select an account with admin access to $REPO."

REPO_CHECK="$(gh repo view "$REPO" --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null)" \
  || fail "Cannot access $REPO with the current GitHub account. Check gh login and repository permissions."
[[ "$REPO_CHECK" == "$REPO" ]] || fail "GitHub resolved '$REPO' as '$REPO_CHECK'; refusing to update secrets for a different repository."

printf 'Checking the local Devvit login...\n'
# Use local files as the source of truth, not any stale exported CI credentials.
if ! (cd "$(dirname "$0")/.." && env -u DEVVIT_AUTH_TOKEN -u DEVVIT_SESSION_ID npx devvit whoami); then
  fail "The local Devvit login is not valid. Run 'npx devvit login --copy-paste', confirm with 'npx devvit whoami', then rerun this script."
fi

printf 'Updating DEVVIT_TOKEN in %s...\n' "$REPO"
gh secret set DEVVIT_TOKEN --repo "$REPO" < "$TOKEN_FILE"

printf 'Updating DEVVIT_SESSION_ID in %s...\n' "$REPO"
# Strip only line endings from the one-line session ID to prevent a trailing newline in the secret.
tr -d '\r\n' < "$SESSION_FILE" | gh secret set DEVVIT_SESSION_ID --repo "$REPO"

# Verify that GitHub lists both Actions secret names. Values are never retrievable or printed.
SECRET_NAMES="$(gh secret list --app actions --repo "$REPO" --json name --jq '.[].name')" \
  || fail "Secrets were submitted, but GitHub could not verify the resulting secret list."
grep -Fxq 'DEVVIT_TOKEN' <<< "$SECRET_NAMES" || fail "GitHub did not list DEVVIT_TOKEN after the update."
grep -Fxq 'DEVVIT_SESSION_ID' <<< "$SECRET_NAMES" || fail "GitHub did not list DEVVIT_SESSION_ID after the update."

printf '\nSuccess: both GitHub Actions secrets are set for %s. Secret values were not displayed.\n' "$REPO"
printf 'Next: rerun the Deploy Devvit workflow from GitHub Actions; this script does not deploy the app.\n'
