import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export const IPHONE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

interface InstallWindow {
  __installPromptCalls?: number;
}

export function installBar(page: Page): Locator {
  return page.getByRole("region", { name: "Install app" });
}

export async function offerInstallPrompt(
  page: Page,
  outcome: "accepted" | "dismissed" = "accepted",
): Promise<void> {
  await page.evaluate((chosen) => {
    const host = window as unknown as InstallWindow;
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: () => {
        host.__installPromptCalls = (host.__installPromptCalls ?? 0) + 1;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: chosen, platform: "web" }),
    });
    window.dispatchEvent(event);
  }, outcome);
}

export function installPromptCalls(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as InstallWindow).__installPromptCalls ?? 0,
  );
}

export async function announceInstalled(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
}

export async function emulateStandalone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      const list = original(query);
      const forced = /^\(display-mode:\s*(standalone|browser)\)$/.exec(query);
      if (forced === null) return list;
      return new Proxy(list, {
        get(target, property) {
          if (property === "matches") return forced[1] === "standalone";
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    };
  });
}

export async function openCommands(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "More commands" }).click();
  const menu = page.getByRole("menu", { name: "Commands" });
  await expect(menu).toBeVisible();
  return menu;
}
