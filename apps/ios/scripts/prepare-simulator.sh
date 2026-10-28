#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: prepare-simulator.sh <simulator-udid>" >&2
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

# Keynote mode stops PosterBoard prewarming its wallpaper gallery after every boot. The prewarm
# runs about 30 poster extensions of 300 MB each, which swaps a 7 GB CI runner for minutes and
# slows every UI query, launch and terminate. PosterBoard resets its defaults on first boot, so they
# are written after it.
POSTERBOARD="$DEVICE/Library/Preferences/com.apple.PosterBoard.unprotectedUserDefaults.plist"

python3 -c '
import os, plistlib, sys

def update(path, change):
    settings = {}
    if os.path.exists(path):
        with open(path, "rb") as file:
            settings = plistlib.load(file)
    else:
        os.makedirs(os.path.dirname(path), exist_ok=True)
    change(settings)
    with open(path, "wb") as file:
        plistlib.dump(settings, file, fmt=plistlib.FMT_BINARY)

def disable_autofill(settings):
    settings.setdefault("restrictedBool", {})["allowPasswordAutoFill"] = {"value": False}

for path in sys.argv[1:3]:
    update(path, disable_autofill)
    print("password AutoFill disabled in", path)
update(sys.argv[3], lambda settings: settings.update(KEYNOTE_MODE=True))
print("PosterBoard keynote mode set in", sys.argv[3])
' \
  "$PROFILE" \
  "$DEVICE/Containers/Shared/SystemGroup/systemgroup.com.apple.configurationprofiles/Library/ConfigurationProfiles/UserSettings.plist" \
  "$POSTERBOARD"

xcrun simctl boot "$1"
xcrun simctl bootstatus "$1" -b > /dev/null

if [ "$(xcrun simctl spawn "$1" defaults read com.apple.PosterBoard.unprotectedUserDefaults KEYNOTE_MODE 2>/dev/null)" != 1 ]; then
  echo "::warning::PosterBoard dropped keynote mode; the wallpaper gallery prewarm will run during the tests"
fi
