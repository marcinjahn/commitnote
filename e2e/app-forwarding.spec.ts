import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import {
  KEY_DERIVATION_TIMEOUT,
  SAMPLE,
  expectTree,
  openNotes,
} from "./helpers";
import { emulateStandalone } from "./helpers/install";
import { createLink } from "./helpers/sharing";
import { treeItem } from "./helpers/tree";

const HEADING = "Encrypted markdown notes in your own git repository.";
const SESSION = "fake-forge-session=" + encodeURIComponent(SAMPLE.repo);

function landingHeading(page: Page) {
  return page.getByRole("heading", { level: 1, name: HEADING });
}

async function expectApp(page: Page): Promise<URL> {
  await expect.poll(() => new URL(page.url()).pathname).toBe("/app/");
  return new URL(page.url());
}

async function expectLanding(page: Page, path: string): Promise<void> {
  await expect(landingHeading(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
  const url = new URL(page.url());
  expect(url.pathname + url.search + url.hash).toBe(path);
}

test("a pre-move share link forwards to the viewer without a back loop", async ({
  page,
}) => {
  await openNotes(page);
  await treeItem(page, "Welcome").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Share…" }).click();
  const link = new URL(await createLink(page));
  expect(link.pathname).toBe("/app/");
  const preMove = new URL(link);
  preMove.pathname = "/";

  const viewer = await page.context().newPage();
  await viewer.goto(preMove.href);
  expect((await expectApp(viewer)).hash).toBe(link.hash);
  await expect(
    viewer.getByRole("heading", { name: "Welcome", level: 1 }).first(),
  ).toBeVisible();
  await expect(viewer).toHaveTitle("Shared note · commitnote");

  const browsing = await page.context().newPage();
  await browsing.goto("/?from=e2e");
  await expect(landingHeading(browsing)).toBeVisible();
  await browsing.goto("/" + link.hash);
  expect((await expectApp(browsing)).hash).toBe(link.hash);

  await browsing.goBack();
  await expectLanding(browsing, "/?from=e2e");
});

test("a note fragment forwards to the app", async ({ page }) => {
  const committed: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) committed.push(frame.url());
  });

  await page.goto("/#n=AAAA");

  await expectApp(page);
  await expect(page.getByLabel("Access token")).toBeVisible();
  expect(committed.map((url) => new URL(url).pathname + new URL(url).hash)).toContain(
    "/app/#n=AAAA",
  );
});

test("the new-note launch action forwards and opens a draft", async ({
  page,
}) => {
  await page.goto(`/?${SESSION}&action=new-note`);

  await expect(page.getByRole("textbox", { name: "Note name" })).toBeFocused({
    timeout: KEY_DERIVATION_TIMEOUT,
  });
  await expectApp(page);
  await expect.poll(() => new URL(page.url()).search).toBe("");
});

test("the search launch action forwards and opens search", async ({ page }) => {
  await page.goto(`/?${SESSION}&action=search`);

  await expectTree(page);
  await expect(
    page.getByRole("dialog", { name: "Search notes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Search notes" }),
  ).toBeFocused();
  await expectApp(page);
  await expect.poll(() => new URL(page.url()).search).toBe("");
});

test("the installed app forwards from the site root", async ({ page }) => {
  await emulateStandalone(page);

  await page.goto("/");

  await expectApp(page);
  await expect(page.getByLabel("Access token")).toBeVisible();
});

test("the landing page's own addresses are not forwarded", async ({ page }) => {
  for (const path of ["/", "/#how-it-works", "/?fake-forge-session=x"]) {
    await page.goto("about:blank");
    await page.goto(path);
    await expectLanding(page, path);
  }
});
