#!/usr/bin/env bash
# Counts PASS results. Each runner's exit status is checked before that count is added.
# A non-zero runner exits this script before any success total is printed and before metrics are written.
# Usage: scripts/test-count.sh
#        E2E=1 BASE_URL=http://localhost:3100 scripts/test-count.sh
#        METRICS_OUT=/tmp/metrics.json scripts/test-count.sh
set -euo pipefail
cd "$(dirname "$0")/.."
fail() { echo "FAIL $*" >&2; exit 1; }
dest="${METRICS_OUT:-docs/metrics.json}"

out=()
total=0
add() {
  local name=$1 n=$2
  [[ "$n" =~ ^[0-9]+$ ]] || fail "$name count"
  out+=("$(printf '%-14s %5d' "$name" "$n")")
  total=$((total + n))
}

# The assignment's status is the collector's status. add runs only after that status is 0.
take() {
  local name=$1
  shift
  local n
  if ! n=$("$@"); then
    fail "$name"
  fi
  add "$name" "$n"
}

cargo_count() {
  local log
  log=$(mktemp)
  if ! (cd "$1" && cargo test --locked) >"$log" 2>&1; then
    tail -n 30 "$log" >&2 || true
    return 1
  fi
  awk '/^test result:/{s+=$4} END{print s+0}' "$log"
}

cli_count() {
  local log
  log=$(mktemp)
  if ! (cd cli && npm test) >"$log" 2>&1; then
    tail -n 30 "$log" >&2 || true
    return 1
  fi
  awk '/^# pass/{print $3; found=1} END{if (!found) exit 1}' "$log"
}

web_count() {
  local dir
  dir=$(mktemp -d)
  if ! (cd web && npx vitest run --reporter=json --outputFile="$dir/v.json") >"$dir/log" 2>&1; then
    tail -n 30 "$dir/log" >&2 || true
    return 1
  fi
  node -e 'const j=require(process.argv[1]); if (!Number.isInteger(j.numPassedTests) || j.numFailedTests) process.exit(1); process.stdout.write(String(j.numPassedTests))' "$dir/v.json"
}

e2e_count() {
  local dir
  dir=$(mktemp -d)
  if ! (cd web && PLAYWRIGHT_JSON_OUTPUT_NAME="$dir/p.json" npx playwright test --grep-invert "funded payment key" --reporter=json) >"$dir/log" 2>&1; then
    tail -n 30 "$dir/log" >&2 || true
    return 1
  fi
  node -e 'const j=require(process.argv[1]); const n=new Set(j.suites.flatMap(function f(s){return [...(s.specs||[]).filter(x=>x.ok).map(x=>x.file+x.title),...(s.suites||[]).flatMap(f)]})).size; if (!Number.isInteger(n)) process.exit(1); process.stdout.write(String(n))' "$dir/p.json"
}

# Contract and worker cargo runs are not part of the default artifact. Set MEASURE_CARGO=1 to include them.
# Playwright is not part of it either. Set E2E=1 to include that runner. Sandbox stays excluded.
excluded="contract,worker,sandbox,playwright"
if [ "${MEASURE_CARGO:-0}" = 1 ]; then
  take contract cargo_count contracts/keys
  take worker cargo_count tee/worker
  excluded="${excluded//contract,/}"
  excluded="${excluded//worker,/}"
fi
take cli cli_count
take web-unit web_count
if [ "${E2E:-0}" = 1 ]; then
  take e2e e2e_count
  excluded="${excluded//playwright/}"
  excluded="${excluded%,}"
fi

printf '%s\n' "${out[@]}"
printf '%-14s %5d\n' TOTAL "$total"
echo "commit $(git rev-parse HEAD)  $(date -u +%FT%TZ)"
node scripts/gen-metrics.mjs --write --file "$dest" --total "$total" --lines "$(printf '%s\n' "${out[@]}")" --commit "$(git rev-parse HEAD)" --measured-at "$(date -u +%FT%TZ)" --excluded "$excluded"
