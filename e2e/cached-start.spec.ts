import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  fakeForge,
  flushPendingSaves,
  holdOnLoad,
  onFakeForgeReady,
  openNotes,
  SAMPLE,
  waitForCachedTree,
} from "./helpers";
import { editRemotely, openNote } from "./helpers/conflict";
import { closeSettings, openSettings } from "./helpers/settings";
import { headerSyncIcon } from "./helpers/tree";

const IDEAS = ["Projects", "commitnote", "Ideas"] as const;

const IDEAS_MARKDOWN = [
  "# Ideas",
  "",
  "- Add offline sync",
  "- Support multiple repos",
  "",
].join("\n");

function editor(page: Page) {
  return page.getByRole("textbox", { name: "Note editor" });
}

/** Leaves Ideas as the last view and the tree kept, then starts again with the forge's head held. */
async function restartFromCacheWithHeadHeld(page: Page): Promise<void> {
  await openNotes(page);
  const dialog = await openSettings(page);
  await dialog
    .getByRole("checkbox", {
      name: "Reopen the last note and folders",
      exact: true,
    })
    .check();
  await closeSettings(page);
  await openNote(page, IDEAS);
  await waitForCachedTree(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) =>
          k.startsWith("commitnote.lastView."),
        );
        const raw = key === undefined ? null : localStorage.getItem(key);
        return raw === null
          ? null
          : (JSON.parse(raw) as { note: unknown }).note;
      }),
    )
    .not.toBeNull();

  await holdOnLoad(page, "getHead");
  await page.goto("./");
  await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
    "Ideas",
  );
  await expect(editor(page)).toContainText("Support multiple repos");
}

async function typeLocalLineAtTop(page: Page): Promise<void> {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("Local line");
  await page.keyboard.press("Enter");
}

async function expectMergedAndSaved(
  page: Page,
  openSecondDevice: () => Promise<{ page: Page }>,
): Promise<void> {
  await flushPendingSaves(page);
  await expect(headerSyncIcon(page)).toHaveCount(0, { timeout: 10_000 });
  await expect(editor(page)).toContainText("Local line");
  await expect(editor(page)).toContainText("Remote line");
  await expect(page.getByText(/Open it to resolve the conflict/)).toHaveCount(
    0,
  );

  const second = await openSecondDevice();
  await onFakeForgeReady(
    second.page,
    (controls, arg) => controls.adoptRepo(arg.key, arg.exported),
    { key: SAMPLE.key, exported: await fakeForge(page).exportRepo() },
  );
  await openNotes(second.page);
  await openNote(second.page, IDEAS);
  await expect(editor(second.page)).toContainText("Local line");
  await expect(editor(second.page)).toContainText("Remote line");
}

test("shows the kept tree and last note while the forge has not answered", async ({
  page,
}) => {
  await restartFromCacheWithHeadHeld(page);

  await expect(page.getByText("Loading…")).toHaveCount(0);
  await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible();

  await editRemotely(page, IDEAS, `${IDEAS_MARKDOWN}\nRemote line`);
  await fakeForge(page).release("getHead");
  await expect(editor(page)).toContainText("Remote line");
});

test("an edit made before the refresh merges with the newer remote version", async ({
  page,
  openSecondDevice,
}) => {
  await restartFromCacheWithHeadHeld(page);
  await editRemotely(page, IDEAS, `${IDEAS_MARKDOWN}\nRemote line`);

  await typeLocalLineAtTop(page);
  await fakeForge(page).release("getHead");

  await expectMergedAndSaved(page, openSecondDevice);
});

test("a refresh landing while typing keeps the typed text", async ({
  page,
  openSecondDevice,
}) => {
  await restartFromCacheWithHeadHeld(page);
  await editRemotely(page, IDEAS, `${IDEAS_MARKDOWN}\nRemote line`);

  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("Local ");
  await fakeForge(page).release("getHead");
  await expect(editor(page)).toContainText("Remote line");
  await page.keyboard.type("line");
  await page.keyboard.press("Enter");

  await expectMergedAndSaved(page, openSecondDevice);
});

test("a save racing the refresh merges with the newer remote version", async ({
  page,
  openSecondDevice,
}) => {
  await restartFromCacheWithHeadHeld(page);
  await editRemotely(page, IDEAS, `${IDEAS_MARKDOWN}\nRemote line`);
  const forge = fakeForge(page);
  await forge.hold("commit");

  await typeLocalLineAtTop(page);
  await flushPendingSaves(page);
  await expect(headerSyncIcon(page)).toBeVisible();
  await forge.release("getHead");
  await forge.release("commit");

  await expectMergedAndSaved(page, openSecondDevice);
});

test("a start that cannot reach the forge shows the kept notes and says so", async ({
  page,
}) => {
  await openNotes(page);
  await waitForCachedTree(page);
  await onFakeForgeReady(
    page,
    (controls, key) => controls.failNext(key, "getHead", "Network"),
    SAMPLE.key,
  );

  await page.goto("./");

  await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible();
  await expect(
    page.getByText("Could not reach GitHub. Showing the last loaded notes."),
  ).toBeVisible();
});
