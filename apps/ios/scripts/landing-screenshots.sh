#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: landing-screenshots.sh <exported-screenshots-dir> <out-dir>" >&2
  exit 2
fi

IN=$1
OUT=$2
# iPhone screenshots are taken at 3x, so a third of their width is the logical (@1x) width.
SCALE=3
mkdir -p "$OUT"

COUNT=0
for VIEW in tree note; do
  for APPEARANCE in light dark; do
    SOURCE="$IN/iphone-$APPEARANCE-store-$VIEW.png"
    if [ ! -f "$SOURCE" ]; then
      echo "missing $SOURCE" >&2
      exit 1
    fi
    WIDTH=$(sips -g pixelWidth "$SOURCE" | awk '/pixelWidth/ { print $2 }')
    LOGICAL=$((WIDTH / SCALE))
    sips --resampleWidth "$LOGICAL" "$SOURCE" --out "$OUT/ios-$VIEW-$APPEARANCE@1x.png" >/dev/null
    sips --resampleWidth $((LOGICAL * 2)) "$SOURCE" --out "$OUT/ios-$VIEW-$APPEARANCE@2x.png" >/dev/null
    COUNT=$((COUNT + 2))
  done
done
echo "wrote $COUNT landing screenshots to $OUT"
