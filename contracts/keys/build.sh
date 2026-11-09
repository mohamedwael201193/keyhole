#!/usr/bin/env bash
# LOCAL BUILD ONLY: never deploys, funds, or updates a live identity.
set -euo pipefail
cd "$(dirname "$0")"
CH="${CARGO_HOME:-$HOME/.cargo}"
# Keep off-chain ABI JSON; omit the optional on-chain compressed ABI export.
# Stable panic/source paths avoid baking machine-local registry/checkout names into code.
cargo near build non-reproducible-wasm --locked --no-embed-abi \
  --env "RUSTFLAGS=--remap-path-prefix=$CH=/cargo --remap-path-prefix=$PWD=/keyhole-contract" "$@"
