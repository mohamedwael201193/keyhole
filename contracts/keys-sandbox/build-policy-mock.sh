#!/usr/bin/env bash
# LOCAL MOCK BUILD ONLY: no custody keystore, real provider call, deployment or funds.
set -euo pipefail
cd "$(dirname "$0")/race-receiver"
CH="${CARGO_HOME:-$HOME/.cargo}"
cargo near build non-reproducible-wasm --locked --no-embed-abi \
  --env "RUSTFLAGS=--remap-path-prefix=$CH=/cargo --remap-path-prefix=$PWD=/keyhole-policy-mock"
cp target/near/race_receiver.wasm ../tests/fixtures/custody_policy_mock.wasm
sha256sum ../tests/fixtures/custody_policy_mock.wasm
