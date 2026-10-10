import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { KEY_DERIVATION_TIMEOUT, fakeForge, openNotes } from "./helpers";

interface DropFile {
  readonly name: string;
  readonly text?: string;
  readonly bytes?: readonly number[];
  readonly repeatBytes?: number;
}

interface DragOptions {
  readonly drop?: boolean;
  readonly textOnly?: boolean;
}

async function dragFiles(
  target: Locator,
  files: readonly DropFile[],
  options: DragOptions = {},
): Promise<void> {
  await target.evaluate(
    (element, { files, drop, textOnly }) => {
      const data = new DataTransfer();
      if (textOnly) {
        data.setData("text/plain", "Just some text");
      } else {
        for (const file of files) {
          const parts: BlobPart[] =
            file.bytes !== undefined
              ? [new Uint8Array(file.bytes)]
              : file.repeatBytes !== undefined
                ? [new Uint8Array(file.repeatBytes).fill(0x61)]
                : [file.text ?? ""];
          data.items.add(new File(parts, file.name));
        }
      }
      const types = drop
        ? ["dragenter", "dragover", "drop"]
        : ["dragenter", "dragover"];
      for (const type of types) {
        element.dispatchEvent(
          new DragEvent(type, {
            dataTransfer: data,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    { files, drop: options.drop ?? false, textOnly: options.textOnly ?? false },
  );
}

function treeContainer(page: Page): Locator {
  return page.locator(".tree-container");
}

function row(page: Page, path: readonly string[]): Locator {
  return page.locator(
    `[data-tree-row][data-tree-path='${JSON.stringify(path)}']`,
  );
}

function treeItem(page: Page, name: string): Locator {
  return page.getByRole("treeitem", { name, exact: true });
}

const TWO_NOTES: readonly DropFile[] = [
  { name: "Alpha.md", text: "# Alpha\n" },
  { name: "Beta.md", text: "# Beta\n" },
];

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

test("dropping files on a folder imports them into it in one commit", async ({
  page,
}) => {
  const before = await fakeForge(page).commitCount();

  await dragFiles(row(page, ["Projects"]), TWO_NOTES);
  await expect(row(page, ["Projects"])).toHaveAttribute("data-drop-into", "");
  await expect(page.locator("[data-drop-into]")).toHaveCount(1);

  await dragFiles(row(page, ["Projects"]), TWO_NOTES, { drop: true });
  await expect(page.locator("[data-drop-into]")).toHaveCount(0);
  await expect(page.getByText("Imported 2 notes.")).toBeVisible();
  await expect(row(page, ["Projects", "Alpha"])).toBeVisible();
  await expect(row(page, ["Projects", "Beta"])).toBeVisible();
  await expect.poll(() => fakeForge(page).commitCount()).toBe(before + 1);
});

test("dropping files on a note imports them into the note's folder", async ({
  page,
}) => {
  await treeItem(page, "Projects").click();
  await treeItem(page, "commitnote").click();
  const ideas = row(page, ["Projects", "commitnote", "Ideas"]);
  await expect(ideas).toBeVisible();

  await dragFiles(ideas, [{ name: "Dropped.md", text: "Dropped\n" }]);
  await expect(row(page, ["Projects", "commitnote"])).toHaveAttribute(
    "data-drop-into",
    "",
  );
  await expect(page.locator("[data-drop-into]")).toHaveCount(1);

  await dragFiles(ideas, [{ name: "Dropped.md", text: "Dropped\n" }], {
    drop: true,
  });
  await expect(page.getByText("Imported 1 note.")).toBeVisible();
  await expect(row(page, ["Projects", "commitnote", "Dropped"])).toBeVisible();
});

test("dropping files on empty tree space imports them into the root", async ({
  page,
}) => {
  await dragFiles(treeContainer(page), [
    { name: "Loose.txt", text: "Loose\n" },
  ]);
  await expect(treeContainer(page)).toHaveAttribute("data-drop-into", "");
  await expect(page.locator("[data-drop-into]")).toHaveCount(1);

  await dragFiles(
    treeContainer(page),
    [{ name: "Loose.txt", text: "Loose\n" }],
    {
      drop: true,
    },
  );
  await expect(treeContainer(page)).not.toHaveAttribute("data-drop-into");
  await expect(page.getByText("Imported 1 note.")).toBeVisible();
  await expect(row(page, ["Loose"])).toBeVisible();
});

test("a dropped file named like an existing note gets a free name", async ({
  page,
}) => {
  await dragFiles(
    treeContainer(page),
    [{ name: "Welcome.md", text: "Again\n" }],
    {
      drop: true,
    },
  );
  await expect(page.getByText("Imported 1 note.")).toBeVisible();
  await expect(treeItem(page, "Welcome (2)")).toBeVisible();
  await expect(treeItem(page, "Welcome")).toBeVisible();
});

test("unsupported dropped files are skipped and reported", async ({ page }) => {
  await dragFiles(
    treeContainer(page),
    [
      { name: "Plain.txt", text: "Plain\n" },
      { name: "photo.png", text: "not a note" },
      { name: "broken.md", bytes: [0xff, 0xfe, 0xfd] },
      { name: "big.md", repeatBytes: 1024 * 1024 + 1 },
    ],
    { drop: true },
  );
  await expect(
    page.getByText(
      "Imported 1 note. Skipped 3 files: 1 not .md, .markdown or .txt, 1 not UTF-8 text, 1 over 1 MiB.",
    ),
  ).toBeVisible();
  await expect(treeItem(page, "Plain")).toBeVisible();
  await expect(treeItem(page, "broken")).toHaveCount(0);
  await expect(treeItem(page, "big")).toHaveCount(0);
});

test("a drop without any note file imports nothing", async ({ page }) => {
  const before = await fakeForge(page).commitCount();
  await dragFiles(
    treeContainer(page),
    [{ name: "photo.png", text: "not a note" }],
    {
      drop: true,
    },
  );
  await expect(
    page.getByText(
      "No notes imported. Skipped 1 file: 1 not .md, .markdown or .txt.",
    ),
  ).toBeVisible();
  expect(await fakeForge(page).commitCount()).toBe(before);
});

test("undo moves the dropped notes to the trash", async ({ page }) => {
  await dragFiles(treeContainer(page), TWO_NOTES, { drop: true });
  await expect(page.getByText("Imported 2 notes.")).toBeVisible();
  await expect(treeItem(page, "Alpha")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("2 notes moved to trash")).toBeVisible();
  await expect(treeItem(page, "Alpha")).toHaveCount(0);
  await expect(treeItem(page, "Beta")).toHaveCount(0);
  await expect(treeItem(page, "Welcome")).toBeVisible();
});

async function shareFromRowMenu(page: Page, name: string): Promise<void> {
  await treeItem(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Share…" }).click();
  const dialog = page.getByRole("dialog", { name: `Share “${name}”` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog.getByRole("textbox", { name: "Share link" })).toBeVisible(
    { timeout: KEY_DERIVATION_TIMEOUT },
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

test("undo keeps a shared dropped note and trashes the rest", async ({
  page,
}) => {
  await dragFiles(treeContainer(page), TWO_NOTES, { drop: true });
  await expect(page.getByText("Imported 2 notes.")).toBeVisible();
  await shareFromRowMenu(page, "Alpha");
  await expect(treeItem(page, "Alpha")).toHaveAccessibleDescription(/Shared/);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(
    page.getByText("1 note moved to trash. 1 shared note kept."),
  ).toBeVisible();
  await expect(treeItem(page, "Beta")).toHaveCount(0);
  await expect(treeItem(page, "Alpha")).toBeVisible();
  await expect(treeItem(page, "Alpha")).toHaveAccessibleDescription(/Shared/);
});

test("a drag without files is ignored", async ({ page }) => {
  const before = await fakeForge(page).commitCount();
  await dragFiles(row(page, ["Projects"]), [], { textOnly: true });
  await expect(page.locator("[data-drop-into]")).toHaveCount(0);

  await dragFiles(treeContainer(page), [], { textOnly: true, drop: true });
  await expect(page.locator("[data-drop-into]")).toHaveCount(0);
  await expect(page.getByText(/^Imported|^No notes imported/)).toHaveCount(0);
  expect(await fakeForge(page).commitCount()).toBe(before);
});

test("a successful drop clears the tag filter", async ({ page }) => {
  const purple = page.getByRole("button", {
    name: "Filter by Purple tag",
    exact: true,
  });
  await purple.click();
  await expect(purple).toHaveAttribute("aria-pressed", "true");
  await expect(treeItem(page, "Welcome")).toHaveCount(0);

  await dragFiles(
    treeContainer(page),
    [{ name: "Fresh.md", text: "Fresh\n" }],
    {
      drop: true,
    },
  );
  await expect(page.getByText("Imported 1 note.")).toBeVisible();
  await expect(purple).toHaveAttribute("aria-pressed", "false");
  await expect(treeItem(page, "Welcome")).toBeVisible();
  await expect(treeItem(page, "Fresh")).toBeVisible();
});
