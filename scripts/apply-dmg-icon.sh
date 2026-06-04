#!/usr/bin/env bash
set -euo pipefail

DMG_PATH="${1:-release/token-panic-0.1.0-arm64.dmg}"
ICON_PNG="${2:-build/icon.iconset/icon_512x512.png}"

if [[ ! -f "$DMG_PATH" ]]; then
  echo "DMG not found: $DMG_PATH" >&2
  exit 1
fi

if [[ ! -f "$ICON_PNG" ]]; then
  echo "Icon PNG not found: $ICON_PNG" >&2
  exit 1
fi

TMP_ICON="$(mktemp -t token-panic-dmg-icon).png"
TMP_RSRC="$(mktemp -t token-panic-dmg-icon).rsrc"
trap 'rm -f "$TMP_ICON" "$TMP_RSRC"' EXIT

cp "$ICON_PNG" "$TMP_ICON"
sips -i "$TMP_ICON" >/dev/null
DeRez -only icns "$TMP_ICON" > "$TMP_RSRC"
Rez -append "$TMP_RSRC" -o "$DMG_PATH"
SetFile -a C "$DMG_PATH"
