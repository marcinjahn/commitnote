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
- `build` — produce a production build in `dist/`
- `preview` — preview the production build locally
- `test` — run unit tests with Vitest
- `test:e2e` — run end-to-end tests with Playwright
- `check` — type-check the app and the Node-side config/scripts

## End-to-end tests

Install the Chromium browser once:

```
npx playwright install chromium
```

Then run:

```
npm run test:e2e
```

## Production build

`npm run build` writes plain static files to `dist/`. The build ships with a strict Content
Security Policy applied via a `<meta>` tag; it is not present in the dev server.
