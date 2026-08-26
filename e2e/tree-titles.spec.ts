import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "@playwright/test";
import { logIn, expectTree } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";

const ROOT_NAMES = [
  "Empty folder",
  "Journal",
  "Projects",
  "Welcome",
  "Zażółć gęślą jaźń",
];

async function backToTreeIfMobile(
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  if (testInfo.project.name !== "mobile") return;
  await page.getByRole("button", { name: "Back to notes" }).click();
}

test("tree rows show titles and small icons", async ({ page }) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  for (const name of ROOT_NAMES) {
    const row = page.getByRole("treeitem", { name, exact: true });
    await expect(row).toBeVisible();

    const label = row.getByText(name, { exact: true });
    await expect(label).toBeVisible();
    const labelBox = await label.boundingBox();
    expect(labelBox?.width).toBeGreaterThan(20);

    const rowBox = await row.boundingBox();
    expect(rowBox?.height).toBeGreaterThanOrEqual(44);

    const svgs = row.locator("svg");
    const count = await svgs.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await svgs.nth(i).boundingBox();
      expect(box?.width).toBeLessThanOrEqual(20);
      expect(box?.height).toBeLessThanOrEqual(20);
    }
  }
});

test("a long title stays on one line and is truncated", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  const longName =
    "A very long note title that cannot possibly fit into the sidebar width";
  const welcome = page.getByRole("treeitem", { name: "Welcome", exact: true });
  const originalBox = await welcome.boundingBox();
  expect(originalBox).not.toBeNull();

  await welcome.click();
  const renameInput = page.getByRole("textbox", { name: "Note name" });
  await renameInput.fill(longName);
  await renameInput.press("Enter");
  await backToTreeIfMobile(page, testInfo);

  const row = page.getByRole("treeitem", { name: longName, exact: true });
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  expect(Math.abs((box?.height ?? 0) - (originalBox?.height ?? 0))).toBeLessThanOrEqual(1);
  await expect(row).toHaveAttribute("title", longName);

  const label = row.getByText(longName, { exact: true });
  expect(
    await label.evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(true);
});
