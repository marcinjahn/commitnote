#!/bin/sh
set -eu

package=io.github.marcinjahn.commitnote
# The startup screens are transient, so wait for a marker that only the login screen shows.
login_marker='Access token'
startup_failure='Commitnote can.{1,10}t start'
timeout_seconds=60
poll_seconds=2

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is not on the PATH; the emulator's adb server is needed to install the release APK." >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
release_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)/out/release

apk=
for candidate in commitnote-android-x86_64-debugsigned.apk commitnote-android-x86_64.apk; do
  if [ -f "$release_dir/$candidate" ]; then
    apk="$release_dir/$candidate"
    break
  fi
done
if [ -z "$apk" ]; then
  echo "No x86_64 release APK in $release_dir; run 'just android release' first." >&2
  exit 1
fi

ui_dump=
fail() {
  echo "$1" >&2
  echo "--- crash log ---" >&2
  adb logcat -d | grep -E 'FATAL EXCEPTION|AndroidRuntime' >&2 || echo "(no FATAL EXCEPTION or AndroidRuntime lines)" >&2
  echo "--- last UI dump ---" >&2
  printf '%s\n' "$ui_dump" >&2
  exit 1
}

adb uninstall "$package" >/dev/null 2>&1 || true
adb install "$apk"
adb logcat -c
adb shell am start -W -n "$package/.MainActivity"

waited=0
while [ "$waited" -lt "$timeout_seconds" ]; do
  if [ -z "$(adb shell pidof "$package" | tr -d '\r')" ]; then
    fail "The release app is not running after launch."
  fi
  ui_dump=$(adb exec-out uiautomator dump /dev/tty 2>/dev/null || true)
  if printf '%s\n' "$ui_dump" | grep -q -E "$startup_failure"; then
    fail "The release app reports that it cannot start."
  fi
  if printf '%s\n' "$ui_dump" | grep -q -F "$login_marker"; then
    echo "release smoke passed"
    exit 0
  fi
  sleep "$poll_seconds"
  waited=$((waited + poll_seconds))
done

fail "The login screen did not appear within ${timeout_seconds}s."
