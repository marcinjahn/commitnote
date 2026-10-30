# commitnote for GNOME

A native GNOME client for the same encrypted notes repo the web app uses. It is a Rust, GTK 4 and
libadwaita app that runs the shared native core bundle (`commitnote-core.js`, built from
`src/native-core/`) in JavaScriptCore, so it reads and writes exactly what the web app does. It logs
in, unlocks a notes repo or sets a new one up, browses the note tree, and edits notes in a
live-preview Markdown editor with autosave, sync status and conflict resolution.

## Overview

The app and its crates:

- **App** (`src/`, UI definitions in `data/ui/`, UI tests in `tests/ui/`) — GTK 4 and libadwaita
  pages and navigation. It talks to the core runtime and uses the three pure crates below. The
  editor widget is `src/editor/`.
- **Core runtime** (`crates/core-runtime`) — loads the core bundle into JavaScriptCore and provides
  the host services it needs: crypto, network (libsoup), the remembered session in the Secret
  Service keyring, a blob cache, device settings and the image codec.
- **Crypto** (`crates/crypto`) — the cryptographic operations behind the host crypto service.
- **Core API** (`crates/core-api`) — the typed command, event and error shapes shared with the core
  bundle, plus the fake commands the testing build uses.
- **Markdown** (`crates/markdown`, `commitnote-markdown`) — the Markdown parser, the live-preview
  renderer (style runs and placements for a selection) and the Markdown commands (bold, italic,
  strikethrough, links, tasks).
- **Editor text** (`crates/editor-text`, `commitnote-editor-text`) — UTF-16 text edits, the grouped
  undo history and the merge of remote text into what is being typed.
- **Interaction** (`crates/interaction`, `commitnote-interaction`) — the rules for starting a note by
  typing.

Every text offset between the app and the core is in UTF-16 code units, as in the web app. The
editor widget converts to and from GTK's character offsets at the edge.

The core bundle is embedded into the binary from `dist-native-core/` (`dist-native-core-fake/` for
the testing build). Build it first with `npm run build:native-core` from the repository root.

The build is meson wrapping cargo (`meson.build`, `meson.options`).

## Editing

The note view has a title field above the editor. Everything below is in the editor unless noted.

- **Live preview.** Headings, emphasis, strikethrough, inline code, code blocks, quotes, links, list
  marks, task checkboxes and horizontal rules are drawn as they will read. The Markdown markers
  (`#`, `**`, link brackets and the like) are hidden on every line the caret or selection does not
  touch. Hiding is only styling: the buffer text is always exactly the note text, so what is saved
  is what was typed. Clicking a checkbox toggles the task. Images are not shown yet.
- **Autosave.** The core saves a note about 2 s after typing stops, at most 30 s later, and also when
  you switch notes, hide the window or log out. Ctrl+S (Save Now, also in the note menu) saves at
  once. Typing keeps working offline; the edits are saved when the connection returns.
- **Sync status.** The status button in the sidebar header (in the note header when the sidebar is
  hidden or collapsed) shows one icon: offline, synced, syncing, waiting to save, failed or
  conflict. Its popover shows the status text, the notes that are not saved yet (a click opens
  one) and Retry. The banner above the note shows the most urgent of: an unresolved conflict on
  this note (with Resolve), a conflict being edited (the hint), a failed save (with Retry Now) and
  being offline. A change made to the open note on another device shows as a short toast, and the
  editor takes the merged text without moving the caret.
- **Conflicts.** The note is read-only while a conflict is unresolved. Resolve opens a dialog with
  the merged text, conflict markers dimmed, and three choices: keep this version, keep the other, or
  edit the merged text in the editor. The wording of the dialog and the choices comes from the core.
- **Formatting.** Ctrl+B, Ctrl+I, Ctrl+Shift+X, Ctrl+K and Ctrl+Return (see Shortcuts) work on the
  selection. Ctrl+K wraps the selection in a link with an empty destination and puts the caret in it;
  pasting a URL over a selection makes a link too. Toggle Task with nothing selected in a link opens
  it. In the narrow layout a formatting bar sits at the bottom of the note, and in both layouts the
  note menu holds Save Now and the same commands.
