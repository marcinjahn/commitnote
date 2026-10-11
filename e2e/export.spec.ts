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
