import { createHash } from "node:crypto";
import { test, expect } from "./fixtures";
import { buildModeFacts } from "../scripts/build-mode.ts";
import { buildCsp } from "../scripts/csp.ts";

// Playwright's own module loader can't import this straight from
// src/testing/fake-forge/fake-forge-factory.ts: that file pulls in
// sample-notes-repo.json, and Node's ESM loader (unlike Vite/tsx) requires an
// import attribute for JSON that the source doesn't use.
const FAKE_FORGE_BANNER = "Test mode: fake forge, no network";


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

  await page.goto("./");

  await expect(page.getByRole("heading", { name: "commitnote" })).toBeVisible();
  await expect(page).toHaveTitle("Log in · commitnote");

  const cspMeta = page.locator('meta[http-equiv="Content-Security-Policy"]');
  const bootScript = await page.locator("head script:not([src])").textContent();
  const bootScriptHash = createHash("sha256")
    .update(bootScript ?? "")
    .digest("base64");
  await expect(cspMeta).toHaveAttribute("content", buildCsp(
      "web",
      [`'sha256-${bootScriptHash}'`],
      buildModeFacts("fake-forge").analyticsEndpoint,
    ));

  await expect(page.getByText(FAKE_FORGE_BANNER)).toBeVisible();

  expect(pageErrors).toEqual([]);
  const unexpectedConsoleErrors = consoleErrors.filter(
    (text) => !text.includes("frame-ancestors"),
  );
  expect(unexpectedConsoleErrors).toEqual([]);
});

test("self-hosted font loads under a dark colour scheme", async ({
  page,
  baseURL,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });

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

  const fontResponse = page.waitForResponse((r) => r.url().endsWith(".woff2"));

  await page.goto("./");

  await expect(page.getByRole("heading", { name: "commitnote" })).toBeVisible();

  const response = await fontResponse;
  expect(response.status()).toBe(200);
  expect(new URL(response.url()).origin).toBe(new URL(baseURL!).origin);

  await expect
    .poll(() =>
      page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].some(
          (f) =>
            f.family.replace(/["']/g, "") === "Inter" && f.status === "loaded",
        );
      }),
    )
    .toBe(true);

  expect(pageErrors).toEqual([]);
  const unexpectedConsoleErrors = consoleErrors.filter(
    (text) => !text.includes("frame-ancestors"),
  );
  expect(unexpectedConsoleErrors).toEqual([]);
});
