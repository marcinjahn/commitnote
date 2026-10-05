import { test, expect } from "./fixtures";
import { openNotes } from "./helpers";
import { chooseAccent, openSettings } from "./helpers/settings";
import { headerSyncIcon } from "./helpers/tree";


// page.close({ runBeforeUnload: true }) resolves without waiting for the
// page to actually finish unloading, so the beforeunload dialog (or its
// absence) is only observable a moment later.
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("closing the page with nothing unsaved shows no leave-site prompt", async ({
  page,
}) => {
  await openNotes(page);

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
}) => {
  await openNotes(page);

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

test.describe("with GitHub-like forge latency", () => {
  test.use({ forgeLatency: "github" });

  test("hiding the tab flushes pending edits immediately", async ({
    page,
  }) => {
    await openNotes(page);

    await page.getByRole("treeitem", { name: "Welcome" }).click();
    const editor = page.getByRole("textbox", { name: "Note editor" });
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" extra");

    const syncIcon = headerSyncIcon(page);
    await expect(syncIcon).toBeVisible();

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Saving starts well within the 2 s autosave debounce.
    await expect(syncIcon).toHaveAccessibleName("Saving", { timeout: 500 });
    await expect(syncIcon).toHaveCount(0, { timeout: 5_000 });
  });
});

test("closing the page before a settings change is saved shows the leave-site prompt", async ({
  page,
}) => {
  await openNotes(page);

  await openSettings(page);
  await chooseAccent(page, "Teal");

  let dialogType: string | null = null;
  page.on("dialog", (prompt) => {
    dialogType = prompt.type();
    void prompt.dismiss();
  });

  await page.close({ runBeforeUnload: true });
  await expect.poll(() => dialogType, { timeout: 3_000 }).toBe("beforeunload");
});
