#!/usr/bin/env bash
# verify.sh <call_id> [--rebuild]
# Checks a KEYHOLE TEE call: attestation (TDX quote, wasm hash) == FastFS bytes [== your own rebuild].
set -euo pipefail
CALL="${1:?usage: ./verify.sh <call_id> [--rebuild]}"
API="${OUTLAYER_API:-https://api.outlayer.ai}"
need(){ command -v "$1" >/dev/null || { echo "missing $1"; exit 2; }; }
need curl; need jq; need sha256sum
A=$(curl -fsS "$API/attestations/by-call/$CALL")
H=$(jq -r '.executed_wasm_sha256' <<<"$A"); R=$(jq -r '.wasm_hash' <<<"$A"); P=$(jq -r '.project_id' <<<"$A")
Q=$(jq -r '.tdx_quote | length' <<<"$A")
echo "call      $CALL"; echo "project   $P"; echo "attested  $H"
fail=0; ok(){ echo "OK   $1"; }; bad(){ echo "FAIL $1"; fail=1; }
[ "$Q" -gt 100 ] && ok "TDX quote present ($Q chars)" || bad "no TDX quote"
[ "$H" = "$R" ] && ok "registered wasm_hash == executed" || bad "wasm_hash $R != executed $H"
PUB=$(tr -d '[:space:]' < "$(dirname "$0")/tee/worker/DEPLOYED_SHA256")
PREV=f13efe92613284bac3a4d09b1e8eca45d0f36a84ec238be125975a8eca28119c
if [ "$H" = "$PUB" ]; then ok "executed == published build ${PUB:0:8}"
elif [ "$H" = "$PREV" ]; then ok "executed == previous build ${PREV:0:8}, superseded by ${PUB:0:8}"
else bad "executed $H != published build $PUB"; fi
URL="${FASTFS_BASE:-https://main.fastfs.io}/${P%%/*}/outlayer.near/$H.wasm"
F=$(curl -fsS "$URL" | sha256sum | cut -d' ' -f1)
[ "$F" = "$H" ] && ok "FastFS $URL sha256 matches" || bad "FastFS sha256 $F"
if [ "${2:-}" = "--rebuild" ]; then
  B=$("$(dirname "$0")/tee/worker/build.sh")
  [ "$B" = "$H" ] && ok "local reproducible build matches ($B)" || bad "local build $B differs (deployed version may be another commit)"
fi
exit $fail
