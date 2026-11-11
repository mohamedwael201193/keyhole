#!/usr/bin/env bash
# Counts PASS results. A failed suite exits this script before any success total is printed.
# Usage: scripts/test-count.sh
#        E2E=1 BASE_URL=http://localhost:3100 scripts/test-count.sh
set -euo pipefail
cd "$(dirname "$0")/.."
fail() { echo "FAIL $*" >&2; exit 1; }
if [ "${TEST_COUNT_FIXTURE:-}" = "fail" ]; then
  (exit 1)
  fail "fixture runner"
fi
out=()
total=0
add() { out+=("$(printf '%-14s %5d' "$1" "$2")"); total=$((total + $2)); }

cargo_pass() {
  local log
  log=$(mktemp)
  if ! (cd "$1" && cargo test --locked) >"$log" 2>&1; then
    tail -n 30 "$log" >&2 || true
    fail "cargo test $1"
  fi
  awk '/^test result:/{s+=$4} END{print s+0}' "$log"
}

cli_pass() {
  local log
  log=$(mktemp)
  if ! (cd cli && npm test) >"$log" 2>&1; then
    tail -n 30 "$log" >&2 || true
    fail "cli npm test"
  fi
  awk '/^# pass/{print $3}' "$log"
}

web_pass() {
  local dir log
  dir=$(mktemp -d)
  if ! (cd web && npx vitest run --reporter=json --outputFile="$dir/v.json") >"$dir/log" 2>&1; then
    tail -n 30 "$dir/log" >&2 || true
    fail "web vitest"
  fi
  node -e 'const j=require(process.argv[1]); if (!j.numPassedTests && j.numPassedTests !== 0) process.exit(1); if (j.numFailedTests) process.exit(1); process.stdout.write(String(j.numPassedTests))' "$dir/v.json" \
    || fail "web vitest json"
}

add contract "$(cargo_pass contracts/keys)"
add worker "$(cargo_pass tee/worker)"
add cli "$(cli_pass)"
add web-unit "$(web_pass)"

if [ "${E2E:-0}" = 1 ]; then
  dir=$(mktemp -d)
  if ! (cd web && PLAYWRIGHT_JSON_OUTPUT_NAME="$dir/p.json" npx playwright test --grep-invert "funded payment key" --reporter=json) >"$dir/log" 2>&1; then
    tail -n 30 "$dir/log" >&2 || true
    fail "playwright"
  fi
  add e2e "$(node -e 'const j=require(process.argv[1]); const n=new Set(j.suites.flatMap(function f(s){return [...(s.specs||[]).filter(x=>x.ok).map(x=>x.file+x.title),...(s.suites||[]).flatMap(f)]})).size; process.stdout.write(String(n))' "$dir/p.json")"
fi

printf '%s\n' "${out[@]}"
printf '%-14s %5d\n' TOTAL "$total"
echo "commit $(git rev-parse --short HEAD)  $(date -u +%FT%TZ)"
node scripts/gen-metrics.mjs --write --total "$total" --lines "$(printf '%s\n' "${out[@]}")"
