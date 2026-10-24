import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes } from "./helpers";
import {
  checkForUpdate,
  reloadControlled,
  startSiteServer,
  stopReplacedWorkers,
  waitForActiveWorker,
  type SiteServer,
} from "./helpers/service-worker";

test.use({ serviceWorkers: "allow" });

const HEADING = "Encrypted markdown notes in your own git repository.";
// The old app boots from its cached shell, fetches the new root sw.js and
// reloads once the retirement worker takes over, which is slow under load.
const RETIREMENT_TIMEOUT = 15_000;

function registrationScopes(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope),
  );
}

function controllerScript(page: Page): Promise<string | null> {
  return page.evaluate(
    () => navigator.serviceWorker.controller?.scriptURL ?? null,
  );
}

async function controlledByOldRootWorker(
  page: Page,
  server: SiteServer,
  options: { renameAssets?: boolean } = {},
) {
  await server.serveOldLayout(options);
  await page.goto(server.origin + "/");
  await expect(page.getByLabel("Access token")).toBeVisible();
  await waitForActiveWorker(page);
  expect(await registrationScopes(page)).toEqual([server.origin + "/"]);
  await reloadControlled(page);
}

test("the app's service worker is scoped to the app path", async ({ page }) => {
  await openNotes(page);
  await waitForActiveWorker(page);

  const origin = new URL(page.url()).origin;
  expect(await registrationScopes(page)).toEqual([origin + "/app/"]);

  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: HEADING }),
  ).toBeVisible();
  expect(await controllerScript(page)).toBeNull();
});

test.describe("an old root worker", () => {
  let server: SiteServer;

  test.beforeEach(async () => {
    server = await startSiteServer();
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("is retired so the site root shows the landing page", async ({
    page,
  }) => {
    await controlledByOldRootWorker(page, server);

    // The retirement worker may take over while the old app still boots;
    // test mode loads chunks lazily at boot, which production does not.
    await server.serveSite({ keepOldAssets: true });
    await page.goto(server.origin + "/");
    const landing = page.getByRole("heading", { level: 1, name: HEADING });
    // Stopping the outgoing worker during the old app's boot would fail its
    // in-flight requests.
    await expect(page.getByLabel("Access token").or(landing)).toBeVisible();
    await stopReplacedWorkers(page);

    await expect(landing).toBeVisible({ timeout: RETIREMENT_TIMEOUT });
    await expect
      .poll(() => registrationScopes(page))
      .not.toContain(server.origin + "/");
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: HEADING }),
    ).toBeVisible();
    expect(await controllerScript(page)).toBeNull();
  });

  test("leaves a first app path visit blank until one reload", async ({
    page,
  }) => {
    await controlledByOldRootWorker(page, server, { renameAssets: true });
    await stopReplacedWorkers(page);

    await server.serveSite();
    await page.goto(server.origin + "/app/");
    await page.waitForLoadState("networkidle");
    expect(await controllerScript(page)).toBe(server.origin + "/sw.js");
    await expect(page.getByLabel("Access token")).toHaveCount(0);

    await checkForUpdate(page);
    await expect
      .poll(() => registrationScopes(page))
      .not.toContain(server.origin + "/");

    await page.reload();
    await expect(page.getByLabel("Access token")).toBeVisible();
    expect(await controllerScript(page)).not.toBe(server.origin + "/sw.js");
  });
});
