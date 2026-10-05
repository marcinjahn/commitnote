import { test as base, type BrowserContext } from "@playwright/test";

export { expect } from "@playwright/test";

export type ForgeLatencyOption = "none" | "github";

export const test = base.extend<
  {
    forgeLatency: ForgeLatencyOption;
    argon2Cache: boolean;
    prepareContext: (context: BrowserContext) => Promise<void>;
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
  prepareContext: async (
    { forgeLatency, argon2Cache, argon2Results },
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
        argon2Cache
          ? { latency: forgeLatency, argon2Results: [...argon2Results] }
          : { latency: forgeLatency },
      );
    });
  },
  context: async ({ context, prepareContext }, use) => {
    await prepareContext(context);
    await use(context);
  },
});
