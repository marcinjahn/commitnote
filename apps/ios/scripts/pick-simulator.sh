#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: pick-simulator.sh <iphone|ipad>" >&2
  exit 2
fi

case "$1" in
  iphone) PREFIX="iPhone"; PREFERRED="iPhone 17 Pro|iPhone 17|iPhone 16 Pro|iPhone 16" ;;
  ipad) PREFIX="iPad"; PREFERRED="iPad Pro 11-inch (M5)|iPad Pro 11-inch (M4)|iPad Air 11-inch (M3)|iPad Air 11-inch (M2)|iPad Pro 13-inch (M5)|iPad Pro 13-inch (M4)" ;;
  *) echo "usage: pick-simulator.sh <iphone|ipad>" >&2; exit 2 ;;
esac

xcrun simctl list devices available --json | python3 -c '
import json, re, sys

prefix, preferred = sys.argv[1], sys.argv[2].split("|")
runtimes = json.load(sys.stdin)["devices"]

def version(runtime):
    match = re.search(r"iOS-([0-9-]+)$", runtime)
    return tuple(int(part) for part in match.group(1).split("-")) if match else None

ios = sorted(
    (r for r in runtimes if version(r) is not None),
    key=version,
    reverse=True,
)

def usable(runtime):
    return [d for d in runtimes[runtime] if d.get("isAvailable", True)]

for runtime in ios:
    devices = usable(runtime)
    for name in preferred:
        for device in devices:
            if device["name"] == name:
                print(device["udid"])
                sys.exit(0)

for runtime in ios:
    for device in usable(runtime):
        if device["name"].startswith(prefix):
            print(device["udid"])
            sys.exit(0)

sys.exit("no available " + prefix + " simulator found")
' "$PREFIX" "$PREFERRED"
