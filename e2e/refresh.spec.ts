import { test, expect } from "./fixtures";
import { openNotes, fakeForge } from "./helpers";


test("there is only one Refresh button", { tag: "@mobile" }, async ({ page }, testInfo) => {
  await openNotes(page);
  const refresh = page.getByRole("button", { name: "Refresh" });

  if (testInfo.project.name === "desktop") {
    await page.getByRole("treeitem", { name: "Welcome" }).click();
    await expect(
      page.getByRole("textbox", { name: "Note editor" }),
    ).toBeVisible();
  }
  await expect(refresh).toHaveCount(1);
});

test("focus and visibility do not refresh; clicking Refresh does", async ({
  page,
}) => {
  await openNotes(page);

  const editRemotely = fakeForge(page).editNote;

  await editRemotely(["Scratch"], "warm-up");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("treeitem", { name: "Scratch" })).toBeVisible();

  await editRemotely(["Remote note"], "# Remote note");

  const remoteNote = page.getByRole("treeitem", { name: "Remote note" });
  const refresh = page.getByRole("button", { name: "Refresh" });

  // The armed failure is consumed by the first getHead call, so seeing it on
  // the click proves the events below did not start a refresh.
  await fakeForge(page).failNext("getHead", "Network");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await refresh.click();
  await expect(refresh).toHaveAttribute("data-feedback", "error");
  await expect(remoteNote).toHaveCount(0);

  await refresh.click();
  await expect(refresh).toHaveAttribute("data-feedback", "success");
  await expect(remoteNote).toBeVisible();
});

test("clicking Refresh with an unchanged head reads the head once and lists no tree", async ({
  page,
}) => {
  await openNotes(page);
  const forge = fakeForge(page);
  const headsBefore = await forge.getHeadCount();
  const treesBefore = await forge.listTreeCount();

  const refresh = page.getByRole("button", { name: "Refresh" });
  await refresh.click();
  await expect(refresh).toHaveAttribute("data-feedback", "success");

  expect(await forge.getHeadCount()).toBe(headsBefore + 1);
  expect(await forge.listTreeCount()).toBe(treesBefore);
});

test("clicking Refresh briefly shows a checkmark", async ({ page }) => {
  await openNotes(page);
  const refresh = page.getByRole("button", { name: "Refresh" });

  await refresh.click();
  await expect(refresh).toHaveAttribute("data-feedback", "success");
  await expect(page.getByRole("status").filter({ hasText: "Refreshed" })).toHaveCount(1);
  await expect(refresh).not.toHaveAttribute("data-feedback");
});

test("a failed Refresh shows the error in a toast and an x", async ({
  page,
}) => {
  await openNotes(page);
  const refresh = page.getByRole("button", { name: "Refresh" });

  await fakeForge(page).failNext("getHead", "Network");
  await refresh.click();

  await expect(refresh).toHaveAttribute("data-feedback", "error");
  const toast = page.getByRole("group").filter({
    hasText: "Could not reach GitHub. Showing the last loaded notes.",
  });
  await expect(toast).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(refresh).not.toHaveAttribute("data-feedback");

  await refresh.click();
  await expect(refresh).toHaveAttribute("data-feedback", "success");
  await expect(toast).toHaveCount(0);
});
