import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { KEY_DERIVATION_TIMEOUT, fakeForge, openNotes } from "./helpers";
import { createLink, shareDialog } from "./helpers/sharing";
import { openWelcome, treeItem, waitForSynced } from "./helpers/tree";

const FAKELAB_NOTES_REPO = "https://fakelab.test/team/notes";
const FAKELAB_KEY = "team/notes";
const PASSWORD = "open sesame";

async function shareFromRowMenu(
  page: Page,
  options: { password?: string } = {},
): Promise<string> {
  await treeItem(page, "Welcome").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Share…" }).click();
  return createLink(page, options);
}

async function closeDialog(dialog: Locator): Promise<void> {
  await dialog.page().keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

async function openSharedLinks(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "More commands" }).click();
  await page
    .getByRole("menu", { name: "Commands" })
    .getByRole("menuitem", { name: "Shared links" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Shared links" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function shareAction(
  list: Locator,
  title: string,
  item: string,
): Promise<void> {
  await list.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  await list
    .getByRole("button", { name: `Share actions for ${title}` })
    .click();
  await list
    .page()
    .getByRole("menu", { name: `Share actions for ${title}` })
    .getByRole("menuitem", { name: item })
    .click();
}

async function editWelcome(page: Page, text: string): Promise<void> {
  await openWelcome(page);
  await page.getByRole("textbox", { name: "Note editor" }).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
  await waitForSynced(page);
}

async function openViewer(page: Page, link: string): Promise<Page> {
  const viewer = await page.context().newPage();
  await viewer.goto(link);
  return viewer;
}

const NOTE_TEXT = "Notes stay private even to the forge that hosts them.";

test("a share link opens the note without logging in", async ({ page }) => {
  await openNotes(page);
  const link = await shareFromRowMenu(page);

  const viewer = await openViewer(page, link);
  await expect(
    viewer.getByRole("heading", { name: "Welcome", level: 1 }).first(),
  ).toBeVisible();
  await expect(viewer.getByText(NOTE_TEXT)).toBeVisible();
  await expect(viewer).toHaveTitle("Shared note · commitnote");
  await expect(viewer.getByLabel("Access token")).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Copy text" })).toBeVisible();
});

test("a password-protected share asks for the password", async ({ page }) => {
  await openNotes(page);
  await openWelcome(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const link = await createLink(page, { password: PASSWORD });
  await expect(
    shareDialog(page).getByRole("textbox", { name: "Share password" }),
  ).toHaveValue(PASSWORD);

  const viewer = await openViewer(page, link);
  await expect(
    viewer.getByRole("heading", {
      name: "This note is protected with a password",
    }),
  ).toBeVisible();
  const field = viewer.getByRole("textbox", { name: "Password" });
  await field.fill("wrong");
  await viewer.getByRole("button", { name: "Unlock" }).click();
  await expect(viewer.getByText("Wrong password")).toBeVisible({
    timeout: KEY_DERIVATION_TIMEOUT,
  });
  await expect(field).toHaveValue("wrong");

  await field.fill(PASSWORD);
  await viewer.getByRole("button", { name: "Unlock" }).click();
  await expect(viewer.getByText(NOTE_TEXT)).toBeVisible({
    timeout: KEY_DERIVATION_TIMEOUT,
  });
});

test("a share keeps the text from when it was created", async ({ page }) => {
  await openNotes(page);
  const link = await shareFromRowMenu(page);
  await closeDialog(shareDialog(page));

  const viewer = await openViewer(page, link);
  await expect(viewer.getByText(NOTE_TEXT)).toBeVisible();

  await editWelcome(page, "Edited after sharing");

  await viewer.reload();
  await expect(viewer.getByText(NOTE_TEXT)).toBeVisible();
  await expect(viewer.getByText("Edited after sharing")).toHaveCount(0);
});

test("revoking a share removes the link and the markers", async ({ page }) => {
  await openNotes(page);
  const link = await shareFromRowMenu(page);
  await closeDialog(shareDialog(page));
  await openWelcome(page);
  await expect(treeItem(page, "Welcome")).toHaveAccessibleDescription(/Shared/);

  const list = await openSharedLinks(page);
  await shareAction(list, "Welcome", "Revoke…");
  await page
    .getByRole("dialog", { name: "Revoke link?" })
    .getByRole("button", { name: "Revoke", exact: true })
    .click();

  await expect(page.getByText("Link revoked")).toBeVisible();
  await expect(
    list.getByText("No shared links yet. Share a note from its menu."),
  ).toBeVisible();
  await closeDialog(list);

  const viewer = await openViewer(page, link);
  await expect(
    viewer.getByText("This shared note is no longer available.", {
      exact: false,
    }),
  ).toBeVisible();

  await expect(treeItem(page, "Welcome")).not.toHaveAccessibleDescription(
    /Shared/,
  );
  await expect(treeItem(page, "Welcome").locator(".share-glyph")).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Share", exact: true }),
  ).not.toHaveAccessibleDescription("Shared");
  await expect(
    page.getByRole("button", { name: "Shared", exact: true }),
  ).toHaveCount(0);
});

test("a shared note is marked in the tree, header and details, also after renaming", async ({
  page,
}) => {
  await openNotes(page);
  await shareFromRowMenu(page);
  await closeDialog(shareDialog(page));
  await openWelcome(page);

  await expect(treeItem(page, "Welcome")).toHaveAccessibleDescription(/Shared/);
  await expect(treeItem(page, "Welcome").locator(".share-glyph")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Share", exact: true }),
  ).toHaveAccessibleDescription("Shared");

  await page.getByRole("button", { name: "Shared", exact: true }).click();
  const dialog = shareDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Shared links")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Share actions for Welcome" }),
  ).toBeVisible();
  await closeDialog(dialog);

  const name = page.getByRole("textbox", { name: "Note name" });
  await name.fill("Greeting");
  await name.press("Enter");
  await expect(treeItem(page, "Greeting")).toHaveAccessibleDescription(
    /Shared/,
  );
  await expect(
    treeItem(page, "Greeting").locator(".share-glyph"),
  ).toBeVisible();
});

