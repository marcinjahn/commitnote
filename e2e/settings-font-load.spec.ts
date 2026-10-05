import { expect, test } from "./fixtures";
import { openNotes } from "./helpers";
import { collectFontFiles } from "./helpers/settings";
import { openWelcome } from "./helpers/tree";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("only the Inter font file loads on app load", async ({ page }) => {
  const files = collectFontFiles(page);
  await openNotes(page);
  await openWelcome(page);
  await expect.poll(() => files.length).toBeGreaterThan(0);
  await page.evaluate(() => document.fonts.ready);

  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    expect(file.startsWith("InterVariable")).toBe(true);
  }
  const families = await page.evaluate(() =>
    [...document.fonts]
      .filter((face) => face.status !== "unloaded")
      .map((face) => face.family.replace(/^"|"$/g, "")),
  );
  expect(families.length).toBeGreaterThan(0);
  for (const family of families) {
    expect(family).toBe("Inter");
  }
});
