#!/usr/bin/env bash
# Step 3 of the judge kit: rebuild the worker from source and compare it with what the TEE executed.
# Same as ./verify.sh <call_id> --rebuild from the repository root. Default call: the published cff9fd3c info call.
set -euo pipefail
cd "$(dirname "$0")/.."
exec ./verify.sh "${1:-643a012d-0389-44d7-9c78-efb5d7835e80}" --rebuild
