import { test, expect } from "./fixtures";
import { expectTree, openNotes } from "./helpers";
import {
  reloadControlled,
  shellCacheNames,
  waitForActiveWorker,
} from "./helpers/service-worker";
import { createLink } from "./helpers/sharing";
import { openRowMenu, treeItem } from "./helpers/tree";

test.use({ serviceWorkers: "allow" });

test("the service worker installs and precaches the app shell", { tag: "@mobile" }, async ({
  page,
}) => {
  await openNotes(page);
  await waitForActiveWorker(page);

  const names = await shellCacheNames(page);
  expect(names).toHaveLength(1);
  const cached = await page.evaluate(async (name) => {
    const cache = await caches.open(name);
    const has = async (path: string) =>
      (await cache.match(new URL(path, location.href))) !== undefined;
    return {
      index: await has("index.html"),
      manifest: await has("manifest.webmanifest"),
    };
  }, names[0]);
  expect(cached).toEqual({ index: true, manifest: true });
});

test("the app shell starts offline after a first load", { tag: "@mobile" }, async ({
  page,
}) => {
  await openNotes(page);
  await waitForActiveWorker(page);

  await page.context().setOffline(true);
  try {
    await page.reload();
    await expectTree(page);
    await expect(treeItem(page, "Welcome")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Offline", exact: true }),
    ).toBeVisible();
  } finally {
    await page.context().setOffline(false);
  }
});

test("the shared note viewer works with the worker in place", { tag: "@mobile" }, async ({
  page,
}) => {
  await openNotes(page);
  await waitForActiveWorker(page);
  await reloadControlled(page);
  await expectTree(page);

  const menu = await openRowMenu(page, "Welcome");
  await menu.getByRole("menuitem", { name: "Share…" }).click();
  const link = await createLink(page);

  const viewer = await page.context().newPage();
  await viewer.goto(link);
  await expect(
    viewer.getByRole("heading", { name: "Welcome", level: 1 }).first(),
  ).toBeVisible();
  await expect(
    viewer.getByText("Notes stay private even to the forge that hosts them."),
  ).toBeVisible();
  await expect(viewer).toHaveTitle("Shared note · commitnote");
  expect(
    await viewer.evaluate(() => navigator.serviceWorker.controller !== null),
  ).toBe(true);
});
