import { test, expect } from "./fixtures";
import { SAMPLE, openNotes, flushPendingSaves } from "./helpers";

test("sidebar wordmark and repo label are not clipped", async ({ page }) => {
  await openNotes(page);

  const header = page.locator(".tree-header");
  const wordmark = header.locator(".wordmark");
  await expect(wordmark).toHaveAttribute("data-typing", "done", {
    timeout: 15_000,
  });
  await expect(wordmark).toBeVisible();
  await expect(wordmark.locator(".visually-hidden")).toHaveText("commitnote");
  await expect(header.locator(".wordmark-glyphs")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  expect(
    await wordmark.evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  const wordmarkBox = await wordmark.boundingBox();
  const headerBox = await header.boundingBox();
  expect(wordmarkBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(wordmarkBox!.x).toBeGreaterThanOrEqual(headerBox!.x);
  expect(wordmarkBox!.y).toBeGreaterThanOrEqual(headerBox!.y);
  expect(wordmarkBox!.x + wordmarkBox!.width).toBeLessThanOrEqual(
    headerBox!.x + headerBox!.width,
  );
  expect(wordmarkBox!.y + wordmarkBox!.height).toBeLessThanOrEqual(
    headerBox!.y + headerBox!.height,
  );

  const repo = page
    .locator(".sidebar-footer")
    .getByText(SAMPLE.key, { exact: true });
  await expect(repo).toBeVisible();
  expect(await repo.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await expect(repo).not.toHaveAttribute("title");

  const sha = page.locator(".sidebar-footer").getByTestId("commit-sha");
  await expect(sha).toBeVisible();
  expect(await sha.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );

  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  const sidebar = page.locator(".sidebar");
  expect(
    await sidebar.evaluate((el) => {
      const limit = el.getBoundingClientRect().right;
      return [...el.querySelectorAll("*")]
        .filter((child) => !child.closest(".sidebar-resize-handle"))
        .every((child) => child.getBoundingClientRect().right <= limit + 0.5);
    }),
  ).toBe(true);
});

test("the sidebar links to the repository, shows the current commit and follows each save", async ({
  page,
}) => {
  await openNotes(page);

  const link = page
    .locator(".sidebar-footer")
    .getByRole("link", { name: /^sample\/notes Commit [0-9a-f]{40}$/ });
  await expect(link).toHaveAttribute("href", SAMPLE.repo);
  await expect(link).toHaveAttribute("target", "_blank");

  const sha = page.locator(".sidebar-footer").getByTestId("commit-sha");
  await expect(sha).toHaveAttribute("data-sha", /^[0-9a-f]{40}$/);
  const before = await sha.getAttribute("data-sha");
  await expect(
    page.locator(".sidebar-footer").getByRole("link"),
  ).toContainText(`Commit ${before}`);

  await page.getByRole("treeitem", { name: "Welcome" }).click();
  const editor = page.getByRole("textbox", { name: "Note editor" });
  await expect(editor).toContainText("Welcome");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" and one more line");
  await flushPendingSaves(page);

  await expect(sha).not.toHaveAttribute("data-sha", before!, {
    timeout: 15_000,
  });
  await expect(sha).toHaveAttribute("data-sha", /^[0-9a-f]{40}$/);
});

test("the narrow sidebar has no footer and keeps Log out in the command menu", { tag: "@mobile-only" }, async ({
  page,
}) => {
  await openNotes(page);

  const wordmark = page.locator(".tree-header .wordmark");
  await expect(wordmark).toHaveAttribute("data-typing", "done", {
    timeout: 15_000,
  });
  expect(
    await wordmark.evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);

  await expect(page.locator(".sidebar-footer")).toHaveCount(0);
  await expect(page.locator(".repo-link")).toHaveCount(0);
  await expect(page.locator(".commit-sha")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);

  expect(
    await page.locator(".sidebar").evaluate((el) => {
      const limit = el.getBoundingClientRect().right;
      return [...el.querySelectorAll("*")]
        .filter((child) => !child.closest(".sidebar-resize-handle"))
        .every((child) => child.getBoundingClientRect().right <= limit + 0.5);
    }),
  ).toBe(true);

  await page.getByRole("button", { name: "More commands" }).click();
  await expect(
    page.getByRole("menu", { name: "Commands" }).getByRole("menuitem", { name: "Log out" }),
  ).toBeVisible();
});
