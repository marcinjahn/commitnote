#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: disable-password-autofill.sh <simulator-udid>" >&2
  exit 2
fi

# The restriction lives in profile files a simulator creates on first boot and reads only at boot.
DEVICE="$HOME/Library/Developer/CoreSimulator/Devices/$1/data"
PROFILE="$DEVICE/Library/UserConfigurationProfiles/EffectiveUserSettings.plist"
STATE=$(xcrun simctl list devices --json | python3 -c '
import json, sys
for devices in json.load(sys.stdin)["devices"].values():
    for device in devices:
        if device["udid"] == sys.argv[1]:
            print(device["state"])
' "$1")
# A simulator that has booted before already has the files, so it needs only the one boot.
if [ "$STATE" != "Shutdown" ] || [ ! -f "$PROFILE" ]; then
  xcrun simctl bootstatus "$1" -b > /dev/null
  xcrun simctl shutdown "$1"
fi

python3 -c '
import os, plistlib, sys

for path in sys.argv[1:]:
    settings = {}
    if os.path.exists(path):
        with open(path, "rb") as file:
            settings = plistlib.load(file)
    else:
        os.makedirs(os.path.dirname(path), exist_ok=True)
    settings.setdefault("restrictedBool", {})["allowPasswordAutoFill"] = {"value": False}
    with open(path, "wb") as file:
        plistlib.dump(settings, file, fmt=plistlib.FMT_BINARY)
    print("password AutoFill disabled in", path)
' \
  "$PROFILE" \
  "$DEVICE/Containers/Shared/SystemGroup/systemgroup.com.apple.configurationprofiles/Library/ConfigurationProfiles/UserSettings.plist"

xcrun simctl boot "$1"
xcrun simctl bootstatus "$1" -b > /dev/null