- **Undo.** Ctrl+Z and Ctrl+Shift+Z use the app's own history, which groups typing that is less than
  a second apart. A remote change merges into the text without becoming an undo step, so
  Ctrl+Z takes back only your own typing.
- **Vim mode.** The device setting `vimMode` (off by default) switches the editor to GtkSourceView's
  Vim emulation and shows a status line with the mode and any pending command below the note. There
  is no Preferences row for it yet: the setting lives in `device-settings.json` in the app's config
  directory and changes through the core's `settings.change` command (`vimMode`, `"true"` or
  `"false"`), and the editor follows a change at once. In normal mode `u` and Ctrl+R, and `:undo`,
  `:redo` (also `:u` and `:red`), use the app's history instead of the buffer's, which is
  turned off. `:w` saves.
- **New notes and the title.** New Note (the sidebar button, Ctrl+N) opens a draft with the title
  field focused. A draft becomes a note when it gets a name or any text; leaving it empty discards
  it. Renaming is done in the title field; a name that cannot be used shows an error under the
  field.
- **Type to start.** With nothing open and the empty note view showing, typing a character starts
  a new note with it (the device setting `typeToStart`, on by default; it needs no focused text
  field and no dialog). The keys typed before the editor is ready are held and entered as one edit.
- **Early draft.** While the notes load after login, the loading page has a name field and a body.
  What is typed there is handed to the core as soon as the notes are ready: a body creates a note,
  a name alone opens a draft with that name. If that fails, the page stays with Try Again and the
  text is kept.
- **Close and logout guards.** Closing the window, Ctrl+W and Ctrl+Q save first. If something is
  still unsaved, "Some Changes Are Not Saved" offers Keep Trying (which retries and keeps the window
  open) and Quit Anyway. Log Out asks the same way, with Cancel, Keep Trying and Log Out Anyway.
  Text typed into the early draft on the loading page is guarded too: closing with it asks the same
  way, and Keep Trying keeps the text and lets the hand-off finish (or runs Try Again when the
  loading page shows a failure). An empty early draft closes at once. While anything is unsaved, or
  the early draft holds text, the app also holds a GNOME logout inhibit, so a session logout or
  shutdown warns first.

## Shortcuts

| Shortcut         | Where                    | What it does                                                           |
| ---------------- | ------------------------ | ---------------------------------------------------------------------- |
| Ctrl+S           | anywhere in the window   | Save Now: sends the edits and saves them.                              |
| Ctrl+N           | notes and loading pages  | New note; on the loading page it focuses the early draft's name field. |
| Ctrl+W           | anywhere in the window   | Closes the window, through the close guard.                            |
| Ctrl+Q           | anywhere in the window   | Quits, through the close guard.                                        |
| Ctrl+R           | notes page               | Refresh. With Vim mode on and the editor focused, Vim's redo instead.  |
| F9               | notes page               | Shows or hides the sidebar.                                            |
| Left, Right      | note tree                | Collapse or expand a folder; move to the parent or the first child.    |
| Ctrl+Z           | editor                   | Undo.                                                                  |
| Ctrl+Shift+Z     | editor                   | Redo.                                                                  |
| Ctrl+B           | editor                   | Bold.                                                                  |
| Ctrl+I           | editor                   | Italic.                                                                |
| Ctrl+Shift+X     | editor                   | Strikethrough.                                                         |
| Ctrl+K           | editor                   | Insert link.                                                           |
| Ctrl+Return      | editor                   | Toggle task; with nothing selected inside a link, open it.             |
| Ctrl+click       | a link in the editor     | Opens the link.                                                        |
| `u`              | editor, Vim normal mode  | Undo through the app's history.                                        |
| `:undo`, `:redo` | editor, Vim command line | Undo and redo through the app's history.                               |
| `:w`             | editor, Vim command line | Save Now.                                                              |

