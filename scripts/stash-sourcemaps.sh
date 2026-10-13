#!/usr/bin/env bash
# Zeus — move the build sourcemaps OUT of the served directory.
#
# [2026-10-13] The build emits sourcemaps as 'hidden': the .map files are
# produced, but no sourceMappingURL comment goes into the bundle, so no browser
# learns they exist. They still land in public/app/assets, which Express serves,
# so they must not stay there. This moves them to a sibling directory that
# nothing serves, keyed by build number so an old map survives for an old
# bundle still cached on someone phone.
#
# Run this straight after `npm run build`. Not running it is not a disaster —
# nginx returns 404 for *.map — but belt and braces are both wanted here,
# because M18 (no source disclosure in production) is a security decision and
# this must not quietly undo it.
set -euo pipefail

ROOT=/opt/zeus-terminal
SERVED="$ROOT/public/app/assets"
BUILD=$(node -e "console.log(require('$ROOT/server/version.js').build)")
DEST="$ROOT/sourcemaps/b$BUILD"

mkdir -p "$DEST"
n=0
shopt -s nullglob
for m in "$SERVED"/*.map; do
  mv "$m" "$DEST/"
  n=$((n+1))
done
shopt -u nullglob

# A map is the source. Keep it readable only by the owner.
chmod 700 "$ROOT/sourcemaps" "$DEST" 2>/dev/null || true
chmod 600 "$DEST"/*.map 2>/dev/null || true

echo "stashed $n sourcemap(s) -> $DEST"

# Belt: prove none stayed behind, and that the bundle does not point at one.
# Counted with a glob, not `ls | wc -l`: under `set -o pipefail` a glob that
# matches nothing makes ls exit non-zero and takes the whole script down with
# it, reporting failure for the one outcome we actually want.
shopt -s nullglob
leftf=( "$SERVED"/*.map ); left=${#leftf[@]}
reff=( $(grep -l "sourceMappingURL" "$SERVED"/*.js 2>/dev/null || true) ); ref=${#reff[@]}
shopt -u nullglob
[ "$left" = "0" ] || { echo "REFUSING: $left map(s) still in the served directory"; exit 1; }
[ "$ref" = "0" ]  || { echo "REFUSING: $ref bundle file(s) carry a sourceMappingURL comment"; exit 1; }
echo "verified: no maps served, no sourceMappingURL in any bundle"
