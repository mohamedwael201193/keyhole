#!/usr/bin/env bash
# Thin alias for judge/1-contract.sh (same checks, same output).
# Usage (from a checkout): bash verify/1-contract.sh --strict
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
exec "$ROOT/judge/1-contract.sh" "$@"
