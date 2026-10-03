import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { chooseRepository, expectTree, logIn } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const REPO_KEY = "sample/notes";
const PASSPHRASE = "sample notes repo passphrase";
const TEAL = "rgb(0, 133, 115)";

interface Sample {
  readonly root: string;
  readonly element: string | null;
}

function startSampling(selector: string) {
  const w = window as any;
  w.__accentSamples = [];
  w.__accentSampling = true;
  const frame = () => {
    if (!w.__accentSampling) return;
    const element = document.querySelector(selector);
    w.__accentSamples.push({
      root: getComputedStyle(document.documentElement)
        .getPropertyValue("--color-accent")
        .trim(),
      element: element
        ? getComputedStyle(element).getPropertyValue("--color-accent").trim()
        : null,
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function stopSampling(page: Page): Promise<Sample[]> {
  return page.evaluate(() => {
    const w = window as any;
    w.__accentSampling = false;
    return w.__accentSamples as Sample[];
  });
}

function channels(color: string): number[] {
  return (color.match(/[\d.]+/g) ?? []).map(Number);
}

function distance(a: string, b: string): number {
  const [x, y] = [channels(a), channels(b)];
  return Math.hypot(...x.map((value, i) => value - y[i]));
}

/** Share of the way from `from` to `to` of each rendered change, in order. */
function fadeSteps(colors: readonly string[], from: string, to: string) {
  const changes = colors.filter((color, i) => i > 0 && color !== colors[i - 1]);
  return changes.map((color) => distance(color, from) / distance(to, from));
}

function expectFade(colors: readonly string[], from: string, to: string) {
  expect(from).not.toBe(to);
  expect(colors[0]).toBe(from);
  expect(colors.at(-1)).toBe(to);
  const between = fadeSteps(colors, from, to).filter(
    (step) => step > 0.02 && step < 0.98,
  );
  expect(between.length).toBeGreaterThanOrEqual(2);
}

function rootAccent(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--color-accent")
      .trim(),
  );
}

async function saveTeal(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More commands" }).click();
  await page
    .getByRole("menu", { name: "Commands" })
    .getByRole("menuitem", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog
    .locator("label")
    .filter({ has: page.getByRole("radio", { name: "Teal", exact: true }) })
    .click();
  await expect
    .poll(
      () =>
        page.evaluate(
          (repoKey) =>
            (window as any).__commitNoteFakeForge.commitMessages(
              repoKey,
            ) as string[],
          REPO_KEY,
        ),
      { timeout: 10_000 },
    )
    .toContainEqual(expect.stringContaining("accentColor"));
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => rootAccent(page)).toBe(TEAL);
}

async function clickLogOut(page: Page): Promise<void> {
  const back = page.getByRole("button", { name: "Back to notes" });
  if (await back.isVisible()) {
    await back.click();
  }
  await page.getByRole("button", { name: "Log out", exact: true }).click();
}

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(700);
}

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the saved accent fades in on the passphrase step and back to system on logout", async ({
    page,
  }) => {
    await page.goto("/");
    await logIn(page, { repo: NOTES_REPO, passphrase: PASSPHRASE });
    await expectTree(page);
    await saveTeal(page);
    await clickLogOut(page);
    await expect(page.getByLabel("Access token")).toBeVisible({
      timeout: 10_000,
    });
    await settle(page);
    const system = await rootAccent(page);

    await page.getByLabel("Access token").fill("test-token");
    await page.evaluate(startSampling, "#login-passphrase");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByLabel("Passphrase", { exact: true })).toBeVisible();
    await settle(page);
    const unlocking = await stopSampling(page);
    expectFade(
      unlocking.map((s) => s.root),
      system,
      TEAL,
    );
    expectFade(
      unlocking.map((s) => s.element).filter((c) => c !== null),
      system,
      TEAL,
    );

    await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
    await page.getByRole("button", { name: "Log in" }).click();
    await expectTree(page);
    await settle(page);

    await page.evaluate(startSampling, "#login-passphrase");
    await clickLogOut(page);
    await expect(page.getByLabel("Access token")).toBeVisible({
      timeout: 10_000,
    });
    await settle(page);
    const loggingOut = await stopSampling(page);
    expectFade(
      loggingOut.map((s) => s.root),
      TEAL,
      system,
    );
  });

  test("a remembered session fades the saved accent in once the app has rendered", async ({
    page,
  }) => {
    await page.goto("/");
    await logIn(page, {
      repo: NOTES_REPO,
      passphrase: PASSPHRASE,
      rememberMe: true,
    });
    await expectTree(page);
    const system = await rootAccent(page);
    await saveTeal(page);
    const exported = await page.evaluate(
      (repoKey) =>
        (window as any).__commitNoteFakeForge.exportRepo(repoKey) as string,
      REPO_KEY,
    );
    await page.addInitScript(
      ([key, repoKey, state]) => {
        let controls: any;
        Object.defineProperty(window, key, {
          configurable: true,
          get: () => controls,
          set: (value) => {
            controls = value;
            controls.adoptRepo(repoKey, state);
          },
        });
      },
      ["__commitNoteFakeForge", REPO_KEY, exported],
    );
    await page.addInitScript(startSampling, "[role='tree']");
    // A slower CPU makes mounting the app a long task, which is what used to
    // swallow the fade.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });

    await page.reload();
    await expectTree(page);
    await settle(page);
    const samples = (await stopSampling(page)).filter(
      (s) => s.element !== null,
    );
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

    const roots = samples.map((s) => s.root);
    expectFade(roots, system, TEAL);
    expect(fadeSteps(roots, system, TEAL)[0]).toBeLessThan(0.2);
    expectFade(
      samples.map((s) => s.element as string),
      system,
      TEAL,
    );
  });
});

test("with reduced motion the saved accent applies at once", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: PASSPHRASE });
  await expectTree(page);
  await saveTeal(page);
  await clickLogOut(page);
  await expect(page.getByLabel("Access token")).toBeVisible({
    timeout: 10_000,
  });
  await settle(page);
  const system = await rootAccent(page);
  expect(system).not.toBe(TEAL);

  await page.evaluate(startSampling, "#login-passphrase");
  await chooseRepository(page, { repo: NOTES_REPO });
  await expect(page.getByLabel("Passphrase", { exact: true })).toBeVisible();
  await settle(page);
  const roots = (await stopSampling(page)).map((s) => s.root);
  expect(roots[0]).toBe(system);
  expect(roots.at(-1)).toBe(TEAL);
  expect(new Set(roots)).toEqual(new Set([system, TEAL]));
});
