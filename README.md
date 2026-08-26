<p align="center"><img src="src/assets/favicon.svg" alt="commitnote logo" width="96" height="96" /></p>

<h1 align="center">commitnote</h1>

commitnote is a static, client-side web app for encrypted markdown notes. Notes are encrypted
entirely in your browser and stored as files in a GitHub repository you own — there is no backend
server.

## Prerequisites

- Node 24
- npm

## Run locally

```
npm install
npm run dev
```

Then open `http://localhost:5173`.

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
  ships test-mode fixture data

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
viewport.

## Test mode

`npm run dev:fake` (and `npm run build:fake` / `preview:fake`) run the app against in-memory
fixture repositories instead of GitHub, with no network access. The fixture repo URLs:

- `https://github.com/sample/notes` — an initialized notes repo, passphrase
  `sample notes repo passphrase`
- `https://github.com/sample/empty` — empty and writable
- `https://github.com/sample/empty-read-only`, `https://github.com/sample/read-only` — read-only
  variants
- `https://github.com/sample/foreign`, `https://github.com/sample/newer` — repositories commitnote
  refuses to open

The access token `invalid-token` is always rejected; any other non-empty token is accepted. All
fixture state resets on reload. Test mode is never part of `npm run build`, which
`npm run check:bundle` verifies.

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

## Production build

`npm run build` writes plain static files to `dist/`. The build ships with a strict Content
Security Policy applied via a `<meta>` tag; it is not present in the dev server.
