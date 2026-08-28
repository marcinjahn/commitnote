import { test, expect } from "@playwright/test";
import { logIn, expectTree } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";

// page.close({ runBeforeUnload: true }) resolves without waiting for the
// page to actually finish unloading, so the beforeunload dialog (or its
// absence) is only observable a moment later.
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("closing the page with nothing unsaved shows no leave-site prompt", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "dialog handling is desktop-only here",
  );

  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  let dialogFired = false;
  page.on("dialog", (dialog) => {
    dialogFired = true;
    void dialog.dismiss();
  });

  await page.close({ runBeforeUnload: true });
  await wait(500);

  expect(dialogFired).toBe(false);
});

test("closing the page before autosave completes shows the leave-site prompt", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "dialog handling is desktop-only here",
  );

  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.getByRole("treeitem", { name: "Welcome" }).click();
  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.click();
  await page.keyboard.type(" extra");

  let dialogType: string | null = null;
  page.on("dialog", (dialog) => {
    dialogType = dialog.type();
    void dialog.dismiss();
  });

  // The 2 s autosave debounce has not elapsed yet, so the edit is still
  // unsaved when the page is closed.
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => dialogType, { timeout: 3_000 }).toBe("beforeunload");
});

test("hiding the tab flushes pending edits immediately", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "dialog handling is desktop-only here",
  );

  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.getByRole("treeitem", { name: "Welcome" }).click();
  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" extra");

  const header = page.locator("header.note-header");
  const syncIcon = header.getByRole("img");
  await expect(syncIcon).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  // Flushed well within the 2 s autosave debounce.
  await expect(syncIcon).toHaveCount(0, { timeout: 1_500 });
});
