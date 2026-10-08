import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  KEY_DERIVATION_TIMEOUT,
  SAMPLE,
  chooseRepository,
  expectSettingsIdle,
  expectTree,
  fakeForge,
  flushPendingSaves,
  handOverRepo,
  logOut,
  onFakeForgeReady,
  openNotes,
} from "./helpers";
import { chooseOption, closeSettings, openSettings, settingsDialog } from "./helpers/settings";
import { openWelcome, treeItem } from "./helpers/tree";

const LIGHT_BACKGROUND = "rgb(250, 250, 250)";
const DARK_BACKGROUND = "rgb(11, 11, 11)";
const LIGHT_TEXT = "rgb(10, 10, 10)";
const DARK_TEXT = "rgb(237, 237, 237)";
const LIGHT_RAISED = "rgb(255, 255, 255)";
const DARK_RAISED = "rgb(26, 26, 26)";

type Scheme = "light" | "dark";
type ColorMode = "System" | "Light" | "Dark";

const BACKGROUND: Record<Scheme, string> = {
  light: LIGHT_BACKGROUND,
  dark: DARK_BACKGROUND,
};

function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

function expectBackground(page: Page, scheme: Scheme): Promise<void> {
  return expect.poll(() => bodyBackground(page)).toBe(BACKGROUND[scheme]);
}

function expectRootColorScheme(page: Page, scheme: Scheme): Promise<void> {
  return expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    )
    .toBe(scheme);
}

function expectSettingsCommits(page: Page, count: number): Promise<void> {
  return expect
    .poll(() => fakeForge(page).commitCount(), { timeout: 10_000 })
    .toBe(count);
}

function colorModeGroup(page: Page): Locator {
  return settingsDialog(page).getByRole("radiogroup", { name: "Color mode" });
}

async function pickColorMode(page: Page, mode: ColorMode): Promise<void> {
  await openSettings(page);
  await chooseOption(page, "Color mode", mode);
  await closeSettings(page);
}

async function pickAndSave(page: Page, mode: ColorMode): Promise<void> {
  await pickColorMode(page, mode);
  await flushPendingSaves(page);
}

async function shareWelcome(page: Page): Promise<string> {
  await treeItem(page, "Welcome").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Share…" }).click();
  const dialog = page.getByRole("dialog", { name: "Share “Welcome”" });
  await dialog.getByRole("button", { name: "Create link" }).click();
  const link = dialog.getByRole("textbox", { name: "Share link" });
  await expect(link).toBeVisible({ timeout: KEY_DERIVATION_TIMEOUT });
  const url = await link.inputValue();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  return url;
}

function themeColorMeta(page: Page, os: Scheme): Locator {
  return page.locator(
    `meta[name="theme-color"][media="(prefers-color-scheme: ${os})"]`,
  );
}

