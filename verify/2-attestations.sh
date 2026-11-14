#!/usr/bin/env bash
# Thin alias for judge/2-attestations.sh (same checks, same output).
# Usage (from a checkout): bash verify/2-attestations.sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
exec "$ROOT/judge/2-attestations.sh" "$@"
