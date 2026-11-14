import type { Locator, Page } from "@playwright/test";
import { test, expect, FAKE_ANALYTICS_ORIGIN } from "./fixtures";
import { KEY_DERIVATION_TIMEOUT, openNotes, settleIdle } from "./helpers";
import { openRecipientViewer, shareInvite, shareNote } from "./helpers/sharing";

const NOTE_TEXT = "Notes stay private even to the forge that hosts them.";
const INVITE_TEXT =
  "Shared with commitnote: end-to-end encrypted notes kept in your own GitHub or GitLab repository.";

function noteHeading(viewer: Page, name = "Welcome"): Locator {
  return viewer.getByRole("heading", { name, level: 1 }).first();
}

async function expectOutline(locator: Locator): Promise<void> {
  await expect
    .poll(() => locator.evaluate((el) => getComputedStyle(el).outlineStyle))
    .not.toBe("none");
}

test("a recipient sees the share invite after the note, and it sends nothing", async ({
  page,
  analyticsRequests,
}) => {
  await openNotes(page);
  const link = await shareNote(page);
  const urls: string[] = [];
  page.context().on("request", (request) => urls.push(request.url()));
  const before = analyticsRequests.length;

  const viewer = await openRecipientViewer(page, link);
  await expect(noteHeading(viewer)).toBeVisible();
  await expect(viewer.getByText(NOTE_TEXT)).toBeVisible();

  const invite = shareInvite(viewer);
  await expect(invite).toBeVisible();
  await expect(invite).toContainText(INVITE_TEXT);
  const tryLink = invite.getByRole("link", { name: "Try commitnote yourself" });
  await expect(tryLink).toHaveAttribute("href", "https://commitnote.eu/");
  await expect(tryLink).toHaveAttribute("target", "_blank");
  await expect(tryLink).toHaveAttribute("rel", "noopener noreferrer");
  await expect(invite.getByRole("button", { name: "No thanks" })).toBeVisible();

  const order = await viewer.getByRole("main").evaluate(
    (main, [aside, footer]) => ({
      inviteAfterMain: Boolean(
        main.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      footerAfterInvite: Boolean(
        aside.compareDocumentPosition(footer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    }),
    await Promise.all([
      invite.elementHandle(),
      viewer.getByRole("contentinfo").elementHandle(),
    ]),
  );
  expect(order).toEqual({ inviteAfterMain: true, footerAfterInvite: true });

  const hiddenInPrint = viewer.getByRole("complementary", {
    name: "About commitnote",
    includeHidden: true,
  });
  await viewer.emulateMedia({ media: "print" });
  await expect(hiddenInPrint).toHaveCount(1);
  await expect(hiddenInPrint).toBeHidden();
  await viewer.emulateMedia({ media: "screen" });
  await expect(invite).toBeVisible();

  await settleIdle(viewer);
  await expect.poll(() => analyticsRequests.length).toBe(before + 1);
  const viewerOrigin = new URL(viewer.url()).origin;
  const web = urls.filter((url) => /^https?:/.test(url));
  expect(web.length).toBeGreaterThan(0);
  for (const url of web) {
    expect(
      url.startsWith(`${viewerOrigin}/`) ||
        url.startsWith(`${FAKE_ANALYTICS_ORIGIN}/`),
    ).toBe(true);
  }

  const requestsAfterDismiss: string[] = [];
  viewer.on("request", (request) => requestsAfterDismiss.push(request.url()));
  await invite.getByRole("button", { name: "No thanks" }).click();
  await settleIdle(viewer);
  await expect(invite).toHaveCount(0);
  expect(requestsAfterDismiss).toEqual([]);
});

test("a password-protected share shows the share invite only after unlocking", async ({
  page,
}) => {
  await openNotes(page);
  const link = await shareNote(page, { password: "open sesame" });

  const viewer = await openRecipientViewer(page, link);
  await expect(
    viewer.getByRole("heading", {
      name: "This note is protected with a password",
    }),
  ).toBeVisible();
  await expect(shareInvite(viewer)).toHaveCount(0);

  await viewer.getByRole("textbox", { name: "Password" }).fill("open sesame");
  await viewer.getByRole("button", { name: "Unlock" }).click();
  await expect(viewer.getByText(NOTE_TEXT)).toBeVisible({
    timeout: KEY_DERIVATION_TIMEOUT,
  });
  await expect(shareInvite(viewer)).toBeVisible();
});

test("No thanks hides the share invite for good on this device", async ({
  page,
}) => {
  await openNotes(page);
  const link = await shareNote(page);

  const viewer = await openRecipientViewer(page, link);
  const invite = shareInvite(viewer);
  await expect(invite).toBeVisible();

  const tryLink = invite.getByRole("link", { name: "Try commitnote yourself" });
  const dismiss = invite.getByRole("button", { name: "No thanks" });
  await tryLink.focus();
  await viewer.keyboard.press("Shift+Tab");
  await viewer.keyboard.press("Tab");
  await expect(tryLink).toBeFocused();
  await expectOutline(tryLink);
  await viewer.keyboard.press("Tab");
  await expect(dismiss).toBeFocused();
  await expectOutline(dismiss);

  await viewer.keyboard.press("Enter");
  await expect(invite).toHaveCount(0);
  await expect(viewer.getByRole("contentinfo")).toBeFocused();
  expect(
    await viewer.evaluate(() =>
      localStorage.getItem("commitnote.shareInviteDismissed"),
    ),
  ).toBe("1");

  await viewer.reload();
  await expect(viewer.getByText(NOTE_TEXT)).toBeVisible();
  await expect(invite).toHaveCount(0);

  const other = "Zażółć gęślą jaźń";
  const otherLink = await shareNote(page, { note: other });
  const otherViewer = await openRecipientViewer(page, otherLink);
  await expect(noteHeading(otherViewer, other)).toBeVisible();
  await expect(shareInvite(otherViewer)).toHaveCount(0);
});

test(
  "the share invite fits a phone screen below the note",
  { tag: "@mobile-only" },
  async ({ page }) => {
    await openNotes(page);
    const link = await shareNote(page);

    const viewer = await openRecipientViewer(page, link);
    await expect(viewer.getByText(NOTE_TEXT)).toBeVisible();
    const invite = shareInvite(viewer);
    await invite.scrollIntoViewIfNeeded();
    await expect(invite).toBeVisible();

    const fitsWidth = () =>
      viewer.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
    const box = await invite.boundingBox();
    const main = await viewer.getByRole("main").boundingBox();
    const innerWidth = await viewer.evaluate(() => window.innerWidth);
    expect(box).not.toBeNull();
    expect(main).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(innerWidth);
    expect(await fitsWidth()).toBe(true);
    expect(box!.y).toBeGreaterThanOrEqual(main!.y + main!.height);
    expect(
      await invite.evaluate((el) => getComputedStyle(el).position),
    ).toMatch(/^(static|relative)$/);

    for (const control of [
      invite.getByRole("link", { name: "Try commitnote yourself" }),
      invite.getByRole("button", { name: "No thanks" }),
    ]) {
      const controlBox = await control.boundingBox();
      expect(controlBox!.height).toBeGreaterThanOrEqual(44);
    }

    await viewer.setViewportSize({ width: 320, height: 640 });
    await expect.poll(fitsWidth).toBe(true);
    await expect
      .poll(async () => {
        const narrow = await invite.boundingBox();
        return narrow!.x + narrow!.width;
      })
      .toBeLessThanOrEqual(320);
  },
);
