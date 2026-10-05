import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { chooseRepository, expectTree, SAMPLE, openNotes, logOut, fakeForge, onFakeForgeReady } from "./helpers";
import { chooseAccent, closeSettings, openSettings, rootAccent } from "./helpers/settings";

const TEAL = "rgb(0, 133, 115)";

interface Sample {
  readonly root: string;
  readonly element: string | null;
}

interface AccentFade {
  readonly duration: number | string | undefined;
  readonly startTime: number | null;
  readonly midRoot: string;
  readonly midElement: string | null;
  readonly endRoot: string;
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

/**
 * Catches the next `--color-accent` transition on the root and samples it at
 * its midpoint by seeking, so the check does not depend on how many frames a
 * busy machine renders during the fade.
 */
function watchAccentFade(selector: string) {
  const w = window as any;
  w.__accentFade = null;
  const accent = (element: Element) =>
    getComputedStyle(element).getPropertyValue("--color-accent").trim();
  const onRun = (event: TransitionEvent) => {
    const root = document.documentElement;
    if (event.target !== root || event.propertyName !== "--color-accent") {
      return;
    }
    document.removeEventListener("transitionrun", onRun);
    const transition = root
      .getAnimations()
      .find(
        (a): a is CSSTransition =>
          a instanceof CSSTransition &&
          a.transitionProperty === "--color-accent",
      );
    if (!transition) {
      w.__accentFade = { missing: true };
      return;
    }
    const startTime = transition.startTime;
    transition.pause();
    transition.currentTime = 150;
    const element = document.querySelector(selector);
    const fade = {
      duration: transition.effect?.getComputedTiming().duration,
      startTime: startTime === null ? null : Number(startTime),
      midRoot: accent(root),
      midElement: element ? accent(element) : null,
      endRoot: "",
    };
    transition.finish();
    w.__accentFade = { ...fade, endRoot: accent(root) };
  };
  document.addEventListener("transitionrun", onRun);
}

function watchFirstTreeFrame() {
  const w = window as any;
  w.__firstTreeFrameTime = null;
  const frame = (time: number) => {
    if (document.querySelector("[role='tree']")) {
      w.__firstTreeFrameTime = time;
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function accentFade(page: Page): Promise<AccentFade> {
  await expect
    .poll(() => page.evaluate(() => (window as any).__accentFade))
    .not.toBeNull();
  const fade = await page.evaluate(() => (window as any).__accentFade);
  expect(fade).not.toHaveProperty("missing");
  return fade as AccentFade;
}

function channels(color: string): number[] {
  return (color.match(/[\d.]+/g) ?? []).map(Number);
}

function expectBetween(color: string | null, from: string, to: string) {
  const [value, a, b] = [channels(color ?? ""), channels(from), channels(to)];
  expect(value).toHaveLength(a.length);
  expect(color).not.toBe(from);
  expect(color).not.toBe(to);
  for (const [i, channel] of value.entries()) {
    if (a[i] === b[i]) {
      expect(channel).toBe(a[i]);
    } else {
      expect(channel).toBeGreaterThan(Math.min(a[i], b[i]));
      expect(channel).toBeLessThan(Math.max(a[i], b[i]));
    }
  }
}

function expectFade(
  fade: AccentFade,
  from: string,
  to: string,
  { element }: { readonly element: boolean },
) {
  expect(from).not.toBe(to);
  expect(fade.duration).toBe(300);
  expectBetween(fade.midRoot, from, to);
  if (element) {
    expect(fade.midElement).toBe(fade.midRoot);
  }
  expect(fade.endRoot).toBe(to);
}

async function saveTeal(page: Page): Promise<void> {
  await openSettings(page);
  await chooseAccent(page, "Teal");
  await expect
    .poll(() => fakeForge(page).commitMessages(), { timeout: 10_000 })
    .toContainEqual(expect.stringContaining("accentColor"));
  await closeSettings(page);
  await expect.poll(() => rootAccent(page)).toBe(TEAL);
}

async function settle(page: Page, accent: string): Promise<void> {
  await expect.poll(() => rootAccent(page)).toBe(accent);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.getAnimations().length),
    )
    .toBe(0);
}

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the saved accent fades in on the passphrase step and back to system on logout", async ({
    page,
  }) => {
    await openNotes(page);
    const system = await rootAccent(page);
    await settle(page, system);
    await saveTeal(page);
    await logOut(page);
    await expect(page.getByLabel("Access token")).toBeVisible({
      timeout: 10_000,
    });
    await settle(page, system);

    await page.getByLabel("Access token").fill("test-token");
    await page.evaluate(watchAccentFade, "#login-passphrase");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByLabel("Passphrase", { exact: true })).toBeVisible();
    expectFade(await accentFade(page), system, TEAL, { element: true });
    await settle(page, TEAL);

    await page.getByLabel("Passphrase", { exact: true }).fill(SAMPLE.passphrase);
    await page.getByRole("button", { name: "Log in" }).click();
    await expectTree(page);
    await settle(page, TEAL);

    await page.evaluate(watchAccentFade, "#login-passphrase");
    await logOut(page);
    await expect(page.getByLabel("Access token")).toBeVisible({
      timeout: 10_000,
    });
    expectFade(await accentFade(page), TEAL, system, { element: false });
    await settle(page, system);
  });

  test("a remembered session fades the saved accent in once the app has rendered", async ({
    page,
  }) => {
    await openNotes(page, { via: "login", rememberMe: true });
    const system = await rootAccent(page);
    await settle(page, system);
    await saveTeal(page);
    const exported = await fakeForge(page).exportRepo();
    await onFakeForgeReady(
      page,
      (controls, [repoKey, state]) => controls.adoptRepo(repoKey, state),
      [SAMPLE.key, exported],
    );
    await page.addInitScript(watchAccentFade, "[role='tree']");
    await page.addInitScript(watchFirstTreeFrame);

    await page.reload();
    await expectTree(page);
    const fade = await accentFade(page);
    expectFade(fade, system, TEAL, { element: true });
    // Applied in the task that mounts the app, the transition starts on the
    // same frame that first renders the tree, so the mount swallows its start.
    // Frames are always more than 1 ms apart; the margin absorbs float noise.
    const firstTreeFrameTime = await page.evaluate(
      () => (window as any).__firstTreeFrameTime as number | null,
    );
    expect(firstTreeFrameTime).not.toBeNull();
    expect(fade.startTime).toBeGreaterThan(firstTreeFrameTime! + 1);
    await settle(page, TEAL);
  });
});

test("with reduced motion the saved accent applies at once", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openNotes(page);
  const system = await rootAccent(page);
  expect(system).not.toBe(TEAL);
  await settle(page, system);
  await saveTeal(page);
  await logOut(page);
  await expect(page.getByLabel("Access token")).toBeVisible({
    timeout: 10_000,
  });
  await settle(page, system);

  await page.evaluate(startSampling, "#login-passphrase");
  await chooseRepository(page, { repo: SAMPLE.repo });
  await expect(page.getByLabel("Passphrase", { exact: true })).toBeVisible();
  await settle(page, TEAL);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__accentSamples.at(-1)?.root),
    )
    .toBe(TEAL);
  const roots = (await stopSampling(page)).map((s) => s.root);
  expect(roots[0]).toBe(system);
  expect(new Set(roots)).toEqual(new Set([system, TEAL]));
});
