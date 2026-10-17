import type { Page } from "@playwright/test";
import { test as base, expect } from "./fixtures";
import { expectTree, onFakeForgeReady, openNotes, SAMPLE } from "./helpers";
import {
  checkForUpdate,
  reloadControlled,
  shellCacheNames,
  startShellServer,
  waitForActiveWorker,
  type ShellServer,
} from "./helpers/service-worker";
import { openWelcome } from "./helpers/tree";

const test = base.extend<{ shellServer: ShellServer }>({
  shellServer: async ({}, use) => {
    const server = await startShellServer();
    try {
      await use(server);
    } finally {
      await server.close();
    }
  },
  baseURL: async ({ shellServer }, use) => {
    await use(shellServer.origin);
  },
});

test.use({ serviceWorkers: "allow" });

const AVAILABLE = "A new version of commitnote is available.";
const WAITING_FOR_SAVE = "commitnote will update once your changes are saved.";

function infoToast(page: Page, text: string) {
  return page.getByRole("group", { name: "Info" }).filter({ hasText: text });
}

async function setMarker(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as { __marker?: boolean }).__marker = true;
  });
}

function hasMarker(page: Page): Promise<boolean> {
  return page
    .evaluate(() => (window as { __marker?: boolean }).__marker === true)
    .catch(() => true);
}

function countDocumentLoads(page: Page): () => number {
  let count = 0;
  page.on("load", () => count++);
  return () => count;
}

async function openControlledNotes(page: Page): Promise<void> {
  await openNotes(page);
  await waitForActiveWorker(page);
  await reloadControlled(page);
  await expectTree(page);
}

test("a second build shows the update toast and Update reloads once saved", async ({
  page,
  shellServer,
}) => {
  await onFakeForgeReady(
    page,
    (controls, key) => {
      const stored = sessionStorage.getItem("e2e-forge-state");
      if (stored !== null) controls.adoptRepo(key, stored);
      addEventListener("pagehide", () => {
        sessionStorage.setItem("e2e-forge-state", controls.exportRepo(key));
      });
    },
    SAMPLE.key,
  );
  await openControlledNotes(page);
  const hashedAsset = shellServer.manifest.files.find((file) =>
    /^assets\/index-.+\.js$/.test(file),
  );
  expect(hashedAsset).toBeDefined();

  shellServer.resetRequestCounts();
  await shellServer.serveSecondBuild();
  await checkForUpdate(page);
  await expect(infoToast(page, AVAILABLE)).toBeVisible({ timeout: 15_000 });
  expect(shellServer.requestCount("/index.html")).toBeGreaterThanOrEqual(1);
  expect(shellServer.requestCount(`/${hashedAsset}`)).toBe(0);

  await page.context().setOffline(true);
  try {
    await openWelcome(page);
    await page.getByRole("textbox", { name: "Note editor" }).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" extra");
    await setMarker(page);

    await infoToast(page, AVAILABLE).getByTestId("toast-action").click();
    await expect(infoToast(page, WAITING_FOR_SAVE)).toBeVisible();
    expect(await hasMarker(page)).toBe(true);
    expect(
      await page.evaluate(
        async () =>
          (await navigator.serviceWorker.getRegistration())?.waiting !== null,
      ),
    ).toBe(true);
  } finally {
    await page.context().setOffline(false);
  }

  await expect.poll(() => hasMarker(page), { timeout: 15_000 }).toBe(false);
  await expectTree(page);
  await expect(infoToast(page, AVAILABLE)).toHaveCount(0);
  await expect(infoToast(page, WAITING_FOR_SAVE)).toHaveCount(0);
  await expect.poll(() => shellCacheNames(page)).toHaveLength(2);

  await openWelcome(page);
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toContainText(" extra");
});

test("an update accepted in one tab reloads other clean tabs", async ({
  page,
  context,
  shellServer,
}) => {
  await openControlledNotes(page);
  const other = await context.newPage();
  await openNotes(other);
  await expect
    .poll(() =>
      other.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true);

  const loads = [countDocumentLoads(page), countDocumentLoads(other)];
  await setMarker(page);
  await setMarker(other);

  await shellServer.serveSecondBuild();
  await checkForUpdate(page);
  await infoToast(page, AVAILABLE).getByTestId("toast-action").click();

  for (const tab of [page, other]) {
    await expect.poll(() => hasMarker(tab), { timeout: 15_000 }).toBe(false);
    await expectTree(tab);
  }
  await expect(infoToast(page, AVAILABLE)).toHaveCount(0);
  expect(loads.map((count) => count())).toEqual([1, 1]);
});

test("after an update, an earlier build's chunk still loads from the shell caches", async ({
  page,
  shellServer,
}) => {
  await openControlledNotes(page);
  const chunk = shellServer.manifest.files.find((file) =>
    /^assets\/vim-extension-.+\.js$/.test(file),
  );
  expect(chunk).toBeDefined();
  const chunkUrl = `${shellServer.origin}/${chunk}`;

  await shellServer.serveSecondBuild({ drop: [chunk!] });
  await checkForUpdate(page);
  await infoToast(page, AVAILABLE).getByTestId("toast-action").click();
  await expect.poll(() => shellCacheNames(page), { timeout: 15_000 }).toHaveLength(2);
  await expectTree(page);

  const response = page.waitForResponse((candidate) => candidate.url() === chunkUrl);
  await page.evaluate((url) => import(/* @vite-ignore */ url), chunkUrl);
  expect((await response).fromServiceWorker()).toBe(true);
});
