import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { logIn, expectTree, SAMPLE, openNotes, logOut } from "./helpers";


async function openWelcomeAndType(page: Page, text: string): Promise<void> {
  await page.getByRole("treeitem", { name: "Welcome" }).click();
  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
}

async function failNext(
  page: Page,
  kind: "Network" | "Unauthorized",
): Promise<void> {
  await page.evaluate(([repoKey, failure]) => {
    const controls = (
      window as unknown as {
        __commitNoteFakeForge: {
          failNext(repoKey: string, operation: string, kind: string): void;
        };
      }
    ).__commitNoteFakeForge;
    controls.failNext(repoKey, "commit", failure);
  }, [SAMPLE.key, kind] as const);
}

test("logging out saves pending edits first", async ({ page }) => {
  await openNotes(page);
  await openWelcomeAndType(page, " typed before logout");
  await logOut(page);

  await expect(page.getByLabel("Access token")).toBeVisible({ timeout: 10_000 });

  await logIn(page, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
  await expectTree(page);
  await page.getByRole("treeitem", { name: "Welcome" }).click();
  await expect(page.getByRole("textbox", { name: "Note editor" })).toContainText(
    "typed before logout",
  );
});

test("keep trying retries the save and then logs out", async ({ page }) => {
  await openNotes(page);
  await openWelcomeAndType(page, " unsaved");
  await failNext(page, "Network");
  await logOut(page);

  const dialog = page.getByRole("dialog", { name: "Some changes are not saved" });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText("1 note or folder is not saved yet.");

  await dialog.getByRole("button", { name: "Keep trying" }).click();
  await expect(page.getByLabel("Access token")).toBeVisible({ timeout: 10_000 });
});

test("log out anyway discards unsaved changes", async ({ page }) => {
  await openNotes(page);
  await openWelcomeAndType(page, " unsaved");
  await failNext(page, "Network");
  await failNext(page, "Network");
  await logOut(page);

  const dialog = page.getByRole("dialog", { name: "Some changes are not saved" });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Keep trying" }).click();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText("1 note or folder is not saved yet.");

  await dialog.getByRole("button", { name: "Log out anyway" }).click();
  await expect(page.getByLabel("Access token")).toBeVisible({ timeout: 10_000 });
});
