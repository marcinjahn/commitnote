# commitnote for iOS

A native iPhone and iPad client for the same encrypted notes repo the web app uses. It is a notes
app you can edit with: log in, unlock with the passphrase, browse and organise the note tree, create
and edit notes and folders, and keep them in sync with the other devices.

## Overview

Three layers:

- **SwiftUI app** (`Commitnote/`) — screens and navigation. It only talks to the core runtime.
- **Core runtime** (`Packages/CoreRuntime`) — loads the core bundle into JavaScriptCore and provides
  the host services it needs (crypto, network, Keychain-backed remembered session, blob cache, device
  settings, image codec). It decodes images with ImageIO and encodes them through `ImageCodec`.
- **Core bundle** (`commitnote-core.js`) — the native core, built from `src/native-core/`. It reuses
  the web app's format, crypto, forge adapters, `NoteTree` and `SyncEngine`, so the iOS app reads
  exactly what the web app writes and syncs the same way. The native core API version is 4. The `Testing` configuration bundles the fake core bundle instead,
  which serves the sample notes repo from a fake forge.

What the app does:

- Create notes and folders (New note, New folder). Placement follows the synced `newNotePlacement`
  and `newFolderPlacement` settings, which are edited on the web for now (see Settings and data). A new note has a focused
  name field; if you type the body first, the name is an automatic `YYYY-MM-DD HH:mm:ss`. Name
  clashes get a ` (2)` suffix, and drafts left untouched vanish.
- Edit notes in a TextKit 2 live-preview editor: headings, lists, quotes, emphasis, strikethrough,
  inline and fenced code, links and rules are styled, and the markers are hidden off the active line.
  The stored text is exactly what was typed. Task checkboxes are tappable. Links open on tap when
  not editing and from the edit menu while editing; pasting a URL over a selection makes a link. A
  keyboard toolbar offers Bold, Italic, Strikethrough, Link and Task. The caret and scroll position
  are restored per note while the app runs.
- Insert images from the photo library (up to 10 at a time), the camera, Files, paste and drag and
  drop. The app decodes them (HEIC, JPEG, PNG and the other formats iOS reads, with the orientation
  applied) and encodes WebP with libwebp under the same image profile as the web; GIFs stay GIF, with
  metadata stripped. Images are encrypted like on the web. Images render inline; tap one to open a
  zoomable full-screen viewer. Pasting another note's image reference copies the image. Removing a
  reference deletes the image on save, and Undo brings it back. An unknown reference shows "Image
  unavailable".
- "Version history" in a note's actions menu lists versions grouped by day and editing session, with
  "Current" and "Shared" badges. A preview shows what restoring would change; restore the content and
  optionally the title, with Undo.
- "Share" in a note's actions menu creates a secret link (GitHub gist or GitLab snippet) with an
  optional share password and share label. "Share link" and "Share password" open the share sheet.
  The Shared links screen (from the notes "…" menu) offers Update to current version, View shared
  version, Rename, Open note, Copy link, Copy password and Revoke. Links open the web viewer. Clear
  errors explain a missing gist permission or a missing GitLab `api` scope.
- Autosave runs 2 s after typing stops and at least every 30 s. Structure changes, note switches,
  going to the background (inside a background task) and Log out save immediately.
- Organise notes with context menus and swipe actions (Rename, Move to, Move up, Move down, Delete,
  Color tag) and with drag and drop, which has Undo. Delete moves a note to the trash with Undo; the
  Trash screen offers Restore, Delete permanently and Empty trash, and items older than 30 days are
  purged. Deleting a shared note warns first, because it revokes its links.
- Color tags (`ColorTag`) can be filtered with the tag filter. Search is native, with recent notes
  and indexing progress. A note has a details view.
- The last view is reopened on launch (on by default; Settings has the toggle). While
  the app loads, the loading screen offers an early draft, kept in memory while the app runs.
- Remote edits to the open note are merged in without losing the caret or Undo. Remote renames and
  moves are followed.
- The sync status shows synced, syncing, pending, failed, conflict or offline, with the unsaved
  notes and Retry now. On a conflict, the conflict view offers "Keep this device's version", "Keep
  other device's version" and "Edit merged". Notices come with actions.
- Log out saves first and offers "Keep trying" or "Log out anyway". After a passphrase change on
  another device, the key-changed screen exports the notes, including unsaved edits, as a zip
  through the share sheet.

## Layout

