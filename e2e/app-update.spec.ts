import type { Page } from "@playwright/test";
import { test as base, expect } from "./fixtures";
import {
  expectTree,
  onFakeForgeReady,
  openNotes,
  SAMPLE,
} from "./helpers";
import {
  activeBuildId,
  checkForUpdate,
  reloadControlled,
  SECOND_BUILD_ID,
  shellCacheNames,
  startShellServer,
  waitForActiveWorker,
  waitForWaitingWorker,
  type ShellServer,
} from "./helpers/service-worker";
import { openWelcome, treeItem, waitForSynced } from "./helpers/tree";

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
    await use(shellServer.appURL);
  },
});

test.use({ serviceWorkers: "allow" });

const IDLE_APPLY_MS = 60_000;

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

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((hide) => {
    if (hide) {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
    } else {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

async function keepForgeStateAcrossReloads(page: Page): Promise<void> {
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
}

async function openControlledNotes(page: Page): Promise<void> {
  await openNotes(page);
  await waitForActiveWorker(page);
  await reloadControlled(page);
  await expectTree(page);
}

test("an update found at launch applies before the user does anything", async ({
  page,
  shellServer,
}) => {
  await openControlledNotes(page);
  await shellServer.serveSecondBuild();
  const loads = countDocumentLoads(page);

  await page.reload();

  await expect.poll(() => activeBuildId(page), { timeout: 15_000 }).toBe(SECOND_BUILD_ID);
  await expect.poll(loads, { timeout: 15_000 }).toBe(2);
  await expectTree(page);
});

test("unsaved changes hold the update until they are saved, then it applies in the background", async ({
  page,
  shellServer,
}) => {
  await keepForgeStateAcrossReloads(page);
  await openControlledNotes(page);
  await openWelcome(page);
  const editor = page.getByRole("textbox", { name: "Note editor" });

  await page.context().setOffline(true);
  try {
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" extra");
    await setMarker(page);

    await shellServer.serveSecondBuild();
    await checkForUpdate(page);
    await waitForWaitingWorker(page);
    await setHidden(page, true);

    expect(await hasMarker(page)).toBe(true);
    expect(await activeBuildId(page)).not.toBe(SECOND_BUILD_ID);
  } finally {
    await page.context().setOffline(false);
  }

  await expect.poll(() => hasMarker(page), { timeout: 15_000 }).toBe(false);
  await expect.poll(() => activeBuildId(page)).toBe(SECOND_BUILD_ID);
  await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue("Welcome");
  await expect(editor).toContainText(" extra");
});

test("an idle tab applies the update and keeps the open note, folders and scroll position", async ({
  page,
  shellServer,
}) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 480 });
  await keepForgeStateAcrossReloads(page);
  await openControlledNotes(page);

  const projects = treeItem(page, "Projects");
  await projects.click();
  await expect(projects).toHaveAttribute("aria-expanded", "true");
  await openWelcome(page);
  await page.getByRole("textbox", { name: "Note editor" }).click();
  await page.keyboard.press("Control+End");
  for (let line = 0; line < 40; line++) await page.keyboard.press("Enter");
  await page.keyboard.type("bottom line");
  await waitForSynced(page);

  const content = page.locator(".note-content");
  await content.evaluate((el) => (el.scrollTop = 300));
  await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBe(300);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  await shellServer.serveSecondBuild();
  await checkForUpdate(page);
  await waitForWaitingWorker(page);
  await setMarker(page);
  expect(await hasMarker(page)).toBe(true);

  await page.clock.fastForward(IDLE_APPLY_MS);

  await expect.poll(() => hasMarker(page), { timeout: 15_000 }).toBe(false);
  await expect.poll(() => activeBuildId(page)).toBe(SECOND_BUILD_ID);
  await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue("Welcome");
  await expect(treeItem(page, "Projects")).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBe(300);
  await expect(page.getByRole("textbox", { name: "Note editor" })).toContainText("bottom line");
});

test("an update applied in one tab reloads another tab at its own safe moment", async ({
  page,
  context,
  shellServer,
}) => {
  await openControlledNotes(page);
  const other = await context.newPage();
  await openNotes(other);
  await expect
    .poll(() => other.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await treeItem(page, "Welcome").click();
  await treeItem(other, "Welcome").click();

  const loads = [countDocumentLoads(page), countDocumentLoads(other)];
  await setMarker(page);
  await setMarker(other);

  await shellServer.serveSecondBuild();
  await checkForUpdate(page);
  await waitForWaitingWorker(page);
  await setHidden(page, true);
  await expect.poll(() => hasMarker(page), { timeout: 15_000 }).toBe(false);
  await expectTree(page);

  expect(await hasMarker(other)).toBe(true);
  await setHidden(other, true);
  await expect.poll(() => hasMarker(other), { timeout: 15_000 }).toBe(false);
  await expectTree(other);
  expect(loads.map((count) => count())).toEqual([1, 1]);
});

test("after an update, an earlier build's chunk still loads from the shell caches", async ({
  page,
  shellServer,
}) => {
  await openControlledNotes(page);
  await treeItem(page, "Welcome").click();
  const chunk = shellServer.manifest.files.find((file) =>
    /^assets\/vim-extension-.+\.js$/.test(file),
  );
  expect(chunk).toBeDefined();
  const chunkUrl = `${shellServer.appURL}${chunk}`;

  await shellServer.serveSecondBuild({ drop: [chunk!] });
  await checkForUpdate(page);
  await waitForWaitingWorker(page);
  await setMarker(page);
  await setHidden(page, true);
  await expect.poll(() => hasMarker(page), { timeout: 15_000 }).toBe(false);
  await expect.poll(() => shellCacheNames(page)).toHaveLength(2);
  await expectTree(page);

  const response = page.waitForResponse((candidate) => candidate.url() === chunkUrl);
  await page.evaluate((url) => import(/* @vite-ignore */ url), chunkUrl);
  expect((await response).fromServiceWorker()).toBe(true);
});
