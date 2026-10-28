#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
API="${OUTLAYER_API:-https://api.outlayer.ai}"; fail=0
while IFS= read -r row; do
  id=$(jq -r .call_id <<<"$row"); name=$(jq -r .name <<<"$row"); out=$(jq -c .output <<<"$row")
  A=$(curl -fsS "$API/attestations/by-call/$id")
  h=$(jq -r .executed_wasm_sha256 <<<"$A"); oh=$(jq -r .output_hash <<<"$A")
  mine=$(printf '%s' "$out" | jq -cS . | tr -d '\n' | sha256sum | cut -d' ' -f1)
  if [ "$mine" = "$oh" ]; then s=OK; else s=FAIL; fail=1; fi
  pub=$(tr -d '[:space:]' < tee/worker/DEPLOYED_SHA256)
  note=""; [ "$h" = "$pub" ] || note="  earlier build, superseded by ${pub:0:8}"
  printf '%-4s %-36s %-28s wasm %s  %s%s\n' "$s" "$id" "$name" "${h:0:12}" "$(jq -r '.output.error.code // (if .output.ok then "ok" else "" end)' <<<"$row")" "$note"
done < <(jq -c '.[]' judge/evidence.json)
exit $fail
