#!/bin/sh
set -eu

ALLOW_EMPTY=0
if [ "$#" -eq 3 ] && [ "$3" = "--allow-empty" ]; then
  ALLOW_EMPTY=1
elif [ "$#" -ne 2 ]; then
  echo "usage: export-screenshots.sh <xcresult> <out-dir> [--allow-empty]" >&2
  exit 2
fi

XCRESULT=$1
OUT=$2
EXPORT_DIR=$(mktemp -d)
mkdir -p "$OUT"

xcrun xcresulttool export attachments --path "$XCRESULT" --output-path "$EXPORT_DIR"

python3 - "$EXPORT_DIR" "$OUT" "$ALLOW_EMPTY" <<'PY'
import json, os, re, shutil, sys

export_dir, out_dir, allow_empty = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
manifest_path = os.path.join(export_dir, "manifest.json")
if allow_empty and not os.path.exists(manifest_path):
    print("exported 0 screenshots")
    sys.exit(0)
with open(manifest_path) as handle:
    manifest = json.load(handle)

pattern = re.compile(r"^(iphone|ipad)-(light|dark)-[a-z-]+")
copied = 0
for test in manifest:
    for attachment in test.get("attachments", []):
        match = pattern.match(attachment.get("suggestedHumanReadableName", ""))
        if not match:
            continue
        source = os.path.join(export_dir, attachment["exportedFileName"])
        shutil.copyfile(source, os.path.join(out_dir, match.group(0) + ".png"))
        copied += 1

if copied == 0 and not allow_empty:
    sys.exit("no screenshots exported")
print("exported %d screenshots" % copied)
PY
