import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { expectTree, logIn, SAMPLE, openNotes, logOut, fakeForge, handOverRepo } from "./helpers";
import { closeSettings, openDataSecurityAction } from "./helpers/settings";

const NEW_PASSPHRASE = "a brand new passphrase";
const KEY_CHANGED_TEXT =
  "The passphrase was changed on another device. Log in again.";

function changeDialog(page: Page) {
  return page.getByRole("dialog", { name: "Change passphrase" });
}

async function openChangeDialog(page: Page): Promise<void> {
  await openDataSecurityAction(page, "Change passphrase");
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
  await fillPassphrases(page, SAMPLE.passphrase, NEW_PASSPHRASE);
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
  await closeSettings(page);
  await expectTree(page);
}

const VERSION_HISTORY_NOTICE =
  "Version history starts over: commitnote can't show or restore versions of your notes from before the change.";

const CHANGE_PASSPHRASE_INTRO =
  "Change your passphrase if someone else may know it, or to switch to a stronger one. Your notes are re-encrypted so only the new passphrase opens them from now on.";
const HISTORY_WARNING =
  "Earlier versions of your notes stay in the repository's history, so the current passphrase still decrypts them after the change, though commitnote can no longer restore them.";
const OTHER_DEVICES_WARNING =
  "Other devices are signed out and must log in with the new passphrase. Reload commitnote in any other open tabs.";

async function closeNoteHistory(page: Page): Promise<void> {
  const history = page.getByRole("dialog", { name: "Version history" });
  await history.getByRole("button", { name: "Close" }).click();
  await expect(history).toHaveCount(0);
}

async function expectNoteHistoryEnd(page: Page, text: string): Promise<void> {
  await page.getByRole("treeitem", { name: "Welcome", exact: true }).click();
  await page.getByRole("button", { name: "Version history" }).click();
  const history = page.getByRole("dialog", { name: "Version history" });
  await expect(history.getByTestId("history-end")).toHaveText(text);
}

