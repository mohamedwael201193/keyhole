#!/usr/bin/env bash
# LOCAL BUILD ONLY: never deploys, funds, or updates a live identity.
set -euo pipefail
cd "$(dirname "$0")"
CH="${CARGO_HOME:-$HOME/.cargo}"
# Keep off-chain ABI JSON; omit the optional on-chain compressed ABI export.
# Stable panic/source paths avoid baking machine-local registry/checkout names into code.
cargo near build non-reproducible-wasm --locked --no-embed-abi \
  --env "RUSTFLAGS=--remap-path-prefix=$CH=/cargo --remap-path-prefix=$PWD=/keyhole-contract" "$@"

# cargo-near already applies wasm-opt -O. A pinned second pass reduces size further.
# Never snip code, disable arithmetic checks, remove exports, or change live identities.
optimizer="$(../../scripts/install-wasm-opt.sh)"
"$optimizer" -Oz --converge --strip-debug --strip-producers   target/near/keyhole_keys.wasm -o target/near/keyhole_keys.optimized.wasm
mv target/near/keyhole_keys.optimized.wasm target/near/keyhole_keys.wasm
# Keep the generated off-chain ABI's code hash honest after post-processing.
python3 - <<'PYABI'
from pathlib import Path
import hashlib,json
p=Path('target/near/keyhole_keys_abi.json')
v=json.loads(p.read_text());digest=hashlib.sha256(Path('target/near/keyhole_keys.wasm').read_bytes()).digest()
n=int.from_bytes(digest,'big');alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';out=''
while n:n,r=divmod(n,58);out=alphabet[r]+out
v['metadata']['wasm_hash']='1'*(len(digest)-len(digest.lstrip(b'\0')))+out
v['metadata']['build']['builder']+='; Binaryen 123 -Oz --converge'
p.write_text(json.dumps(v,indent=2)+'\n')
PYABI
sha256sum target/near/keyhole_keys.wasm
