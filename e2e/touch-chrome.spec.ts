import { test, expect } from "./fixtures";
import { openNotes } from "./helpers";
import { openWelcome } from "./helpers/tree";

const MOBILE = { tag: "@mobile-only" } as const;

test("buttons opt out of double-tap zoom and selection", MOBILE, async ({
  page,
}) => {
  await openNotes(page);
  const styles = await page
    .getByRole("button", { name: "Refresh" })
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return { touchAction: style.touchAction, userSelect: style.userSelect };
    });
  expect(styles).toEqual({ touchAction: "manipulation", userSelect: "none" });
});

test("the note name field stays editable under the header", MOBILE, async ({
  page,
}) => {
  await openNotes(page);
  await openWelcome(page);
  const field = page.locator(".note-header .name-input");
  await expect
    .poll(() => field.evaluate((el) => getComputedStyle(el).userSelect))
    .not.toBe("none");
  await field.fill("Typed title");
  await expect(field).toHaveValue("Typed title");
});
