#!/usr/bin/env bash
# Step 3 of the judge kit: rebuild the worker from source and compare it with what the TEE executed.
# Same as ./verify.sh <call_id> --rebuild from the repository root. Default call: the published 09d481a5 info call.
set -euo pipefail
cd "$(dirname "$0")/.."
exec ./verify.sh "${1:-2896d0ad-aa27-4e21-b4a1-0cf2d3755d56}" --rebuild
