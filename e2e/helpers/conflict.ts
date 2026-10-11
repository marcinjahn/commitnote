import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { fakeForge, openNotes } from "../helpers";
import { headerSyncIcon } from "./tree";

const CONFLICT = "Out of sync: conflict, needs your decision";

const WELCOME_TAIL = [
  "",
  "This is your **notes** repo, encrypted end to end. Some *emphasis*, ~~strikethrough~~, and `inline code`.",
  "",
  "```js",
  'console.log("hello");',
  "```",
  "",
  "See the [commitnote project](https://github.com/example/commitnote) for details.",
  "",
  "> Notes stay private even to the forge that hosts them.",
  "",
  "- First bullet",
  "- Second bullet",
  "",
  "1. First step",
  "2. Second step",
  "",
  "- [x] Done task",
  "- [ ] Open task",
  "",
  "| Column A | Column B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
];

function welcomeWithHeading(heading: string): string {
  return [heading, ...WELCOME_TAIL].join("\n");
}

export async function openNote(page: Page, path: readonly string[]): Promise<void> {
  for (const [index, name] of path.entries()) {
    const item = page.getByRole("treeitem", { name, exact: true });
    const isNote = index === path.length - 1;
    if (isNote || (await item.getAttribute("aria-expanded")) !== "true") {
      await item.click();
    }
  }
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toBeVisible();
}

export async function editRemotely(
  page: Page,
  notePath: readonly string[],
  markdown: string,
): Promise<void> {
  await fakeForge(page).editNote(notePath, markdown);
}

export async function startConflictOnWelcome(page: Page): Promise<void> {
  await openNotes(page);
  await openNote(page, ["Welcome"]);

  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.type("# Welcome from here");
  await editRemotely(
    page,
    ["Welcome"],
    welcomeWithHeading("# Welcome from elsewhere"),
  );

  await expect(headerSyncIcon(page)).toHaveAccessibleName(CONFLICT, {
    timeout: 10_000,
  });
  await expect(
    page.getByText(
      /was changed on another device too\. Open it to resolve the conflict\./,
    ),
  ).toBeVisible();
  const region = page.getByRole("region", { name: "Conflict" });
  await expect(region).toBeVisible();
  await expect(
    region.getByText("This note was changed on another device too"),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Merged text" }),
  ).toContainText("<<<<<<< This device");

  const tree = page.getByRole("tree", { name: "Notes" });
  await expect(tree.getByRole("treeitem", { name: "Welcome" })).toHaveAccessibleDescription(
    new RegExp(CONFLICT),
  );
  await expect(tree.getByRole("img")).toHaveCount(0);
}
