import {
  test as base,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";

export { expect } from "@playwright/test";

export type ForgeLatencyOption = "none" | "github";

export type PlatformOption =
  | "mac"
  | "windows"
  | "linux"
  | "ios"
  | "android"
  | "other"
  | "detect";

export const test = base.extend<
  {
    forgeLatency: ForgeLatencyOption;
    platform: PlatformOption;
    argon2Cache: boolean;
    prepareContext: (context: BrowserContext) => Promise<void>;
    openSecondDevice: (
      options?: BrowserContextOptions,
    ) => Promise<{ context: BrowserContext; page: Page }>;
  },
  { argon2Results: Map<string, string> }
>({
  forgeLatency: ["none", { option: true }],
  argon2Cache: [true, { option: true }],
  platform: ["other", { option: true }],
  argon2Results: [
    async ({}, use) => {
      await use(new Map());
    },
    { scope: "worker" },
  ],
  prepareContext: async (
    { forgeLatency, argon2Cache, platform, argon2Results },
    use,
  ) => {
    await use(async (context) => {
      if (argon2Cache) {
        await context.exposeBinding(
          "__commitNoteFakeForgeArgon2Derived",
          (_source, key: string, hash: string) => {
            argon2Results.set(key, hash);
          },
        );
      }
      await context.addInitScript(
        (options) => {
          const w = window as unknown as Record<string, object | undefined>;
          w.__commitNoteFakeForgeOptions = {
            ...w.__commitNoteFakeForgeOptions,
            ...options,
          };
        },
        {
          latency: forgeLatency,
          ...(platform === "detect" ? {} : { platform }),
          ...(argon2Cache ? { argon2Results: [...argon2Results] } : {}),
        },
      );
    });
  },
  openSecondDevice: async ({ browser, prepareContext }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    await use(async (options) => {
      const device = testInfo.project.use as BrowserContextOptions;
      const context = await browser.newContext({ ...device, ...options });
      contexts.push(context);
      await prepareContext(context);
      const page = await context.newPage();
      await page.goto("/");
      return { context, page };
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
  context: async ({ context, prepareContext }, use) => {
    await prepareContext(context);
    await use(context);
  },
});
