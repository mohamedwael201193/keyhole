#!/usr/bin/env bash
# Thin alias for judge/0-live.sh (same checks, same output).
# Usage (from a checkout): bash verify/0-live.sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
exec "$ROOT/judge/0-live.sh" "$@"
