#!/usr/bin/env bash
# LOCAL BUILD ONLY: never deploys, funds, or updates a live identity.
set -euo pipefail
cd "$(dirname "$0")"
CH="${CARGO_HOME:-$HOME/.cargo}"
[ "$(cargo near --version | awk '{print $2}')" = "0.22.0" ] || { echo "cargo-near 0.22.0 required" >&2; exit 1; }
# Capture rustc -vV first: grep -q on a live rustc pipe can exit 141 (SIGPIPE) under pipefail.
rustc_vv="$(rustc -vV)"
grep -q '^commit-hash: 05f9846f893b09a1be1fc8560e33fc3c815cfecb$' <<<"$rustc_vv" || { echo "Release requires rustc 1.86.0 (commit 05f9846f89)" >&2; exit 1; }
grep -q '^host: x86_64-unknown-linux-gnu$' <<<"$rustc_vv" || { echo "Release requires pinned Linux host + official wasm32 target (not a locally rebuilt std)" >&2; exit 1; }

# Keep off-chain ABI JSON; omit the optional on-chain compressed ABI export.
# Stable panic/source paths avoid baking machine-local registry/checkout names into code.
# cargo-near may reuse a newer final Wasm; never post-optimize an already optimized output.
# Preserve the previous local artifact and force its normal optimizer to read fresh Rust output.
if [[ -f target/near/keyhole_keys.wasm ]]; then
  mv target/near/keyhole_keys.wasm target/near/keyhole_keys.previous.wasm
fi
cargo near build non-reproducible-wasm --locked --no-embed-abi \
  --env "RUSTFLAGS=--remap-path-prefix=$CH=/cargo --remap-path-prefix=$PWD=/keyhole-contract" "$@"

# cargo-near already applies wasm-opt -O. A pinned second pass reduces size further.
# Never snip code, disable arithmetic checks, remove exports, or change live identities.
optimizer="$(../../scripts/install-wasm-opt.sh)"
BINARYEN_CORES=1 "$optimizer" -Oz --converge --strip-debug --strip-producers   target/near/keyhole_keys.wasm -o target/near/keyhole_keys.optimized.wasm
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
v['metadata']['build']['builder']=v['metadata']['build']['builder'].split('; Binaryen')[0]+'; Binaryen 123 -Oz --converge'
p.write_text(json.dumps(v,indent=2)+'\n')
PYABI
# Custom build-std artifacts once embedded /home/devmo/.rustup/... standard-library paths.
# Official Rust 1.86 target uses /rustc/<commit>/library/... and reproduces on clean Linux CI.
python3 - <<'PYPATH'
from pathlib import Path
import re
if re.search(rb"/(?:home|Users)/[^\0]{0,256}\.rustup", Path('target/near/keyhole_keys.wasm').read_bytes()):
    raise SystemExit('Machine-local standard-library paths: reinstall official rustup wasm32 target')
PYPATH
sha256sum target/near/keyhole_keys.wasm
