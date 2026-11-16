# Android app recipes, run as `just android <recipe>`. The container builds embed the core bundle, so
# run `just build-native-core` first. Paths are relative to the repository root.

set default-list
set positional-arguments
set working-directory := "../.."

# Build the development profile APK in the build container
[group('build')]
build:
    apps/android/scripts/build.sh

# Run a command in the build container from apps/android
[group('build')]
container +args:
    apps/android/scripts/container.sh "$@"

# Release APKs per ABI (plus the AAB when signing is configured) into apps/android/out/release
[group('build')]
release:
    apps/android/scripts/release.sh

# Build the release profile and fail if its artifacts are unsafe to ship
[group('check')]
release-check:
    apps/android/scripts/release-check.sh

# Start the debug-signed release APK on the emulator the host's adb server sees (needs /dev/kvm)
[group('check')]
release-smoke:
    apps/android/scripts/release-smoke.sh

# Android lint and the Kotlin formatting check
[group('check')]
lint:
    apps/android/scripts/lint.sh

# All JVM tests
[group('check')]
test:
    apps/android/scripts/test.sh

# Instrumented tests on the emulator the host's adb server sees (needs /dev/kvm)
[group('check')]
ui-test:
    apps/android/scripts/ui-test.sh

# Landing page screenshots of the showcase repository, pulled into OUT_DIR (needs /dev/kvm; leaves the emulator on gesture navigation and in light mode)
[group('build')]
landing-screenshots out_dir="apps/android/out/landing-screenshots":
    apps/android/scripts/landing-screenshots.sh "$1"
