import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { flushPendingSaves, openNotes } from "./helpers";
import { openWelcome, treeItem } from "./helpers/tree";

const SEARCH_REPO = "https://github.com/sample/search";

function noteContent(page: Page): Locator {
  return page.locator(".note-content");
}

function scrollTop(page: Page): Promise<number> {
  return noteContent(page).evaluate((el) => el.scrollTop);
}

test.describe("scroll", () => {
  test.beforeEach(async ({ page }) => {
    await openNotes(page, { repo: SEARCH_REPO });
  });

  test("resets to the top on every note switch", async ({ page }) => {
    await openWelcome(page);
    await page.getByRole("textbox", { name: "Note editor" }).click();
    await page.keyboard.press("ControlOrMeta+End");
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}`);
    await page.locator(".cm-content").evaluate((el, value) => {
      const data = new DataTransfer();
      data.setData("text/plain", value);
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, `\n${lines.join("\n")}`);

    await noteContent(page).evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);

    await treeItem(page, "Zażółć gęślą jaźń").click();
    await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
      "Zażółć gęślą jaźń",
    );
    await expect(page.getByRole("textbox", { name: "Note editor" })).toBeVisible();
    await expect.poll(() => scrollTop(page)).toBe(0);

    await treeItem(page, "Welcome").click();
    await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
      "Welcome",
    );
    await expect(page.getByRole("textbox", { name: "Note editor" })).toContainText(
      "Welcome",
    );
    await expect.poll(() => scrollTop(page)).toBe(0);
  });
});

test.describe("search result focus", () => {
  test.use({ forgeLatency: "github" });

  test("a superseded search selection does not steal focus", async ({ page }) => {
    await page.clock.install();
    await openNotes(page, { repo: SEARCH_REPO });
    await treeItem(page, "Zażółć gęślą jaźń").click();
    const editor = page.getByRole("textbox", { name: "Note editor" });
    await editor.click();
    await page.keyboard.type("edited");
    await treeItem(page, "Welcome").click();
    await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
      "Welcome",
    );

    await page.getByRole("button", { name: "Search notes" }).click();
    const palette = page.getByRole("dialog", { name: "Search notes" });
    const input = palette.getByRole("combobox", { name: "Search notes" });
    await expect(input).toBeFocused();
    await input.fill("reading");
    const target = await treeItem(page, "Zażółć gęślą jaźń").elementHandle();
    await palette.getByRole("option").first().evaluate(async (option, row) => {
      (option as HTMLElement).click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      (row as HTMLElement).click();
    }, target);
    await page.clock.runFor(1000);

    const name = page.getByRole("textbox", { name: "Note name" });
    await expect(name).toHaveValue("Zażółć gęślą jaźń");
    await expect(editor).toBeVisible();
    await expect(editor).not.toBeFocused();
    await expect(name).toHaveValue("Zażółć gęślą jaźń");
  });
});

test.describe("cached note switch", () => {
  test.use({ forgeLatency: "github" });

  test("returning to a viewed note never shows the loading state", async ({
    page,
  }) => {
    await openNotes(page, { repo: SEARCH_REPO });
    const name = page.getByRole("textbox", { name: "Note name" });
    await treeItem(page, "Welcome").click();
    await expect(name).toHaveValue("Welcome");
    await treeItem(page, "Zażółć gęślą jaźń").click();
    await expect(name).toHaveValue("Zażółć gęślą jaźń");
    await expect(page.getByRole("textbox", { name: "Note editor" })).toBeVisible();

    await page.evaluate(() => {
      const record = window as unknown as { contentTexts: string[] };
      record.contentTexts = [];
      new MutationObserver(() => {
        const text = document.querySelector(".note-content")?.textContent ?? "";
        if (record.contentTexts.at(-1) !== text) record.contentTexts.push(text);
      }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });

    await treeItem(page, "Welcome").click();
    await expect(name).toHaveValue("Welcome");
    await expect(page.getByRole("textbox", { name: "Note editor" })).toContainText(
      "Welcome",
    );

    const texts = await page.evaluate(
      () => (window as unknown as { contentTexts: string[] }).contentTexts,
    );
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.filter((text) => text.includes("Loading…"))).toEqual([]);
  });

  test("returning to a viewed note shows its dates at once", async ({ page }) => {
    await openNotes(page, { repo: SEARCH_REPO });
    const details = page.locator(".note-content:not(.held) .note-details");
    await treeItem(page, "Welcome").click();
    await expect(details).toContainText("Created");
    await treeItem(page, "Zażółć gęślą jaźń").click();
    await expect(details).toContainText("Created");

    await page.evaluate(() => {
      const record = window as unknown as { detailTexts: string[] };
      record.detailTexts = [];
      new MutationObserver(() => {
        const text =
          document.querySelector(".note-content:not(.held) .note-details")
            ?.textContent ?? "";
        if (record.detailTexts.at(-1) !== text) record.detailTexts.push(text);
      }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });

    await treeItem(page, "Welcome").click();
    await expect(details).toContainText("Created");

    const texts = await page.evaluate(
      () => (window as unknown as { detailTexts: string[] }).detailTexts,
    );
    expect(texts.filter((text) => /^\d+ words?$/.test(text.trim()))).toEqual([]);
  });
});

interface MotionWindow {
  __motion: string[];
}

async function recordMotion(page: Page): Promise<void> {
  await page.evaluate(() => {
    const record = window as unknown as MotionWindow;
    record.__motion = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[],
      options?: number | KeyframeAnimationOptions,
    ) {
      let kind: string | null = null;
      if (this.matches(".note-header .name-field")) kind = "title";
      else if (this.parentElement?.matches(".note-pane .note-content"))
        kind = "content";
      if (kind !== null) {
        const props = Object.keys(keyframes[0] ?? {})
          .filter((key) => key !== "offset")
          .sort();
        record.__motion.push(`${kind}:${props.join("+")}`);
      }
      return original.call(this, keyframes, options);
    };
  });
}

function recordedMotion(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as MotionWindow).__motion);
}

async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
      ),
  );
}

async function expectNoteShown(page: Page, name: string, text: string) {
  await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(name);
  await expect(page.getByRole("textbox", { name: "Note editor" })).toContainText(
    text,
  );
}

test.describe("switch motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("selecting a different note animates the content and the title", async ({
    page,
  }) => {
    await openNotes(page);
    await openWelcome(page);
    await recordMotion(page);

    await treeItem(page, "Zażółć gęślą jaźń").click();
    await expectNoteShown(page, "Zażółć gęślą jaźń", "");

    await expect
      .poll(async () => (await recordedMotion(page)).join())
      .toContain("title:opacity");
    await expect
      .poll(async () => (await recordedMotion(page)).join())
      .toContain("content:opacity+translate");
    const motion = new Set(await recordedMotion(page));
    expect(motion.has("content:opacity+translate")).toBe(true);
    expect(motion.has("title:opacity")).toBe(true);
    expect([...motion].filter((entry) => !/^(content|title):/.test(entry))).toEqual([]);
  });

  test("selecting the open note again does not animate or reload", async ({
    page,
  }) => {
    await openNotes(page);
    await openWelcome(page);
    const editor = page.locator(".cm-editor");
    await editor.evaluate((el) => {
      (el as unknown as { kept: boolean }).kept = true;
    });
    await recordMotion(page);

    await treeItem(page, "Welcome").click();
    await nextFrames(page);

    await expect(page.locator(".note-loading")).toHaveCount(0);
    expect(
      await editor.evaluate((el) => (el as unknown as { kept?: boolean }).kept),
    ).toBe(true);
    expect(await recordedMotion(page)).toEqual([]);

    await treeItem(page, "Zażółć gęślą jaźń").click();
    await expect
      .poll(async () => (await recordedMotion(page)).length)
      .toBeGreaterThan(0);
  });

  test("renaming the open note does not animate", async ({ page }) => {
    await openNotes(page);
    await openWelcome(page);
    await recordMotion(page);

    const name = page.getByRole("textbox", { name: "Note name" });
    await name.fill("Welcome renamed");
    await name.press("Enter");
    await expect(treeItem(page, "Welcome renamed")).toBeVisible();
    await expect(name).toHaveValue("Welcome renamed");
    await nextFrames(page);

    expect(await recordedMotion(page)).toEqual([]);
  });

  test("rapid clicks settle on the last clicked note", async ({ page }) => {
    await openNotes(page);
    await openWelcome(page);
    for (const folder of ["Journal", "2026", "Projects", "commitnote"]) {
      const row = treeItem(page, folder);
      if ((await row.getAttribute("aria-expanded")) !== "true") {
        await row.click();
      }
    }
    const sequence = [
      "Zażółć gęślą jaźń",
      "January",
      "Ideas",
      "Welcome",
      "Zażółć gęślą jaźń",
    ];
    const handles = await Promise.all(
      sequence.map((name) => treeItem(page, name).elementHandle()),
    );
    await page.evaluate((rows) => {
      for (const row of rows) (row as HTMLElement).click();
    }, handles);

    await expectNoteShown(page, "Zażółć gęślą jaźń", "");
    await expect(page.locator(".note-content.held")).toHaveCount(0);
    await expect
      .poll(() =>
        page
          .locator(".note-pane")
          .evaluate(
            (pane) =>
              pane
                .getAnimations({ subtree: true })
                .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
                .length,
          ),
      )
      .toBe(0);
    const opacities = await page
      .locator(".note-content > *")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity));
    expect(opacities.length).toBeGreaterThan(0);
    expect(opacities.every((value) => value === "1")).toBe(true);
  });
});

test.describe("switch motion with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("selecting a different note starts no animation", async ({ page }) => {
    await openNotes(page);
    await openWelcome(page);
    await recordMotion(page);

    await treeItem(page, "Zażółć gęślą jaźń").click();
    await expectNoteShown(page, "Zażółć gęślą jaźń", "");
    await nextFrames(page);

    expect(await recordedMotion(page)).toEqual([]);
  });
});

test.describe("slow note load", () => {
  test.use({ reducedMotion: "no-preference", forgeLatency: "github" });

  test("holds the previous note without a loading flash", async ({ page }) => {
    await openNotes(page);
    await openWelcome(page);
    const welcomeText = await page
      .getByRole("textbox", { name: "Note editor" })
      .innerText();
    const editor = page.getByRole("textbox", { name: "Note editor" });
    await editor.click();
    await page.locator(".cm-editor").evaluate((el) => {
      const record = window as unknown as {
        samples: {
          held: boolean;
          inert: boolean;
          readOnly: boolean;
          sameEditor: boolean;
          loading: boolean;
        }[];
        sampling: boolean;
      };
      (el as unknown as { kept: boolean }).kept = true;
      record.samples = [];
      record.sampling = true;
      const sample = () => {
        const current = document.querySelector(".cm-editor");
        const content = document.querySelector(".note-content");
        record.samples.push({
          held: content?.classList.contains("held") ?? false,
          inert: current?.closest("[inert]") != null,
          readOnly:
            current?.querySelector(".cm-content")?.getAttribute("contenteditable") ===
            "false",
          sameEditor: (current as unknown as { kept?: boolean })?.kept === true,
          loading: document.querySelector(".note-loading") !== null,
        });
        if (record.sampling) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });

    const target = await treeItem(page, "Zażółć gęślą jaźń").elementHandle();
    await target.evaluate((row) => (row as HTMLElement).click());
    await page.keyboard.type("typed during load");

    await expectNoteShown(page, "Zażółć gęślą jaźń", "");
    await expect(page.locator(".note-content.held")).toHaveCount(0);
    const targetText = await editor.innerText();
    expect(targetText).not.toContain("typed during load");
    const samples = await page.evaluate(() => {
      const record = window as unknown as {
        samples: Record<string, boolean>[];
        sampling: boolean;
      };
      record.sampling = false;
      return record.samples;
    });

    const held = samples.filter((sample) => sample.held);
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((s) => s.inert && s.readOnly && s.sameEditor)).toBe(true);
    expect(samples.every((s) => s.sameEditor)).toBe(true);
    expect(samples.filter((s) => s.loading)).toEqual([]);

    await flushPendingSaves(page);
    await treeItem(page, "Welcome").click();
    await expectNoteShown(page, "Welcome", "");
    expect(await editor.innerText()).toBe(welcomeText);
  });
});

interface DetailsSample {
  height: number;
  editorTop: number;
  text: string;
  fading: boolean;
}

interface DetailsSamplerWindow {
  __detailsSamples: DetailsSample[];
  __detailsSampling: boolean;
}

test.describe("note details during a switch", () => {
  test.use({ reducedMotion: "no-preference", forgeLatency: "github" });

  test("the details line keeps its size until late dates cross-fade in", async ({
    page,
  }) => {
    await openNotes(page);
    await openWelcome(page);
    await expect(page.locator(".note-details")).toContainText("Created");
    const welcomeText = await page.locator(".cm-content").innerText();

    await page.evaluate(
      ({ name, previous }) => {
        const record = window as unknown as DetailsSamplerWindow;
        record.__detailsSamples = [];
        record.__detailsSampling = true;
        const sample = () => {
          const content = document.querySelector(".note-pane .note-content:not(.held)");
          const nameField = document.querySelector<HTMLInputElement>(
            ".note-header input[aria-label='Note name']",
          );
          const editorText =
            content?.querySelector<HTMLElement>(".cm-content")?.innerText ?? "";
          const details = content?.querySelector<HTMLElement>(".note-details");
          const editorRoot = content?.querySelector<HTMLElement>(".markdown-editor");
          if (
            nameField?.value === name &&
            editorText !== previous &&
            details != null &&
            editorRoot != null
          ) {
            const text = details.textContent ?? "";
            record.__detailsSamples.push({
              height: details.offsetHeight,
              editorTop: editorRoot.offsetTop,
              text,
              fading: [...details.querySelectorAll(".details-form")].some(
                (form) => form.getAnimations().length > 0,
              ),
            });
            if (text.includes("Created")) record.__detailsSampling = false;
          }
          if (record.__detailsSampling) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      },
      { name: "Zażółć gęślą jaźń", previous: welcomeText },
    );

    await treeItem(page, "Zażółć gęślą jaźń").click();
    await expect(page.locator(".note-content:not(.held) .note-details")).toContainText(
      "Created",
      { timeout: 15_000 },
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as DetailsSamplerWindow).__detailsSampling,
        ),
      )
      .toBe(false);

    const samples = await page.evaluate(
      () => (window as unknown as DetailsSamplerWindow).__detailsSamples,
    );
    expect(samples.length).toBeGreaterThan(1);
    expect(new Set(samples.map((s) => s.height)).size).toBe(1);
    expect(new Set(samples.map((s) => s.editorTop)).size).toBe(1);
    expect(samples.some((s) => /^\d+ words?$/.test(s.text))).toBe(true);
    expect(samples.at(-1)!.fading).toBe(true);
    await expect(page.locator(".note-content .details-form")).toHaveCount(1);
  });
});

interface SlideRecord {
  target: string;
  x: number;
}

interface SlideWindow {
  __slides: SlideRecord[];
  __slideKinds: string[];
}

async function recordSlides(page: Page): Promise<void> {
  await page.evaluate(() => {
    const record = window as unknown as SlideWindow;
    record.__slides = [];
    record.__slideKinds = [];
    const seen = new Set<Animation>();
    const sample = () => {
      for (const animation of document.getAnimations()) {
        if (seen.has(animation)) continue;
        seen.add(animation);
        const target = (animation.effect as KeyframeEffect | null)?.target;
        if (!(target instanceof Element)) continue;
        const first = (animation.effect as KeyframeEffect).getKeyframes()[0] as
          | { translate?: string }
          | undefined;
        if (target.matches(".note-pane, .sidebar")) {
          record.__slides.push({
            target: target.matches(".note-pane") ? "note-pane" : "sidebar",
            x: Number.parseFloat(first?.translate ?? "0"),
          });
        } else if (target.parentElement?.matches(".note-content")) {
          record.__slideKinds.push("content");
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

function recordedSlides(page: Page): Promise<SlideRecord[]> {
  return page.evaluate(() => (window as unknown as SlideWindow).__slides);
}

function recordedContentMotion(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as SlideWindow).__slideKinds);
}

test.describe("mobile view slide", () => {
  test.use({ reducedMotion: "no-preference" });

  test(
    "slides the incoming view in from the matching side",
    { tag: "@mobile-only" },
    async ({ page }) => {
      await openNotes(page);
      await recordSlides(page);

      await openWelcome(page);
      await expect
        .poll(async () => (await recordedSlides(page)).map((s) => s.target))
        .toEqual(["note-pane"]);
      expect((await recordedSlides(page))[0].x).toBeGreaterThan(0);

      await page.getByRole("button", { name: "Back to notes" }).click();
      await expect
        .poll(async () => (await recordedSlides(page)).map((s) => s.target))
        .toEqual(["note-pane", "sidebar"]);
      expect((await recordedSlides(page))[1].x).toBeLessThan(0);
    },
  );

  test(
    "reopening the selected note slides without a switch motion",
    { tag: "@mobile-only" },
    async ({ page }) => {
      await openNotes(page);
      await openWelcome(page);
      await page.getByRole("button", { name: "Back to notes" }).click();
      await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document
                .getAnimations()
                .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
                .length,
          ),
        )
        .toBe(0);
      await recordSlides(page);

      await treeItem(page, "Welcome").click();
      await expect
        .poll(async () => (await recordedSlides(page)).map((s) => s.target))
        .toEqual(["note-pane"]);
      await nextFrames(page);
      expect(await recordedContentMotion(page)).toEqual([]);
    },
  );
});

test.describe("mobile view slide with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("starts no animation", { tag: "@mobile-only" }, async ({ page }) => {
    await openNotes(page);
    await recordSlides(page);

    await openWelcome(page);
    await page.getByRole("button", { name: "Back to notes" }).click();
    await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible();
    await nextFrames(page);

    expect(await recordedSlides(page)).toEqual([]);
  });
});
