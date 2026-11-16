# iOS app recipes, run as `just ios <recipe>`. Paths are relative to the repository root.

set default-list
set positional-arguments
set working-directory := "../.."

# Run the Swift package tests, except CoreRuntime, on Linux in the swift Docker image
[group('check')]
swift-test:
    apps/ios/scripts/swift-linux-test.sh

# Generate apps/ios/Commitnote.xcodeproj with XcodeGen (macOS; the app build needs `just build-native-core`)
[group('xcode')]
generate-project:
    xcodegen generate --spec apps/ios/project.yml

# Archive the Release app without signing and package it as <out-dir>/commitnote-unsigned.ipa
[group('xcode')]
build-unsigned-ipa out_dir:
    apps/ios/scripts/build-unsigned-ipa.sh "$1"

# Check that an unsigned IPA holds the production core bundle and no test hooks
[group('xcode')]
check-ipa ipa:
    apps/ios/scripts/check-ipa.sh "$1"