test.describe("with a login that is not remembered", () => {
  test.beforeEach(async ({ page }) => {
    await openNotes(page, { via: "login", passphrase: SAMPLE.passphrase });
  });

  test("changes the passphrase in one commit; afterwards only the new one logs in", async ({
    page,
  }) => {
    const before = await fakeForge(page).commitMessages();

    await changePassphrase(page);

    const after = await fakeForge(page).commitMessages();
    expect(after).toHaveLength(before.length + 1);
    expect(after[0].split("\n")[0]).toBe("commitnote: change passphrase");
    await page.getByRole("treeitem", { name: "Welcome" }).click();
    await expect(
      page.getByRole("textbox", { name: "Note editor" }),
    ).toContainText("Welcome");
    await expectNoteHistoryEnd(
      page,
      "Earlier versions are encrypted with a previous passphrase and can't be shown.",
    );
    await closeNoteHistory(page);

    await logOut(page);
    await logIn(page, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
    await expect(page.getByRole("alert")).toHaveText("Wrong passphrase.", {
      timeout: 15_000,
    });

    await page.getByLabel("Passphrase", { exact: true }).fill(NEW_PASSPHRASE);
    await page.getByRole("button", { name: "Log in" }).click();
    await expectTree(page);
    await expect(page.getByRole("treeitem", { name: "Welcome" })).toBeVisible();
  });

  test("deletes the old history when asked, leaving one commit", async ({
    page,
  }) => {
    await openChangeDialog(page);
    const dialog = changeDialog(page);
    const removeHistory = dialog.getByRole("checkbox", {
      name: "Also delete the old history",
    });
    const historyWarning = dialog.getByRole("note");
    await expect(historyWarning).toHaveText(
      "Earlier versions of your notes stay in the repository's history, so the current passphrase still decrypts them after the change, though commitnote can no longer restore them.",
    );
    const warningBox = await historyWarning.boundingBox();
    const checkboxBox = await removeHistory.boundingBox();
    expect(warningBox!.y).toBeGreaterThanOrEqual(
      checkboxBox!.y + checkboxBox!.height,
    );
    await expect(removeHistory).not.toBeChecked();
    await expect(removeHistory).toHaveAccessibleDescription(
      /replaces the whole history with the one commit of re-encrypted notes/,
    );
    await removeHistory.check();
    await expect(historyWarning).toHaveCount(0);
    await removeHistory.uncheck();
    await expect(historyWarning).toBeVisible();
    await removeHistory.check();
    await expect(historyWarning).toHaveCount(0);

    await fillPassphrases(page, SAMPLE.passphrase, NEW_PASSPHRASE);
    const review = page.getByRole("dialog", {
      name: "Ready to change passphrase",
    });
    await expect(
      review.getByText(/history is replaced with just that commit/),
    ).toBeVisible({ timeout: 15_000 });
    await review.getByRole("button", { name: "Change passphrase" }).click();
    await expect(
      page.getByText("Passphrase changed and the old history deleted."),
    ).toBeVisible({ timeout: 15_000 });
    await expectTree(page);

    const after = await fakeForge(page).commitMessages();
    expect(after).toHaveLength(1);
    expect(after[0].split("\n")[0]).toBe("commitnote: change passphrase");
    await page.getByRole("treeitem", { name: "Welcome" }).click();
    await expect(
      page.getByRole("textbox", { name: "Note editor" }),
    ).toContainText("Welcome");
    await expectNoteHistoryEnd(
      page,
      "Earlier history was deleted when the passphrase was changed.",
    );
  });

  test("rates the strength of the new passphrase only", async ({ page }) => {
    await openChangeDialog(page);
    const dialog = changeDialog(page);
    const currentField = dialog.getByLabel("Current passphrase");
    const newField = dialog.getByLabel("New passphrase", { exact: true });
    const repeatField = dialog.getByLabel("Repeat new passphrase");

    await currentField.fill("password");
    await repeatField.fill("password");
    await expect(newField).not.toHaveAccessibleDescription(/strength/);

    await newField.fill("password");
    await expect(newField).toHaveAccessibleDescription(
      /Passphrase strength: Weak\./,
    );
    await newField.fill("violet anchor pepper tundra kayak");
    await expect(newField).toHaveAccessibleDescription(
      /Passphrase strength: (Good|Strong)\./,
    );
    await expect(currentField).not.toHaveAccessibleDescription(/strength/);
    await expect(repeatField).not.toHaveAccessibleDescription(/strength/);
  });

  test("a wrong current passphrase changes nothing", async ({ page }) => {
    const before = await fakeForge(page).commitMessages();
    await openChangeDialog(page);

    await fillPassphrases(page, "not the passphrase", NEW_PASSPHRASE);

    const dialog = changeDialog(page);
    await expect(dialog.getByRole("alert")).toHaveText(
      "The current passphrase is wrong.",
      { timeout: 15_000 },
    );
    await expect(dialog.getByLabel("Current passphrase")).toBeFocused();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await fakeForge(page).commitMessages()).toEqual(before);

    await closeSettings(page);
    await page.getByRole("treeitem", { name: "Welcome" }).click();
    await expect(
      page.getByRole("textbox", { name: "Note editor" }),
    ).toBeVisible();
  });

  test("explains the change and its consequences before the fields, with the current passphrase focused", async ({
    page,
  }) => {
    await openChangeDialog(page);
    const dialog = changeDialog(page);
    const current = dialog.getByLabel("Current passphrase");

    await expect(dialog.getByText(CHANGE_PASSPHRASE_INTRO)).toBeInViewport();
    await expect(dialog.getByText(VERSION_HISTORY_NOTICE)).toBeInViewport();
    await expect(current).toBeFocused();

    const top = async (locator: Locator) =>
      (await locator.boundingBox())?.y ?? Number.NaN;
    const intro = await top(dialog.getByText(CHANGE_PASSPHRASE_INTRO));
    const notice = await top(dialog.getByText(VERSION_HISTORY_NOTICE));
    const checkbox = await top(
      dialog.getByRole("checkbox", { name: "Also delete the old history" }),
    );
    const warning = await top(dialog.getByText(HISTORY_WARNING));
    const otherDevices = await top(dialog.getByText(OTHER_DEVICES_WARNING));
    const currentY = await top(current);
    expect(intro).toBeLessThan(notice);
    expect(notice).toBeLessThan(checkbox);
    expect(checkbox).toBeLessThan(warning);
    expect(warning).toBeLessThan(otherDevices);
    expect(otherDevices).toBeLessThan(currentY);
  });

  test("asks again when the new passphrases differ", async ({ page }) => {
    await openChangeDialog(page);

    await fillPassphrases(page, SAMPLE.passphrase, NEW_PASSPHRASE, "something else");

    await expect(changeDialog(page).getByRole("alert")).toHaveText(
      "The new passphrases do not match.",
    );
    const repeat = changeDialog(page).getByRole("textbox", {
      name: "Repeat new passphrase",
    });
    await expect(repeat).toHaveAttribute("aria-invalid", "true");
    await expect(repeat).toHaveAccessibleDescription(
      "The new passphrases do not match.",
    );
    await expect(changeDialog(page).getByRole("alert")).toHaveCount(1);
  });

  test("backing out of the review keeps the old passphrase and explains that version history starts over", async ({ page }) => {
    const before = await fakeForge(page).commitMessages();
    await openChangeDialog(page);
    await expect(
      changeDialog(page).getByText(VERSION_HISTORY_NOTICE),
    ).toBeVisible();
    await fillPassphrases(page, SAMPLE.passphrase, NEW_PASSPHRASE);
    const review = page.getByRole("dialog", {
      name: "Ready to change passphrase",
    });
    await expect(review).toBeVisible({ timeout: 15_000 });
    await expect(review.getByText(VERSION_HISTORY_NOTICE)).toBeVisible();

    await expect(review.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await review.getByRole("button", { name: "Close" }).click();

    await expect(review).toHaveCount(0);
    expect(await fakeForge(page).commitMessages()).toEqual(before);
    await closeSettings(page);
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByLabel("Folder name").fill("After cancel");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect
      .poll(() => fakeForge(page).commitMessages().then((m) => m.length))
      .toBe(before.length + 1);
  });

  test("another device still on the old passphrase is asked to log in again", async ({
    page,
    openSecondDevice,
  }) => {
    const { page: other } = await openSecondDevice();
    await logIn(other, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
    await expectTree(other);

    await changePassphrase(page);
    await handOverRepo(page, other);
    const changedHead = (await fakeForge(other).commitMessages())[0];
    await other.getByRole("button", { name: "Refresh" }).click();

    await expect(
      other.getByRole("alert").getByText(KEY_CHANGED_TEXT),
    ).toBeVisible();
    expect((await fakeForge(other).commitMessages())[0]).toBe(changedHead);
  });
});

test.describe("with a remembered login", () => {
  test.beforeEach(async ({ page }) => {
    await openNotes(page, {
      via: "login",
      passphrase: SAMPLE.passphrase,
      rememberMe: true,
    });
  });

  test("another tab of the same browser picks up the new passphrase it remembered", async ({
    page,
  }) => {
    const other = await page.context().newPage();
    await other.goto(page.url());
    await expectTree(other);

    await changePassphrase(page);
    await handOverRepo(page, other);
    await other.getByRole("button", { name: "Refresh" }).click();
    await expect(
      other.getByRole("alert").getByText(KEY_CHANGED_TEXT),
    ).toBeVisible();
    await other.getByRole("button", { name: "Log in again" }).click();

    await expectTree(other);
    await expect(other.getByLabel("Access token")).toHaveCount(0);
  });
});
