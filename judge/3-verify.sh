#!/usr/bin/env bash
# Step 3 of the judge kit: rebuild the worker from source and compare it with what the TEE executed.
# Same as ./verify.sh <call_id> --rebuild from the repository root. Default call: the published 94c355ff info call.
set -euo pipefail
cd "$(dirname "$0")/.."
exec ./verify.sh "${1:-ecb0d1d6-90e3-4522-852a-578ca50fdeb6}" --rebuild