- `project.yml` — XcodeGen project definition (`Debug`, `Release`, `Testing` configurations).
- `Commitnote/` — app sources. `CommitnoteTests/`, `CommitnoteUITests/` — unit and UI tests.
- `Packages/CommitnoteCrypto` — Swift crypto primitives, checked against the test vectors.
- `Packages/NativeCoreAPI` — Swift types for the native core API and native core API version.
- `Packages/EditorText` — pure Swift text-edit mapping and undo history, tested on Linux.
- `Packages/MarkdownStyling` — pure Swift, tested on Linux: the markdown syntax scanner, the
  live-preview style runs and the editing commands. Depends on `EditorText`.
- `Packages/ImageCodec` — libwebp 1.5.0 vendored unmodified as a C target (BSD-3-Clause, its licence
  file is kept with the sources) and a Swift WebP encoder, tested on Linux.
- `Packages/CoreRuntime` — the core runtime (Apple platforms only).
- `Commitnote/Settings/` — the Settings screen and its data screens (Export, Import notes, Change
  passphrase, note font list). `Commitnote/App/AppModel+Settings.swift`, `AppModel+Data.swift`,
  `AppModel+Passphrase.swift` and `AppModel+Print.swift` hold their model side;
  `Commitnote/App/PrintRenderer.swift` renders the print PDF.
- `Packages/CoreRuntime/Sources/CoreRuntime/IOSVisit.swift` — the iOS visit (see Usage statistics).
- `Commitnote/Fonts/` — the bundled note fonts (see Fonts below).
- `scripts/` — `swift-linux-test.sh`, `pick-simulator.sh`, `disable-password-autofill.sh`,
  `export-screenshots.sh`, `build-unsigned-ipa.sh`, `check-ipa.sh`.
- `../test-vectors/` — JSON test vectors shared by the TypeScript and Swift tests.

The Xcode project is generated and not committed.

## Usage statistics

The app counts launches with one anonymous request, the iOS visit:

- One `GET` per cold launch to the GoatCounter `count` endpoint with exactly `p=%2Fapp%2Fios` and
  `t=App%20(iOS)`. It uses its own ephemeral session: no cookies, cache, `Referer`, body,
  identifiers or other parameters. It is never awaited or retried, and returning from the
  background sends nothing.
- The endpoint comes from `GOATCOUNTER_SITE_CODE` in `analytics.config.ts` through `buildModeFacts`:
  the `native-core` mode uses GoatCounter and `native-core-fake` uses `https://analytics.invalid/count`.
  While the site code is `null`, nothing is sent. Setting it enables iOS counting on the next app
  build.
- Opt out in Settings › This device › "Anonymous usage statistics". The choice is stored as
  `commitnote.analyticsOptOut = "1"` in the device settings storage. iOS has no DNT or GPC signal, so
  this switch is the only opt-out.
- The landing page's privacy copy and the root README intentionally do not list the `/app/ios` path
  until the app is released. `npm run check:bundle` fails if `/app/ios` or `App (iOS)` reaches the
  landing or web bundles.

## Settings and data

Settings has the same sections as the web app. The differences:

- Color mode, accent color and note font have a scope toggle ("All devices" / "This device").
- Vim mode and the animated caret are not offered, and their synced values are never rewritten
  (settings are written per key).
- Reopening the last view is on by default; turning it off is stored as
  `commitnote.reopenLastViewOff`.
- There is no type-to-start toggle yet.
- The note fonts are the bundled ones (see Fonts).

Data:

- Export writes the same zip as the web, images included, and offers the share sheet or Save to
  Files.
- Import notes takes a zip or `.md`/text files from Files, or files dropped onto a tree folder.
  The conflict and rename rules are the web's.
- Change passphrase has a review step, a strength check and "Also delete the old history". The
  remembered session is re-saved with the new key material; the passphrase is never stored.
- Print renders the note as a PDF, black on white, with its images, in the note font, and hands it to
  the share sheet.

Security: there is no app lock, Face ID or passcode prompt, by design. The remembered session is a
plain Keychain item with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.

## Fonts

`Commitnote/Fonts/` holds the 10 note font families as full upstream TTFs, copied into the app bundle
root and registered through `UIAppFonts`. Every family is licensed under the SIL Open Font License
1.1; the licence texts are in `Commitnote/Fonts/Licenses/`. `NoteFontCatalog`
(`Commitnote/Shared/NoteFonts.swift`) maps a `noteFont` id to these files; `system` uses SF.

