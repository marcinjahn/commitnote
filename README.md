<h1 align="center">
  <picture>
    <source
      media="(prefers-color-scheme: dark)"
      srcset="docs/brand/wordmark-dark.svg"
    />
    <img src="docs/brand/wordmark-light.svg" alt="commitnote" width="245" />
  </picture>
</h1>

commitnote is a static, client-side web app for encrypted markdown notes. Notes are encrypted
entirely in your browser and stored as files in a GitHub or GitLab repository you own — there is no backend
server. The only other request is an optional anonymous visit count (see
[Privacy and analytics](#privacy-and-analytics)).

[commitnote.eu](https://commitnote.eu) is the landing page; the app is at
[commitnote.eu/app](https://commitnote.eu/app/). A Linux desktop build is available as an
[AppImage download](https://github.com/marcinjahn/commitnote/releases/latest/download/commitnote-x86_64.AppImage) (see [Desktop app](#desktop-app-linux-appimage)).

## Prerequisites

- Node 26
- npm

## Run locally

```
npm install
npm run dev
```

Then open `http://localhost:5173`. `npm run dev:landing` starts the landing page dev server instead
(see [Landing page](#landing-page)).

`npm run generate:brand` regenerates the brand SVGs from the app font: the README wordmark SVGs in `docs/brand/`, including their animated caret, and the favicon in `src/assets/favicon.svg`. It also rasterises the app icons (`any` 192/512, `maskable` 192/512, `monochrome` 512 and `apple-touch-icon` 180) into `public/icons/`. Never edit them by hand: the drift test fails when they are stale. `npm run generate:brand -- --contact-sheet <file.png>` also writes an uncommitted review sheet with the maskable safe-zone circle.

### Secure context

WebCrypto is only available in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts).
`localhost` qualifies (both the dev server and the preview server), but opening the dev server
through a LAN IP address over plain HTTP does not work.

## Scripts

- `dev` — start the Vite dev server
- `dev:fake` — start the Vite dev server in test mode (fake forge, see below)
- `dev:landing` — start the Vite dev server for the landing page (`landing/`)
- `build` — produce the production site in `dist/`: the landing build first (it empties `dist/`),
  then the app build into `dist/app/`
- `build:fake` — produce a test-mode build in `dist-fake/` (`--if-stale` reuses an up-to-date one)
- `preview` — preview the built site locally: landing page at `/`, app at `/app/`
- `preview:fake` — preview the test-mode build locally
- `test` — run unit tests with Vitest
- `test:e2e` — run end-to-end tests with Playwright under the e2e lock (see below)
- `check` — type-check the app and the Node-side config/scripts
- `check:bundle` — build `dist/`, `dist-fake/` and `dist-desktop/` and verify the site layout, the
  landing page's CSP and retirement worker, and the landing size budget (see
  [Landing page](#landing-page)), and that the production build never ships test-mode fixture data or desktop shell code, that the web app manifest and every icon
  and screenshot it references are in the production build, that `app/sw.js` is present and its
  precache list equals the emitted files under `app/`, and that the desktop build ships the desktop shell but no fake-forge
  fixture data or `sw.js`, and that its CSP allows `https://gitlab.com` and `ipc:`
- `generate:brand` — regenerate the brand SVGs and app icons (see above)
- `generate:pwa-screenshots` — regenerate the web app manifest screenshots in `public/screenshots/` from
  the test-mode build, using the system Chrome (optional `E2E_PORT`)
- `generate:landing-screenshots` — regenerate the landing screenshots in `landing/screenshots/`, in
  light and dark, from the test-mode build; run it after visible UI changes (optional `E2E_PORT`)
- `fixture:sample-notes-repo` — regenerate the sample notes repo fixture
- `build:desktop` — build only the web assets of the desktop app into `dist-desktop/`
- `build:desktop-fake` — build the same in test mode (fake forge) into `dist-desktop-fake/`, for the
  local desktop-fake AppImage only (never published)
- `appimage` — build the Linux AppImage in Docker (see below)
- `tauri` — run the Tauri CLI

### Build the AppImage locally

Needs `docker`. The build runs in an Ubuntu 22.04 builder image (created on first use), the same
base as the release workflow:

```
npm run appimage
npm run appimage -- --mode desktop-fake
```

The first writes `dist-appimage/desktop/` (the AppImage, its `.zsync` file and `SHA256SUMS`). The
second builds a fake-forge AppImage for local testing; it is never published. Cargo, npm and tool
caches live in `~/.cache/commitnote-appimage`; set `COMMITNOTE_APPIMAGE_CACHE_DIR` to move them.

`scripts/appimage/xvfb-smoke.sh` is a smoke test that starts a `desktop-fake` AppImage under Xvfb:

```
sh scripts/appimage/docker-run.sh bash scripts/appimage/xvfb-smoke.sh dist-appimage/desktop-fake/commitnote-x86_64.AppImage
```

## Landing page

The landing page lives in `landing/`: plain HTML, CSS and a small TypeScript module, with its own Vite
config (`landing/vite.config.ts`). It imports only the dependency-free analytics module
(`src/analytics/analytics.ts`) from the app source; the app lives under `src/`.

- `npm run dev:landing` runs it, and `npm run build` builds it into the root of `dist/` before the app.
- `landing/src/boot.ts` is a pre-render script bundled and inlined into `<head>`. It applies the saved
  color mode and performs app forwarding: a share link, a note fragment, a launch action or an
  installed display mode sends the visitor to `/app/` with the query and hash kept. The landing page's
  own anchors never forward.
- The page ships a strict CSP applied via a `<meta>` tag, which includes the hash of the inline boot
  script. Its `connect-src` is `'none'` unless analytics is enabled, then exactly the GoatCounter origin.
- The landing stylesheet copies the app's design tokens; `landing/src/tokens.test.ts` fails when they
  drift apart.
- The landing screenshots are in `landing/screenshots/`; regenerate them with
  `npm run generate:landing-screenshots`.
- `npm run check:bundle` enforces the size budget: landing HTML, CSS and JS together at most 40 KB,
  and each landing screenshot PNG at most 400 KB.

## Privacy and analytics

commitnote counts anonymous visits with [GoatCounter](https://www.goatcounter.com/help/privacy), a hosted
(EU: Hetzner, Finland/Germany), open source (EUPL-1.2) service. Analytics is inert until a site code is
configured: with the default `GOATCOUNTER_SITE_CODE = null` in `analytics.config.ts` no request is made and
the CSPs are unchanged. See also the [privacy section of the landing page](https://commitnote.eu/#privacy).

**What is sent.** One visit per page load of the landing page or the app (the share viewer counts as the
app), scheduled on an idle callback, never awaited, errors ignored. In-app navigation sends nothing, and a
landing load that is forwarded to `/app/` (installed display mode, `#share=` or `#n=` links, `?action=`)
does not count as a landing visit. The request is exactly
`GET https://<site-code>.goatcounter.com/count?p=<visit path>&t=<visit title>`, sent with
`mode: "no-cors"`, `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `cache: "no-store"` and
`keepalive: true`, with no other parameters and nothing derived from the URL:

| Visit path     | Visit title      |
| -------------- | ---------------- |
| `/landing/web` | `Landing (web)`  |
| `/app/web`     | `App (web)`      |
| `/app/pwa`     | `App (PWA)`      |
| `/app/appimage`| `App (AppImage)` |

**What is never sent or stored.** No cookies or browser storage for counting, no note data, URLs, hashes,
query strings, referrer or identifiers. GoatCounter does not store the IP address or the full User-Agent; it
derives only the country, browser and OS names, counts unique visitors with an in-memory mapping that lasts
up to 8 hours, and filters bot and headless User-Agents on the server.

**When nothing is sent.** Nothing is sent when `navigator.doNotTrack === "1"`,
`navigator.globalPrivacyControl === true`, when the browser is offline, or after opting out. Opt out in
Settings > This device > "Anonymous usage statistics", or with the button in the landing page's `#privacy`
section. The choice is stored as `localStorage["commitnote.analyticsOptOut"] = "1"` and shared by the
landing page and the web app (same origin); the AppImage keeps its own.

The dev server and unit tests always have no endpoint. Fake-forge builds use
`https://analytics.invalid/count`, which the e2e tests intercept.

### Enabling analytics

1. Sign up at <https://www.goatcounter.com/signup> (free for non-commercial use) and pick a site code,
   e.g. `commitnote` (the dashboard becomes `https://<code>.goatcounter.com`). The code must match
   `^[a-z0-9-]+$` or the build fails.
2. In the site's Settings > Data collection keep **Sessions**, **User-Agent** and **Country** on; turn
   **Referrer**, **Size** and **Region** off; leave **Individual pageviews** and **Language** off. Save.
3. Set `GOATCOUNTER_SITE_CODE` in `analytics.config.ts` to the site code, commit and push to `main`. The
   GoatCounter origin is then added to `connect-src` of the landing, web and desktop CSPs.
4. "Deploy to GitHub Pages" enables the landing page and web app; the next "Desktop release" enables the
   AppImage (older AppImages keep sending nothing).
5. Verify: open `https://commitnote.eu/` with DevTools > Network and confirm exactly one
   `count?p=%2Flanding%2Fweb…` request to `<code>.goatcounter.com`, without `Referer` or `Cookie` headers.

## Deployment

Every push to `main` runs `.github/workflows/pages.yml`: type-check, unit tests, the bundle check, then
a publish of `dist/` to GitHub Pages. In the repository settings, set Pages > Source to "GitHub
Actions" once. `dist/` is the whole site: the landing page at the root (with the retirement worker
`sw.js` and `social.png`) and the app in `dist/app/`, served at `https://commitnote.eu/app/`. The
build uses relative asset paths. Desktop builds stay app-only: `dist-desktop/` has no landing page.

Every push to `main` also runs `.github/workflows/desktop-release.yml`, separate from `pages.yml`:
type-check and unit tests, the AppImage build in `ubuntu:22.04`, a build-provenance attestation, and a
GitHub release `v0.1.<N>` (N is the commit count of `main`) titled `commitnote 0.1.<N>` and marked
Latest. Its assets are `commitnote-x86_64.AppImage`, `commitnote-x86_64.AppImage.zsync` and
`SHA256SUMS`. Only the 10 newest desktop releases are kept; older ones are deleted together with
their tags. Manual runs only build and publish from `main`.

## End-to-end tests

```
npm run test:e2e
```

Arguments after `--` go to Playwright, e.g. `npm run test:e2e -- e2e/refresh.spec.ts`. The script
installs Playwright's headless shell (`chromium-headless-shell`, with its bundled FFmpeg)
automatically when it is missing. The `installability` project (the PWA installability test) runs
on the system Google Chrome, so Chrome must be installed; `generate:pwa-screenshots` needs it too.

The suite runs the built site in test mode (fake forge, no network, `dist-fake/`) with `baseURL` at
`/app/`, in the `desktop` and `mobile` projects, with 5 workers by default. App specs navigate with
relative paths (`./`), landing specs with root paths (`/`). Motion is reduced by default (`reducedMotion: "reduce"`);
a test that needs motion opts in with `test.use({ reducedMotion: "no-preference" })`. The web
server reuses `dist-fake/` when `check:bundle` just built it from the same inputs.

Runs take the e2e lock on `/tmp/commitnote-e2e.lock`: a second `npm run test:e2e` anywhere on the
machine (any jj workspace, the agent cage, your own shell) prints a waiting notice and starts when
the first one finishes. `npx playwright test` bypasses the lock.

`E2E_PORT` overrides the port the app is served on (default 4173). Never run two e2e runs on the
same port at once; direct `playwright test` runs can still overlap.

In the 6-CPU agent cage with nothing else running, the full e2e suite takes about 4.5 min (270 s).
Full local validation (`check` + `test` + `check:bundle` + `test:e2e`) takes about 5.2 min.

## Manual live check

Real-GitHub behaviour is not covered by automation; check it by hand against a real notes repo:

- Reorder notes by dragging (mouse on desktop, long-press then drag on a phone), move one into and
  out of a folder, then log in on a second real device and check it shows the same order.

## Test mode

`npm run dev:fake` (and `npm run build:fake` / `preview:fake`) run the app against in-memory
fixture repositories instead of GitHub, with no network access. Every forge call is delayed by
roughly what it takes on GitHub (a commit about 1.2 s), so saving and loading states are visible.
Any access token lists all of these fixture repositories:

- `https://github.com/sample/notes` — an initialized notes repo, passphrase
  `sample notes repo passphrase`
- `https://github.com/sample/trash` — same passphrase; a few notes plus three trash entries. With
  the clock pinned to `2026-09-30T12:00:00Z` (the `SAMPLE_TRASH_NOW` constant in
  `src/testing/sample-notes-repo/sample-source.ts`), the note deleted 2026-01-05 and the folder
  (with a nested note) deleted 2026-01-12 are expired, and the note deleted 2026-09-27 is fresh.
  `sample/notes` has no trash, so it never triggers a startup purge
- `https://github.com/sample/large-tree` — same passphrase; a large generated tree (600+ notes in
  nested folders) for checking tree performance, built on first open
- `https://github.com/sample/empty` — empty and writable
- `https://github.com/sample/almost-empty` — writable, with only `README.md`, `LICENSE` and
  `.gitignore`
- `https://github.com/sample/public-empty` — empty and writable, listed as public
- `https://github.com/sample/empty-read-only`, `https://github.com/sample/read-only` — read-only
  variants
- `https://github.com/sample/foreign` (a README and code), `https://github.com/sample/newer` —
  repositories commitnote refuses to open

A second fake provider, "Fakelab", stands in for GitLab and lists its own fixtures:

- `https://fakelab.test/team/notes` — an initialized notes repo, same passphrase as `sample/notes`
- `https://fakelab.test/team/empty` — empty and writable

The access token `invalid-token` is always rejected and `no-repositories-token` lists no
repositories; any other non-empty token is accepted. All
fixture state resets on reload. Test mode is never part of `npm run build`, which
`npm run check:bundle` verifies.

## Logging in

1. Paste a fine-grained access token. "Create a token on GitHub" opens GitHub's token form with the
   name, a one-year expiry and the "Contents: read and write" and "Gists: read and write"
   permissions already filled in; you only choose the notes repository there. Sharing needs the
   account permission "Gists: read and write" (classic tokens: the `gist` scope); an existing token
   can be edited to add it without logging in again. GitLab tokens need the `api` scope, which
   already covers sharing.
   No notes repo yet? The link under the token field opens the host's form for a new private
   repository; create it empty (or with only a README, LICENSE or .gitignore) and give the token
   access to it.
2. Continue: commitnote lists the repositories the token can see. The last used repository is
   preselected, and a single one is picked for you. Choosing a repository checks it, and only then
   asks for a passphrase:
   - a notes repo asks for its passphrase and logs in;
   - an empty repository, or one holding only a README, LICENSE or .gitignore, asks you to create
     a passphrase and repeat it, then sets it up as a notes repo, keeping those files;
   - any other repository says why it can't be used, and you can pick another one with the same
     token.
     A repository that is not private shows a warning: notes stay encrypted, but when you save, how
     many files there are and their sizes are visible to anyone who can see it.

Each git host is a forge provider in `src/forge/` (token link, repository listing, adapter): GitHub
and GitLab (gitlab.com only, personal access token with the `api` scope; self-hosted instances are
not supported yet). A GitLab project in nested groups keeps the whole group path as its owner.

## Remember me

With Remember me checked, commitnote keeps your access token and the usable (non-extractable) keys
derived from your passphrase in this browser profile's IndexedDB until you log out. Anyone with
access to that browser profile can then read your notes. The passphrase itself is never stored.
Without Remember me, only the repo URL is kept, so you re-enter the access token and passphrase
next time.

In the installed app there is no Remember me option: logging in always keeps you logged in on that
device, the same as checking it, until you log out. Log out works the same in both.

## Navigating notes

Every opened note gets its own browser history entry, with the encrypted note path in the URL
fragment. The browser's Back and Forward, and the system back gesture on Android, step through the
notes you visited in order, closing an open dialog first. On a phone, the "Back to notes" button in
the note header is an "up" button instead: one tap always returns to the note tree, however many
notes you went through, even ones opened before the window was narrowed from the desktop layout.
It rewinds the history to the latest tree entry, or turns the first entry into the tree when there
is none, so Forward still reaches the notes it skipped.

## Editing and saving

- Each note has one view: an editable name field on top and the live-preview markdown editor below.
  Task checkboxes toggle on click or tap, and the toggle autosaves like typing.
- "New note" in the sidebar header, or "New note..." in a folder's row menu, opens an empty draft
  with the name field focused. The note is created when you confirm a name (Enter or leaving the
  field) or when you type content first; then it gets an auto name, the current local date and time
  as `YYYY-MM-DD HH:mm:ss`, with ` (2)`, ` (3)`, ... appended on a clash. A draft left untouched
  disappears without creating anything.
- To rename a note, edit its name field and press Enter or leave the field. Escape or an empty
  value restores the name, and an invalid or duplicate name shows an inline error. The field is
  read-only while the note has a conflict. Folders are renamed from their row menu.
- Remote changes are pulled only when you click Refresh in the sidebar header, at startup or login,
  or when a save finds that the remote moved and merges. Switching windows or tabs does not
  refresh.
- Autosave saves 2 s after you stop typing, at least every 30 s while you keep typing, and
  immediately on structure changes, note switch, tab hide, and logout.
- The sync state is synced, syncing, or out of sync, with reason pending (waiting to save), failed
  (retrying with back-off), or conflict.
- If the access token is revoked or rejected mid-session, saving shows the failed state and keeps
  retrying, and the edits stay unsaved. The unload warning and the logout choice still protect
  them.
- A conflicting change opens the conflict view, where you choose "Keep this device's version",
  "Keep other device's version" (each with the device's name when known), or "Edit merged".
- Each device has a name, set as Device name under Settings → This device. If left empty, an
  automatic name such as "Firefox on Linux" is used. The name stays on that device, is stored
  encrypted in commits, and is shown only when resolving a conflict.
- Notices report failures, retries, and other sync events as they happen.

## Sharing notes

A share is a fixed, encrypted copy of the note's saved version, uploaded as a secret gist (GitHub) or public
snippet (GitLab) that holds only ciphertext. Choose "Share…" in a note's menu, or the Share button in its header, to create a share link
(`https://commitnote.eu/app/#share=...` on the web; the desktop app uses the same app URL). Old
`https://commitnote.eu/#share=...` links keep working through app forwarding.

- The link's secret stays in the URL fragment, so it never reaches a server. An optional share
  password is then needed in addition to the link.
- "Shared links" in the command menu lists your shares. The list is stored encrypted in
  `.commitnote/shares`, so it is the same on every device.
- A share never changes on its own. "Update to current version" in the share's "⋯" menu (also opened by right-click) replaces the shared copy with the note's current saved version, keeping the same link and the same password.
- The link always shows the latest update. On GitHub, recipients may see the previous content for up to about a minute after an update.
- Revoking a share deletes its gist or snippet, and the link stops working. Shares never expire.
- Moving a shared note (or a folder holding one) to the trash asks first, then revokes its links.
  Restoring it from the trash doesn't bring them back.
- After a passphrase change, existing links keep working, but "View shared version" can no longer
  show the old version.

## Production build

`npm run build` writes plain static files to `dist/`: the landing page at the root and the app in
`dist/app/`. The app build ships with a strict Content
Security Policy applied via a `<meta>` tag; its `connect-src` allows `https://api.github.com` and, when analytics is enabled, the GoatCounter origin; it is not present in the dev server. The app build also ships a web app manifest
(`public/manifest.webmanifest`, `id` `/`), so commitnote can be installed as an app.

## Installing and updates

### Installing

- **Android and other Chromium phones:** an install bar at the top of the login screen and the
  notes list offers **Install**, which opens the browser's own install dialog. Declining that
  dialog hides the bar for good.
- **iPhone and iPad:** the install bar says to add commitnote to the Home Screen from the Share
  menu. **How to install** shows the steps; keep "Open as Web App" turned on.
- **Desktop:** choose **Install app** in the command menu ("More commands"), or use the browser's
  install action.
- **Desktop window:** the installed app draws its headers into the title bar, next to the window
  controls. Drag the window by an empty part of a header. Use the title-bar toggle (the chevron
  next to the window controls) to switch back to a classic title bar; both work the same.
- **Shortcuts:** the installed app's icon offers **New note** and **Search notes**. If you need to
  log in first, the shortcut runs right after. Launching the app again focuses the window that is
  already open instead of opening a second one. Where they appear:
  - Android, installed from Chrome, Edge or Samsung Internet: long press the app icon.
  - Desktop Chrome and Edge (Windows, macOS, Linux): right-click the app in the dock or taskbar, or
    use the jump list.
  - iPhone and iPad: not available. iOS does not show app shortcuts for Home Screen web apps, and
    there is no way for a web app to add them.
  - Firefox and desktop Safari web apps: not available.
- Dismissing the install bar is remembered on that device (localStorage
  `commitnote.installBarDismissed`); **Install app** in the command menu still works afterwards.
  The bar never appears in the installed app, on desktop, in the note view or in the shared-note
  viewer.
- On iPhone and iPad the installed app keeps its own storage, separate from Safari, so you log in
  again there. On Android and desktop, the installed app shares storage with the browser it was
  installed from, so logging in or out in one also applies to the other.

### Desktop app (Linux AppImage)

Download the latest build:
[commitnote-x86_64.AppImage](https://github.com/marcinjahn/commitnote/releases/latest/download/commitnote-x86_64.AppImage).
Linux x86_64 only.

```
chmod +x commitnote-x86_64.AppImage
./commitnote-x86_64.AppImage
```

- **Requirements:** no `libfuse2` is needed (static runtime) and WebKitGTK is bundled. The AppImage
  is built on Ubuntu 22.04 (glibc 2.35), so it runs on Ubuntu 22.04+, Debian 12+, Fedora 36+ and
  current Arch and openSUSE.
- **Updating:** the AppImage embeds zsync update information
  (`gh-releases-zsync|marcinjahn|commitnote|latest|commitnote-x86_64.AppImage.zsync`), so
  AppImageUpdate, Gear Lever or AppImageLauncher update it in place with a delta download. There is
  no in-app updater and no service worker in the desktop app.
- **Verifying:** download `SHA256SUMS` from the same release and run
  `sha256sum -c SHA256SUMS`. The AppImage also has a GitHub build-provenance attestation:
  `gh attestation verify commitnote-x86_64.AppImage --repo marcinjahn/commitnote`. There is no GPG
  signature.
- **Differences from the web app:** a native window with the system title bar. It counts as the
  installed app: no Remember me option (the login is kept until **Log out**), and there is no
  install bar or **Install app** command. Export opens a native save dialog, links open in the
  default browser, and share links point at `https://commitnote.eu/app/`. Page zoom is disabled.
  Closing the window with unsaved edits saves first, and asks before quitting if saving fails.
  Starting the app again focuses the running window. The app menu offers **New note** and
  **Search notes** (`commitnote --action new-note` or `--action search`).
- **Blank window:** `WEBKIT_DISABLE_DMABUF_RENDERER=1` is set unless you set it yourself; it works
  around a blank window on NVIDIA and some Wayland setups.
- **Data:** `~/.local/share/io.github.marcinjahn.commitnote/` (user-only). The access token and
  the non-extractable keys derived from your passphrase live in IndexedDB there, the same model as
  the installed web app. The passphrase is never stored and the OS keyring is not used. Log out
  deletes the stored record.

### What is cached

The app's service worker (`/app/sw.js`, scope `/app/`, generated by the app build) precaches only the app shell into a Cache
Storage cache named `commitnote-shell-<buildId>`. It never stores notes, tokens or forge responses.
The remembered session's ciphertext blob cache in IndexedDB is unchanged and stays the only data
cache. The build id hashes the path and content of every precached file, so any change to the shell
produces a new build id and a new service worker.

The root `/sw.js` is the retirement worker: it only unregisters itself. Visitors who still have the old
root service worker get it replaced and unregistered by it. Returning users may see the old app once
until the new worker activates, and a first visit straight to `/app/` under the old worker may need one
reload. The manifest `id` is `/`, so apps installed before the move remain the same app.

### Update flow

- The app checks for an app update on start, when it becomes visible and when it comes online, at
  most every 15 minutes.
- The app also checks every 15 minutes while it stays open.
- A downloaded app update applies by itself, with no prompt, at a moment that cannot cost any work:
  - right after the app starts, before the first click or key press (within 10 seconds);
  - when the tab or app goes to the background;
  - after a minute without input, with no dialog or menu open and no text field focused.
- It never applies while anything is unsaved: it waits until saving finishes, offline included.
  Nor does it apply while a new note, a dialog, an import or a passphrase change is open, or while
  you are logged in without Remember me (that would log you out); then it applies on the next start.
- Applying reloads the page and keeps the open note, its cursor and scroll position, the expanded
  folders and the tree scroll position. Other open tabs reload at their own safe moment.
- At most one automatic reload happens per minute in a tab, so a broken update cannot loop.
- The previous version's shell cache is kept, so pages of the old version that are still open keep
  working.

### Development

`npm run dev` and `npm run dev:fake` never register a service worker. `npm run preview` and
`npm run preview:fake` do, so when iterating on a build use DevTools → Application → Service
workers → "Update on reload", or unregister the worker there. End-to-end tests block service
workers unless a spec opts in with `test.use({ serviceWorkers: "allow" })`.

### Kill switch

If a broken app service worker ever ships, commit `public/sw.js` with the following content and push:

```js
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("commitnote-")) await caches.delete(key);
      }
      await self.registration.unregister();
    })(),
  );
});
```

The app build ships it unchanged as `app/sw.js` in place of the generated worker, and `check:bundle`
accepts it. It replaces only the app worker; the root `sw.js` is always the retirement worker. It
has no `fetch` handler and never navigates clients: it deletes the commitnote caches and
unregisters itself. Open pages reload once through their `controllerchange` handling. In Chromium they may stay
controlled by the kill-switch worker until every commitnote page is closed; it has no `fetch`
handler, so everything then loads from the network, and there is no reload loop. Remove `public/sw.js` again to restore the normal
service worker.
