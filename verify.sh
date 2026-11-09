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
M=$(jq -r '.worker_measurement // empty' <<<"$A")
Q=$(jq -r '.tdx_quote | length' <<<"$A")
echo "call         $CALL"; echo "project      $P"; echo "executed     $H"
echo "measurement  ${M:-none}"
DEP="$(dirname "$0")/tee/worker/DEPLOYED_SHA256"
if [ -f "$DEP" ]; then echo "deployed     $(tr -d '[:space:]' < "$DEP")"; fi
fail=0; ok(){ echo "OK   $1"; }; bad(){ echo "FAIL $1"; fail=1; }
[ "$Q" -gt 100 ] && ok "TDX quote present ($Q chars)" || bad "no TDX quote"
[ "$H" = "$R" ] && ok "registered wasm_hash == executed" || bad "wasm_hash $R != executed $H"
PUB=$(tr -d '[:space:]' < "$(dirname "$0")/tee/worker/DEPLOYED_SHA256")
PREV="cc8d2fa8e2e4cc3b05705c5b98ac7eaab0ad119fae1745458a3b733d6270ec4c a985fd87866c4a586603d30f0f73bdff1506e381c5b8a748973302d028b9e4f8 ebeb6a3496b9c3e2447cbca12919b33f631931150f6ab7565c525451060f583b 94c355ffa318ec0e6cafc5268afb6968c91cad5c99ebd343e14f9b85f2bca9ed cff9fd3c4937ad5255cef8cda6f269d62f564af72cea65950471b94459aeb1bc a55ebb14df4ebb26f2bcc45767d9ec794466f6debd8ce96a883c93223a80140e 09d481a5c3340856f0fe75d6ba89012887de5c1230c46bc1ef380d69d172aaf4 f7217ae291c7c39c3df699f33a0f84a262c37388f992fa62652d941a01a85381 452df1fd4f69fac618da0a5c11f9b8b5a9f7b0c1c95d5785850dd4746c5c134d 6367401a78ae4f193eae16f90925968e8c3b477f1a387a213540aa0c60479693 67c5cd77a46814e5a4286b0a6971f8bc533274b425e7fb3272be3145469e65b2 38bd67b930ea829cd0fdfad1c09d9d6b93e12f422c8c58a5c84b6899be9f5c78 b3fa1a394bceca3dc34efd044e430498d7d3bb9c5032290eaab87021fda2388a f13efe92613284bac3a4d09b1e8eca45d0f36a84ec238be125975a8eca28119c"
if [ "$H" = "$PUB" ]; then ok "executed == published build ${PUB:0:8}"
elif [[ " $PREV " == *" $H "* ]]; then ok "executed == previous build ${H:0:8}, superseded by ${PUB:0:8}"
else bad "executed $H != published build $PUB"; fi
URL="${FASTFS_BASE:-https://main.fastfs.io}/${P%%/*}/outlayer.near/$H.wasm"
F=$(curl -fsS "$URL" | sha256sum | cut -d' ' -f1)
[ "$F" = "$H" ] && ok "FastFS $URL sha256 matches" || bad "FastFS sha256 $F"
if [ "${2:-}" = "--rebuild" ]; then
  B=$("$(dirname "$0")/tee/worker/build.sh")
  [ "$B" = "$H" ] && ok "local reproducible build matches executed wasm ($B)" || bad "local build $B differs from executed $H"
  echo "note  worker_measurement is the TDX RTMR3 measurement of the OutLayer worker image. It is not the wasm sha256."
fi
exit $fail
