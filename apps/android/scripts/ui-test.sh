#!/bin/sh
set -eu

if [ ! -e /dev/kvm ]; then
  echo "Instrumented tests need an Android emulator, which needs /dev/kvm; none is available here. They run in the Android workflow." >&2
  exit 1
fi

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is not on the PATH; the emulator's adb server is needed to follow the device log." >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# Gradle does not print the device log, which is where the measurements of the tests are reported.
adb logcat -c
adb logcat -s Commitnote:I &
logcat_pid=$!
trap 'kill "$logcat_pid" 2>/dev/null || true' EXIT

status=0
# The container's adb must reach the adb server and emulator of the host.
"$script_dir/container.sh" --host-network ./gradlew :app:connectedFakeAndroidTest || status=$?

# Let the logcat stream deliver the last lines before it is stopped.
sleep 2
exit "$status"