The editor shortcuts work while the editor has focus. Ctrl+KP_Enter also toggles the task.

## Build on the host (Fedora 43)

Install the build and run packages:

<!-- packages: build+run -->

```sh
sudo dnf install \
  appstream \
  blueprint-compiler \
  desktop-file-utils \
  gcc \
  glib2 \
  glib2-devel \
  gtk4 \
  gtk4-devel \
  gtksourceview5 \
  gtksourceview5-devel \
  javascriptcoregtk6.0 \
  javascriptcoregtk6.0-devel \
  libadwaita \
  libadwaita-devel \
  libsoup3 \
  libsoup3-devel \
  libwebp \
  libwebp-devel \
  meson \
  ninja-build \
  pkgconf-pkg-config \
  webkitgtk6.0 \
  webkitgtk6.0-devel
```

Node.js and npm are needed for the core bundle, and rustup for the Rust toolchain. rustup reads
`rust-toolchain.toml` and installs the pinned toolchain with clippy and rustfmt on the first cargo
command inside `apps/linux/`. Fedora packages it as `rustup`; run `rustup-init` once after
installing it.

From the repository root:

```sh
npm ci
npm run build:native-core
apps/linux/scripts/run-host.sh
```

`run-host.sh` configures meson in `apps/linux/_build`, builds, installs into
`apps/linux/out/host-prefix` and starts the installed binary from there, so nothing is installed
system-wide. `apps/linux/scripts/run-host.sh --testing` builds and runs the testing build instead
(see below).

## Run without development packages

`install-prefix.sh` builds the app in the Docker build container and installs it into
`apps/linux/out/prefix`; `run-installed.sh` starts it on the host. This needs Docker (or Podman's
Docker API) and only the run packages on the host. Most of them are on a default Fedora
Workstation.

<!-- packages: run -->

```sh
sudo dnf install \
  glib2 \
  gtk4 \
  gtksourceview5 \
  javascriptcoregtk6.0 \
  libadwaita \
  libsoup3 \
  libwebp \
  webkitgtk6.0
```

From the repository root:

```sh
npm ci
npm run build:native-core
apps/linux/scripts/install-prefix.sh
apps/linux/scripts/run-installed.sh
```

`install-prefix.sh` takes `--release` (the release profile) or `--testing` (the testing build);
without an option it installs the development profile. Each run replaces `out/prefix`.
`run-installed.sh [<prefix>]` runs `<prefix>/usr/bin/commitnote` with the prefix's schemas and data
directories; without an argument it uses `apps/linux/out/prefix`. Extra arguments are passed to the
app.

## Testing build

The testing build (`-Dtesting=true`, development profile only) embeds the fake core bundle
(`dist-native-core-fake/`) and serves the sample notes repo from a fake forge, so the app works
without a network or an account: any token logs in, and the passphrase of the sample repo is
`sample notes repo passphrase`. It also adds a Testing section to the notes view's main menu with
Remote Edit, Fail Next Request, Change Passphrase Elsewhere and Hold Loading, which change the fake
forge's state so the app's reaction can be seen. Remote Edit replaces the first line of the open
note (or of the first note) with a commit from another device. Hold Loading makes the fake forge
hold back the repository inspection of the sample repositories, so the loading page stays up: type
there to try the early draft, then press Finish Loading, a button the loading page shows only in this
build. Starting the app with `COMMITNOTE_TESTING_HOLD_LOADING=1` holds loading from the start. The UI
tests run against this build.

```sh
apps/linux/scripts/install-prefix.sh --testing
apps/linux/scripts/run-installed.sh
```

or, with the development packages installed, `apps/linux/scripts/run-host.sh --testing`.

## Checks and tests

