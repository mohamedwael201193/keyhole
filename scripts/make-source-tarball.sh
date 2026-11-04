#!/usr/bin/env bash
# Builds the judge source tarball from a commit (default HEAD) with `git archive` (gzip -n: no timestamp),
# writes web/public/source/{keyhole-src.tar.gz,keyhole-src.tar.gz.sha256,manifest.json}. Served by the site at /source/.
# usage: scripts/make-source-tarball.sh [commit]
set -euo pipefail
cd "$(dirname "$0")/.."
REV=$(git rev-parse "${1:-HEAD}")
OUT=web/public/source; mkdir -p "$OUT"
git archive --format=tar --prefix=keyhole/ "$REV" | gzip -n -9 > "$OUT/keyhole-src.tar.gz"
SHA=$(sha256sum "$OUT/keyhole-src.tar.gz" | cut -d' ' -f1)
echo "$SHA  keyhole-src.tar.gz" > "$OUT/keyhole-src.tar.gz.sha256"
BYTES=$(wc -c < "$OUT/keyhole-src.tar.gz")
printf '{"commit":"%s","sha256":"%s","bytes":%s,"files":%s}\n' "$REV" "$SHA" "$BYTES" "$(git ls-tree -r --name-only "$REV" | grep -vc '^web/public/source/')" > "$OUT/manifest.json"
echo "OK $OUT/keyhole-src.tar.gz commit $REV sha256 $SHA ($BYTES bytes)"
