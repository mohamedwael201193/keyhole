#!/usr/bin/env bash
# Step 3 of the judge kit: rebuild the worker from source and compare it with what the TEE executed.
# Same as ./verify.sh <call_id> --rebuild from the repository root. Default call: the published d337e822 info call.
set -euo pipefail
cd "$(dirname "$0")/.."
exec ./verify.sh "${1:-dc3668db-674f-4865-a2ce-272f70c41b0d}" --rebuild
