import type { Page } from "@playwright/test";
import { test, expect } from "@playwright/test";
import { logIn, expectTree } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";
const MODIFIER = process.platform === "darwin" ? "Meta" : "Control";

async function openWelcomeAndType(page: Page, text: string): Promise<void> {
  await page.getByRole("treeitem", { name: "Welcome" }).click();
  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.click();
  await page.keyboard.press(`${MODIFIER}+End`);
  await page.keyboard.type(text);
}

async function clickLogOut(page: Page): Promise<void> {
  const back = page.getByRole("button", { name: "Back to notes" });
  if (await back.isVisible()) {
    await back.click();
  }
  await page.getByRole("button", { name: "Log out", exact: true }).click();
}

async function failNext(
  page: Page,
  kind: "Network" | "Unauthorized",
): Promise<void> {
  await page.evaluate((failure) => {
    const controls = (
      window as unknown as {
        __commitNoteFakeForge: {
          failNext(repoKey: string, operation: string, kind: string): void;
        };
      }
    ).__commitNoteFakeForge;
    controls.failNext("sample/notes", "commit", failure);
  }, kind);
}

async function loginAndOpen(page: Page): Promise<void> {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);
}

test("logging out saves pending edits first", async ({ page }) => {
  await loginAndOpen(page);
  await openWelcomeAndType(page, " typed before logout");
  await clickLogOut(page);

  await expect(page.getByLabel("Repo URL")).toBeVisible({ timeout: 10_000 });

  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);
  await page.getByRole("treeitem", { name: "Welcome" }).click();
  await expect(page.getByRole("textbox", { name: "Note editor" })).toContainText(
    "typed before logout",
  );
});

test("keep trying retries the save and then logs out", async ({ page }) => {
  await loginAndOpen(page);
  await openWelcomeAndType(page, " unsaved");
  await failNext(page, "Network");
  await clickLogOut(page);

  const dialog = page.getByRole("dialog", { name: "Some changes are not saved" });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText("1 note or folder is not saved yet.");

  await dialog.getByRole("button", { name: "Keep trying" }).click();
  await expect(page.getByLabel("Repo URL")).toBeVisible({ timeout: 10_000 });
});

test("log out anyway discards unsaved changes", async ({ page }) => {
  await loginAndOpen(page);
  await openWelcomeAndType(page, " unsaved");
  await failNext(page, "Network");
  await failNext(page, "Network");
  await clickLogOut(page);

  const dialog = page.getByRole("dialog", { name: "Some changes are not saved" });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Keep trying" }).click();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText("1 note or folder is not saved yet.");

  await dialog.getByRole("button", { name: "Log out anyway" }).click();
  await expect(page.getByLabel("Repo URL")).toBeVisible({ timeout: 10_000 });
});

test("a rejected access token can be replaced without losing changes", async ({
  page,
}) => {
  await loginAndOpen(page);
  await openWelcomeAndType(page, " kept");
  await failNext(page, "Unauthorized");

  const dialog = page.getByRole("dialog", { name: "Access token needed" });
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  await dialog.getByLabel("Access token").fill("invalid-token");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "The access token is invalid or has expired.",
  );

  await dialog.getByLabel("Access token").fill("new-token");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  await expect(
    page.locator("header.note-header").getByRole("img", { name: "Synced" }),
  ).toBeVisible({ timeout: 15_000 });
});
