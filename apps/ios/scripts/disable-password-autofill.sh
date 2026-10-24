#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: disable-password-autofill.sh <simulator-udid>" >&2
  exit 2
fi

# The restriction lives in profile files a simulator creates on first boot and reads only at boot.
DEVICE="$HOME/Library/Developer/CoreSimulator/Devices/$1/data"
PROFILE="$DEVICE/Library/UserConfigurationProfiles/EffectiveUserSettings.plist"
SETTINGS="$DEVICE/Containers/Shared/SystemGroup/systemgroup.com.apple.configurationprofiles/Library/ConfigurationProfiles/UserSettings.plist"
STATE=$(xcrun simctl list devices --json | python3 -c '
import json, sys
for devices in json.load(sys.stdin)["devices"].values():
    for device in devices:
        if device["udid"] == sys.argv[1]:
            print(device["state"])
' "$1")

write_profiles() {
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
' "$PROFILE" "$SETTINGS"
}

profile_applied() {
  python3 -c '
import plistlib, sys

try:
    with open(sys.argv[1], "rb") as file:
        value = plistlib.load(file)["restrictedBool"]["allowPasswordAutoFill"]["value"]
except (OSError, KeyError, plistlib.InvalidFileException):
    sys.exit(1)
sys.exit(0 if value is False else 1)
' "$PROFILE"
}

# A simulator that has never booted gets the files before its first boot, which then is the only boot
# when the simulator keeps them.
first_boot_with_profiles() {
  write_profiles && xcrun simctl boot "$1" && xcrun simctl bootstatus "$1" -b > /dev/null && profile_applied
}

if [ "$STATE" = "Shutdown" ] && [ ! -f "$PROFILE" ]; then
  if first_boot_with_profiles "$1"; then
    exit 0
  fi
  echo "the first boot did not keep the profile files, booting again" >&2
  xcrun simctl shutdown "$1" || true
elif [ "$STATE" != "Shutdown" ]; then
  xcrun simctl bootstatus "$1" -b > /dev/null
  xcrun simctl shutdown "$1"
fi

write_profiles
xcrun simctl boot "$1"
xcrun simctl bootstatus "$1" -b > /dev/null
