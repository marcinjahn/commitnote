# commitnote for GNOME

A native GNOME client for the same encrypted notes repo the web app uses. It is a Rust, GTK 4 and
libadwaita app that runs the shared native core bundle (`commitnote-core.js`, built from
`src/native-core/`) in JavaScriptCore, so it reads exactly what the web app writes. This version is
read-only: log in, unlock a notes repo or set a new one up, browse the note tree and read notes.

## Overview

Four layers:

- **App** (`src/`, UI definitions in `data/ui/`, UI tests in `tests/ui/`) — GTK 4 and libadwaita
  pages and navigation. It only talks to the core runtime.
- **Core runtime** (`crates/core-runtime`) — loads the core bundle into JavaScriptCore and provides
  the host services it needs: crypto, network (libsoup), the remembered session in the Secret
  Service keyring, a blob cache, device settings and the image codec.
- **Crypto** (`crates/crypto`) — the cryptographic operations behind the host crypto service.
- **Core API** (`crates/core-api`) — the typed command, event and error shapes shared with the core
  bundle, plus the fake commands the testing build uses.

The core bundle is embedded into the binary from `dist-native-core/` (`dist-native-core-fake/` for
the testing build). Build it first with `npm run build:native-core` from the repository root.

The build is meson wrapping cargo (`meson.build`, `meson.options`).

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
forge's state so the app's reaction can be seen. The UI tests run against this build.

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
  strict compile of the GSettings schema.

The tests (`test.sh`) run, in this order:

1. The crate tests (`cargo test --workspace`) inside a D-Bus session with an unlocked
   gnome-keyring, because the remembered-session store uses the Secret Service. One more test checks
   that the app copes with no Secret Service at all.
2. The app's own unit tests (meson `cargo` suite).
3. The UI suite (`ci/steps/ui-test.sh`): the testing build under headless Weston at 1280x800 with
   an unlocked keyring, driving real pages and saving screenshots to
   `apps/linux/out/screenshots/p<phase>-<view>-<narrow|wide>-<light|dark>-<accent>.png`. A failing
   case saves `failure-<case>.png` there. Logs go to `apps/linux/out/logs/`.
4. On the host, the read-back: the crate tests write a repo with the Rust runtime, and
   `npx tsx scripts/read-back-native-repo.ts apps/linux/out/read-back` has the shared TypeScript
   reader open it, so this step needs `npm ci` but no container. It proves the TypeScript side can
   read what the Linux app wrote.

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
