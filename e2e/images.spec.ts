import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { TouchFinger, fakeForge, flushPendingSaves, openNotes } from "./helpers";
import { moveToTrash, openTrash, treeItem } from "./helpers/tree";

const IMAGE_ID = "s4u5q5zr4xaec3jewbaixgwlou";
const IMAGE_PATH = `.commitnote/images/${IMAGE_ID}`;
const NOTES = "sample/notes";

async function openWhiteboard(page: Page): Promise<void> {
  await openNotes(page);
  await treeItem(page, "Journal").click();
  await treeItem(page, "2026").click();
  await treeItem(page, "Whiteboard").click();
  await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
    "Whiteboard",
  );
}

function widget(page: Page): Locator {
  return page.locator(`button.cm-image[data-image-id="${IMAGE_ID}"]`);
}

function lightbox(page: Page): Locator {
  return page.locator("dialog.image-lightbox");
}

function editorContent(page: Page): Locator {
  return page.locator(".cm-content");
}

async function expectLoaded(page: Page): Promise<void> {
  await expect(widget(page)).toHaveAttribute("data-state", "loaded");
}

async function openLightbox(page: Page): Promise<void> {
  await widget(page).click();
  await expect(lightbox(page)).toBeVisible();
}

async function headPaths(page: Page): Promise<string[]> {
  return fakeForge(page, NOTES).headPaths();
}

test("the image widget renders and hides its reference off the active line", async ({
  page,
}) => {
  await openWhiteboard(page);
  await expectLoaded(page);
  await expect(widget(page)).toHaveAccessibleName("Image");
  await expect
    .poll(() => widget(page).locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(64);
  await expect(editorContent(page)).not.toContainText(`image:${IMAGE_ID}`);

  await editorContent(page).getByText("Sketch from the planning session.").click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");

  await expect(editorContent(page)).toContainText(`image:${IMAGE_ID}`);
});

test("the lightbox closes with Escape and with Back", async ({ page }) => {
  await openWhiteboard(page);
  await expectLoaded(page);
  const url = page.url();

  await openLightbox(page);
  await expect(lightbox(page).locator("img")).toBeVisible();
  await expect(lightbox(page)).toHaveAccessibleName("Image");
  await page.keyboard.press("Escape");
  await expect(lightbox(page)).toHaveCount(0);

  await openLightbox(page);
  await page.goBack();
  await expect(lightbox(page)).toHaveCount(0);
  expect(page.url()).toBe(url);
  await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
    "Whiteboard",
  );
});

test("the lightbox stays open while the shown note saves", async ({ page }) => {
  await openWhiteboard(page);
  await expectLoaded(page);

  await editorContent(page).getByText("Sketch from the planning session.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" more");
  await openLightbox(page);

  const commitsBefore = await fakeForge(page, NOTES).commitCount();
  await flushPendingSaves(page);
  await expect
    .poll(() => fakeForge(page, NOTES).commitCount())
    .toBeGreaterThan(commitsBefore);

  await expect(lightbox(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lightbox(page)).toHaveCount(0);
});

test("removing an image from the note deletes its file and undo revives it", async ({
  page,
}) => {
  await openWhiteboard(page);
  await expectLoaded(page);
  expect(await headPaths(page)).toContain(IMAGE_PATH);

  await openLightbox(page);
  await lightbox(page).getByRole("button", { name: "Remove from note" }).click();

  await expect(lightbox(page)).toHaveCount(0);
  await expect(widget(page)).toHaveCount(0);
  await expect(editorContent(page)).not.toContainText("image:");
  await flushPendingSaves(page);
  await expect.poll(() => headPaths(page)).not.toContain(IMAGE_PATH);

  await expect(editorContent(page)).toBeFocused();
  await page.keyboard.press("Control+Z");
  await expectLoaded(page);
  await flushPendingSaves(page);
  await expect.poll(() => headPaths(page)).toContain(IMAGE_PATH);
});

test("purging a trashed note removes its image file", async ({ page }) => {
  await openWhiteboard(page);
  await expectLoaded(page);
  expect(await headPaths(page)).toContain(IMAGE_PATH);

  await moveToTrash(page, "Whiteboard");
  await openTrash(page);
  await page
    .getByRole("button", { name: "Delete Whiteboard permanently", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete permanently?" })
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();

  await expect.poll(() => headPaths(page)).not.toContain(IMAGE_PATH);
});

test("an unknown image reference shows Image unavailable", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("frame-ancestors")) {
      problems.push(message.text());
    }
  });
  await openNotes(page);
  await treeItem(page, "Welcome").click();
  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n![](image:aaaaaaaaaaaaaaaaaaaaaaaaaa#40x30)\n");

  const unknown = page.locator(
    'button.cm-image[data-image-id="aaaaaaaaaaaaaaaaaaaaaaaaaa"]',
  );
  await expect(unknown).toHaveAttribute("data-state", "unavailable");
  await expect(unknown).toContainText("Image unavailable");
  expect(problems).toEqual([]);
});

test("the image widget is reachable and operable by keyboard", async ({ page }) => {
  await openWhiteboard(page);
  await expectLoaded(page);

  await editorContent(page).getByText("Sketch from the planning session.").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(widget(page)).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(lightbox(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lightbox(page)).toHaveCount(0);
  await expect(widget(page)).toBeFocused();
});

test("the lightbox closes with a swipe and with Back on mobile", { tag: "@mobile-only" }, async ({
  page,
}) => {
  await openWhiteboard(page);
  await expectLoaded(page);

  await widget(page).tap();
  await expect(lightbox(page)).toBeVisible();
  const box = (await lightbox(page).locator("img").boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const finger = await TouchFinger.on(page);
  await finger.down(start);
  await finger.move({ x: start.x, y: start.y + 300 }, 20);
  finger.hold(150);
  await finger.up();
  await expect(lightbox(page)).toHaveCount(0);

  await widget(page).tap();
  await expect(lightbox(page)).toBeVisible();
  await page.goBack();
  await expect(lightbox(page)).toHaveCount(0);
});
