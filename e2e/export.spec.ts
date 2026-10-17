import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import { strFromU8, unzipSync } from "fflate";
import { openNotes } from "./helpers";
import { openDataSecurityAction } from "./helpers/settings";


test("exporting downloads a zip of all notes and folders", async ({ page }) => {
  await openNotes(page);

  const downloadPromise = page.waitForEvent("download");
  await openDataSecurityAction(page, "Export notes");
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(
    /^commitnote-export-\d{4}-\d{2}-\d{2}\.zip$/,
  );
  const files = unzipSync(await readFile(await download.path()));
  expect(Object.keys(files).sort()).toEqual(
    [
      "Empty folder/",
      "Journal/",
      "Journal/2026/",
      "Journal/2026/January.md",
      "Projects/",
      "Projects/commitnote/",
      "Projects/commitnote/Ideas.md",
      "Projects/commitnote/Roadmap.md",
      "Welcome.md",
      "Zażółć gęślą jaźń.md",
    ].sort(),
  );
  expect(strFromU8(files["Welcome.md"])).toContain("# Welcome");
});

test("the commands menu opens from the keyboard and closes on Escape", async ({
  page,
}) => {
  await openNotes(page);

  const trigger = page.getByRole("button", { name: "More commands" });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.focus();
  await page.keyboard.press("Enter");

  const menu = page.getByRole("menu", { name: "Commands" });
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitem", { name: "Settings" })).toBeFocused();
  await expect(page.locator(".sidebar-footer").getByText("Export")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

declare global {
  interface Window {
    __sharedFiles?: { name: string; type: string; size: number }[];
    __shareCalled?: boolean;
  }
}

test(
  "exporting on a touch device hands the zip to the share sheet",
  { tag: "@mobile-only" },
  async ({ page }) => {
    await page.addInitScript(() => {
      navigator.canShare = () => true;
      navigator.share = async (data) => {
        window.__sharedFiles = (data?.files ?? []).map((f) => ({
          name: f.name,
          type: f.type,
          size: f.size,
        }));
      };
    });
    const downloads: unknown[] = [];
    page.on("download", (download) => downloads.push(download));
    await openNotes(page);

    await openDataSecurityAction(page, "Export notes");

    await expect
      .poll(() => page.evaluate(() => window.__sharedFiles?.length ?? 0))
      .toBe(1);
    const [shared] = (await page.evaluate(() => window.__sharedFiles)) ?? [];
    expect(shared.name).toMatch(/^commitnote-export-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(shared.type).toBe("application/zip");
    expect(shared.size).toBeGreaterThan(0);
    expect(downloads).toHaveLength(0);
  },
);

test(
  "cancelling the share sheet does nothing",
  { tag: "@mobile-only" },
  async ({ page }) => {
    await page.addInitScript(() => {
      navigator.canShare = () => true;
      navigator.share = async () => {
        window.__shareCalled = true;
        throw new DOMException("cancel", "AbortError");
      };
    });
    const downloads: unknown[] = [];
    page.on("download", (download) => downloads.push(download));
    await openNotes(page);

    await openDataSecurityAction(page, "Export notes");

    await expect.poll(() => page.evaluate(() => window.__shareCalled)).toBe(true);
    await expect(page.getByText("Export failed")).toHaveCount(0);
    expect(downloads).toHaveLength(0);
  },
);
