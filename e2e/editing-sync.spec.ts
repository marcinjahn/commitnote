import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { logIn, expectTree, rowSyncState, SAMPLE, openNotes, logOut, showTree } from "./helpers";



const WAITING = "Out of sync: waiting to save";
const FAILED = "Out of sync: saving failed, will retry";
const CONFLICT = "Out of sync: conflict, needs your decision";

const CONFLICT_KEEP_THEIRS_LABEL = "Keep theirs";
const CONFLICT_EDIT_MERGED_LABEL = "Edit merged";

const IDEAS_MARKDOWN = [
  "# Ideas",
  "",
  "- Add offline sync",
  "- Support multiple repos",
  "",
].join("\n");

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

function headerIcon(page: Page) {
  return page.locator("header.note-header").getByRole("img");
}

async function openNote(page: Page, path: readonly string[]): Promise<void> {
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

async function recordHeaderIconLabels(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __iconLabels: string[] }).__iconLabels = seen;
    const record = () => {
      const label =
        document
          .querySelector("header.note-header [role='img']")
          ?.getAttribute("aria-label") ?? "(no status)";
      if (seen[seen.length - 1] !== label) seen.push(label);
    };
    record();
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-label"],
    });
  });
}

async function recordedHeaderIconLabels(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __iconLabels: string[] }).__iconLabels,
  );
}

async function editRemotely(
  page: Page,
  notePath: readonly string[],
  markdown: string,
): Promise<void> {
  await page.evaluate(
    ([repoKey, path, text]) =>
      (window as any).__commitNoteFakeForge.editNote(repoKey, path, text),
    [SAMPLE.key, notePath, markdown] as const,
  );
}

async function createNoteThroughRowMenu(
  page: Page,
  folderName: string,
  noteName: string,
): Promise<void> {
  await page.getByRole("button", { name: `Actions for ${folderName}` }).click();
  await page.getByRole("menuitem", { name: "New note…" }).click();
  const nameField = page.getByRole("textbox", { name: "Note name" });
  await nameField.fill(noteName);
  await nameField.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toBeVisible();
}

