#!/usr/bin/env bash
# Step 3 of the judge kit: rebuild the worker from source and compare it with what the TEE executed.
# Same as ./verify.sh <call_id> --rebuild from the repository root. Default call: the published a985fd87 info call.
set -euo pipefail
cd "$(dirname "$0")/.."
exec ./verify.sh "${1:-246e4a7a-f138-4459-8548-350dd9960751}" --rebuild
