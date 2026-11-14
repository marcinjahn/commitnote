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
