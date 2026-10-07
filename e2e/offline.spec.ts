import { test, expect } from "./fixtures";
import { fakeForge, flushPendingSaves, openNotes } from "./helpers";
import { headerSyncIcon, openWelcome, waitForSynced } from "./helpers/tree";

test("edits wait while offline and save as soon as the browser is back online", async ({
  page,
}) => {
  await openNotes(page);
  await openWelcome(page);
  const commitsBefore = await fakeForge(page).commitCount();

  await page.context().setOffline(true);
  try {
    await page.getByRole("textbox", { name: "Note editor" }).click();
    await page.keyboard.type(" written offline");
    await flushPendingSaves(page);

    await expect(headerSyncIcon(page)).toHaveAccessibleName(
      "Out of sync: waiting to save",
    );
    expect(await fakeForge(page).commitCount()).toBe(commitsBefore);
  } finally {
    await page.context().setOffline(false);
  }

  await waitForSynced(page);
  await expect
    .poll(() => fakeForge(page).commitCount())
    .toBe(commitsBefore + 1);
});
