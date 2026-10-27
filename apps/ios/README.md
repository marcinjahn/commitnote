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
  exactly what the web app writes and syncs the same way. The native core API version is 6.

The `Testing` configuration bundles the fake core bundle instead, which serves the sample notes repo
from a fake forge.

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
- Launch from outside the app and iPad keyboard, pointer and multitasking support: see Entry points
  and iPad.
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
- `Packages/AppInteraction` — pure Swift, tested on Linux: the `commitnote://` link parser, the quick
  action mapping, the keyboard shortcut table, the type-to-start rules and key buffer, and the haptic
  mapping.
- `Packages/CoreRuntime` — the core runtime (Apple platforms only).
- `Commitnote/App/LaunchInbox.swift` holds launch actions until the model forwards them to the native
  core; `AppDelegate.swift` receives quick actions; `LaunchIntents.swift` declares the App Shortcuts;
  `AppCommands.swift` is the menu-bar and ⌘-hold command set; `HapticsPlayer.swift` plays haptics.
  `Commitnote/Notes/TypeToStartCatcher.swift` catches hardware key presses for type-to-start.
- `Commitnote/Info.plist` (generated from `project.yml`) adds, beyond the standard keys: the
  `commitnote` URL scheme (`CFBundleURLTypes`), the two quick actions (`UIApplicationShortcutItems`),
  the camera usage string, the bundled note fonts (`UIAppFonts`) and the exported tree item type.
  `UIApplicationSupportsMultipleScenes` is `false`.
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

## Entry points and iPad

### Launch actions

Two launch actions exist: `new-note` and `search`. Each can come from a quick action, an App Shortcut
or a link, and all of them take the same path: the app hands the launch action to the native core
(`launch.*` commands), which holds it until the app can act on it.

| Entry point | New note | Search notes |
| --- | --- | --- |
| Quick actions (long-press the app icon) | "New note" (`io.github.marcinjahn.commitnote.new-note`) | "Search notes" (`io.github.marcinjahn.commitnote.search`) |
| App Shortcuts (Shortcuts app, Spotlight, Action Button) | `NewNoteIntent`: "New note in commitnote", "Start a note in commitnote" | `SearchNotesIntent`: "Search notes in commitnote", "Search commitnote" |
| Links | `commitnote://new-note` | `commitnote://search` |

Any `commitnote://` URL also accepts `?action=new-note` or `?action=search`, for example
`commitnote://open?action=search`. A URL with another scheme, or without a known action, does nothing.
To put a shortcut on the Action Button, choose the Shortcut action in Settings → Action Button and
pick one of the two shortcuts.

Rules:

- While the app is starting or loading with a remembered session, "new note" focuses the early draft
  on the loading screen. Without a remembered session, it waits through login and opens a draft once
  the notes are ready. Search waits for the notes in both cases.
- Once the notes are ready, both work. They are dropped while a sheet, a dialog or search is open.
- Search on iPhone first leaves the open note.
- A cold launch from a link or quick action waits for the notes to be ready before acting.

### iPad keyboard, pointer and multitasking

- Menu-bar and ⌘-hold commands: ⌘N New Note, ⌘F Search Notes, ⌘S Save, and in the editor ⌘B Bold,
  ⌘I Italic, ⌘⇧X Strikethrough, ⌘K Link, ⌘↩ Task. ⌘K opens Search when the editor is not focused. The
  commands are disabled while the notes are not shown or a sheet is open, and the formatting commands
  while the editor is not focused. ⌘S saves without a toast; the sync status icon shows the result.
- Type-to-start: with a hardware keyboard, typing a printable character on the empty note placeholder
  creates a new note and puts the typed text in its editor. It needs Settings → Editor → "Start a note
  by typing" (on by default; the scope is This device by default), the regular width layout and the
  loaded tree. It does not run on the loading screen, with a sheet or search open, with a text field
  focused, or for key presses with ⌘, ⌃ or ⌥ held.
