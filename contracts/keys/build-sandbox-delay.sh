#!/usr/bin/env bash
# Sandbox fixture ONLY. Shrinks the upgrade timelock and the disbursement window to 30s.
# Never a release artifact: contracts/keys/build.sh refuses this feature, and this script
# does not set cfg keyhole_release. Do not deploy the output.
set -euo pipefail
cd "$(dirname "$0")"
if ./build.sh --features sandbox-short-delay >/tmp/keyhole-short-delay-refuse.txt 2>&1; then
  echo "build.sh must refuse sandbox-short-delay" >&2
  exit 1
fi
grep -q "refuses sandbox-short-delay" /tmp/keyhole-short-delay-refuse.txt

CH="${CARGO_HOME:-$HOME/.cargo}"
[ "$(cargo near --version | awk '{print $2}')" = "0.22.0" ] || { echo "cargo-near 0.22.0 required" >&2; exit 1; }
rustc_vv="$(rustc -vV)"
grep -q '^commit-hash: 05f9846f893b09a1be1fc8560e33fc3c815cfecb$' <<<"$rustc_vv" || { echo "rustc 1.86.0 required" >&2; exit 1; }

saved=""
if [[ -f target/near/keyhole_keys.wasm ]]; then
  saved="$(mktemp)"
  cp target/near/keyhole_keys.wasm "$saved"
fi
cleanup() {
  mkdir -p target/near
  if [[ -n "$saved" && -f "$saved" ]]; then
    cp "$saved" target/near/keyhole_keys.wasm
    rm -f "$saved"
  else
    rm -f target/near/keyhole_keys.wasm
  fi
}
trap cleanup EXIT

cargo near build non-reproducible-wasm --locked --no-embed-abi --features sandbox-short-delay \
  --env "RUSTFLAGS=--remap-path-prefix=$CH=/cargo --remap-path-prefix=$PWD=/keyhole-contract"
optimizer="$(../../scripts/install-wasm-opt.sh)"
BINARYEN_CORES=1 "$optimizer" -Oz --converge --strip-debug --strip-producers \
  target/near/keyhole_keys.wasm -o target/near/keyhole_keys.sandbox-delay.wasm
out="../keys-sandbox/tests/fixtures/v27_short_delay.wasm"
mkdir -p "$(dirname "$out")"
cp target/near/keyhole_keys.sandbox-delay.wasm "$out"
# The release wasm is restored by the trap. Do not leave the short-delay module as the default artifact.
rm -f target/near/keyhole_keys.sandbox-delay.wasm
sha256sum "$out"
echo "sandbox-short-delay fixture only; release delay stays 24h"
