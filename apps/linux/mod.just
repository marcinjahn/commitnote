# Linux app recipes, run as `just linux <recipe>`. The container builds embed the core bundle, so
# run `just build-native-core` first. Paths are relative to the repository root.

set default-list
set positional-arguments
set working-directory := "../.."

# Build the crates and the testing build of the app in the build container
[group('build')]
build:
    apps/linux/scripts/build.sh

# Build in the container and install into apps/linux/out/prefix (`--release` or `--testing`)
[group('build')]
install-prefix *flags:
    apps/linux/scripts/install-prefix.sh "$@"

# Run the app installed by install-prefix (`[<prefix>] [app arguments]`)
[group('build')]
run *args:
    apps/linux/scripts/run-installed.sh "$@"

# Build and run on the host with the development packages installed (`--testing`)
[group('build')]
run-host *flags:
    apps/linux/scripts/run-host.sh "$@"

# Run a command in the build container from apps/linux (`--remove-target-volume` drops the cache)
[group('build')]
container +args:
    apps/linux/scripts/container.sh "$@"

# Static checks: rustfmt, clippy, meson static suite and the Markdown vectors
[group('check')]
lint:
    apps/linux/scripts/lint.sh

# Crate tests, the app's unit tests, the UI suite and the TypeScript read-back
[group('check')]
test:
    apps/linux/scripts/test.sh

# Run the UI suite, or only the cases whose name contains <filter>
[group('check')]
ui-test filter="":
    apps/linux/scripts/ui-test.sh "$1"

# Build the release profile and check it holds no testing code and the right core bundle
[group('check')]
release-check:
    apps/linux/scripts/release-check.sh

# Regenerate the Markdown vectors from the web editor (`--check` fails when they are stale instead)
[group('generate')]
generate-markdown-vectors *args:
    tsx apps/linux/markdown-vectors/generate.ts "$@"

# Build the Flatpak bundle into apps/linux/out/flatpak/ (`--testing`, or `--remove-state-volume`)
[group('flatpak')]
flatpak-build *flags:
    apps/linux/scripts/flatpak-build.sh "$@"

# Install a bundle in the Flatpak test container, start it and print its screenshot path
[group('flatpak')]
flatpak-launch bundle:
    apps/linux/scripts/flatpak-launch.sh "$1"

# Smoke-test a release bundle and, optionally, a testing bundle in a clean container
[group('flatpak')]
flatpak-smoke-test release testing="":
    apps/linux/scripts/flatpak-smoke-test.sh "$1" ${2:+"$2"}
