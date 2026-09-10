import { test, expect } from "@playwright/test";
import { logIn, expectTree } from "./helpers";

test("sidebar wordmark and repo label are not clipped", async ({ page }) => {
  await page.goto("/");
  await logIn(page, {
    repo: "https://github.com/sample/notes",
    passphrase: "sample notes repo passphrase",
  });
  await expectTree(page);

  const header = page.locator(".tree-header");
  const wordmark = header.getByText("commitnote", { exact: true });
  await expect(wordmark).toBeVisible();
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
    .getByText("sample/notes", { exact: true });
  await expect(repo).toBeVisible();
  expect(await repo.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await expect(repo).not.toHaveAttribute("title");

  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  const sidebar = page.locator(".sidebar");
  expect(
    await sidebar.evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});

test("the sidebar repo label links to the repository in a new tab", async ({
  page,
}) => {
  await page.goto("/");
  await logIn(page, {
    repo: "https://github.com/sample/notes",
    passphrase: "sample notes repo passphrase",
  });
  await expectTree(page);

  const link = page
    .locator(".sidebar-footer")
    .getByRole("link", { name: "sample/notes", exact: true });
  await expect(link).toHaveAttribute("href", "https://github.com/sample/notes");
  await expect(link).toHaveAttribute("target", "_blank");
});
