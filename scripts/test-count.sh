#!/usr/bin/env bash
# Runs every test suite and prints how many tests PASSED in each (not cases, not files).
# Usage: scripts/test-count.sh            (unit suites; e2e needs a running site)
#        E2E=1 BASE_URL=http://localhost:3100 scripts/test-count.sh
# Property/fuzz tests count once each; their fixed seeds and case counts are listed in the test source.
set -uo pipefail
cd "$(dirname "$0")/.."
out=()
total=0
add() { set -- "$1" "${2:-0}"; out+=("$(printf '%-14s %5d' "$1" "$2")"); total=$((total + $2)); }
cargo_pass() { (cd "$1" && cargo test --locked 2>&1) | awk '/^test result:/{s+=$4} END{print s+0}'; }
add contract "$(cargo_pass contracts/keys)"
add worker "$(cargo_pass tee/worker)"
add cli "$( (cd cli && npm test 2>&1) | awk '/^# pass/{print $3}')"
tmp=$(mktemp -d)
(cd web && npx vitest run --reporter=json --outputFile="$tmp/v.json" >/dev/null 2>&1)
add web-unit "$(node -p "require('$tmp/v.json').numPassedTests" 2>/dev/null || echo 0)"
if [ "${E2E:-0}" = 1 ]; then
  (cd web && PLAYWRIGHT_JSON_OUTPUT_NAME="$tmp/p.json" npx playwright test --grep-invert "funded payment key" --reporter=json >/dev/null 2>&1)
  add "e2e" "$(node -p "const j=require('$tmp/p.json');new Set(j.suites.flatMap(function f(s){return [...(s.specs||[]).filter(x=>x.ok).map(x=>x.file+x.title),...(s.suites||[]).flatMap(f)]})).size" 2>/dev/null || echo 0)"  # distinct tests; each also runs at 1440 and 390
fi
printf '%s\n' "${out[@]}"
printf '%-14s %5d\n' TOTAL "$total"
echo "commit $(git rev-parse --short HEAD)  $(date -u +%FT%TZ)"