- Pointer: rows, buttons and notices have hover effects, and tree and trash rows have right-click
  context menus (the same actions as the long-press menus).
- Multitasking: Stage Manager and Split View resize the one window. The layout follows the
  size class, so a narrow window uses the iPhone layout. There is only one window and one scene.
- Haptics: they follow the system haptics setting and play on iPhone for drags, drops, notices,
  save failures, conflicts and finished actions. An iPad has no haptic engine, so nothing plays there.
- Accessibility: Dynamic Type including the accessibility sizes (checked by an accessibility audit at
  the AccessibilityL size), VoiceOver labels and values, Reduce Motion, and Increase Contrast.

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
- "Start a note by typing" (type-to-start) is offered, with the scope This device by default; it needs
  the regular width layout and a hardware keyboard, so in practice it works on iPad (see Entry points and iPad).
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
- `Runtime tests` boots one iPad Simulator and uses it for everything in the job, so it boots once,
  while the test products download. It runs the core runtime tests (`CommitnoteTests`, including
  `IOSVisitTests`, `NoteFontTests`, `LaunchActionTests`, the `data` read-back scenario and the
  performance measurement) on it from the shared build, reads the produced repos back with
  TypeScript, then runs `scripts/warm-up-app.sh` and the iPad UI classes `EditorFlowTests`,
  `DataFlowTests`, `EntryPointFlowTests` and `MediaFlowTests` on the same simulator.
- `UI tests (<device>, <suite>)` runs for `iphone` and `ipad`, each on its own simulator from the
  shared build. These jobs start once `Build for testing` has finished, and boot and prepare their
  simulator while the test products download. `scripts/warm-up-app.sh` then installs the app, launches
  it once and waits until it reports ready (a notification the Testing build posts), instead of fixed
  sleeps, so the first test does not pay for the slow first launch. The classes per job:

  | Job | Classes |
  | --- | --- |
  | `iphone` / `flows` | `EditingFlowTests` (all but five methods), `OrganisationFlowTests`, `MediaFlowTests`, `SettingsFlowTests`, `EntryPointFlowTests`, `SettingsScreenshotTests` |
  | `iphone` / `screens` | `ScreenshotTests`, `OrganisationScreenshotTests`, `EditorFlowTests`, `MediaScreenshotTests`, `DataFlowTests`, `LoginFlowTests`, `AccessibilityScreenshotTests`, five `EditingFlowTests` methods |
  | `ipad` / `flows` | `EditingFlowTests`, `SettingsScreenshotTests`, `IPadFlowTests`, `AccessibilityScreenshotTests`, `LoginFlowTests` |
  | `ipad` / `screens` | `ScreenshotTests`, `OrganisationFlowTests`, `MediaScreenshotTests`, `OrganisationScreenshotTests`, `SettingsFlowTests` |

  `EditingFlowTests` is the longest class, so on iPhone it is split by method between the two jobs
  (`IPHONE_EDITING` in the workflow): `flows` skips the listed methods and `screens` runs only those,
  so a new method runs once, in `flows`.

  `IPadFlowTests` (menu shortcuts, format shortcuts, type-to-start, width switch) run on iPad only.
  `EntryPointFlowTests` (links, held until the tree is ready, dropped while a sheet is open) run on
  iPhone in `flows` and on iPad in the runtime job. `AccessibilityScreenshotTests` run on both devices
  (large text screens with an accessibility audit). Every other UI class runs on both devices, in
  different jobs per device.

  The screenshot tests reach each screen once and capture it in light and dark, switching the
  running app's appearance through a FAKE_CORE testing hook. Between tests the app is restarted in
  its process through another such hook (a new model, core and fake forge, with stored state kept,
  as a relaunch would) instead of being relaunched; tests about launching still relaunch it. A failed
  UI test run uploads the app's log as `app.log` with its result bundle.

  The `Runtime tests` job, which finishes its tests first, then builds and checks the unsigned IPA
  (`commitnote-unsigned-ipa`). The check asserts, among other things, that no test hook reached the
  app, that there is no provisioning profile, entitlements file or `NSFaceIDUsageDescription`, and that
  `Info.plist` has the `commitnote` URL scheme and both quick action types and the bundle has
  `Metadata.appintents`.

