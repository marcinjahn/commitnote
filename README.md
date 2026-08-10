# git-notes

git-notes is a static, client-side web app for encrypted markdown notes. Notes are encrypted
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
- `https://github.com/sample/foreign`, `https://github.com/sample/newer` — repositories git-notes
  refuses to open

The access token `invalid-token` is always rejected; any other non-empty token is accepted. All
fixture state resets on reload. Test mode is never part of `npm run build`, which
`npm run check:bundle` verifies.

## Remember me

With Remember me checked, git-notes keeps your access token and the usable (non-extractable) keys
derived from your passphrase in this browser profile's IndexedDB until you log out. Anyone with
access to that browser profile can then read your notes. The passphrase itself is never stored.
Without Remember me, only the repo URL is kept, so you re-enter the access token and passphrase
next time.

## Editing and saving

- Autosave saves 2 s after you stop typing, at least every 30 s while you keep typing, and
  immediately on structure changes, note switch, tab hide, and logout.
- The sync state is synced, syncing, or out of sync, with reason pending (waiting to save), failed
  (retrying with back-off), or conflict.
- A conflicting change opens the conflict view, where you choose Keep mine, Keep theirs, or Edit
  merged.
- Notices report failures, retries, and other sync events as they happen.

## Production build

`npm run build` writes plain static files to `dist/`. The build ships with a strict Content
Security Policy applied via a `<meta>` tag; it is not present in the dev server.
