#!/usr/bin/env bash
# Stage a PoC test file from the report repo into the upstream worker test dir
# and run it with the upstream worker's vitest (workers pool + real D1 migrations).
# Usage: scripts/run-poc.sh <worker-dir-name> <poc-file-relative-to-repo-root> [extra vitest args]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UP="$ROOT/upstream/pollinations"
WORKER="$1"; POC="$2"; shift 2
BASE="$(basename "$POC")"
DEST_DIR="$UP/$WORKER/test/redteam"
mkdir -p "$DEST_DIR"
cp "$ROOT/$POC" "$DEST_DIR/$BASE"
cd "$UP/$WORKER"
set +e
timeout 600 npx vitest run "test/redteam/$BASE" "$@" 2>&1 | tee "$ROOT/evidence/last-run.txt"
CODE=${PIPESTATUS[0]}
set -e
exit $CODE
