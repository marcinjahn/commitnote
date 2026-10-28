import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { fakeForge, flushPendingSaves, openNotes } from "./helpers";
import { dispatchImages, pngBase64, type ImageSpec } from "./helpers/images";
import { enableVimMode } from "./helpers/settings";
import { openWelcome, treeItem } from "./helpers/tree";

const NOTES = "sample/notes";
const WHITEBOARD_ID = "s4u5q5zr4xaec3jewbaixgwlou";
const IMAGE_PREFIX = ".commitnote/images/";
const PHOTO_NAME = "holiday-secret-photo.png";

function editorContent(page: Page): Locator {
  return page.locator("#note-pane .cm-content");
}

function loadedWidgets(page: Page): Locator {
  return page.locator('button.cm-image[data-state="loaded"]');
}

async function pickerFile(page: Page, spec: ImageSpec) {
  return {
    name: spec.name ?? PHOTO_NAME,
    mimeType: "image/png",
    buffer: Buffer.from(await pngBase64(page, spec), "base64"),
  };
}

async function pasteText(page: Page, text: string): Promise<void> {
  await page.locator(".cm-content").evaluate((element, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}

async function openWelcomeAtEnd(page: Page): Promise<void> {
  await openNotes(page);
  await openWelcome(page);
  await editorContent(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  // Moves off the table's trailing blank line so new content cannot continue the table. Don't fold
  // this into insertText("\n..."): Playwright's synthetic insert drops that leading newline right
  // after a block widget, while real typing and paste keep it.
  await page.keyboard.press("Enter");
}

async function typeLines(page: Page, lines: readonly string[]): Promise<void> {
  await page.keyboard.press("Enter");
  for (const [index, line] of lines.entries()) {
    await page.keyboard.type(line);
    if (index < lines.length - 1) await page.keyboard.press("Enter");
  }
}

async function widgetIds(page: Page): Promise<string[]> {
  return page
    .locator("button.cm-image")
    .evaluateAll((buttons) => buttons.map((b) => b.getAttribute("data-image-id")!));
}

async function outline(page: Page): Promise<string[]> {
  const entries = await page.locator("#note-pane .cm-content").evaluate((content) =>
    [...content.children].map((child) => {
      const image = child.matches("button.cm-image")
        ? child
        : child.querySelector("button.cm-image");
      if (image) return `image:${image.getAttribute("data-image-id")}`;
      const raw = /image:([a-z2-7]{26})/.exec(child.textContent ?? "");
      return raw ? `image:${raw[1]}` : (child.textContent ?? "");
    }),
  );
  return entries.filter((entry, index) => entry !== "" && entry !== entries[index - 1]);
}

async function headImagePaths(page: Page): Promise<string[]> {
  return (await fakeForge(page, NOTES).headPaths()).filter((path) =>
    path.startsWith(IMAGE_PREFIX),
  );
}

interface RepoExport {
  readonly objects: {
    readonly blobs: [string, string][];
    readonly binaryBlobs?: [string, string][];
    readonly trees: [string, [string, string][]][];
    readonly commits: [string, { tree: string }][];
  };
  readonly main: string | null;
}

function blobBytes(repo: RepoExport, sha: string): Buffer | undefined {
  const binary = repo.objects.binaryBlobs?.find(([key]) => key === sha);
  if (binary) return Buffer.from(binary[1], "base64");
  const text = repo.objects.blobs.find(([key]) => key === sha);
  return text ? Buffer.from(text[1], "utf8") : undefined;
}

async function imageFileBytes(page: Page, id: string): Promise<Buffer> {
  const exported = await fakeForge(page, NOTES).exportRepo();
  const repo = JSON.parse(exported) as RepoExport;
  const commit = repo.objects.commits.find(([sha]) => sha === repo.main)![1];
  const files = repo.objects.trees.find(([sha]) => sha === commit.tree)![1];
  const entry = files.find(([path]) => path === `${IMAGE_PREFIX}${id}`)!;
  return blobBytes(repo, entry[1])!;
}

async function expectNoPlaintextInRepo(page: Page): Promise<void> {
  const exported = await fakeForge(page, NOTES).exportRepo();
  const repo = JSON.parse(exported) as RepoExport;
  const everything = [
    Buffer.from(exported, "utf8"),
    ...(repo.objects.binaryBlobs ?? []).map(([, base64]) => Buffer.from(base64, "base64")),
  ];
  for (const bytes of everything) {
    expect(bytes.includes(Buffer.from("\x89PNG", "latin1"))).toBe(false);
    expect(bytes.includes(Buffer.from("IHDR"))).toBe(false);
    expect(bytes.includes(Buffer.from("WEBP"))).toBe(false);
    expect(bytes.includes(Buffer.from(PHOTO_NAME))).toBe(false);
  }
}

function errorToast(page: Page, text: string): Locator {
  return page.getByRole("group").filter({ hasText: text });
}

test("a pasted image lands at the caret and is stored encrypted", async ({ page }) => {
  await openWelcomeAtEnd(page);
  await typeLines(page, ["before", "after"]);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("End");

  await dispatchImages(page, "paste", [{ width: 40, height: 30, shade: 10, name: PHOTO_NAME }]);

  await expect(loadedWidgets(page)).toHaveCount(1);
  const [id] = await widgetIds(page);
  expect(id).toMatch(/^[a-z2-7]{26}$/);
  await expect(editorContent(page)).toContainText("after");

  const lines = await outline(page);
  const beforeAt = lines.indexOf("before");
  expect(lines.slice(beforeAt, beforeAt + 3)).toEqual(["before", `image:${id}`, "after"]);

  await flushPendingSaves(page);
  await expect.poll(() => headImagePaths(page)).toContain(`${IMAGE_PREFIX}${id}`);
  expect(await headImagePaths(page)).toHaveLength(2);
  const file = await imageFileBytes(page, id);
  expect(file.subarray(0, 4)).toEqual(Buffer.from([0x43, 0x4e, 0x49, 0x01]));
  await expectNoPlaintextInRepo(page);
});

test("dropping two images inserts both in order at the drop position", async ({
  page,
}) => {
  await openWelcomeAtEnd(page);
  await typeLines(page, ["first", "second", "third"]);
  const secondLine = page.locator("#note-pane .cm-line", { hasText: /^second$/ });
  const box = (await secondLine.boundingBox())!;

  await dispatchImages(
    page,
    "drop",
    [
      { width: 40, height: 30, shade: 20 },
      { width: 50, height: 20, shade: 200 },
    ],
    { x: box.x + box.width - 2, y: box.y + box.height / 2 },
  );

  await expect(loadedWidgets(page)).toHaveCount(2);
  const ids = await widgetIds(page);
  const lines = await outline(page);
  const secondAt = lines.indexOf("second");
  expect(lines.slice(secondAt, secondAt + 4)).toEqual([
    "second",
    `image:${ids[0]}`,
    `image:${ids[1]}`,
    "third",
  ]);
  expect(new Set(await widgetIds(page)).size).toBe(2);
});

test("the header Insert image button downscales a large image", async ({ page }) => {
  await openWelcomeAtEnd(page);
  const file = await pickerFile(page, { width: 3000, height: 2000, shade: 90 });

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Insert image" }).click();
  await (await chooser).setFiles(file);

  await expect(loadedWidgets(page)).toHaveCount(1);
  await editorContent(page).focus();
  await page.keyboard.press("ArrowUp");
  await expect(editorContent(page)).toContainText("#2560x1707");
});

test("the command menu Insert image opens the file chooser", async ({ page }) => {
  await openWelcomeAtEnd(page);
  await page.getByRole("button", { name: "More commands" }).click();

  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("menu", { name: "Commands" })
    .getByRole("menuitem", { name: "Insert image" })
    .click();
  await (await chooser).setFiles(await pickerFile(page, { width: 30, height: 30, shade: 5 }));

  await expect(loadedWidgets(page)).toHaveCount(1);
});

test("Vim :image opens the picker and paste inserts an image in insert mode", async ({
  page,
}) => {
  await openNotes(page);
  await enableVimMode(page);
  await openWelcome(page);
  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.focus();
  await expect(page.locator(".vim-status-bar .mode-label")).toHaveText("NORMAL");

  await page.keyboard.type(":");
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.type("image");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles(await pickerFile(page, { width: 30, height: 30, shade: 5 }));
  await expect(loadedWidgets(page)).toHaveCount(1);

  await page.keyboard.press("Escape");
  await page.keyboard.press("G");
  await page.keyboard.press("i");
  await expect(page.locator(".vim-status-bar .mode-label")).toHaveText("INSERT");
  await page.keyboard.press("Enter");
  await dispatchImages(page, "paste", [{ width: 20, height: 20, shade: 60 }]);
  await expect(loadedWidgets(page)).toHaveCount(2);
});

test("files that are not accepted images show a notice and insert nothing", async ({
  page,
}) => {
  await openWelcomeAtEnd(page);
  const input = page.getByTestId("insert-image-file");

  await input.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("plain text"),
  });
  await expect(errorToast(page, "This file is not an image.")).toBeVisible();

  await input.setInputFiles({
    name: "drawing.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await expect(errorToast(page, "This image format is not supported.")).toBeVisible();

  const tiny = await pickerFile(page, { width: 8, height: 8, shade: 1 });
  await input.setInputFiles(Array.from({ length: 11 }, () => tiny));
  await expect(errorToast(page, "You can add up to 10 images at a time.")).toBeVisible();

  await expect(editorContent(page)).not.toContainText("image:");
  await expect(page.locator("button.cm-image")).toHaveCount(0);
});

test("pasting a reference to an existing image clones it under a new id", async ({
  page,
}) => {
  await openNotes(page);
  await treeItem(page, "Journal").click();
  await treeItem(page, "2026").click();
  await treeItem(page, "Whiteboard").click();
  const original = page.locator(`button.cm-image[data-image-id="${WHITEBOARD_ID}"]`);
  await expect(original).toHaveAttribute("data-state", "loaded");
  const size = await original
    .locator("img")
    .evaluate((img: HTMLImageElement) => `${img.naturalWidth}x${img.naturalHeight}`);

  await treeItem(page, "Welcome").click();
  await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue("Welcome");
  await editorContent(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await pasteText(page, `![](image:${WHITEBOARD_ID}#${size})\n`);

  await expect(loadedWidgets(page)).toHaveCount(1);
  await expect.poll(() => widgetIds(page)).not.toContain(WHITEBOARD_ID);
  const [cloneId] = await widgetIds(page);
  expect(cloneId).toMatch(/^[a-z2-7]{26}$/);

  await flushPendingSaves(page);
  await expect
    .poll(() => headImagePaths(page))
    .toEqual(
      expect.arrayContaining([`${IMAGE_PREFIX}${WHITEBOARD_ID}`, `${IMAGE_PREFIX}${cloneId}`]),
    );
});

test.describe("without native WebP encoding", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const pngInstead = (type: string | undefined) =>
        type === "image/webp" ? "image/png" : type;
      const convert = OffscreenCanvas.prototype.convertToBlob;
      OffscreenCanvas.prototype.convertToBlob = function (options) {
        return convert.call(this, { ...options, type: pngInstead(options?.type) });
      };
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        return toBlob.call(this, callback, pngInstead(type), quality);
      };
    });
  });

  test("the WASM encoder stores the image under the production CSP", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/content security policy|csp/i.test(text) && !text.includes("frame-ancestors")) {
        violations.push(text);
      }
    });
    await openWelcomeAtEnd(page);
    await typeLines(page, ["wasm"]);

    await dispatchImages(page, "paste", [{ width: 120, height: 80, shade: 40, name: PHOTO_NAME }]);

    await expect(loadedWidgets(page)).toHaveCount(1);
    const [id] = await widgetIds(page);
    await flushPendingSaves(page);
    await expect.poll(() => headImagePaths(page)).toContain(`${IMAGE_PREFIX}${id}`);
    await expectNoPlaintextInRepo(page);
    expect(violations).toEqual([]);
  });
});

test("tapping Insert image on the mobile layout picks and inserts an image", { tag: "@mobile" }, async ({
  page,
}) => {
  await openNotes(page);
  await openWelcome(page);
  await editorContent(page).click();
  const file = await pickerFile(page, { width: 60, height: 40, shade: 70 });

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Insert image" }).click();
  await (await chooser).setFiles(file);

  await expect(loadedWidgets(page)).toHaveCount(1);
});
