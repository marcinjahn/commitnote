#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: sibling-simulator.sh <simulator-udid>" >&2
  exit 2
fi

# A second simulator of the same model and runtime, so two test runs can share one runner.
xcrun simctl list devices --json | python3 -c '
import json, sys

udid = sys.argv[1]
for runtime, devices in json.load(sys.stdin)["devices"].items():
    for device in devices:
        if device["udid"] == udid:
            print(device["deviceTypeIdentifier"], runtime)
            sys.exit(0)
sys.exit("simulator " + udid + " not found")
' "$1" | {
  read -r DEVICE_TYPE RUNTIME
  xcrun simctl create "Commitnote UI tests 2" "$DEVICE_TYPE" "$RUNTIME"
}