The `Testing` configuration (fake core bundle only) adds test hooks: a Testing menu entry "Share
Welcome" and "Fail next share" (the next share fails), and "Import sample archive"
(`testing-import-archive`, opens the Import notes form for a sample zip), the launch variable
`COMMITNOTE_UI_HOLD_LOADING=1`, which holds loading and shows a loading testing bar, and
`COMMITNOTE_UI_ANIMATION_SPEED`, which the UI tests set to run the app's animations faster. The UI tests expect password AutoFill to be off, so
iOS never shows its save-password or strong-password sheets over the app; the workflow turns it off on
every simulator with `scripts/disable-password-autofill.sh`. Do the same before running them locally.
Artifacts, kept for 30 days:

| Artifact | Contents |
| --- | --- |
| `commitnote-unsigned-ipa` | `commitnote-unsigned.ipa` |
| `ios-screenshots-<device>` | the screenshots taken by the classes in that device's `screens` suite, light and dark |
| `ios-screenshots-<device>-flows` | the screenshots taken by the classes in that device's `flows` suite (the settings screenshots, and on iPad the large text ones), light and dark |
| `ios-xcresults-runtime` | Xcode result bundle of the core runtime tests |
| `ios-xcresults-ui-ipad-runtime` | Xcode result bundle of the iPad UI tests run in the runtime job |
| `ios-xcresults-ui-<device>-<suite>` | Xcode result bundles of the UI tests |
| `ios-test-output` | repos written by the runtime tests, and the performance timings (`perf/perf.json`, which names the iPad simulator that measured them) |

The shared build, `ios-test-products`, is kept for a day.

To download the unsigned IPA from a run, see Installing on a device.

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

A totally unsigned app cannot be installed on a non-jailbroken iPhone or iPad. The CI artifact has to
be re-signed with an Apple ID first. Every step below works on Linux, without a Mac. Nobody has
installed the app on a device yet, so treat the steps as untested end to end. Tool facts were checked
against Impactor v2.7.2 (released 2026-10-24).

1. Authenticate `gh`, because artifact downloads need a logged-in `gh` even on a public repository,
   then find the latest green `iOS` run on `main`:

   ```sh
   gh auth login
   gh run list -R marcinjahn/commitnote --workflow ios.yml --branch main --status success --limit 1
   ```

   The first column of the output is the run ID.
2. Download and unzip the artifact (`gh` unzips it for you into the directory):

   ```sh
   gh run download <run-id> -R marcinjahn/commitnote -n commitnote-unsigned-ipa -D ./commitnote-ipa
   ```

   The directory then contains `commitnote-unsigned.ipa`. Artifacts are kept for 30 days. If the
   newest green run is older, the artifact is gone: start a fresh run (this needs write access to the
   repository) and wait for it to go green, then repeat from the list command:

   ```sh
   gh workflow run ios.yml -R marcinjahn/commitnote --ref main
   ```
3. On the device, enable Developer Mode: Settings → Privacy & Security → Developer Mode, switch it
   on, restart the device and confirm.
4. Install Impactor (`claration/Impactor`, MIT) from Flathub (`dev.khcrysalis.PlumeImpactor`) or as the
   `Impactor-linux-x86_64.appimage` (`aarch64` on ARM) from its GitHub releases, and make the
   AppImage executable. `usbmuxd` must be installed and running (most distributions have it). Plug the
   device in over USB and tap "Trust" on it. If Impactor does not see the device, plug it in first and
   restart Impactor, because `usbmuxd` may stop when no device is connected.
