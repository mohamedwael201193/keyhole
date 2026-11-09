#!/usr/bin/env bash
# Step 3 of the judge kit: rebuild the worker from source and compare it with what the TEE executed.
# Same as ./verify.sh <call_id> --rebuild from the repository root. Default call: the published cc8d2fa8 info call.
set -euo pipefail
cd "$(dirname "$0")/.."
exec ./verify.sh "${1:-f21fbb59-13f7-41f4-a89e-a612cf6bdca5}" --rebuild
