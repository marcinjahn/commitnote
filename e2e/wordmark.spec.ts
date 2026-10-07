import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  KEY_DERIVATION_TIMEOUT,
  chooseRepository,
  expectTree,
  fakeForge,
  logIn,
  logOut,
  openNotes,
  SAMPLE,
  showTree,
} from "./helpers";
import { openWelcome, treeItem } from "./helpers/tree";

type Phase = "typing" | "blinking" | "done";

const PHASE_ORDER: readonly Phase[] = ["typing", "blinking", "done"];
const START = new Date("2026-03-02T10:00:00");

test.use({ reducedMotion: "no-preference" });

async function freezeClock(page: Page): Promise<void> {
  await page.clock.install({ time: START });
  await page.clock.pauseAt(new Date(START.getTime() + 1000));
}

async function advanceUntilVisible(page: Page, target: Locator): Promise<void> {
  for (let step = 0; step < 300; step++) {
    if (await target.isVisible()) return;
    await page.clock.runFor(100);
    await expect(target)
      .toBeVisible({ timeout: 100 })
      .catch(() => undefined);
  }
  throw new Error("the page never showed the expected element");
}

function tree(page: Page): Locator {
  return page.getByRole("tree", { name: "Notes" });
}

async function openNotesFrozen(page: Page): Promise<void> {
  await page.goto("/?fake-forge-session=" + encodeURIComponent(SAMPLE.repo));
  await advanceUntilVisible(page, tree(page));
}

function sidebarWordmark(page: Page): Locator {
  return page.locator(".tree-header .wordmark");
}

interface Snapshot {
  readonly phase: string | null;
  readonly width: number;
  readonly visibleLetters: number;
  readonly caret: string | null;
  readonly caretOpacity: string | null;
  readonly tail: string;
  readonly tailLetters: number;
}

function snapshot(wordmark: Locator): Promise<Snapshot> {
  return wordmark.evaluate((el) => ({
    phase: el.getAttribute("data-typing"),
    width: el.getBoundingClientRect().width,
    visibleLetters: [...el.querySelectorAll(".wordmark-letter")].filter(
      (letter) => getComputedStyle(letter).visibility !== "hidden",
    ).length,
    caret: el.getAttribute("data-caret"),
    caretOpacity:
      el.querySelector<HTMLElement>(".wordmark-caret")?.style.opacity ?? null,
    tail: el.style.getPropertyValue("--wordmark-tail"),
    tailLetters: el.querySelectorAll(".wordmark-tail").length,
  }));
}

async function playToDone(page: Page, wordmark: Locator): Promise<Snapshot[]> {
  const seen: Snapshot[] = [];
  for (let step = 0; step < 150; step++) {
    const current = await snapshot(wordmark);
    seen.push(current);
    if (current.phase === "done") return seen;
    await page.clock.runFor(100);
    await expect(wordmark)
      .toHaveAttribute("data-typing", "done", { timeout: 30 })
      .catch(() => undefined);
  }
  throw new Error("the wordmark never reached done");
}

async function expectStaticWordmark(
  wordmark: Locator,
  { typed }: { typed: boolean },
): Promise<void> {
  const letters = wordmark.locator(".wordmark-letter");
  await expect(letters).toHaveCount(10);
  const details = await letters.evaluateAll((els) =>
    els.map((el) => ({
      text: el.textContent,
      weight: getComputedStyle(el).fontWeight,
      after: getComputedStyle(el, "::after").content,
    })),
  );
  expect(details.map((d) => d.text).join("")).toBe("commitnote");
  expect(details.map((d) => d.weight)).toEqual([
    ...Array(6).fill("600"),
    ...Array(4).fill("400"),
  ]);
  for (const { after } of details) {
    expect(["none", "normal"]).toContain(after);
  }
  const wordmarkAfter = await wordmark.evaluate(
    (el) => getComputedStyle(el, "::after").content,
  );
  expect(["none", "normal"]).toContain(wordmarkAfter);
  await expect(wordmark.locator(".visually-hidden")).toHaveText("commitnote");
  if (typed) {
    await expect(wordmark).toHaveAttribute("data-typing", "done");
  } else {
    await expect(wordmark).not.toHaveAttribute("data-typing");
  }
}

test.describe("static wordmark", () => {
  test("login screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Access token")).toBeVisible();
    const heading = page.getByRole("heading", { name: "commitnote" });
    await expect(heading).toBeVisible();
    await expectStaticWordmark(page.locator(".wordmark"), { typed: false });
  });

  test("sidebar header once typed", async ({ page }) => {
    await openNotes(page);
    await expect(sidebarWordmark(page)).toHaveAttribute("data-typing", "done", {
      timeout: 10_000,
    });
    await expectStaticWordmark(sidebarWordmark(page), { typed: true });
  });

  test("share viewer", async ({ page }) => {
    await openNotes(page);
    await treeItem(page, "Welcome").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Share…" }).click();
    const dialog = page.getByRole("dialog", { name: "Share “Welcome”" });
    await dialog.getByRole("button", { name: "Create link" }).click();
    const link = dialog.getByRole("textbox", { name: "Share link" });
    await expect(link).toBeVisible({ timeout: KEY_DERIVATION_TIMEOUT });

    const viewer = await page.context().newPage();
    await viewer.goto(await link.inputValue());
    await expect(viewer).toHaveTitle("Shared note · commitnote");
    await expectStaticWordmark(viewer.locator(".wordmark"), { typed: false });
  });

  test("key-changed screen", async ({ page }) => {
    await openNotes(page);
    await fakeForge(page).changeRepoKey();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(
      page.getByRole("heading", { name: "Passphrase changed" }),
    ).toBeVisible();
    await expectStaticWordmark(page.locator(".wordmark"), { typed: false });
  });
});