Variable fonts were renamed from `Name[axes].ttf` to `Name-Variable.ttf` and
`Name-Italic[axes].ttf` to `Name-VariableItalic.ttf`; the contents are unmodified.

| Family | Files | Source commit | Licence |
| --- | --- | --- | --- |
| Inter | variable roman and italic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |
| IBM Plex Sans | variable roman and italic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |
| Atkinson Hyperlegible Next | variable roman and italic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |
| Nunito | variable roman and italic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |
| iA Writer Quattro | static Regular, Bold, Italic, BoldItalic | iaolo/iA-Fonts `c6588670c71e9ac628acc27b72cde4bf12726b7f` | OFL 1.1 |
| Literata | variable roman and italic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |
| Source Serif 4 | variable roman and italic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |
| Lora | variable roman and italic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |
| JetBrains Mono | variable roman and italic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |
| IBM Plex Mono | static Regular, SemiBold, Italic, SemiBoldItalic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |

| File (under `Commitnote/Fonts/`) | Source URL | SHA-256 |
| --- | --- | --- |
| `Inter-Variable.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/inter/Inter[opsz,wght].ttf | `29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031` |
| `Inter-VariableItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/inter/Inter-Italic[opsz,wght].ttf | `acd98e64795781b2058f07b18475e0ecee2a0fe2b42a49e2f9e37d0d6bf66ce6` |
| `Licenses/Inter-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/inter/OFL.txt | `5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57` |
| `IBMPlexSans-Variable.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/ibmplexsans/IBMPlexSans[wdth,wght].ttf | `3b031aa4216174205bd8471f88a49b91f093169e9e87bd5262242bc5967fe2e3` |
| `IBMPlexSans-VariableItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/ibmplexsans/IBMPlexSans-Italic[wdth,wght].ttf | `0b94c5e981993764db32bf9c610ecc60cbd34ad77ec2f10ba03c64ab75124d8e` |
| `Licenses/IBMPlexSans-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/ibmplexsans/OFL.txt | `7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da` |
| `AtkinsonHyperlegibleNext-Variable.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext[wght].ttf | `5a455d1cfa099b601ab70751bb9673e8fe1854dc4500c80e1a220d0d75e31745` |
| `AtkinsonHyperlegibleNext-VariableItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext-Italic[wght].ttf | `ce9cffed32742ad2d9238c561a93220385e5934cdc02b8eb4097a50efa957dc6` |
| `Licenses/AtkinsonHyperlegibleNext-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/atkinsonhyperlegiblenext/OFL.txt | `aca6a428580965d2297d1b718042dd427c2a9443ece3b0d02d758e161e0c4030` |
| `Nunito-Variable.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/nunito/Nunito[wght].ttf | `bb55a5ca5c2042335b3991af27c4d0705d0ef41cac6164ac737fd8f2a1e85207` |
| `Nunito-VariableItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/nunito/Nunito-Italic[wght].ttf | `b520cc871868b0acfca1beda875df7f4a44ebce914f8a89f83977fc9c09529c8` |
| `Licenses/Nunito-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/nunito/OFL.txt | `580df76c95a1ec5ab878ceb25bb3d85c6a076804e9c970c8c6972aea775fdf65` |
| `Literata-Variable.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/literata/Literata[opsz,wght].ttf | `b41138c9373112f32abb589cc22e8674b06ed4048b0c513be922bdd26f274440` |
| `Literata-VariableItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/literata/Literata-Italic[opsz,wght].ttf | `d483dfaeba9cbf4ce71d32a52ee65df82f7e35b15fff8d1011cdb242d1fcd465` |
| `Licenses/Literata-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/literata/OFL.txt | `8742963604cd89dc81437811a850018fc03b2bfad686d7422c8235967c87614e` |
| `SourceSerif4-Variable.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/sourceserif4/SourceSerif4[opsz,wght].ttf | `97b2d4da6e3cb494b5a1e66ae176914d852ccabef49e0c02c0df25f3e39aca0b` |
| `SourceSerif4-VariableItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/sourceserif4/SourceSerif4-Italic[opsz,wght].ttf | `15fbc7e4679489a501998c3669272637a6646388ef7e4bd77eebb5bf967a1f42` |
| `Licenses/SourceSerif4-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/sourceserif4/OFL.txt | `5f94c3fd3a23131a417ab5a0c8452de57e70c3cfb9f604d88241f7065ebf9fd9` |
| `Lora-Variable.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/lora/Lora[wght].ttf | `822a6621ccbe8d97d20ac88c1c41f5615c9c2c202eaa75f272cd452aac6475a7` |
| `Lora-VariableItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/lora/Lora-Italic[wght].ttf | `22d8d8854b53807aa664ca34f2031a9ed57a1d0dea296b8b96cdd3aad937a2b3` |
| `Licenses/Lora-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/lora/OFL.txt | `1d9a970809ac804b582a6ce7f0ebc4e7fefcbfd7ff6299cad35ee656a21be716` |
| `JetBrainsMono-Variable.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/jetbrainsmono/JetBrainsMono[wght].ttf | `48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda` |
| `JetBrainsMono-VariableItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/jetbrainsmono/JetBrainsMono-Italic[wght].ttf | `85ae2a5cd3f56baf1ce1c21a851322c58e3d8fbe8e8ad4a4d090a820dd7fe558` |
| `Licenses/JetBrainsMono-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/jetbrainsmono/OFL.txt | `b2fe5e8987594e9ffd1d2ca52a2f5d73eb8335243893c5d6254b5ad69269591d` |
| `IBMPlexMono-Regular.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/ibmplexmono/IBMPlexMono-Regular.ttf | `6a3412f058c7d8dfd9170c41e85ade48e5156ecb89356110ca57a0a27734af46` |
| `IBMPlexMono-SemiBold.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/ibmplexmono/IBMPlexMono-SemiBold.ttf | `d3c38e55c78f5b0f28009fddba4834ec503278936a5986032424c9bd2d23aa46` |
| `IBMPlexMono-Italic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/ibmplexmono/IBMPlexMono-Italic.ttf | `3362fc791b0652193328b862c1c5f23a789bc7288b1617fa63302f88689a2a34` |
| `IBMPlexMono-SemiBoldItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/ibmplexmono/IBMPlexMono-SemiBoldItalic.ttf | `391ef0e273eb52571eccaab6a6dbddeec48e1d282cb7bf153043512b797ed6f0` |
| `Licenses/IBMPlexMono-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/ibmplexmono/OFL.txt | `7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da` |
| `iAWriterQuattroS-Regular.ttf` | https://raw.githubusercontent.com/iaolo/iA-Fonts/c6588670c71e9ac628acc27b72cde4bf12726b7f/iA%20Writer%20Quattro/Static/iAWriterQuattroS-Regular.ttf | `6e367e0e00e057d383680ffae7b64f520d06e1f96abd28bddd67d424fee8e8df` |
| `iAWriterQuattroS-Bold.ttf` | https://raw.githubusercontent.com/iaolo/iA-Fonts/c6588670c71e9ac628acc27b72cde4bf12726b7f/iA%20Writer%20Quattro/Static/iAWriterQuattroS-Bold.ttf | `40dbb1ffed472cdc96a0133073bc777a40782883678b80dfd31677d5963b72b9` |
| `iAWriterQuattroS-Italic.ttf` | https://raw.githubusercontent.com/iaolo/iA-Fonts/c6588670c71e9ac628acc27b72cde4bf12726b7f/iA%20Writer%20Quattro/Static/iAWriterQuattroS-Italic.ttf | `84c19517be57e8c0521f43a1d5c29766b1f0cb9353300e819b193da1b02f47ac` |
| `iAWriterQuattroS-BoldItalic.ttf` | https://raw.githubusercontent.com/iaolo/iA-Fonts/c6588670c71e9ac628acc27b72cde4bf12726b7f/iA%20Writer%20Quattro/Static/iAWriterQuattroS-BoldItalic.ttf | `f61aa3c97d611dec01c7414e07b9212a164501b6d1a800af0dcda11acf4eabb0` |
| `Licenses/iAWriterQuattro-LICENSE.md` | https://raw.githubusercontent.com/iaolo/iA-Fonts/c6588670c71e9ac628acc27b72cde4bf12726b7f/iA%20Writer%20Quattro/LICENSE.md | `2eb84d6d03a9af6e99816f82f50a77c26e7ff6681293f4619cd33a392a8c13b6` |

## Building on CI

Apple builds run only in the iOS workflow (`.github/workflows/ios.yml`). It runs on pushes to `main`
and to `ios-ci/**` branches, and manually. To prove a change on macOS before it reaches `main`, push
it to a branch named `ios-ci/<something>`.

The workflow runs only when something it builds or tests changes: `apps/**`, `src/**`, `scripts/**`,
`package.json`, `package-lock.json`, `vite.config.ts`, `analytics.config.ts`, `svelte.config.js`,
`tsconfig*.json`, the workflow itself and its `.github/actions/ios-*` actions. Manual runs always work.

- `linux` runs the native core check and the Swift package tests (every package except
  `CoreRuntime`). They run only here: the packages are pure Swift, and the Apple crypto backend is
  still exercised on the Simulator by the runtime tests' test vector check.
- `Build for testing` generates the project and builds the app and both test bundles once, for the
  Simulator, and hands them to the jobs below as the `ios-test-products` artifact.
- `Runtime tests and IPA` builds and checks the unsigned IPA, runs the runtime tests (including
  `IOSVisitTests`, `NoteFontTests` and the `data` read-back scenario) on an iPhone
  Simulator from the shared build, reads the produced repos back with TypeScript, and also boots an
  iPad Simulator to run the iPad `EditorFlowTests`, `SettingsFlowTests` and `DataFlowTests`.
- `UI tests (<device>, <suite>)` runs for `iphone` and `ipad`, each on its own simulator from the
  shared build:
  - `flows` — editing, organisation and media flows, plus the login, settings and data flows on
    iPhone and the settings screenshots on iPad.
  - `screens` — every other screenshot, plus the editor flows and settings screenshots on iPhone and
    the login flows on iPad.

  The class lists of the suites differ per device, so every UI class runs on both devices.

The `Testing` configuration (fake core bundle only) adds test hooks: a Testing menu entry "Share
Welcome" and "Fail next share" (the next share fails), and "Import sample archive" (`testing-import-archive`, opens the Import notes form for a sample zip), and the launch variable `COMMITNOTE_UI_HOLD_LOADING=1`, which holds loading and shows a
loading testing bar. The UI tests expect password AutoFill to be off, so
iOS never shows its save-password or strong-password sheets over the app; the workflow turns it off on
every simulator with `scripts/disable-password-autofill.sh`. Do the same before running them locally.
Artifacts, kept for 30 days:

| Artifact | Contents |
| --- | --- |
| `commitnote-unsigned-ipa` | `commitnote-unsigned.ipa` |
| `ios-screenshots-<device>` | screenshots per device, light and dark, including `image-viewer`, `insert-image-menu`, `history`, `history-preview`, `share`, `share-created`, `shared-links` and `shared-version`; on iPhone also `settings`, `settings-fonts`, `settings-data`, `import` and `change-passphrase` |
| `ios-screenshots-ipad-flows` | the iPad `settings`, `settings-fonts`, `settings-data`, `import` and `change-passphrase` screenshots, light and dark |
| `ios-xcresults-runtime` | Xcode result bundle of the runtime tests |
| `ios-xcresults-ui-ipad-runtime` | Xcode result bundle of the iPad tests run in the runtime job |
| `ios-xcresults-ui-<device>-<suite>` | Xcode result bundles of the UI tests |
| `ios-test-output` | repos written by the runtime tests, and performance timings (`perf/perf.json`) |

The shared build, `ios-test-products`, is kept for a day.

Download from a run:

```sh
gh run list --workflow ios.yml
gh run download <run-id> -n commitnote-unsigned-ipa
```

## Local checks on Linux

No Xcode, macOS or Simulator is needed for these:

- `npm run check:native-core` — builds the core bundle and the fake core bundle and runs them in a
  bare host (the bare-host check).
- `apps/ios/scripts/swift-linux-test.sh` — runs the Swift package tests, `ImageCodec` included, in the
  `swift:6.2` Docker image. Run it from a path under `~/code`; it skips `CoreRuntime`, which needs Apple frameworks.
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
can rewrite it. The app has no entitlements and no extensions; Info.plist has only the camera usage
string.

Alternatives: SideStore (refreshes the signature on the device) and Sideloader/AltServer-Linux.

## Limits

Data:

- Notes need the network; there is no offline copy. Edits made offline stay in memory and are saved
  on reconnect, and the app tries to save when it goes to the background, but if iOS terminates the
  suspended app before they are saved, those edits are lost.
- Deleting an image reference removes the image from the note on save; it comes back only if the
  reference text is put back (for example with Undo). Removed images are kept for 30 days as image
  tombstones. They are not in the trash.
- The camera is unavailable in the Simulator; use the photo library, Files, paste or drag and drop
  there.
- Sharing needs the gist permission on GitHub or the `api` scope on GitLab.

Signing and sideloading:

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
