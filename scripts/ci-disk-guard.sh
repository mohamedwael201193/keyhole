#!/usr/bin/env bash
# CI pre-job disk guard for the self-hosted runners.
# Deletes ONLY directories named `target` or `.next` under the runner work dir
# (_work) whose mtime is older than KH_DISK_GUARD_HOURS (default 12). Nothing else.
set -euo pipefail
HOURS="${KH_DISK_GUARD_HOURS:-12}"
WORK="$(dirname "${RUNNER_WORKSPACE:?RUNNER_WORKSPACE not set}")"   # .../_work
case "$WORK" in */_work) ;; *) echo "disk-guard: unexpected work dir $WORK, skipping"; exit 0;; esac
echo "disk-guard: before"; { df -h "$WORK" | tail -1; } || true
find "$WORK" -maxdepth 6 -type d \( -name target -o -name .next \) -not -path '*/node_modules/*' -mmin +$((HOURS * 60)) -prune -print0 |
  while IFS= read -r -d '' d; do echo "disk-guard: rm $d"; rm -rf -- "$d"; done
echo "disk-guard: after"; { df -h "$WORK" | tail -1; } || true
