import {
  test as base,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type Request,
} from "@playwright/test";

export { expect } from "@playwright/test";

export const FAKE_ANALYTICS_ORIGIN = "https://analytics.invalid";

export type ForgeLatencyOption = "none" | "github";

export const test = base.extend<
  {
    forgeLatency: ForgeLatencyOption;
    argon2Cache: boolean;
    analyticsRequests: Request[];
    prepareContext: (context: BrowserContext) => Promise<void>;
    openSecondDevice: (
      options?: BrowserContextOptions,
    ) => Promise<{ context: BrowserContext; page: Page }>;
  },
  { argon2Results: Map<string, string> }
>({
  forgeLatency: ["none", { option: true }],
  argon2Cache: [true, { option: true }],
  argon2Results: [
    async ({}, use) => {
      await use(new Map());
    },
    { scope: "worker" },
  ],
  analyticsRequests: async ({ context }, use) => {
    const requests: Request[] = [];
    context.on("request", (request) => {
      if (request.url().startsWith(`${FAKE_ANALYTICS_ORIGIN}/`)) {
        requests.push(request);
      }
    });
    await use(requests);
  },
  prepareContext: async (
    { forgeLatency, argon2Cache, argon2Results },
    use,
  ) => {
    await use(async (context) => {
      await context.route(`${FAKE_ANALYTICS_ORIGIN}/**`, (route) =>
        route.fulfill({ status: 204 }),
      );
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
        argon2Cache
          ? { latency: forgeLatency, argon2Results: [...argon2Results] }
          : { latency: forgeLatency },
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
      await page.goto("./");
      return { context, page };
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
  context: async ({ context, prepareContext }, use) => {
    await prepareContext(context);
    await use(context);
  },
});
