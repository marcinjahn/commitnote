# commitnote tasks: `just` lists them all. Paths given to recipes are relative to the repository
# root, and the native apps' recipes live in their modules (`just linux <recipe>`).

set minimum-version := "1.55.0"
set positional-arguments

export PATH := justfile_directory() / "node_modules" / ".bin" + ":" + env("PATH")

[private]
default:
    @{{ quote(just_executable()) }} --justfile {{ quote(justfile()) }} --list --list-submodules --unsorted

# Start the Vite dev server for the app
[group('dev')]
dev *args:
    vite "$@"

# Start the Vite dev server in test mode (fake forge, fixture repositories)
[group('dev')]
dev-fake *args:
    vite --mode fake-forge "$@"

# Start the Vite dev server for the landing page
[group('dev')]
dev-landing *args:
    vite --config landing/vite.config.ts "$@"

# Serve the production build from dist/ (landing at /, app at /app/)
[group('dev')]
preview *args:
    vite preview --outDir dist "$@"

# Serve the test-mode build from dist-fake/
[group('dev')]
preview-fake *args:
    vite preview --outDir dist-fake "$@"

# Build the production site into dist/: the landing page, then the app into dist/app/
[group('build')]
build:
    vite build --config landing/vite.config.ts
    vite build

# Build the test-mode site into dist-fake/ (`--if-stale` reuses an up-to-date build)
[group('build')]
build-fake *args:
    tsx scripts/build-fake.ts "$@"

# Build the native core bundles into dist-native-core/ and dist-native-core-fake/
[group('build')]
build-native-core:
    vite build --mode native-core
    vite build --mode native-core-fake

# Type-check the app, the Node-side config and scripts, and the service worker
[group('check')]
check:
    svelte-check --tsconfig ./tsconfig.app.json
    tsc -p tsconfig.node.json
    tsc -p tsconfig.sw.json

# Build dist/ and dist-fake/ and check the site layout, budgets and that no test code ships
[group('check')]
check-bundle: build build-fake
    tsx scripts/check-bundle.ts

# Build the native core bundles and run them in a bare host
[group('check')]
check-native-core: build-native-core
    tsx scripts/check-native-core.ts

# Run the unit tests with Vitest (arguments go to `vitest run`)
[group('test')]
test *args:
    vitest run "$@"

# Run only the unit tests related to the given source files
[group('test')]
test-related +files:
    vitest related --run "$@"

# Run the end-to-end tests with Playwright under the e2e lock (arguments go to Playwright)
[group('test')]
test-e2e *args:
    sh scripts/test-e2e.sh "$@"

# Full local validation: type-check, unit tests, bundle check and end-to-end tests
[group('test')]
validate: check test check-bundle test-e2e

# Read the repositories a native app's tests wrote into <dir> with the TypeScript reader
[group('test')]
read-back-native-repo dir:
    tsx scripts/read-back-native-repo.ts "$1"

# Regenerate the brand SVGs and app icons (`--contact-sheet <file.png>` adds a review sheet)
[group('generate')]
generate-brand *args:
    tsx scripts/generate-brand-svgs.ts "$@"

# Regenerate the landing screenshots from the test-mode build (uses E2E_PORT)
[group('generate')]
generate-landing-screenshots: build-fake
    tsx scripts/generate-landing-screenshots.ts

# Regenerate the web app manifest screenshots from the test-mode build (uses E2E_PORT)
[group('generate')]
generate-pwa-screenshots: build-fake
    tsx scripts/generate-pwa-screenshots.ts

# Regenerate the sample notes repo fixture
[group('generate')]
generate-sample-notes-repo:
    tsx scripts/generate-sample-notes-repo.ts

# Regenerate the shared test vectors in apps/test-vectors/
[group('generate')]
generate-test-vectors:
    tsx scripts/generate-test-vectors.ts

# Profile tree scrolling in the test-mode build (`--out <dir> [--runs <n>]`)
[group('profile')]
profile-tree-scroll *args:
    tsx scripts/profile-tree-scroll.ts "$@"

# Linux app: container builds, checks and the Flatpak (`just linux`)
[group('native')]
mod linux 'apps/linux'

# iOS app: Swift tests on Linux and the Xcode helpers (`just ios`)
[group('native')]
mod ios 'apps/ios'
