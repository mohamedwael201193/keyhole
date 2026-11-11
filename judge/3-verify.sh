#!/usr/bin/env bash
# Step 3 of the judge kit: rebuild the worker from source and compare it with what the TEE executed.
# Same as ./verify.sh <call_id> --rebuild from the repository root. Default call: the current published info call from identity.json.
set -euo pipefail
cd "$(dirname "$0")/.."
CALL="${1:-$(jq -r '.worker.info_call' identity.json)}"
exec ./verify.sh "$CALL" --rebuild
