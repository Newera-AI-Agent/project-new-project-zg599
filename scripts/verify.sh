#!/usr/bin/env bash
# Verify a PoC against the REAL upstream code and capture verbatim evidence.
# Usage: scripts/verify.sh <poc/relative/path.test.ts> [evidence/relative/path.txt]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
POC="$1"
EV="${2:-}"
if [ -z "$EV" ]; then
  EV="evidence/$(echo "$POC" | sed -e 's#^poc/##' -e 's#/#-#g' -e 's#\.test\.ts$#.txt#')"
fi
mkdir -p "$(dirname "$ROOT/$EV")"
cd "$ROOT"
set +e
timeout 600 npx vitest run "$POC" --reporter=basic 2>&1 | tee "$ROOT/$EV"
CODE=${PIPESTATUS[0]}
set -e
echo "[verify] poc=$POC evidence=$EV exit=$CODE"
exit $CODE
