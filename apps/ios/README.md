# commitnote for iOS

A native iPhone and iPad client for the same encrypted notes repo the web app uses. This first
version is read-only: log in, unlock with the passphrase, browse the note tree, open notes, Refresh.

## Overview

Three layers:

- **SwiftUI app** (`Commitnote/`) — screens and navigation. It only talks to the core runtime.
- **Core runtime** (`Packages/CoreRuntime`) — loads the core bundle into JavaScriptCore and provides
  the host services it needs (crypto, network, Keychain-backed remembered session, blob cache, device settings).
- **Core bundle** (`commitnote-core.js`) — the native core, built from `src/native-core/`. It reuses
  the web app's format, crypto, forge adapters, `NoteTree` and `SyncEngine`, so the iOS app reads
  exactly what the web app writes. The `Testing` configuration bundles the fake core bundle instead,
  which serves the sample notes repo from a fake forge.

## Layout

- `project.yml` — XcodeGen project definition (`Debug`, `Release`, `Testing` configurations).
- `Commitnote/` — app sources. `CommitnoteTests/`, `CommitnoteUITests/` — unit and UI tests.
- `Packages/CommitnoteCrypto` — Swift crypto primitives, checked against the test vectors.
- `Packages/NativeCoreAPI` — Swift types for the native core API and native core API version.
- `Packages/CoreRuntime` — the core runtime (Apple platforms only).
- `scripts/` — `swift-linux-test.sh`, `pick-simulator.sh`, `disable-password-autofill.sh`,
  `export-screenshots.sh`, `build-unsigned-ipa.sh`, `check-ipa.sh`.
- `../test-vectors/` — JSON test vectors shared by the TypeScript and Swift tests.

The Xcode project is generated and not committed.

## Building on CI

Apple builds run only in the iOS workflow (`.github/workflows/ios.yml`). It runs on pushes to `main`
and to `ios-ci/**` branches, and manually. To prove a change on macOS before it reaches `main`, push
it to a branch named `ios-ci/<something>`.

The workflow has a Linux job (native core check, Swift package tests) and a macOS job (generate the
project, package tests, runtime tests, read-back of the produced repos with TypeScript, iPhone and
iPad UI tests, unsigned IPA build and check). The UI tests expect password AutoFill to be off, so
iOS never shows its save-password or strong-password sheets over the app; the workflow turns it off in
both simulators with `scripts/disable-password-autofill.sh`. Do the same before running them locally.
Artifacts, kept for 30 days:

| Artifact | Contents |
| --- | --- |
| `commitnote-unsigned-ipa` | `commitnote-unsigned.ipa` |
| `ios-screenshots` | iPhone and iPad screenshots, light and dark |
| `ios-xcresults` | Xcode result bundles |
| `ios-test-output` | repos written by the runtime tests, and performance timings (`perf/perf.json`) |

Download from a run:

```sh
gh run list --workflow ios.yml
gh run download <run-id> -n commitnote-unsigned-ipa
```

## Local checks on Linux

No Xcode, macOS or Simulator is needed for these:

- `npm run check:native-core` — builds the core bundle and the fake core bundle and runs them in a
  bare host (the bare-host check).
- `apps/ios/scripts/swift-linux-test.sh` — runs the Swift package tests in the `swift:6.2` Docker
  image. Run it from a path under `~/code`; it skips `CoreRuntime`, which needs Apple frameworks.
- `npm run fixture:test-vectors` — regenerates `apps/test-vectors/`. A diff afterwards means the
  format or the generator changed.

## Building on a Mac

Optional; CI does this for you.

```sh
npm ci
npm run build:native-core
brew install xcodegen
cd apps/ios
xcodegen generate
open Commitnote.xcodeproj
```

`npm run build:native-core` writes `dist-native-core/` and `dist-native-core-fake/`; the app build
copies `commitnote-core.js` from the first, or from the second in the `Testing` configuration. The
build fails if the file is missing.

## Installing on a device

A totally unsigned app cannot be installed on a non-jailbroken iPhone. The CI artifact has to be
re-signed with an Apple ID first. This works on Fedora, without a Mac.

1. Download `commitnote-unsigned-ipa` and unzip it to get `commitnote-unsigned.ipa`.
2. On the iPhone, enable Developer Mode: Settings → Privacy & Security → Developer Mode, then
   restart the phone and confirm.
3. Install Impactor (`https://github.com/claration/Impactor`, MIT) as a Linux AppImage or from
   Flathub. `usbmuxd` must be running; if the phone is not detected, plug it in first and then
   restart Impactor. Its command line tool is `plumesign`.
4. Connect the iPhone over USB and trust the computer on the phone.
5. In Impactor, sign in with a free Apple ID, select the device, and install
   `commitnote-unsigned.ipa`. Impactor registers the device, creates a certificate and a
   provisioning profile with Apple, signs the app and installs it over USB.
6. When iOS asks, trust the developer certificate (Settings → General → VPN & Device Management).

The Impactor README documents only this UI flow; the `plumesign` command lines are not quoted here.
Check the tool's own documentation for them.

The bundle ID is `io.github.marcinjahn.commitnote`. If Apple refuses it for your free team, Impactor
can rewrite it. The app has no entitlements and no extensions.

Alternatives: SideStore (refreshes the signature on the device) and Sideloader/AltServer-Linux.

## Limits

- A free Apple ID is not the paid Apple Developer Program, but it is still an Apple account. Nothing
  in this repository creates one.
- Free-team signatures expire after 7 days. Reinstall to refresh. Free teams can register a limited
  number of App IDs (10 per 7 days).
- Since July to October 2026 Apple has been rejecting many free-team provisioning profiles at
  install time (`0xe8008024 "provisioning profile is banned"`). This comes from community reports
  only. The fallback is the Apple Developer Program, $99 per year. TestFlight is out of scope.
- Nobody has installed the app on a device as part of this work. The deliverable is the CI-built
  IPA and the steps above.
- Impactor's auto-refresh on Linux only runs when the device is plugged in.

## Performance

Measured in the iPhone Simulator on CI, not on a device: iPhone 17 Pro Simulator (iOS 26.5), Xcode
26.6, run on 2026-10-19. Each number is the median of 3 runs on `sample/large-tree`, in
milliseconds.

| Measurement | iPhone 17 Pro Simulator |
| --- | --- |
| resume | 1384 ms |
| unlock | 1729 ms |
| tree listing | 229 ms |
| open note | 3 ms |
