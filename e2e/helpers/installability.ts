import type {
  BrowserContext,
  LaunchOptions,
  Page,
  PlaywrightWorkerArgs,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function launchPersistentPage(
  playwright: PlaywrightWorkerArgs["playwright"],
  options: {
    baseURL: string | undefined;
    channel: string | undefined;
    headless: boolean;
    launchOptions: LaunchOptions;
  },
): Promise<{ context: BrowserContext; page: Page; close: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "commitnote-pwa-"));
  try {
    const context = await playwright.chromium.launchPersistentContext(dir, {
      ...options.launchOptions,
      headless: options.headless,
      channel: options.channel ?? "chromium",
      baseURL: options.baseURL,
    });
    const page = context.pages()[0] ?? (await context.newPage());
    return {
      context,
      page,
      close: async () => {
        await context.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

export async function installabilityErrors(page: Page): Promise<string[]> {
  const session = await page.context().newCDPSession(page);
  try {
    const { installabilityErrors } = await session.send(
      "Page.getInstallabilityErrors",
    );
    return installabilityErrors.map((error) => error.errorId);
  } finally {
    await session.detach();
  }
}

export async function appManifest(
  page: Page,
): Promise<{ url: string; errors: string[]; data: string | undefined }> {
  const session = await page.context().newCDPSession(page);
  try {
    const { url, errors, data } = await session.send("Page.getAppManifest", {});
    return { url, errors: errors.map((error) => error.message), data };
  } finally {
    await session.detach();
  }
}