Nothing needs GTK on the machine: these scripts run inside the Docker build container
(`ci/Dockerfile`, Fedora 43 plus the three package lists in `ci/` and the pinned Rust toolchain).
The image is built on first use and rebuilt when the Dockerfile, a package list or
`rust-toolchain.toml` changes. Run them from the repository root, after
`npm run build:native-core`:

| Script                                   | What it does                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/linux/scripts/build.sh`            | `cargo build` of the crates, then the meson testing build of the app.                                                                              |
| `apps/linux/scripts/lint.sh`             | The static checks below.                                                                                                                           |
| `apps/linux/scripts/test.sh`             | Crate tests, the app's unit tests, the UI suite and the read-back.                                                                                 |
| `apps/linux/scripts/ui-test.sh [filter]` | Only the UI suite. The optional filter runs the cases whose name contains it; with no match it fails.                                              |
| `apps/linux/scripts/release-check.sh`    | Builds the release profile and checks that the binary holds no fake command, that its embedded bundle equals `dist-native-core/` and not the fake. |

The static checks (`lint.sh`) are:

- the check that the package lists in this README match `ci/*-packages.txt`
  (`scripts/check-package-lists.sh`, which also runs on the host with plain `sh`),
- `cargo fmt --all --check`,
- `cargo clippy` with `-D warnings` on the crates and, through meson, on the app with and without
  the testing build,
- Blueprint compilation of `data/ui/`, which happens when meson builds the app for clippy,
- the meson `static` suite: `desktop-file-validate`, `appstreamcli validate` on the metainfo, and a
  strict compile of the GSettings schema,
- on the host, `npx tsx apps/linux/markdown-vectors/generate.ts --check`, which fails when the
  Markdown vectors are stale (see below).

The tests (`test.sh`) run, in this order:

1. The crate tests (`cargo test --workspace`) inside a D-Bus session with an unlocked
   gnome-keyring, because the remembered-session store uses the Secret Service. One more test checks
   that the app copes with no Secret Service at all.
2. The app's own unit tests (meson `cargo` suite).
3. The UI suite (`ci/steps/ui-test.sh`): the testing build under headless Weston at 1280x800 with
   an unlocked keyring, driving real pages and saving screenshots to
   `apps/linux/out/screenshots/p<phase>-<view>-<narrow|wide>-<light|dark>-<accent>.png`. The `p1`
   cases cover login, unlocking and reading; the `p2` cases cover the editor, Vim mode, drafts,
   sync feedback, conflicts, the close guard and the early draft. A failing case saves
   `failure-<case>.png` there. Logs go to `apps/linux/out/logs/`, with per-case timings in
   `ui-testlog.txt`. The filter of `ui-test.sh` matches case names only. The headless compositor has
   no input seat, so the cases drive keys by calling the controllers and the Vim input method
   directly, and the container has no emoji font, so screenshots show no emoji glyphs.
4. On the host, the read-back: the crate tests and the UI case `editor_read_back` write scenarios
   (a repo made by the Rust runtime and what a reader should find in it) into `apps/linux/out/read-back`, and
   `npx tsx scripts/read-back-native-repo.ts apps/linux/out/read-back` has the shared TypeScript
   reader open every scenario there, so this step needs `npm ci` but no container. It proves the
   TypeScript side can read what the Linux app wrote, including a note typed in the editor.

The crates that need no GTK (`commitnote-markdown`, `commitnote-editor-text`,
`commitnote-interaction` and `commitnote-core-api`) also build and test on a machine without the
development packages. From `apps/linux`, run `cargo test -p <crate> --locked` for a quick loop. The
container scripts stay the check that counts.

### Markdown vectors

The live-preview editor decides what to hide and style from the Markdown syntax tree. The web app
gets that tree from its CodeMirror editor (a lezer parser); the Linux app parses with
`pulldown-cmark`. `apps/linux/markdown-vectors/` proves the Rust renderer treats both the same way:
`corpus.json` holds sample Markdown documents, and `generate.ts` parses each one with the web
editor's real Markdown configuration and records the resulting syntax nodes in `vectors.json`.
`crates/markdown/tests/vectors.rs` renders every entry twice, from the web nodes and from the Rust
parse, for no selection and for a caret at the start of each line, and requires the same style runs
and placements. The differences the two parsers cannot avoid are listed in that test as allowed,
each with a reason, and each must still differ, so a fix that removes one has to remove it from the
list.

After changing the Markdown configuration of the web editor, or the corpus, regenerate the file from
the repository root and commit it:

```sh
npx tsx apps/linux/markdown-vectors/generate.ts
```

`lint.sh` runs the generator with `--check` and fails when `vectors.json` is stale.

`ui-test.sh` needs the packages that the container adds for tests, listed here for running the UI
tests on the host. They are needed only for that; the container has them already, and building and
running the app does not.

<!-- packages: test -->

```sh
sudo dnf install \
  adwaita-icon-theme \
  adwaita-mono-fonts \
  adwaita-sans-fonts \
  dbus-daemon \
  gnome-keyring \
  mesa-dri-drivers \
  weston
```

### Caches and resources

- Cargo's registry and git caches and the build output (`apps/linux/target`) live in Docker named
  volumes, so repeated runs are incremental. The registry and git volumes are shared; the target
  volume is per workspace (`commitnote-linux-target-<hash of the workspace path>`).
  `apps/linux/scripts/container.sh --remove-target-volume` deletes this workspace's target volume.
- `COMMITNOTE_LINUX_CACHE_DIR` replaces the three named volumes with `registry`, `git` and
  `target` directories under the given path (CI uses this to cache them).
- The container runs with 4 CPUs and 8 GB of memory. Override with `COMMITNOTE_DOCKER_CPUS` and
  `COMMITNOTE_DOCKER_MEMORY` (for example `COMMITNOTE_DOCKER_MEMORY=12g`).
- `apps/linux/scripts/container.sh <command...>` runs any command in the container from
  `apps/linux/`. `--print-image-tag` prints the image tag and `--write-context <dir>` writes the
  files the image is built from; CI uses both.
- Everything the scripts write for you to look at is under `apps/linux/out/` (`screenshots/`,
  `logs/`, `prefix/`, `host-prefix/`, `read-back/`), which git ignores.

## Profiles

| Profile       | App id                                  | Differences                                                                                                                      |
| ------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `development` | `io.github.marcinjahn.commitnote.Devel` | The default. Name "commitnote (Devel)", a striped header bar, and a GSettings path, keyring item and XDG directories of its own. |
| `release`     | `io.github.marcinjahn.commitnote`       | The name "commitnote", the plain header bar, the production core bundle and no testing code.                                     |

The development build can run next to an installed release build without sharing settings, the
remembered session or cached data. The `testing` option is a development-only switch on top of the
profile (`-Dprofile=development -Dtesting=true`); the release profile rejects it.

## CI

The `Linux` workflow (`.github/workflows/linux.yml`) builds the container image and runs `build.sh`,
`lint.sh`, `test.sh` and `release-check.sh` in that order. It runs on:

- pushes to `main` and to `linux-ci/**` branches that touch the Linux app, the test vectors, the
  shared web sources and build configuration the core bundle is built from, or the workflow itself
  (it is path-filtered; see `on.push.paths` in the workflow),
- manual dispatch (`workflow_dispatch`).

Push to a `linux-ci/**` branch to prove a build without touching `main`. A run is limited to 45
minutes. The cargo cache makes a warm run take about 3 minutes against about 15 for a cold one.

Every run uploads two artifacts, even when a step failed:

- `linux-screenshots` — the UI screenshots, including `failure-*.png` for failed cases,
- `linux-logs` — the Weston log and the UI test log.

Both are kept for 30 days. To fetch them, name them, because a bare `gh run download` fails on the
`*.dockerbuild` artifact that the image build adds:

```sh
gh run download <run-id> -n linux-screenshots -n linux-logs
```
