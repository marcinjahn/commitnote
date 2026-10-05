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

test("clicking Refresh shows a remote change", async ({
  page,
}, testInfo) => {
  await openNotes(page);

  const editRemotely = fakeForge(page).editNote;

  await editRemotely(["Scratch"], "warm-up");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("treeitem", { name: "Scratch" })).toBeVisible();

  await editRemotely(["Remote note"], "# Remote note");

  const remoteNote = page.getByRole("treeitem", { name: "Remote note" });
  if (testInfo.project.name === "mobile") {
    await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(remoteNote).toBeVisible();
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