function hexToRgb(hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${value >> 16}, ${(value >> 8) & 255}, ${value & 255})`;
}

test.describe("with notes open", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await openNotes(page);
  });

  test("defaults to System and follows the OS", async ({ page }) => {
    await expectBackground(page, "light");
    const dialog = await openSettings(page);
    await expect(colorModeGroup(page).getByRole("radio", { name: "System", exact: true })).toBeChecked();
    await expect(dialog.locator(".color-mode-caption")).toHaveText(
      "System · Light, matches your OS",
    );

    await page.emulateMedia({ colorScheme: "dark" });
    await expectBackground(page, "dark");
    await expectRootColorScheme(page, "dark");
    await expect(dialog.locator(".color-mode-caption")).toHaveText(
      "System · Dark, matches your OS",
    );
  });

  for (const { mode, os, scheme } of [
    { mode: "Dark", os: "light", scheme: "dark" },
    { mode: "Light", os: "dark", scheme: "light" },
  ] as const) {
    test(`${mode} overrides a ${os} OS`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: os });
      await pickColorMode(page, mode);
      await expectBackground(page, scheme);
      await expectRootColorScheme(page, scheme);

      await openWelcome(page);
      const content = page.locator(".cm-content");
      await expect(content).toHaveCSS(
        "color",
        scheme === "dark" ? DARK_TEXT : LIGHT_TEXT,
      );
      await expect
        .poll(() =>
          content.evaluate((el) => {
            for (let node: Element | null = el; node; node = node.parentElement) {
              const color = getComputedStyle(node).backgroundColor;
              if (color !== "rgba(0, 0, 0, 0)") return color;
            }
            return null;
          }),
        )
        .toBe(BACKGROUND[scheme]);

      await treeItem(page, "Welcome").click({ button: "right" });
      await expect(page.locator(".menu-popup")).toHaveCSS(
        "background-color",
        scheme === "dark" ? DARK_RAISED : LIGHT_RAISED,
      );
    });
  }

  test("picking Dark saves one commit naming the setting", async ({
    page,
  }) => {
    const before = await fakeForge(page).commitMessages();
    await pickAndSave(page, "Dark");
    await expectSettingsCommits(page, before.length + 1);
    const afterFirst = await fakeForge(page).commitMessages();
    const added = afterFirst.filter((m) => !before.includes(m));
    expect(added).toHaveLength(1);
    expect(added[0].split("\n")).toContain("Commitnote-Settings: colorMode");

  });

  test("a failed first refresh keeps the cached color mode", async ({ page }) => {
    await pickAndSave(page, "Dark");
    await expect
      .poll(async () =>
        (await fakeForge(page).commitMessages()).some((m) =>
          m.split("\n").includes("Commitnote-Settings: colorMode"),
        ),
      )
      .toBe(true);
    const exported = await fakeForge(page).exportRepo();
    await onFakeForgeReady(
      page,
      (controls, arg) => {
        controls.adoptRepo(arg.key, arg.exported);
        controls.failNext(arg.key, "getHead", "Network");
      },
      { key: SAMPLE.key, exported },
    );
    await page.reload();
    await expect(
      page.getByText("Could not reach GitHub. Showing the last loaded notes."),
    ).toBeVisible();
    await expectBackground(page, "dark");
    expect(
      await page.evaluate(() => localStorage.getItem("commitnote.colorMode")),
    ).toBe("dark");

    await openSettings(page);
    await chooseOption(page, "Color mode", "Light");
    await expectBackground(page, "light");
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("commitnote.colorMode")))
      .toBe("light");
  });

  test("rapid picks settle on the last one with a single commit", async ({
    page,
  }) => {
    const before = await fakeForge(page).commitCount();
    await openSettings(page);
    // Paused so a slow machine can't let the save debounce fire between picks.
    await page.clock.install();
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
    for (const mode of ["Light", "Dark", "System", "Dark"] as const) {
      await chooseOption(page, "Color mode", mode);
    }
    await expect(
      colorModeGroup(page).getByRole("radio", { name: "Dark", exact: true }),
    ).toBeChecked();
    await page.clock.resume();
    await flushPendingSaves(page);
    await expectSettingsIdle(page);
    await closeSettings(page);
    await expectBackground(page, "dark");
    await expectSettingsCommits(page, before + 1);
  });

  test("does not flash light before the cached Dark applies on reload", async ({
    page,
  }) => {
    await pickAndSave(page, "Dark");
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { __loadedBackground: string }).__loadedBackground =
          getComputedStyle(document.body ?? document.documentElement).backgroundColor;
      });
    });
    await page.reload();
    await expectTree(page);
    const recorded = await page.evaluate(
      () => (window as unknown as { __loadedBackground: string }).__loadedBackground,
    );
    expect(recorded).toBe(DARK_BACKGROUND);
  });

  test("logging out keeps the color mode", async ({ page }) => {
    await pickAndSave(page, "Dark");
    await logOut(page);
    await expect(page.getByLabel("Access token")).toBeVisible();
    await expectBackground(page, "dark");
  });

  test("a shared note viewer follows the visitor's cache, then the OS", async ({
    page,
  }) => {
    const link = await shareWelcome(page);
    await pickAndSave(page, "Dark");

    const viewer = await page.context().newPage();
    await viewer.emulateMedia({ colorScheme: "light" });
    await viewer.goto(link);
    await expect(viewer).toHaveTitle("Shared note · commitnote");
    await expectBackground(viewer, "dark");

    await viewer.evaluate(() => localStorage.removeItem("commitnote.colorMode"));
    await viewer.emulateMedia({ colorScheme: "dark" });
    await viewer.reload();
    await expectBackground(viewer, "dark");

    await viewer.emulateMedia({ colorScheme: "light" });
    await expectBackground(viewer, "light");
  });

  test("the theme-color meta matches the background in every color mode", async ({
    page,
  }) => {
    const cases: { mode: ColorMode; os: Scheme }[] = [
      { mode: "System", os: "light" },
      { mode: "System", os: "dark" },
      { mode: "Light", os: "light" },
      { mode: "Light", os: "dark" },
      { mode: "Dark", os: "light" },
      { mode: "Dark", os: "dark" },
    ];
    for (const { mode, os } of cases) {
      await test.step(`${mode} on a ${os} OS`, async () => {
        await page.emulateMedia({ colorScheme: os });
        await pickColorMode(page, mode);
        const scheme: Scheme =
          mode === "System" ? os : (mode.toLowerCase() as Scheme);
        await expectBackground(page, scheme);
        const meta = themeColorMeta(page, os);
        await expect
          .poll(async () => hexToRgb((await meta.getAttribute("content")) ?? "#000000"))
          .toBe(await bodyBackground(page));
      });
    }
  });

  test("a reload with a cached Dark mode raises no CSP violation", async ({
    page,
  }) => {
    await pickAndSave(page, "Dark");
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.addInitScript(() => {
      const w = window as unknown as { __violations: string[] };
      w.__violations = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        w.__violations.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });
    await page.reload();
    await expectTree(page);
    expect(
      await page.evaluate(
        () => (window as unknown as { __violations: string[] }).__violations,
      ),
    ).toEqual([]);
    expect(errors.filter((text) => !text.includes("frame-ancestors"))).toEqual([]);
  });
});

test("login applies the repository's color mode at the passphrase step", async ({
  page,
  openSecondDevice,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openNotes(page);
  const commitsBefore = fakeForge(page).commitCount();
  await pickAndSave(page, "Dark");
  await expectSettingsCommits(page, (await commitsBefore) + 1);

  const second = await openSecondDevice({ colorScheme: "light" });
  await handOverRepo(page, second.page);
  await expectBackground(second.page, "light");
  await chooseRepository(second.page, { repo: SAMPLE.repo });
  await expect(second.page.getByLabel("Passphrase", { exact: true })).toBeVisible();
  await expectBackground(second.page, "dark");
  await expectRootColorScheme(second.page, "dark");
});

test.describe("view transitions", () => {
  async function countTransitions(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const w = window as unknown as { __transitions: number };
      w.__transitions = 0;
      const original = document.startViewTransition?.bind(document);
      if (!original) return;
      document.startViewTransition = ((...args: Parameters<typeof original>) => {
        w.__transitions++;
        return original(...args);
      }) as typeof document.startViewTransition;
    });
  }

  function transitions(page: Page): Promise<number> {
    return page.evaluate(
      () => (window as unknown as { __transitions: number }).__transitions,
    );
  }

  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce", colorScheme: "light" });

    test("a scheme-changing pick starts no view transition", async ({ page }) => {
      await countTransitions(page);
      await openNotes(page);
      await pickColorMode(page, "Dark");
      await expectBackground(page, "dark");
      expect(await transitions(page)).toBe(0);
    });
  });

  test.describe("without a motion preference", () => {
    test.use({ reducedMotion: "no-preference", colorScheme: "light" });

    test("only a scheme-changing pick starts one view transition", async ({
      page,
    }) => {
      await countTransitions(page);
      await openNotes(page);

      await pickColorMode(page, "Light");
      await expectBackground(page, "light");
      expect(await transitions(page)).toBe(0);

      await pickColorMode(page, "Dark");
      await expectBackground(page, "dark");
      await expect.poll(() => transitions(page)).toBe(1);
    });
  });
});

test.describe("on a touch screen", () => {
test.use({ hasTouch: true });
test(
  "the color mode cards sit in one row and a tap applies Dark",
  { tag: "@mobile" },
  async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await openNotes(page);
    const dialog = await openSettings(page);

    const cards = dialog
      .getByRole("radiogroup", { name: "Color mode" })
      .locator(".preview-card");
    await expect(cards).toHaveCount(3);
    const dialogBox = (await dialog.boundingBox())!;
    const boxes = [];
    for (let i = 0; i < 3; i++) boxes.push((await cards.nth(i).boundingBox())!);
    for (const box of boxes) {
      expect(box.y).toBeCloseTo(boxes[0].y, 0);
      expect(box.x).toBeGreaterThanOrEqual(dialogBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width);
    }

    await dialog
      .getByRole("radiogroup", { name: "Color mode" })
      .locator("label")
      .filter({ has: page.getByRole("radio", { name: "Dark", exact: true }) })
      .tap();
    await expectBackground(page, "dark");
  },
);
});
