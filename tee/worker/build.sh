#!/usr/bin/env bash
# Reproducible build of the KEYHOLE worker. Same toolchain + Cargo.lock + path remapping => same sha256 anywhere.
set -euo pipefail
cd "$(dirname "$0")"
CH="${CARGO_HOME:-$HOME/.cargo}"
export RUSTFLAGS="--remap-path-prefix=$CH=/cargo --remap-path-prefix=$PWD=/keyhole-worker"
export CARGO_INCREMENTAL=0 SOURCE_DATE_EPOCH=0
cargo build --locked --release --target wasm32-wasip2 >&2
sha256sum "${CARGO_TARGET_DIR:-target}/wasm32-wasip2/release/keyhole-worker.wasm" | cut -d' ' -f1
