#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
C="${KEYS_CONTRACT:-keyhole-devmo.near}"; RPC="${NEAR_RPC:-https://rpc.mainnet.fastnear.com}"
q(){ curl -fsS "$RPC" -H 'content-type: application/json' -d "$1"; }
CH=$(q '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"'"$C"'"}}' | jq -r .result.code_hash)
LOCAL=$(sha256sum contracts/keys/deployed/keyhole_keys.wasm | cut -d' ' -f1)
LOCAL58=$(python3 -c "import sys;h=bytes.fromhex('$LOCAL');a='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';n=int.from_bytes(h,'big');s='';
while n: n,r=divmod(n,58); s=a[r]+s
print(s)")
echo "on-chain code_hash  $CH"; echo "repo wasm (base58)  $LOCAL58  (sha256 $LOCAL)"
[ "$CH" = "$LOCAL58" ] && echo "OK   contract code matches the committed wasm" || { echo "FAIL contract code differs"; exit 1; }
ARGS=$(printf '{}' | base64)
CFG=$(q '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"'"$C"'","method_name":"config","args_base64":"'"$ARGS"'"}}' | jq -r '.result.result | implode')
echo "config $CFG"
M=$(jq -r .minter <<<"$CFG")
[ ${#M} -eq 64 ] && echo "OK   minter is an implicit account ($M); its key was generated inside the TEE (see worker op info in evidence)" || echo "WARN minter is not an implicit account"
