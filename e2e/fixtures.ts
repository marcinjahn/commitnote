import { test as base, type BrowserContext } from "@playwright/test";

export { expect } from "@playwright/test";

export type ForgeLatencyOption = "none" | "github";

export const test = base.extend<{
  forgeLatency: ForgeLatencyOption;
  prepareContext: (context: BrowserContext) => Promise<void>;
}>({
  forgeLatency: ["none", { option: true }],
  prepareContext: async ({ forgeLatency }, use) => {
    await use(async (context) => {
      await context.addInitScript((latency) => {
        const w = window as unknown as Record<string, object | undefined>;
        w.__commitNoteFakeForgeOptions = {
          ...w.__commitNoteFakeForgeOptions,
          latency,
        };
      }, forgeLatency);
    });
  },
  context: async ({ context, prepareContext }, use) => {
    await prepareContext(context);
    await use(context);
  },
});
