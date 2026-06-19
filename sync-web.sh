#!/usr/bin/env bash
# Copy the latest web app into the Mac app bundle's resource folder.
# Run from anywhere; paths are resolved relative to this script.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$ROOT/mac/WorkPlanner/web"

mkdir -p "$DEST"
cp "$ROOT/index.html" "$ROOT/app.js" "$ROOT/styles.css" "$ROOT/icon.svg" "$ROOT/manifest.webmanifest" "$DEST/"
rm -rf "$DEST/icons"
cp -r "$ROOT/icons" "$DEST/icons"
echo "Synced web app -> $DEST"
