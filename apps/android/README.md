# commitnote for Android

A native Android app for commitnote, written in Kotlin with Jetpack Compose. It runs the same
TypeScript core as the Linux and iOS apps (`src/native-core/`), on the V8 engine, so it reads and
writes exactly what the web app does. It's built for arm64-v8a (phones) and x86_64 (emulators and x86
Chromebooks). There is no Play Store or F-Droid listing; releases are APKs on GitHub.

## Prerequisites

Docker. Builds and tests run in a build container, so you don't need the Android SDK, a JDK or Gradle
on the host. Run `just build-native-core` from the repository root first: the container builds embed
the core bundle.

## Recipes

Run them from the repository root as `just android <recipe>`:

- `build`: the development profile APK.
- `container <command>`: run a command in the build container, from `apps/android`.
- `release`: the release profile APKs, one per ABI, plus the AAB when signing is configured, in
  `apps/android/out/release/`.
- `release-check`: `release`, then fail if the artifacts are unsafe to ship (fake core, wrong
  package, debuggable, unexpected permissions or ABIs).
- `release-smoke`: start the debug-signed release APK on the emulator the host's adb server sees and
  wait for the login screen (needs `/dev/kvm`).
- `landing-screenshots [out-dir]`: capture the landing page screenshots of the showcase repository
  on the emulator the host's adb server sees (needs `/dev/kvm`). The "Android screenshots" workflow
  runs it and turns the captures into the landing images.
- `lint`: Android lint and the Kotlin formatting check.
- `test`: all JVM tests.
- `ui-test`: instrumented tests on the emulator the host's adb server sees (needs `/dev/kvm`).

## Tests

`just android test` runs the JVM tests locally: the core runtime conformance tests and the Robolectric
UI flows against the fake core bundle. The instrumented tests (`ui-test`, built with the `fake`
build type) and the release smoke test need an emulator, so they run in the second job of the Android
workflow (`.github/workflows/android.yml`), which has KVM.

## Release

1. Bump `commitnote.versionName` in `apps/android/gradle.properties`. The version code is derived
   from it.
2. Push and wait for the Android workflow to pass.
3. Dry-run with `gh workflow run android-release.yml --ref main -f tag=android-v0.1.0` and check in
   `gh run list --workflow android-release.yml` that it ran on the commit you're about to tag. A manual
   run builds everything and publishes nothing.
4. Tag that commit and push only the tag: `jj tag set android-v0.1.0 -r main`, then
   `jj git push --tag android-v0.1.0`.

The tag push builds the release, checks it and creates a GitHub release with the APKs, the AAB (when
signed), `SHA256SUMS` and attestations. Tags are never moved; a bad release gets a new patch version.
Android releases are separate from the Flatpak's `v*` releases and are never marked as the latest
release, because `releases/latest` belongs to the Flatpak.

## Signing

Add four repository secrets:

- `ANDROID_KEYSTORE_BASE64`: the upload keystore, base64-encoded, e.g. `base64 -w0 upload.keystore`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Without them a release is debug-signed: it has no AAB, its APKs are named `...-debugsigned.apk`, and
a later build can't be installed over it. The app has to be uninstalled first, which removes its data
on the device, including the remembered session. With the secrets present, all four must be set;
a partial set fails the build.

Locally, the same four values are the environment variables `COMMITNOTE_ANDROID_KEYSTORE` (the path
to the keystore file), `COMMITNOTE_ANDROID_KEYSTORE_PASSWORD`, `COMMITNOTE_ANDROID_KEY_ALIAS` and
`COMMITNOTE_ANDROID_KEY_PASSWORD`. When Docker runs through a sidecar daemon that only sees some
paths, keep the keystore under `~/code` or `~/tmp`; the build container mounts it read-only.

## Notes on the build

- The ABIs are limited by `packaging.jniLibs.excludes` in `app/build.gradle.kts`, not by
  `ndk.abiFilters`, which the Android Gradle plugin rejects next to ABI splits.
- The release build type minifies code with R8 but doesn't shrink resources: the plugin can't build
  an AAB with ABI splits and resource shrinking together.

## Pins

- JS engine: `javet` in `gradle/libs.versions.toml`.
- ICU data: `icu-data-url` (a Chromium ICU revision) and `icu-data-sha256`, in the same file.
- Toolchain (JDK, SDK platform, build tools, NDK, command-line tools): `ci/Dockerfile`.
- Gradle: `gradle/wrapper/gradle-wrapper.properties`.