test("updating a share keeps the same link and shows the new content", async ({
  page,
}) => {
  await openNotes(page);
  const link = await shareFromRowMenu(page);
  await closeDialog(shareDialog(page));
  await editWelcome(page, "Edited after sharing");

  const list = await openSharedLinks(page);
  await shareAction(list, "Welcome", "Update to current version");
  await expect(page.getByText("Link updated")).toBeVisible();

  const viewer = await openViewer(page, link);
  await expect(viewer.getByText("Edited after sharing")).toBeVisible();
  await expect(viewer.getByText(/^Updated /)).toBeVisible();

  await shareAction(list, "Welcome", "Update to current version");
  await expect(
    page.getByText("Link already shows the current version"),
  ).toBeVisible();
});

test.describe("with forge latency", () => {
  test.use({ forgeLatency: "github" });

  test("a keyboard update keeps focus on the share actions trigger", async ({
    page,
  }) => {
    await openNotes(page);
    await shareFromRowMenu(page);
    await closeDialog(shareDialog(page));
    await editWelcome(page, "Edited after sharing");

    const list = await openSharedLinks(page);
    await list.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
    );
    const trigger = list.getByRole("button", {
      name: "Share actions for Welcome",
    });
    const menu = page.getByRole("menu", { name: "Share actions for Welcome" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await menu
      .getByRole("menuitem", { name: "Update to current version" })
      .focus();
    await page.keyboard.press("Enter");

    await expect(list.getByTestId("share-item").getByRole("status")).toHaveText("Updating…");
    await expect(trigger).toHaveAttribute("aria-disabled", "true");
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);

    await expect(page.getByText("Link updated")).toBeVisible();
    await expect(trigger).not.toHaveAttribute("aria-disabled", "true");
    await expect(trigger).toBeFocused();
  });
});

test("a password share keeps its password after an update", async ({
  page,
}) => {
  await openNotes(page);
  const link = await shareFromRowMenu(page, { password: PASSWORD });
  await closeDialog(shareDialog(page));
  await editWelcome(page, "Edited after sharing");

  const list = await openSharedLinks(page);
  await shareAction(list, "Welcome", "Update to current version");
  await expect(page.getByText("Link updated")).toBeVisible();

  const viewer = await openViewer(page, link);
  await viewer.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await viewer.getByRole("button", { name: "Unlock" }).click();
  await expect(viewer.getByText("Edited after sharing")).toBeVisible({
    timeout: KEY_DERIVATION_TIMEOUT,
  });
  await expect(viewer.getByText(/^Updated /)).toBeVisible();
});

