#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# --strict rejects identity/config/version mismatches; --rebuild adds byte equality.
STRICT=0; REBUILD=0
for arg in "$@"; do
  case "$arg" in --strict) STRICT=1;; --rebuild) REBUILD=1;; *) echo "unknown argument: $arg" >&2; exit 2;; esac
done
if [ "$REBUILD" -eq 1 ]; then
  (cd contracts/keys && CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" ./build.sh)
  cmp contracts/keys/target/near/keyhole_keys.wasm contracts/keys/deployed/keyhole_keys.wasm
  echo "OK   reproducible contract rebuild == committed deployed wasm"
fi
C="${KEYS_CONTRACT:-keyhole-devmo.near}"; RPC="${NEAR_RPC:-https://rpc.mainnet.fastnear.com}"
q(){ curl -fsS --max-time 30 "$RPC" -H 'content-type: application/json' -d "$1"; }
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

if [ "$STRICT" -eq 1 ]; then
  export VERIFY_CONTRACT="$C" VERIFY_RPC="$RPC"
  python3 - <<'PYVERIFY'
import base64,hashlib,json,os,urllib.request
identity=json.load(open('identity.json'))['contract']
def query(kind,**kw):
 req=urllib.request.Request(os.environ['VERIFY_RPC'],data=json.dumps({'jsonrpc':'2.0','id':'strict-read-only','method':'query','params':dict(request_type=kind,account_id=os.environ['VERIFY_CONTRACT'],**kw)}).encode(),headers={'content-type':'application/json','User-Agent':'KEYHOLE-release-verifier/2.6 (+https://github.com/mohamedwael201193/keyhole)'})
 with urllib.request.urlopen(req,timeout=30) as r:j=json.load(r)
 if 'error' in j:raise RuntimeError(j['error'])
 return j['result']
a=query('view_account',finality='final');block=a['block_hash']
def view(method):return json.loads(bytes(query('call_function',block_id=block,method_name=method,args_base64='e30=')['result']))
code=base64.b64decode(query('view_code',block_id=block)['code_base64'])
assert a['code_hash']==identity['code_hash'],'live hash != identity'
assert hashlib.sha256(code).hexdigest()==identity['wasm_sha256'],'live bytes != identity'
assert code==open('contracts/keys/deployed/keyhole_keys.wasm','rb').read(),'live bytes != repository'
assert view('contract_source_metadata')['version']==identity['version'],'NEP-330 version mismatch'
assert view('config')['minter']==identity['minter'],'minter mismatch'
print('PASS strict online contract identity, actual code bytes, version and minter at final block',block)
PYVERIFY
fi
