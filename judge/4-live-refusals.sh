#!/usr/bin/env bash
# Live check with YOUR NEAR account. See judge/README.md for env vars.
set -euo pipefail
cd "$(dirname "$0")/../cli"
[ -d node_modules ] || npm ci --silent
npx tsx ../judge/live.mts