test("an update of a link that vanished from the forge explains what to do", async ({
  page,
}) => {
  await openNotes(page);
  await shareFromRowMenu(page);
  await closeDialog(shareDialog(page));
  await editWelcome(page, "Edited after sharing");

  const list = await openSharedLinks(page);
  await fakeForge(page).failNext("updateShare", "NotFound");
  await shareAction(list, "Welcome", "Update to current version");
  await expect(
    page.getByText(
      "This link no longer exists on GitHub. Revoke it to remove it from the list.",
    ),
  ).toBeVisible();
});

test("share rows are one line and the menu works with mouse, right-click and keyboard", async ({
  page,
}) => {
  await openNotes(page);
  await shareFromRowMenu(page);
  await closeDialog(shareDialog(page));
  const list = await openSharedLinks(page);
  await list.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  const row = list.getByTestId("share-item");
  const trigger = row.getByRole("button", {
    name: "Share actions for Welcome",
  });
  const menu = page.getByRole("menu", { name: "Share actions for Welcome" });

  const rowBox = (await row.boundingBox())!;
  const triggerBox = (await trigger.boundingBox())!;
  expect(rowBox.height).toBeLessThanOrEqual(triggerBox.height + 2);

  await trigger.click();
  await expect(
    menu.getByRole("menuitem", { name: "Update to current version" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await row.click({ button: "right" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(trigger).not.toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(list).toBeVisible();
});

test("copy buttons put the link and the password on the clipboard", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openNotes(page);
  const link = await shareFromRowMenu(page, { password: PASSWORD });
  const dialog = shareDialog(page);

  await dialog.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await closeDialog(dialog);

  const list = await openSharedLinks(page);
  await shareAction(list, "Welcome", "Copy password");
  await expect(page.getByText("Password copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    PASSWORD,
  );
});

test("commit messages for sharing and revoking reveal nothing", async ({
  page,
}) => {
  await openNotes(page);
  const link = await shareFromRowMenu(page, { password: PASSWORD });
  const secret = link.split(".").at(-1)!;
  await closeDialog(shareDialog(page));

  const list = await openSharedLinks(page);
  await shareAction(list, "Welcome", "Revoke…");
  await page
    .getByRole("dialog", { name: "Revoke link?" })
    .getByRole("button", { name: "Revoke", exact: true })
    .click();
  await expect(page.getByText("Link revoked")).toBeVisible();

  const messages = await fakeForge(page).commitMessages();
  const joined = messages.join("\n");
  expect(joined).toContain("Commitnote-Share: add");
  expect(joined).toContain("Commitnote-Share: remove");
  expect(joined).not.toContain("Welcome");
  expect(joined).not.toContain(secret);
  expect(joined).not.toContain(PASSWORD);
});

test("names, renames and clears a share link without revealing it", async ({
  page,
}) => {
  await openNotes(page);
  await openWelcome(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const link = await createLink(page, { name: "For Anna" });

  const dialog = shareDialog(page);
  const dialogRow = dialog.getByTestId("share-item");
  await expect(dialogRow.locator(".share-title")).toHaveText("For Anna");
  await expect(dialogRow.locator(".share-note-name")).toHaveText("Welcome");
  await expect(
    dialog.getByRole("button", { name: "Share actions for For Anna" }),
  ).toBeVisible();
  await closeDialog(dialog);

  const list = await openSharedLinks(page);
  const row = list.getByTestId("share-item");
  await shareAction(list, "For Anna", "Rename…");
  const rename = page.getByRole("dialog", { name: "Rename link" });
  await expect(rename.getByRole("textbox", { name: "Name" })).toHaveValue(
    "For Anna",
  );
  await rename.getByRole("textbox", { name: "Name" }).fill("Team review");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(rename).toHaveCount(0);
  await expect(row.locator(".share-title")).toHaveText("Team review");

  await shareAction(list, "Team review", "Rename…");
  await rename.getByRole("textbox", { name: "Name" }).fill("");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(rename).toHaveCount(0);
  await expect(row.locator(".share-title")).toHaveText("Welcome");
  await expect(row.locator(".share-note-name")).toHaveCount(0);

  const viewer = await openViewer(page, link);
  await expect(
    viewer.getByRole("heading", { name: "Welcome", level: 1 }).first(),
  ).toBeVisible();
  await expect(viewer.getByText("For Anna")).toHaveCount(0);
  await expect(viewer.getByText("Team review")).toHaveCount(0);

  await waitForSynced(page);
  const joined = (await fakeForge(page).commitMessages()).join("\n");
  expect(joined).toContain("Commitnote-Share: label");
  expect(joined).not.toContain("For Anna");
  expect(joined).not.toContain("Team review");
  expect(joined).not.toContain("Welcome");
});

test("a GitHub token without gist permission gets a helpful error", async ({
  page,
}) => {
  await openNotes(page);
  await fakeForge(page).failNext("createShare", "Forbidden");
  await treeItem(page, "Welcome").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Share…" }).click();
  const dialog = shareDialog(page);
  await dialog.getByRole("button", { name: "Create link" }).click();

  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("Sharing needs permission to create gists");
  await expect(
    alert.locator(
      'a[href="https://github.com/settings/personal-access-tokens"]',
    ),
  ).toBeVisible();
  await expect(
    alert.locator('a[href="https://github.com/settings/tokens"]'),
  ).toBeVisible();
  await closeDialog(dialog);

  const list = await openSharedLinks(page);
  await expect(
    list.getByText("No shared links yet. Share a note from its menu."),
  ).toBeVisible();
});

test.describe("Fakelab", () => {
  test.beforeEach(async ({ page }) => {
    await openNotes(page, { repo: FAKELAB_NOTES_REPO });
  });

  test("a token without the api scope gets a helpful error", async ({
    page,
  }) => {
    await fakeForge(page, FAKELAB_KEY).failNext("createShare", "Forbidden");
    await treeItem(page, "Welcome").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Share…" }).click();
    const dialog = shareDialog(page);
    await dialog.getByRole("button", { name: "Create link" }).click();

    const alert = dialog.getByRole("alert");
    await expect(alert).toContainText(
      "Sharing needs an access token with the api scope",
    );
    await expect(
      alert.locator(
        'a[href="https://gitlab.com/-/user_settings/personal_access_tokens"]',
      ),
    ).toBeVisible();
  });

  test("a share round trip works", async ({ page }) => {
    const link = await shareFromRowMenu(page);
    expect(link).toContain("#share=1.gl.");

    const viewer = await openViewer(page, link);
    await expect(viewer.getByText(NOTE_TEXT)).toBeVisible();
  });
});

test(
  "the share dialog is a bottom sheet with a touch-sized button",
  { tag: "@mobile" },
  async ({ page, isMobile }) => {
    test.skip(!isMobile, "bottom sheets are mobile only");
    await openNotes(page);
    await page.getByRole("button", { name: "Actions for Welcome" }).click();
    await page.getByRole("menuitem", { name: "Share…" }).click();
    const dialog = shareDialog(page);
    await expect(dialog.getByTestId("dialog-grab-handle")).toBeVisible();
    const box = (await dialog
      .getByRole("button", { name: "Create link" })
      .boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  },
);

test(
  "the shared note viewer fits the screen",
  { tag: "@mobile" },
  async ({ page }) => {
    await openNotes(page);
    await page.getByRole("button", { name: "Actions for Welcome" }).click();
    await page.getByRole("menuitem", { name: "Share…" }).click();
    const link = await createLink(page);

    const viewer = await openViewer(page, link);
    await expect(viewer.getByText(NOTE_TEXT)).toBeVisible();
    const fits = await viewer.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits).toBe(true);
  },
);

test(
  "the share actions trigger is visible and works with a tap",
  { tag: "@mobile" },
  async ({ page, isMobile }) => {
    test.skip(!isMobile, "taps are mobile only");
    await openNotes(page);
    await page.getByRole("button", { name: "Actions for Welcome" }).click();
    await page.getByRole("menuitem", { name: "Share…" }).click();
    await createLink(page);
    await closeDialog(shareDialog(page));

    const list = await openSharedLinks(page);
    await list.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
    );
    const trigger = list.getByRole("button", {
      name: "Share actions for Welcome",
    });
    await expect(trigger).toBeVisible();
    await trigger.tap();
    await page
      .getByRole("menu", { name: "Share actions for Welcome" })
      .getByRole("menuitem", { name: "Revoke…" })
      .tap();
    await page
      .getByRole("dialog", { name: "Revoke link?" })
      .getByRole("button", { name: "Revoke", exact: true })
      .tap();
    await expect(page.getByText("Link revoked")).toBeVisible();
  },
);
