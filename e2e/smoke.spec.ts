import { test, expect } from "@playwright/test";

// Playwright's own module loader can't import this straight from
// src/testing/fake-forge/fake-forge-factory.ts: that file pulls in
// sample-notes-repo.json, and Node's ESM loader (unlike Vite/tsx) requires an
// import attribute for JSON that the source doesn't use.
const FAKE_FORGE_BANNER = "Test mode: fake forge, no network";

const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src https://api.github.com; img-src 'self' https: data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

test("login screen renders under the production CSP", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "commitnote" })).toBeVisible();
  await expect(page).toHaveTitle("commitnote");

  const cspMeta = page.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(cspMeta).toHaveAttribute("content", CSP);

  await expect(page.getByText(FAKE_FORGE_BANNER)).toBeVisible();

  expect(pageErrors).toEqual([]);
  const unexpectedConsoleErrors = consoleErrors.filter(
    (text) => !text.includes("frame-ancestors"),
  );
  expect(unexpectedConsoleErrors).toEqual([]);
});
