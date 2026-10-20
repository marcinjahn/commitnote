#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: export-screenshots.sh <xcresult> <out-dir>" >&2
  exit 2
fi

XCRESULT=$1
OUT=$2
EXPORT_DIR=$(mktemp -d)
mkdir -p "$OUT"

xcrun xcresulttool export attachments --path "$XCRESULT" --output-path "$EXPORT_DIR"

python3 - "$EXPORT_DIR" "$OUT" <<'PY'
import json, os, re, shutil, sys

export_dir, out_dir = sys.argv[1], sys.argv[2]
with open(os.path.join(export_dir, "manifest.json")) as handle:
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

if copied == 0:
    sys.exit("no screenshots exported")
print("exported %d screenshots" % copied)
PY
