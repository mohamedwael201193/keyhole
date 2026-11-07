#!/usr/bin/env bash
# Step 3 of the judge kit: rebuild the worker from source and compare it with what the TEE executed.
# Same as ./verify.sh <call_id> --rebuild from the repository root. Default call: the published ebeb6a34 info call.
set -euo pipefail
cd "$(dirname "$0")/.."
exec ./verify.sh "${1:-5650a6b7-b7de-410c-b206-e189171bad15}" --rebuild
