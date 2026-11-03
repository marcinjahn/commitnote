import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { flushPendingSaves, openNotes } from "./helpers";
import { dispatchImages } from "./helpers/images";
import { createLink, shareDialog } from "./helpers/sharing";
import { openWelcome, treeItem } from "./helpers/tree";

const FAKELAB_NOTES_REPO = "https://fakelab.test/team/notes";
const FAKE_SHARES_KEY = "__commitNoteFakeShares";
const TOO_MANY = "This note has too many images to share.";

type HostedShares = Record<string, Record<string, string>>;

function loadedWidgets(scope: Page | Locator): Locator {
  return scope.locator('button.cm-image[data-state="loaded"]');
}

function lightbox(page: Page): Locator {
  return page.locator("dialog.image-lightbox");
}

function shades(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    width: 16,
    height: 16,
    shade: offset + index * 5,
  }));
}

async function hostedShares(page: Page): Promise<HostedShares> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).shares : {};
  }, FAKE_SHARES_KEY);
}

async function hostedFileNames(page: Page): Promise<string[][]> {
  return Object.values(await hostedShares(page)).map((files) =>
    Object.keys(files).sort(),
  );
}

async function openWelcomeAtEnd(page: Page): Promise<void> {
  await openWelcome(page);
  await page.locator("#note-pane .cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
}

async function pasteImages(
  page: Page,
  specs: Parameters<typeof dispatchImages>[2],
): Promise<void> {
  const before = await loadedWidgets(page).count();
  await dispatchImages(page, "paste", specs);
  await expect(loadedWidgets(page)).toHaveCount(before + specs.length);
}

async function openShareDialog(page: Page): Promise<void> {
  await treeItem(page, "Welcome").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Share…" }).click();
  await expect(shareDialog(page)).toBeVisible();
}

async function shareWelcome(page: Page): Promise<string> {
  await flushPendingSaves(page);
  await openShareDialog(page);
  const link = await createLink(page);
  await page.keyboard.press("Escape");
  await expect(shareDialog(page)).toHaveCount(0);
  return link;
}

async function openViewer(page: Page, link: string): Promise<Page> {
  const viewer = await page.context().newPage();
  await viewer.goto(link);
  return viewer;
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
  await list.getByRole("button", { name: `Share actions for ${title}` }).click();
  await list
    .page()
    .getByRole("menu", { name: `Share actions for ${title}` })
    .getByRole("menuitem", { name: item })
    .click();
}

async function expectReadOnlyLightbox(page: Page): Promise<void> {
  await expect(lightbox(page)).toBeVisible();
  await expect(lightbox(page).locator("img")).toBeVisible();
  await expect(
    lightbox(page).getByRole("button", { name: "Remove from note" }),
  ).toHaveCount(0);
}

test("a share recipient sees the image inline and in a lightbox", async ({
  page,
}) => {
  await openNotes(page);
  await openWelcomeAtEnd(page);
  await pasteImages(page, [{ width: 1200, height: 800, shade: 40 }]);
  const link = await shareWelcome(page);

  const viewer = await openViewer(page, link);
  const image = loadedWidgets(viewer);
  await expect(image).toHaveCount(1);

  await image.click();
  await expectReadOnlyLightbox(viewer);
  await viewer.keyboard.press("Escape");
  await expect(lightbox(viewer)).toHaveCount(0);

  await image.click();
  await expectReadOnlyLightbox(viewer);
  await viewer.goBack();
  await expect(lightbox(viewer)).toHaveCount(0);
  await expect(
    viewer.getByRole("heading", { name: "Welcome", level: 1 }).first(),
  ).toBeVisible();

  const hosted = Object.entries(await hostedShares(page));
  expect(hosted).toHaveLength(1);
  const [key, files] = hosted[0];
  expect(key).toMatch(/^gh:/);
  expect(Object.keys(files).sort()).toEqual([
    "commitnote-image-0.json",
    "commitnote-share.json",
  ]);
  for (const content of Object.values(files)) {
    expect(content).not.toContain("Welcome");
  }
});

test.describe("Fakelab", () => {
  test.beforeEach(async ({ page }) => {
    await openNotes(page, { repo: FAKELAB_NOTES_REPO });
  });

  test("a share recipient sees the image inline", async ({ page }) => {
    await openWelcomeAtEnd(page);
    await pasteImages(page, [{ width: 300, height: 200, shade: 60 }]);
    const link = await shareWelcome(page);
    expect(link).toContain("#share=1.gl.");

    const viewer = await openViewer(page, link);
    await expect(loadedWidgets(viewer)).toHaveCount(1);

    const hosted = Object.entries(await hostedShares(page));
    expect(hosted).toHaveLength(1);
    expect(hosted[0][0]).toMatch(/^gl:/);
    expect(Object.keys(hosted[0][1]).sort()).toEqual([
      "commitnote-image-0.json",
      "commitnote-share.json",
    ]);
  });

  test("a note with 10 images is too big to share", async ({ page }) => {
    await openWelcomeAtEnd(page);
    await pasteImages(page, shades(10));
    await flushPendingSaves(page);

    await openShareDialog(page);
    const dialog = shareDialog(page);
    await dialog.getByRole("button", { name: "Create link" }).click();
    await expect(dialog.getByText(TOO_MANY)).toBeVisible();
    expect(await hostedFileNames(page)).toEqual([]);
  });
});

test("updating a share drops image files that are no longer used", async ({
  page,
}) => {
  await openNotes(page);
  await openWelcomeAtEnd(page);
  await pasteImages(page, shades(2, 30));
  const link = await shareWelcome(page);
  expect(await hostedFileNames(page)).toEqual([
    ["commitnote-image-0.json", "commitnote-image-1.json", "commitnote-share.json"],
  ]);

  await page.locator("#note-pane .cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Backspace");
  await expect(loadedWidgets(page)).toHaveCount(1);
  await flushPendingSaves(page);

  const list = await openSharedLinks(page);
  await shareAction(list, "Welcome", "Update to current version");
  await expect(page.getByText("Link updated")).toBeVisible();

  expect(await hostedFileNames(page)).toEqual([
    ["commitnote-image-0.json", "commitnote-share.json"],
  ]);
  const viewer = await openViewer(page, link);
  await expect(loadedWidgets(viewer)).toHaveCount(1);
});

test("the shared version dialog shows the image", async ({ page }) => {
  await openNotes(page);
  await openWelcomeAtEnd(page);
  await pasteImages(page, [{ width: 400, height: 300, shade: 80 }]);
  await shareWelcome(page);

  const list = await openSharedLinks(page);
  await shareAction(list, "Welcome", "View shared version");
  const version = page.getByRole("dialog", { name: "Shared version" });
  const image = loadedWidgets(version);
  await expect(image).toHaveCount(1);

  await image.click();
  await expectReadOnlyLightbox(page);
  await page.keyboard.press("Escape");
  await expect(lightbox(page)).toHaveCount(0);
  await expect(version).toBeVisible();
});

test("a note with more than 20 images cannot be shared", async ({ page }) => {
  await openNotes(page);
  await openWelcomeAtEnd(page);
  await pasteImages(page, shades(10));
  await pasteImages(page, shades(10, 100));
  await pasteImages(page, [{ width: 16, height: 16, shade: 250 }]);
  await flushPendingSaves(page);

  await openShareDialog(page);
  const dialog = shareDialog(page);
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog.getByText(TOO_MANY)).toBeVisible();
  expect(await hostedFileNames(page)).toEqual([]);
});
