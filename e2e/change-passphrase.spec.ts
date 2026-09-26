import type { BrowserContextOptions, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { expectTree, logIn } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const OLD_PASSPHRASE = "sample notes repo passphrase";
const NEW_PASSPHRASE = "a brand new passphrase";
const REPO_KEY = "sample/notes";
const KEY_CHANGED_TEXT =
  "The passphrase was changed on another device. Log in again.";

function commitMessages(page: Page): Promise<string[]> {
  return page.evaluate(
    (repoKey) =>
      (window as any).__commitNoteFakeForge.commitMessages(repoKey) as string[],
    REPO_KEY,
  );
}

function changeDialog(page: Page) {
  return page.getByRole("dialog", { name: "Change passphrase" });
}

async function openChangeDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More commands" }).click();
  await page
    .getByRole("menu", { name: "Commands" })
    .getByRole("menuitem", { name: "Change passphrase" })
    .click();
  await expect(changeDialog(page)).toBeVisible();
}

async function fillPassphrases(
  page: Page,
  current: string,
  next: string,
  repeated = next,
): Promise<void> {
  const dialog = changeDialog(page);
  await dialog.getByLabel("Current passphrase").fill(current);
  await dialog.getByLabel("New passphrase", { exact: true }).fill(next);
  await dialog.getByLabel("Repeat new passphrase").fill(repeated);
  await dialog.getByRole("button", { name: "Continue" }).click();
}

async function changePassphrase(page: Page): Promise<void> {
  await openChangeDialog(page);
  await fillPassphrases(page, OLD_PASSPHRASE, NEW_PASSPHRASE);
  const review = page.getByRole("dialog", {
    name: "Ready to change passphrase",
  });
  await expect(review).toBeVisible({ timeout: 15_000 });
  await expect(review.getByText(/^Re-encrypts \d+ notes/)).toBeVisible();
  await expect(
    review.getByText(
      "1 file that isn't a note, such as a README, is kept as it is.",
    ),
  ).toBeVisible();
  await review.getByRole("button", { name: "Change passphrase" }).click();
  await expect(page.getByText("Passphrase changed.")).toBeVisible({
    timeout: 15_000,
  });
  await expectTree(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: OLD_PASSPHRASE });
  await expectTree(page);
});

test("changes the passphrase in one commit; afterwards only the new one logs in", async ({
  page,
}, testInfo) => {
  const before = await commitMessages(page);

  await changePassphrase(page);

  const after = await commitMessages(page);
  expect(after).toHaveLength(before.length + 1);
  expect(after[0].split("\n")[0]).toBe("commitnote: change passphrase");
  await page.getByRole("treeitem", { name: "Welcome" }).click();
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toContainText("Welcome");

  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Back to notes" }).click();
  }
  await page.getByRole("button", { name: "Log out" }).click();
  await logIn(page, { repo: NOTES_REPO, passphrase: OLD_PASSPHRASE });
  await expect(page.getByRole("alert")).toHaveText("Wrong passphrase.", {
    timeout: 15_000,
  });

  await page.getByLabel("Passphrase", { exact: true }).fill(NEW_PASSPHRASE);
  await page.getByRole("button", { name: "Log in" }).click();
  await expectTree(page);
  await expect(page.getByRole("treeitem", { name: "Welcome" })).toBeVisible();
});

test("a wrong current passphrase changes nothing", async ({ page }) => {
  const before = await commitMessages(page);
  await openChangeDialog(page);

  await fillPassphrases(page, "not the passphrase", NEW_PASSPHRASE);

  const dialog = changeDialog(page);
  await expect(dialog.getByRole("alert")).toHaveText(
    "The current passphrase is wrong.",
    { timeout: 15_000 },
  );
  await expect(dialog.getByLabel("Current passphrase")).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await commitMessages(page)).toEqual(before);

  await page.getByRole("treeitem", { name: "Welcome" }).click();
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toBeVisible();
});

test("asks again when the new passphrases differ", async ({ page }) => {
  await openChangeDialog(page);

  await fillPassphrases(page, OLD_PASSPHRASE, NEW_PASSPHRASE, "something else");

  await expect(changeDialog(page).getByRole("alert")).toHaveText(
    "The new passphrases do not match.",
  );
});

test("backing out of the review keeps the old passphrase", async ({ page }) => {
  const before = await commitMessages(page);
  await openChangeDialog(page);
  await fillPassphrases(page, OLD_PASSPHRASE, NEW_PASSPHRASE);
  const review = page.getByRole("dialog", {
    name: "Ready to change passphrase",
  });
  await expect(review).toBeVisible({ timeout: 15_000 });

  await review.getByRole("button", { name: "Cancel" }).click();

  await expect(review).toHaveCount(0);
  expect(await commitMessages(page)).toEqual(before);
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("After cancel");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect
    .poll(() => commitMessages(page).then((m) => m.length))
    .toBe(before.length + 1);
});

test("another device still on the old passphrase is asked to log in again", async ({
  page,
  browser,
}, testInfo) => {
  const { baseURL, ...device } = testInfo.project.use as BrowserContextOptions;
  const otherContext = await browser.newContext(device);
  const other = await otherContext.newPage();
  await other.goto(new URL("/", baseURL ?? page.url()).toString());
  await logIn(other, { repo: NOTES_REPO, passphrase: OLD_PASSPHRASE });
  await expectTree(other);

  await changePassphrase(page);
  const exported = await page.evaluate(
    (repoKey) => (window as any).__commitNoteFakeForge.exportRepo(repoKey),
    REPO_KEY,
  );
  await other.evaluate(
    ([repoKey, state]) =>
      (window as any).__commitNoteFakeForge.adoptRepo(repoKey, state),
    [REPO_KEY, exported] as const,
  );
  const changedHead = (await commitMessages(other))[0];
  await other.getByRole("button", { name: "Refresh" }).click();

  await expect(
    other.getByRole("alert").getByText(KEY_CHANGED_TEXT),
  ).toBeVisible();
  expect((await commitMessages(other))[0]).toBe(changedHead);
  await otherContext.close();
});

test("another tab of the same browser picks up the new passphrase it remembered", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Log out" }).click();
  await logIn(page, {
    repo: NOTES_REPO,
    passphrase: OLD_PASSPHRASE,
    rememberMe: true,
  });
  await expectTree(page);
  const other = await page.context().newPage();
  await other.goto(page.url());
  await expectTree(other);

  await changePassphrase(page);
  const exported = await page.evaluate(
    (repoKey) => (window as any).__commitNoteFakeForge.exportRepo(repoKey),
    REPO_KEY,
  );
  await other.evaluate(
    ([repoKey, state]) =>
      (window as any).__commitNoteFakeForge.adoptRepo(repoKey, state),
    [REPO_KEY, exported] as const,
  );
  await other.getByRole("button", { name: "Refresh" }).click();
  await expect(other.getByRole("alert").getByText(KEY_CHANGED_TEXT)).toBeVisible();
  await other.getByRole("button", { name: "Log in again" }).click();

  await expectTree(other);
  await expect(other.getByLabel("Access token")).toHaveCount(0);
});
