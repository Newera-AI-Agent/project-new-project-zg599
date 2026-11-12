#!/usr/bin/env bash
# Reproducible PoC runner.
# Tracked PoC sources live in poc/<worker>/ and are copied into the upstream
# Cloudflare Workers test harness (vitest pool "workers") so every proof runs
# the REAL upstream worker code against a real D1 database (miniflare).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UP="$ROOT/upstream/pollinations"
FILTER="${1:-}"

run_worker() {
  local worker="$1"; local subdir="$2"
  local dst="$UP/$worker/test/integration"
  [ "$worker" = "gen.pollinations.ai" ] && dst="$UP/$worker/test/poc"
  mkdir -p "$dst"
  cp -f "$ROOT"/poc/"$subdir"/*.test.ts "$dst/" 2>/dev/null || true
  ( cd "$UP/$worker" && npx vitest run "test/${worker%%.pollinations.ai}/integration" 2>/dev/null ) || true
}

if [ -d "$ROOT/poc/enter" ] && ls "$ROOT"/poc/enter/*.test.ts >/dev/null 2>&1; then
  echo "=== enter.pollinations.ai worker pool ==="
  cp -f "$ROOT"/poc/enter/*.test.ts "$UP/enter.pollinations.ai/test/integration/"
  ( cd "$UP/enter.pollinations.ai" && npx vitest run test/integration 2>&1 | tee "$ROOT/evidence/poc-enter.log" | tail -40 )
fi
if [ -d "$ROOT/poc/gen" ] && ls "$ROOT"/poc/gen/*.test.ts >/dev/null 2>&1; then
  echo "=== gen.pollinations.ai worker pool ==="
  mkdir -p "$UP/gen.pollinations.ai/test/poc"
  cp -f "$ROOT"/poc/gen/*.test.ts "$UP/gen.pollinations.ai/test/poc/"
  ( cd "$UP/gen.pollinations.ai" && npx vitest run test/poc 2>&1 | tee "$ROOT/evidence/poc-gen.log" | tail -40 )
fi
