#!/bin/sh
set -eu

if [ ! -e /dev/kvm ]; then
  echo "Instrumented tests need an Android emulator, which needs /dev/kvm; none is available here. They run in the Android workflow." >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# The container's adb must reach the adb server and emulator of the host.
exec "$script_dir/container.sh" --host-network ./gradlew :app:connectedFakeAndroidTest
