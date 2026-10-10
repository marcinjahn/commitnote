import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function settledBox(target: Locator) {
  await expect
    .poll(() =>
      target.evaluate(
        (el) =>
          (el.closest("dialog") ?? el)
            .getAnimations({ subtree: true })
            .filter(
              (animation) =>
                animation.effect?.getComputedTiming().iterations !== Infinity,
            ).length,
      ),
    )
    .toBe(0);
  return (await target.boundingBox())!;
}

export async function installFakeKeyboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let keyboard = 0;
    const fake = new EventTarget();
    Object.defineProperties(fake, {
      offsetTop: { value: 0 },
      offsetLeft: { value: 0 },
      pageTop: { value: 0 },
      pageLeft: { value: 0 },
      scale: { value: 1 },
      height: {
        get: () => document.documentElement.clientHeight - keyboard,
      },
      width: { get: () => window.innerWidth },
    });
    Object.defineProperty(window, "visualViewport", {
      value: fake,
      configurable: true,
    });
    Object.defineProperty(window, "__setFakeKeyboard", {
      value: (px: number) => {
        keyboard = px;
        fake.dispatchEvent(new Event("resize"));
      },
    });
  });
}

export async function setKeyboard(page: Page, px: number): Promise<void> {
  await page.evaluate(
    (value) =>
      (window as unknown as { __setFakeKeyboard(px: number): void }).__setFakeKeyboard(
        value,
      ),
    px,
  );
}