5. In Impactor, select the device, sign in with a free Apple ID when asked, choose
   `commitnote-unsigned.ipa` and start the install. Impactor registers the device, creates a
   certificate and provisioning profile with Apple, signs the app and installs it over USB.
   Impactor's README documents only this GUI flow. It ships a `plumesign` command line tool (release
   assets `plumesign-linux-x86_64` and `plumesign-linux-aarch64`), but no documentation of an install
   command, so no command lines are given here; see `plumesign --help`.
6. If iOS asks, trust the developer profile: Settings → General → VPN & Device Management.
7. Free-team signatures expire after 7 days, after which the app no longer opens. Repeat steps 1 to 2
   if you want a newer build, then step 5 with the same Apple ID and bundle ID to reinstall over the
   old app. The app's data survives a reinstall over the same bundle ID, and the notes
   themselves live in your notes repo.

The bundle ID is `io.github.marcinjahn.commitnote`. If Apple refuses it for your free team, Impactor
can rewrite it. A free team gets 10 App IDs per 7 days and 3 active sideloaded apps, so keep the
bundle ID stable. The app has no entitlements and no extensions, which is why free signing works.

### What needs a paid account

Nothing in the app needs one. A paid Apple Developer Program membership ($99 per year) is only a
fallback for signing: its certificates and profiles last longer and it signs with a paid team. Since
mid-2026, Apple has been rejecting many free-team provisioning profiles at install time (`0xe8008024`,
"provisioning profile is banned"). That comes from community reports only and is not confirmed by
Apple. A paid team is not affected by that ban, so it is the way out if the free route fails.
TestFlight and the App Store are out of scope.

Alternatives to Impactor: SideStore (refreshes the signature on the device) and
Sideloader/AltServer-Linux. They use the same free Apple ID and have the same limits.

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
- Free-team signatures expire after 7 days. Reinstall to refresh. Free teams can register 10 App IDs
  per 7 days and have 3 active apps.
- Since mid-2026 Apple has been rejecting many free-team provisioning profiles at install time
  (`0xe8008024 "provisioning profile is banned"`). This comes from community reports only. The
  fallback is the Apple Developer Program, $99 per year, which signs with a paid team and avoids the
  free-team ban. TestFlight is out of scope.
- Nobody has installed the app on a device as part of this work. The deliverable is the CI-built
  IPA and the steps above.
- Impactor's auto-refresh on Linux only runs when the device is plugged in.

Entry points and iPad:

- Quick actions, App Shortcuts and cold launches from a `commitnote://` link are not covered by UI
  tests, because the Home Screen, Shortcuts and Spotlight are out of reach of XCUITest. Their
  mapping (`AppInteraction`, `LaunchActionTests`) is tested, and the IPA check asserts the URL scheme
  and quick action keys in `Info.plist` and the App Intents metadata. `EntryPointFlowTests` cover links
  while the app runs.
- Haptics and hardware-keyboard behaviour on a real device are not exercised: the Simulator has no
  haptic engine and the type-to-start and shortcut tests drive a simulated keyboard.
- The app has one window: no multiple windows, no widgets, Control Center or Lock Screen controls, no
  share extension and no Siri beyond the App Shortcuts phrases.

## Performance

Measured in a Simulator on CI, not on a device. The core runtime tests, which include the
performance measurement, run on the iPad Simulator of the runtime job, and `perf/perf.json` in the
`ios-test-output` artifact names the device. The iPad numbers are from the iPad Pro 13-inch (M5)
Simulator (iOS 26.5), Xcode 26.6, run on 2026-10-26; the iPhone numbers are from the iPhone 17 Pro
Simulator (iOS 26.5), Xcode 26.6, run on 2026-10-19, before the measurement moved to the iPad. Each
number is the median of 3 runs on `sample/large-tree`, in milliseconds.

| Measurement | iPad Pro 13-inch (M5) Simulator | iPhone 17 Pro Simulator |
| --- | --- | --- |
| resume | 2522 ms | 1384 ms |
| unlock | 3899 ms | 1729 ms |
| tree listing | 225 ms | 229 ms |
| open note | 4 ms | 3 ms |
