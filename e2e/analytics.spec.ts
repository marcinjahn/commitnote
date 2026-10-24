import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { SAMPLE, expectTree, openNotes } from "./helpers";
import { emulateStandalone } from "./helpers/install";
import { closeSettings, openSettings } from "./helpers/settings";
import { createLink } from "./helpers/sharing";
import { treeItem } from "./helpers/tree";

const ORIGIN = "https://analytics.invalid/count";
const LANDING = `${ORIGIN}?p=%2Flanding%2Fweb&t=Landing%20(web)`;
const APP_WEB = `${ORIGIN}?p=%2Fapp%2Fweb&t=App%20(web)`;
const APP_PWA = `${ORIGIN}?p=%2Fapp%2Fpwa&t=App%20(PWA)`;
const SESSION = "fake-forge-session=" + encodeURIComponent(SAMPLE.repo);
const OPT_OUT_LABEL = "Anonymous usage statistics";

function settleIdle(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestIdleCallback(() => setTimeout(resolve, 0), { timeout: 10_000 }),
      ),
  );
}

async function flushVisits(page: Page): Promise<void> {
  await page.clock.runFor(10_000);
}

async function overrideNavigator(
  page: Page,
  property: "doNotTrack" | "globalPrivacyControl",
): Promise<void> {
  await page.addInitScript((name) => {
    Object.defineProperty(Navigator.prototype, name, {
      get: () => (name === "doNotTrack" ? "1" : true),
      configurable: true,
    });
  }, property);
}

function expectUrls(
  requests: { url(): string }[],
  expected: string[],
): Promise<void> {
  return expect.poll(() => urls(requests)).toEqual(expected);
}

function expectCount(requests: unknown[], count: number): Promise<void> {
  return expect.poll(() => requests.length).toBe(count);
}

function urls(requests: { url(): string }[]): string[] {
  return requests.map((request) => request.url());
}

test("the landing page sends one bare visit", async ({
  page,
  analyticsRequests,
}) => {
  await page.clock.install();
  await page.goto("/");
  await flushVisits(page);

  await expectUrls(analyticsRequests, [LANDING]);
  const request = analyticsRequests[0];
  expect(request.method()).toBe("GET");
  expect(request.postData()).toBeNull();
  const headers = await request.allHeaders();
  expect(headers).not.toHaveProperty("referer");
  expect(headers).not.toHaveProperty("cookie");
});

test("the app counts loads and launch actions but not hash navigation", async ({
  page,
  analyticsRequests,
}) => {
  await openNotes(page);
  await settleIdle(page);
  await expectUrls(analyticsRequests, [APP_WEB]);

  await treeItem(page, "Welcome").click();
  await expect.poll(() => new URL(page.url()).hash).toContain("n=");
  await settleIdle(page);
  await expectUrls(analyticsRequests, [APP_WEB]);

  await page.reload();
  await expectTree(page);
  await settleIdle(page);
  await expectUrls(analyticsRequests, [APP_WEB, APP_WEB]);

  await page.goto(`./?${SESSION}&action=new-note`);
  await expectTree(page);
  await settleIdle(page);
  await expectUrls(analyticsRequests, [APP_WEB, APP_WEB, APP_WEB]);
});

test("the installed app is counted as the PWA", async ({
  page,
  analyticsRequests,
}) => {
  await emulateStandalone(page);
  await page.goto("./");
  await expect(page.getByLabel("Access token")).toBeVisible();
  await settleIdle(page);

  await expectUrls(analyticsRequests, [APP_PWA]);
});

test("opening a share link counts the viewer without the link", async ({
  page,
  analyticsRequests,
}) => {
  await openNotes(page);
  await treeItem(page, "Welcome").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Share…" }).click();
  const link = await createLink(page);
  await page.keyboard.press("Escape");
  await settleIdle(page);
  const before = analyticsRequests.length;

  const viewer = await page.context().newPage();
  await viewer.goto(link);
  await expect(viewer).toHaveTitle("Shared note · commitnote");
  await settleIdle(viewer);

  await expectCount(analyticsRequests, before + 1);
  expect(analyticsRequests.at(-1)!.url()).toBe(APP_WEB);
  for (const url of urls(analyticsRequests)) {
    expect(url).not.toContain("share");
    expect(url).not.toContain("#");
  }
});

test("Do Not Track suppresses every visit", async ({
  page,
  analyticsRequests,
}) => {
  await overrideNavigator(page, "doNotTrack");
  await openNotes(page);
  await settleIdle(page);
  const dialog = await openSettings(page);
  await expect(
    dialog.getByRole("checkbox", { name: OPT_OUT_LABEL }),
  ).toBeDisabled();
  await closeSettings(page);

  await page.clock.install();
  await page.goto("/");
  await flushVisits(page);
  await expectCount(analyticsRequests, 0);
});

test("Global Privacy Control suppresses every visit", async ({
  page,
  analyticsRequests,
}) => {
  await overrideNavigator(page, "globalPrivacyControl");
  await openNotes(page);
  await settleIdle(page);
  const dialog = await openSettings(page);
  await expect(
    dialog.getByRole("checkbox", { name: OPT_OUT_LABEL }),
  ).toBeDisabled();
  await closeSettings(page);

  await page.clock.install();
  await page.goto("/");
  await flushVisits(page);
  await expectCount(analyticsRequests, 0);
});

test("opting out in Settings stops counting everywhere until opting back in", async ({
  page,
  analyticsRequests,
}) => {
  await openNotes(page);
  await settleIdle(page);
  await expectCount(analyticsRequests, 1);

  const dialog = await openSettings(page);
  await dialog.getByLabel(OPT_OUT_LABEL).uncheck();
  await closeSettings(page);
  await page.reload();
  await expectTree(page);
  await settleIdle(page);
  await expectCount(analyticsRequests, 1);

  await page.goto("/");
  await settleIdle(page);
  await expectCount(analyticsRequests, 1);

  await openNotes(page);
  const again = await openSettings(page);
  await again.getByLabel(OPT_OUT_LABEL).check();
  await closeSettings(page);
  await page.reload();
  await expectTree(page);
  await settleIdle(page);
  await expectCount(analyticsRequests, 2);
});

test("opting out on the landing page stops counting everywhere until opting back in", async ({
  page,
  analyticsRequests,
}) => {
  await page.clock.install();
  await page.goto("/");
  await flushVisits(page);
  await expectCount(analyticsRequests, 1);

  await page
    .getByRole("button", { name: "Don't count my visits in this browser" })
    .click();
  await expect(page.locator("#analytics-status")).toHaveText(
    "Your visits in this browser are not counted.",
  );
  await page.reload();
  await flushVisits(page);
  await expectCount(analyticsRequests, 1);

  await openNotes(page);
  await flushVisits(page);
  await expectCount(analyticsRequests, 1);

  await page.goto("/");
  await page.getByRole("button", { name: "Count my visits again" }).click();
  await page.reload();
  await flushVisits(page);
  await expectCount(analyticsRequests, 2);
});
