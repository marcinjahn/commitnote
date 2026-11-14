import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { SAMPLE, expectTree, openNotes, settleIdle } from "./helpers";
import { emulateStandalone } from "./helpers/install";
import { createLink } from "./helpers/sharing";
import { treeItem } from "./helpers/tree";

const ORIGIN = "https://analytics.invalid/count";
const LANDING = `${ORIGIN}?p=%2Flanding%2Fweb&t=Landing%20(web)`;
const APP_WEB = `${ORIGIN}?p=%2Fapp%2Fweb&t=App%20(web)`;
const APP_PWA = `${ORIGIN}?p=%2Fapp%2Fpwa&t=App%20(PWA)`;
const SESSION = "fake-forge-session=" + encodeURIComponent(SAMPLE.repo);

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
  await expectCount(analyticsRequests, 0);

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
  await expectCount(analyticsRequests, 0);

  await page.clock.install();
  await page.goto("/");
  await flushVisits(page);
  await expectCount(analyticsRequests, 0);
});
