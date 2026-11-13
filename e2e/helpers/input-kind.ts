import type { Locator } from "@playwright/test";
import { expect } from "../fixtures";

const ATTRIBUTES = {
  prose: { autocapitalize: "sentences", autocorrect: "on", spellcheck: "true" },
  verbatim: { autocapitalize: "off", autocorrect: "off", spellcheck: "false" },
} as const;

export async function expectInputKind(
  locator: Locator,
  kind: "prose" | "verbatim",
): Promise<void> {
  const { autocapitalize, autocorrect, spellcheck } = ATTRIBUTES[kind];
  await expect(locator).toHaveAttribute("autocapitalize", autocapitalize);
  await expect(locator).toHaveAttribute("autocorrect", autocorrect);
  await expect(locator).toHaveAttribute("spellcheck", spellcheck);
}
