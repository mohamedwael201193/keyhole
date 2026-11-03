#!/usr/bin/env bash
# Step 3 of the judge kit: rebuild the worker from source and compare it with what the TEE executed.
# Same as ./verify.sh <call_id> --rebuild from the repository root. Default call: the published a55ebb14 info call.
set -euo pipefail
cd "$(dirname "$0")/.."
exec ./verify.sh "${1:-b0a6eadb-cee9-400e-8eca-8b0f4df7bcec}" --rebuild
