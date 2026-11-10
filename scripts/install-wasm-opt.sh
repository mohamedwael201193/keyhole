#!/usr/bin/env bash
# Box/CI build tool only. No deployment, credential, or live-state access.
set -euo pipefail
[[ "$(uname -s) $(uname -m)" == 'Linux x86_64' ]] || { echo 'Pinned optimizer requires Linux x86_64' >&2; exit 1; }
version=123
archive_sha=e959f2170af4c20c552e9de3a0253704d6a9d2766e8fdb88e4d6ac4bae9388fe
binary_sha=d66c6724c07334155720eb2def29c434dcaaf741ce859b4f7f389e22674f9c4a
cache="${KEYHOLE_TOOL_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/keyhole}"
archive="$cache/binaryen-version_${version}-x86_64-linux.tar.gz"
binary="$cache/binaryen-version_${version}/bin/wasm-opt"
mkdir -p "$cache"
if [[ ! -f "$binary" ]]; then
  if [[ ! -f "$archive" ]]; then
    curl --proto '=https' --tlsv1.2 -fL --retry 2 --max-time 180       "https://github.com/WebAssembly/binaryen/releases/download/version_${version}/binaryen-version_${version}-x86_64-linux.tar.gz" -o "$archive"
  fi
  printf '%s  %s\n' "$archive_sha" "$archive" | sha256sum -c - >&2
  tar -xzf "$archive" -C "$cache" "binaryen-version_${version}/bin/wasm-opt"
fi
printf '%s  %s\n' "$binary_sha" "$binary" | sha256sum -c - >&2
printf '%s\n' "$binary"
