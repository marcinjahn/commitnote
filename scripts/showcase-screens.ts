import { expect, type Page } from "@playwright/test";
import { openNotes } from "../e2e/helpers";
import { treeItem } from "../e2e/helpers/tree";
import {
  SHOWCASE_REPO_KEY,
  showcaseHeroNote,
} from "../src/testing/sample-notes-repo/showcase-source";

export async function openShowcase(page: Page): Promise<void> {
  await openNotes(page, { repo: `https://github.com/${SHOWCASE_REPO_KEY}` });
}

export async function expandFolders(
  page: Page,
  folders: readonly string[],
): Promise<void> {
  for (const folder of folders) {
    const item = treeItem(page, folder);
    await item.click();
    await expect(item).toHaveAttribute("aria-expanded", "true");
  }
}

export async function openShowcaseHeroNote(page: Page): Promise<void> {
  await openShowcase(page);
  await expandFolders(page, showcaseHeroNote.folder);
  await treeItem(page, showcaseHeroNote.name).click();
  await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
    showcaseHeroNote.name,
  );
  await expect(
    page.getByRole("list", { name: "Note details" }).locator("time"),
  ).toHaveCount(2);
}