async function startConflictOnWelcome(page: Page): Promise<void> {
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

  await expect(headerIcon(page)).toHaveAccessibleName(CONFLICT, {
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
  ).toContainText("<<<<<<< mine");
}

test.describe("with GitHub-like forge latency", () => {
  test.use({ forgeLatency: "github" });

  test("creating a folder and a note walks through the sync states and survives logging out", async ({
    page,
  }) => {
    await openNotes(page);

    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByLabel("Folder name").fill("Work");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("treeitem", { name: "Work" })).toBeVisible();

    await createNoteThroughRowMenu(page, "Work", "Plan");
    await expect(headerIcon(page)).toHaveCount(0, {
      timeout: 10_000,
    });

    await page.evaluate(
      (repoKey) =>
        (window as any).__commitNoteFakeForge.failNext(
          repoKey,
          "commit",
          "Network",
        ),
      SAMPLE.key,
    );
    await recordHeaderIconLabels(page);

    const editor = page.getByRole("textbox", { name: "Note editor" });
    await editor.click();
    await page.keyboard.type("# Plan");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Ship the editing tests");

    await expect(headerIcon(page)).toHaveAccessibleName(WAITING);
    await expect(headerIcon(page)).toHaveAccessibleName(FAILED, {
      timeout: 10_000,
    });
    await expect(headerIcon(page)).toHaveCount(0, {
      timeout: 15_000,
    });

    const labels = await recordedHeaderIconLabels(page);
    const failedAt = labels.indexOf(FAILED);
    expect(labels.indexOf(WAITING)).toBeGreaterThanOrEqual(0);
    expect(failedAt).toBeGreaterThan(labels.indexOf(WAITING));
    expect(labels.lastIndexOf("Saving")).toBeGreaterThan(failedAt);
    expect(labels.at(-1)).toBe("(no status)");

    await showTree(page);
    await expect(rowSyncState(page, "Work", { exact: true })).toHaveCount(0);

    await logOut(page);
    await logIn(page, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
    await expectTree(page);

    await openNote(page, ["Work", "Plan"]);
    const reopened = page.getByRole("textbox", { name: "Note editor" });
    await expect(reopened).toContainText("Plan");
    await expect(reopened).toContainText("Ship the editing tests");
  });
});

test("renaming, moving and deleting notes and folders", async ({
  page,
}) => {
  await openNotes(page);

  await page.getByRole("treeitem", { name: "Welcome", exact: true }).click();
  const nameField = page.getByRole("textbox", { name: "Note name" });
  await nameField.fill("Hello");
  await nameField.press("Enter");
  await showTree(page);
  await expect(
    page.getByRole("treeitem", { name: "Welcome", exact: true }),
  ).toHaveCount(0);
  await expect(rowSyncState(page, "Hello", { exact: true })).toHaveCount(0, {
    timeout: 10_000,
  });

  await page.getByRole("button", { name: "Actions for Hello" }).click();
  await page.getByRole("menuitem", { name: "Move to folder…" }).click();
  await page
    .getByRole("radiogroup", { name: "Folder" })
    .getByRole("radio", { name: "Projects", exact: true })
    .check();
  await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();

  const hello = page.getByRole("treeitem", { name: "Hello", exact: true });
  if ((await hello.count()) === 0) {
    await page.getByRole("treeitem", { name: "Projects", exact: true }).click();
  }
  await expect(hello).toBeVisible();
  await expect(rowSyncState(page, "Hello", { exact: true })).toHaveCount(0, {
    timeout: 10_000,
  });

  await page.getByRole("button", { name: "Actions for Hello" }).click();
  await page.getByRole("menuitem", { name: "Move to trash…" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  await expect(hello).toHaveCount(0);
  await expect(
    page.getByRole("treeitem", { name: "Projects", exact: true }),
  ).toBeVisible();
  await expect(rowSyncState(page, "Projects", { exact: true })).toHaveCount(0, {
    timeout: 10_000,
  });

  await page.getByRole("button", { name: "Actions for Journal" }).click();
  await page.getByRole("menuitem", { name: "Move to trash…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/and everything in it/)).toBeVisible();
  await dialog.getByRole("button", { name: "Move to trash", exact: true }).click();
  await expect(
    page.getByRole("treeitem", { name: "Journal", exact: true }),
  ).toHaveCount(0);
  await expect(rowSyncState(page, "Empty folder", { exact: true })).toHaveCount(0, {
    timeout: 10_000,
  });
});

test("a concurrent remote edit at the end of a note merges cleanly", async ({
  page,
}) => {
  await openNotes(page);
  await openNote(page, ["Projects", "commitnote", "Ideas"]);

  await editRemotely(
    page,
    ["Projects", "commitnote", "Ideas"],
    `${IDEAS_MARKDOWN}\nRemote line`,
  );

  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("Local line");
  await page.keyboard.press("Enter");

  await expect(headerIcon(page)).toBeVisible();
  await expect(headerIcon(page)).toHaveCount(0, {
    timeout: 10_000,
  });

  const note = page.getByRole("textbox", { name: "Note editor" });
  await expect(note).toContainText("Local line");
  await expect(note).toContainText("Remote line");
  await expect(page.getByText(/Open it to resolve the conflict/)).toHaveCount(
    0,
  );
});

test("a conflict is resolved by editing the merged text", async ({ page }) => {
  await startConflictOnWelcome(page);

  const region = page.getByRole("region", { name: "Conflict" });
  await region
    .getByRole("button", { name: CONFLICT_EDIT_MERGED_LABEL })
    .click();

  const editor = page.getByRole("textbox", { name: "Note editor" });
  await expect(editor).toBeVisible();
  await expect(
    page.getByRole("status").getByText(/conflict marker/),
  ).toBeVisible();

  await editor.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Delete");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  for (let line = 0; line < 3; line += 1) {
    await page.keyboard.press("Shift+ArrowDown");
  }
  await page.keyboard.press("Delete");

  await expect(headerIcon(page)).toHaveAccessibleName(WAITING);
  await expect(headerIcon(page)).toHaveCount(0, {
    timeout: 10_000,
  });

  await expect(page.getByRole("region", { name: "Conflict" })).toHaveCount(0);
  const note = page.getByRole("textbox", { name: "Note editor" });
  await expect(note).toContainText("Welcome from here");
  await expect(note).not.toContainText("Welcome from elsewhere");
});

test("a conflict is resolved by keeping theirs", async ({ page }) => {
  await startConflictOnWelcome(page);

  await page
    .getByRole("region", { name: "Conflict" })
    .getByRole("button", { name: CONFLICT_KEEP_THEIRS_LABEL })
    .click();

  await expect(headerIcon(page)).toHaveCount(0, {
    timeout: 10_000,
  });
  const note = page.getByRole("textbox", { name: "Note editor" });
  await expect(note).toContainText("Welcome from elsewhere");
  await expect(note).not.toContainText("Welcome from here");
});
