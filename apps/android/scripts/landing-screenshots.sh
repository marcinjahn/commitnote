#!/bin/sh
set -eu

if [ ! -e /dev/kvm ]; then
  echo "Landing screenshots need an Android emulator, which needs /dev/kvm; none is available here. The \"Android screenshots\" workflow takes them." >&2
  exit 1
fi

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is not on the PATH; it is needed to set up the emulator and to pull the screenshots." >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
out_dir=${1:?usage: landing-screenshots.sh <out-dir>}
device_dir=/data/local/tmp/commitnote-landing-screenshots

adb shell cmd overlay enable com.android.internal.systemui.navbar.gestural

adb shell rm -rf "$device_dir"
"$script_dir/container.sh" --host-network ./gradlew :app:connectedFakeAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.package=io.github.marcinjahn.commitnote.screenshots

mkdir -p "$out_dir"
for view in tree note; do
  for appearance in light dark; do
    adb pull "$device_dir/android-$view-$appearance.png" "$out_dir/"
  done
done
