import { test, expect } from "@playwright/test";
import { logIn, expectTree } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";
const REPO_KEY = "sample/notes";

async function startSession(page: import("@playwright/test").Page) {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);
}

test("there is only one Refresh button", async ({ page }, testInfo) => {
  await startSession(page);
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
}, testInfo) => {
  await startSession(page);

  const editRemotely = (path: readonly string[], markdown: string) =>
    page.evaluate(
      ([repoKey, notePath, text]) =>
        (window as any).__commitNoteFakeForge.editNote(
          repoKey,
          notePath,
          text,
        ),
      [REPO_KEY, path, markdown] as const,
    );

  // The first remote edit derives a keyring, which is slow.
  await editRemotely(["Scratch"], "warm-up");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("treeitem", { name: "Scratch" })).toBeVisible();

  await editRemotely(["Remote note"], "# Remote note");

  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  const remoteNote = page.getByRole("treeitem", { name: "Remote note" });
  await page.waitForTimeout(1500);
  await expect(remoteNote).toHaveCount(0);

  if (testInfo.project.name === "mobile") {
    await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(remoteNote).toBeVisible();
});