test.describe("typed wordmark", () => {
  test(
    "types, blinks and settles at a constant width",
    { tag: "@mobile" },
    async ({ page }) => {
      await freezeClock(page);
      await openNotesFrozen(page);
      const wordmark = sidebarWordmark(page);
      await expect(wordmark).toHaveAttribute("data-typing", "typing");
      const initial = await snapshot(wordmark);
      expect(initial.visibleLetters).toBe(0);

      const seen = await playToDone(page, wordmark);

      const phases = seen.map((s) => PHASE_ORDER.indexOf(s.phase as Phase));
      expect(phases).not.toContain(-1);
      expect(phases).toEqual([...phases].sort((a, b) => a - b));
      expect(phases).toContain(PHASE_ORDER.indexOf("blinking"));
      for (const { width } of seen) {
        expect(Math.abs(width - initial.width)).toBeLessThanOrEqual(0.5);
      }
      const typingCounts = seen
        .filter((s) => s.phase === "typing")
        .map((s) => s.visibleLetters);
      expect(Math.max(...typingCounts)).toBeGreaterThan(1);

      await expect(wordmark.locator(".wordmark-caret")).toHaveCount(0);
      await expect(wordmark.locator(".wordmark-letter:visible")).toHaveCount(10);
    },
  );

  test("shows the gradient tail only while the caret is on", async ({
    page,
  }) => {
    await freezeClock(page);
    await openNotesFrozen(page);
    const wordmark = sidebarWordmark(page);

    const seen = await playToDone(page, wordmark);

    const animating = seen.filter((s) => s.phase !== "done");
    for (const s of animating) {
      expect(s.caretOpacity).toBe(s.caret === "on" ? "1" : "0");
      expect(s.tail).toBe(s.caret === "on" ? "1" : "0");
      if (s.visibleLetters >= 3) expect(s.tailLetters).toBe(3);
    }
    for (const s of seen.filter((s) => s.phase === "typing")) {
      expect(s.caret).toBe("on");
    }
    const blinkRuns = seen
      .filter((s) => s.phase === "blinking")
      .map((s) => s.caret)
      .filter((caret, i, all) => caret !== all[i - 1]);
    expect(blinkRuns).toEqual(["on", "off", "on", "off", "on", "off"]);

    const settled = seen[seen.length - 1];
    expect(settled.caret).toBeNull();
    expect(settled.tail).toBe("");
    expect(settled.tailLetters).toBe(0);
  });

  test("does not replay after navigating or logging in again", async ({
    page,
  }) => {
    await freezeClock(page);
    await openNotesFrozen(page);
    await playToDone(page, sidebarWordmark(page));
    await page.clock.resume();

    await openWelcome(page);
    await showTree(page);
    await expect(sidebarWordmark(page)).toHaveAttribute("data-typing", "done");

    await page.clock.resume();
    await logOut(page);
    await logIn(page, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
    await expectTree(page);
    await expect(sidebarWordmark(page)).toHaveAttribute("data-typing", "done");
  });

  test(
    "does not replay when the tree is reopened on mobile",
    { tag: "@mobile-only" },
    async ({ page }) => {
      await freezeClock(page);
      await openNotesFrozen(page);
      await playToDone(page, sidebarWordmark(page));
      await page.clock.resume();

      await openWelcome(page);
      await expect(page.getByRole("tree", { name: "Notes" })).toBeHidden();
      await showTree(page);
      await expect(sidebarWordmark(page)).toHaveAttribute("data-typing", "done");
    },
  );

  test(
    "waits for the tree when a note opens first on mobile",
    { tag: "@mobile-only" },
    async ({ page }) => {
      await openNotes(page);
      await openWelcome(page);
      const noteUrl = page.url();

      await freezeClock(page);
      await page.goto(noteUrl);
      await advanceUntilVisible(
        page,
        page.getByRole("textbox", { name: "Note editor" }),
      );
      await expect(page.getByRole("tree", { name: "Notes" })).toBeHidden();

      await page.clock.runFor(6000);
      await showTree(page);
      await advanceUntilVisible(page, tree(page));
      const wordmark = sidebarWordmark(page);
      await expect(wordmark).toHaveAttribute("data-typing", "typing");

      await playToDone(page, wordmark);
    },
  );

  test("plays after logging in", async ({ page }) => {
    await page.clock.install({ time: START });
    await page.goto("/");
    await expect(page.getByLabel("Access token")).toBeVisible();
    await expect(page.locator(".wordmark")).not.toHaveAttribute("data-typing");
    await chooseRepository(page, { repo: SAMPLE.repo });
    await page.getByLabel("Passphrase", { exact: true }).fill(SAMPLE.passphrase);
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(new Date(now + 1000));
    await page.getByRole("button", { name: "Log in" }).click();
    await advanceUntilVisible(page, tree(page));

    const wordmark = sidebarWordmark(page);
    await expect(wordmark).toHaveAttribute("data-typing", "typing");
    await playToDone(page, wordmark);
  });
});

test(
  "with reduced motion the wordmark is done at once",
  { tag: "@mobile" },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openNotes(page);
    const wordmark = sidebarWordmark(page);
    await expect(wordmark).toHaveAttribute("data-typing", "done");
    await expect(wordmark.locator(".wordmark-caret")).toHaveCount(0);
    await expect(wordmark.locator(".wordmark-letter:visible")).toHaveCount(10);
  },
);
