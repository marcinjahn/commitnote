import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { expectNoA11yViolations } from "./helpers/a11y";

const HEADING = "Encrypted markdown notes in your own git repository.";
const REPOSITORY = "https://github.com/marcinjahn/commitnote";
const APPIMAGE =
  "https://github.com/marcinjahn/commitnote/releases/latest/download/commitnote-x86_64.AppImage";

async function openLanding(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADING);
}

function heroShot(page: Page) {
  return page.locator(".hero-shot img:visible");
}

async function savedColorMode(page: Page, mode: "light" | "dark") {
  await page.addInitScript((saved) => {
    localStorage.setItem("commitnote.colorMode", saved);
  }, mode);
}

test("the landing page renders its content and calls to action", async ({
  page,
}) => {
  await openLanding(page);

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toHaveAttribute("href", "#main");
  await expect(page.locator("#main")).toHaveCount(1);

  const openApp = page.getByRole("link", { name: "Open app" });
  await expect(openApp).toHaveCount(3);
  for (const href of await hrefs(openApp)) {
    expect(new URL(href, page.url()).pathname).toBe("/app/");
  }
  expect(
    await hrefs(page.getByRole("link", { name: "Download for Linux" })),
  ).toEqual([APPIMAGE, APPIMAGE]);
  const github = await hrefs(page.getByRole("link", { name: /GitHub/ }));
  expect(github.length).toBeGreaterThanOrEqual(1);
  expect(new Set(github)).toEqual(new Set([REPOSITORY]));

  const images = await page.locator("img:visible").all();
  expect(images.length).toBeGreaterThan(0);
  for (const image of images) {
    await expect(image).toHaveAttribute("alt", /\S/);
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image.evaluate(
          (el: HTMLImageElement) => el.complete && el.naturalWidth,
        ),
      )
      .toBeGreaterThan(0);
  }
});

function hrefs(links: ReturnType<Page["getByRole"]>): Promise<string[]> {
  return links.evaluateAll((elements) =>
    elements.map((el) => el.getAttribute("href") ?? ""),
  );
}

test("Open app reaches the app's login screen", async ({ page }) => {
  await openLanding(page);

  await page.getByRole("link", { name: "Open app" }).first().click();

  await expect(page.getByLabel("Access token")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/app/");
});

test.describe("color mode", () => {
  test.describe("under a light system theme", () => {
    test.use({ colorScheme: "light" });

    test("a saved dark mode renders the dark page", async ({ page }) => {
      await savedColorMode(page, "dark");
      await openLanding(page);

      await expect(page.locator("html")).toHaveAttribute(
        "data-color-mode",
        "dark",
      );
      expect(
        await page.evaluate(
          () => getComputedStyle(document.body).backgroundColor,
        ),
      ).toBe("rgb(11, 11, 11)");
      expect(
        await page
          .locator('meta[name="theme-color"]')
          .evaluateAll((metas) => metas.map((m) => m.getAttribute("content"))),
      ).toEqual(["#0b0b0b", "#0b0b0b"]);
      await expect(heroShot(page)).toHaveClass("shot-dark");
    });
  });

  test.describe("under a dark system theme", () => {
    test.use({ colorScheme: "dark" });

    test("the system theme picks the dark screenshot", async ({ page }) => {
      await openLanding(page);
      await expect(heroShot(page)).toHaveClass("shot-dark");
    });

    test("a saved light mode picks the light screenshot", async ({ page }) => {
      await savedColorMode(page, "light");
      await openLanding(page);
      await expect(heroShot(page)).toHaveClass("shot-light");
    });
  });
});

test("every section is visible without motion", async ({ page }) => {
  await openLanding(page);

  const hidden = await page.evaluate(() => {
    const found: string[] = [];
    for (const section of document.querySelectorAll("main section")) {
      for (const el of [section, ...section.querySelectorAll("*")]) {
        const style = getComputedStyle(el);
        if (style.display === "none") continue;
        const matrix = new DOMMatrixReadOnly(
          style.transform === "none" ? undefined : style.transform,
        );
        if (style.opacity !== "1" || matrix.e !== 0 || matrix.f !== 0) {
          found.push(
            `${el.tagName.toLowerCase()}.${el.className} opacity=${style.opacity} transform=${style.transform}`,
          );
        }
      }
    }
    return found;
  });
  expect(hidden).toEqual([]);
});

test.describe("motion", () => {
  test.use({ reducedMotion: "no-preference" });

  function opacity(locator: ReturnType<Page["locator"]>): Promise<string> {
    return locator.evaluate((el) => getComputedStyle(el).opacity);
  }

  test("the hero wordmark types itself in", async ({ page }) => {
    await openLanding(page);
    await expect(page.locator(".hero-wordmark")).toHaveAttribute(
      "data-typing",
      "done",
    );
  });

  test("a section below the fold reveals on scroll", async ({ page }) => {
    await openLanding(page);
    const head = page.locator("#what-you-need .section-head");

    expect(Number(await opacity(head))).toBeLessThan(1);
    await head.scrollIntoViewIfNeeded();
    await expect.poll(() => opacity(head)).toBe("1");
  });

  test("the commit illustration plays once it comes into view", async ({
    page,
  }) => {
    await openLanding(page);
    const illustration = page.locator(".commit-illustration");
    const entry = illustration.locator(".commit-entry");

    await illustration.scrollIntoViewIfNeeded();
    await expect(illustration).toHaveAttribute("data-played", "");
    await expect
      .poll(() =>
        entry.evaluate((el) => {
          const style = getComputedStyle(el);
          return `${style.opacity} ${style.translate}`;
        }),
      )
      .toMatch(/^1 (none|0px)$/);
  });
});

test("the landing page contacts only its own origin and has no CSP violations", async ({
  page,
}) => {
  const origins = new Set<string>();
  const messages: string[] = [];
  page.on("request", (request) => origins.add(new URL(request.url()).origin));
  page.on("console", (message) => messages.push(message.text()));

  await openLanding(page);
  for (const image of await page.locator("img:visible").all()) {
    await image.scrollIntoViewIfNeeded();
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForLoadState("networkidle");

  expect([...origins]).toEqual([new URL(page.url()).origin]);
  expect(messages.filter((m) => m.includes("Content Security Policy"))).toEqual(
    [],
  );
});

test(
  "the landing page has no accessibility violations",
  { tag: "@mobile" },
  async ({ page }) => {
    await openLanding(page);
    await expectNoA11yViolations(page, "landing");
  },
);
