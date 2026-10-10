import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { KEY_DERIVATION_TIMEOUT, SAMPLE, expectTree, logIn, openNotes } from "./helpers";
import { emulateStandalone } from "./helpers/install";
import { createLink } from "./helpers/sharing";
import { openSettings } from "./helpers/settings";
import { treeItem } from "./helpers/tree";

const SESSION = "fake-forge-session=" + encodeURIComponent(SAMPLE.repo);

type LaunchWindow = {
  __launchConsumer?: (params: { targetURL: string }) => void;
};

function nameField(page: Page) {
  return page.getByRole("textbox", { name: "Note name" });
}

function searchPalette(page: Page) {
  return page.getByRole("dialog", { name: "Search notes" });
}

function searchInput(page: Page) {
  return page.getByRole("combobox", { name: "Search notes" });
}

async function stubLaunchQueue(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      value: {
        setConsumer(fn: LaunchWindow["__launchConsumer"]) {
          (window as unknown as LaunchWindow).__launchConsumer = fn;
        },
      },
    });
  });
}

async function relaunch(page: Page, path: string): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as LaunchWindow).__launchConsumer !== undefined,
  );
  await page.evaluate(
    (target) =>
      (window as unknown as LaunchWindow).__launchConsumer!({
        targetURL: location.origin + target,
      }),
    path,
  );
}

async function expectCleanAddress(page: Page): Promise<void> {
  await expect.poll(() => new URL(page.url()).search).toBe("");
}

test(
  "new-note in the start URL opens a draft after auto-login",
  { tag: "@mobile" },
  async ({ page }) => {
    await page.goto(`/?${SESSION}&action=new-note`);

    await expect(nameField(page)).toBeFocused({
      timeout: KEY_DERIVATION_TIMEOUT,
    });
    await expectCleanAddress(page);
  },
);

test(
  "search in the start URL opens the palette after auto-login",
  { tag: "@mobile" },
  async ({ page }) => {
    await page.goto(`/?${SESSION}&action=search`);
    await expectTree(page);

    await expect(searchPalette(page)).toBeVisible();
    await expect(searchInput(page)).toBeFocused();
    await expectCleanAddress(page);
  },
);

test("an action is held through the login", async ({ page }) => {
  await page.goto("/?action=new-note");
  await expect(page.getByLabel("Access token")).toBeVisible();
  await expectCleanAddress(page);

  await logIn(page, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
  await expectTree(page);

  await expect(nameField(page)).toBeFocused();
});

test.describe("in the installed app", () => {
  test("new-note opens a draft", async ({ page }) => {
    await emulateStandalone(page);
    await page.goto(`/?${SESSION}&action=new-note`);

    await expect(nameField(page)).toBeFocused({
      timeout: KEY_DERIVATION_TIMEOUT,
    });
    await expectCleanAddress(page);
  });

  test("new-note is held through the login", async ({ page }) => {
    await emulateStandalone(page);
    await page.goto("/?action=new-note");
    await expect(page.getByLabel("Access token")).toBeVisible();
    await expect(page.getByText("Remember me")).toHaveCount(0);

    await logIn(page, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
    await expectTree(page);

    await expect(nameField(page)).toBeFocused();
  });
});

test("an unknown action is removed and ignored", async ({ page }) => {
  await page.goto(`/?${SESSION}&action=bogus`);
  await expectTree(page);

  await expectCleanAddress(page);
  await expect(nameField(page)).toHaveCount(0);
  await expect(searchPalette(page)).toHaveCount(0);
});

test("other parameters and the hash stay when the action is removed", async ({
  page,
}) => {
  await page.goto(`/?${SESSION}&action=bogus&keep=1#top`);
  await expectTree(page);

  await expect
    .poll(() => new URL(page.url()).searchParams.has("action"))
    .toBe(false);
  const url = new URL(page.url());
  expect(url.searchParams.get("keep")).toBe("1");
  expect(url.hash).toBe("#top");
});

test("a relaunch runs search, then new note", async ({ page }) => {
  await stubLaunchQueue(page);
  await openNotes(page);

  await relaunch(page, "/?action=search");
  await expect(searchPalette(page)).toBeVisible();
  await expect(searchInput(page)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(searchPalette(page)).toHaveCount(0);

  await relaunch(page, "/?action=new-note");
  await expect(nameField(page)).toBeFocused();
});

test("a relaunch on the login screen is held through the login", async ({
  page,
}) => {
  await stubLaunchQueue(page);
  await page.goto("/");
  await expect(page.getByLabel("Access token")).toBeVisible();

  await relaunch(page, "/?action=search");
  await logIn(page, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
  await expectTree(page);

  await expect(searchPalette(page)).toBeVisible();
  await expect(searchInput(page)).toBeFocused();
});

test("an action arriving while a dialog is open is dropped", async ({
  page,
}) => {
  await stubLaunchQueue(page);
  await openNotes(page);
  const settings = await openSettings(page);

  await relaunch(page, "/?action=search");

  await expect(searchPalette(page)).toHaveCount(0);
  await expect(settings).toBeVisible();
});

test("the shared note viewer ignores launch actions", async ({ page }) => {
  await openNotes(page);
  await treeItem(page, "Welcome").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Share…" }).click();
  const link = await createLink(page);

  const viewer = await page.context().newPage();
  await viewer.goto(link.replace("#", "?action=search#"));

  await expect(
    viewer.getByRole("heading", { name: "Welcome", level: 1 }).first(),
  ).toBeVisible();
  await expect(searchPalette(viewer)).toHaveCount(0);
});

test("the manifest advertises the launch actions", async ({ page }) => {
  const response = await page.request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();

  expect(
    manifest.shortcuts.map((s: { name: string; url: string }) => [
      s.name,
      s.url,
    ]),
  ).toEqual([
    ["New note", "./?action=new-note"],
    ["Search notes", "./?action=search"],
  ]);
  expect(manifest.note_taking).toEqual({ new_note_url: "./?action=new-note" });
  expect(manifest.launch_handler).toEqual({ client_mode: "focus-existing" });

  for (const shortcut of manifest.shortcuts) {
    const icon = await page.request.get(
      new URL(shortcut.icons[0].src, response.url()).href,
    );
    expect(icon.status()).toBe(200);
    expect(icon.headers()["content-type"]).toContain("image/png");
  }
});
