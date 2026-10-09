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
server.

The app is available at [commitnote.eu](https://commitnote.eu).

## Prerequisites

- Node 26
- npm

## Run locally

```
npm install
npm run dev
```

Then open `http://localhost:5173`.

`npm run generate:brand` regenerates the brand SVGs from the app font: the README wordmark SVGs in `docs/brand/`, including their animated caret, and the favicon in `src/assets/favicon.svg`. It also rasterises the app icons (`any` 192/512, `maskable` 192/512, `monochrome` 512 and `apple-touch-icon` 180) into `public/icons/`. Never edit them by hand: the drift test fails when they are stale. `npm run generate:brand -- --contact-sheet <file.png>` also writes an uncommitted review sheet with the maskable safe-zone circle.

### Secure context

WebCrypto is only available in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts).
`localhost` qualifies (both the dev server and the preview server), but opening the dev server
through a LAN IP address over plain HTTP does not work.

## Scripts

- `dev` — start the Vite dev server
- `dev:fake` — start the Vite dev server in test mode (fake forge, see below)
- `build` — produce a production build in `dist/`
- `build:fake` — produce a test-mode build in `dist-fake/`
- `preview` — preview the production build locally
- `preview:fake` — preview the test-mode build locally
- `test` — run unit tests with Vitest
- `test:e2e` — run end-to-end tests with Playwright
- `check` — type-check the app and the Node-side config/scripts
- `check:bundle` — build both `dist/` and `dist-fake/` and verify the production build never
  ships test-mode fixture data, and that the web app manifest and every icon and screenshot it
  references are in the production build
- `generate:brand` — regenerate the brand SVGs and app icons (see above)
- `generate:pwa-screenshots` — regenerate the web app manifest screenshots in `public/screenshots/` from
  the test-mode build, using the system Chrome (optional `E2E_PORT`)
- `fixture:sample-notes-repo` — regenerate the sample notes repo fixture

## Deployment

Every push to `main` runs `.github/workflows/pages.yml`: type-check, unit tests, the bundle check, then
a publish of `dist/` to GitHub Pages. In the repository settings, set Pages > Source to "GitHub
Actions" once. The build uses relative asset paths, so it works under any Pages path.

## End-to-end tests

Install the Chromium browser once:

```
npx playwright install chromium
```

Then run:

```
npm run test:e2e
```

The suite runs the built app in test mode (fake forge, no network) at both a desktop and a mobile
viewport. `E2E_PORT` overrides the port it is served on (default 4173). On a 6-CPU machine the
e2e suite ran fastest with `npm run test:e2e -- --workers=4`.

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
- A conflicting change opens the conflict view, where you choose Keep mine, Keep theirs, or Edit
  merged.
- Notices report failures, retries, and other sync events as they happen.

## Sharing notes

A share is a fixed, encrypted copy of the note's saved version, uploaded as a secret gist (GitHub) or public
snippet (GitLab) that holds only ciphertext. Choose "Share…" in a note's menu, or the Share button in its header, to create a share link
(`<app URL>#share=...`).

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
- GitLab sharing is blocked by the production Content Security Policy like the rest of GitLab
  (known issue).

## Production build

`npm run build` writes plain static files to `dist/`. The build ships with a strict Content
Security Policy applied via a `<meta>` tag; it is not present in the dev server. The build also ships a web app manifest
(`public/manifest.webmanifest`), so commitnote can be installed as an app.
