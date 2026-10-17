import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { A11Y_EXCLUSIONS } from "../a11y-exclusions";

export type A11yState =
  | "login"
  | "login-error"
  | "onboarding"
  | "tree"
  | "note"
  | "note-vim"
  | "commands-menu"
  | "row-menu"
  | "error-toast"
  | "settings"
  | "change-passphrase"
  | "search-results"
  | "search-no-matches"
  | "history"
  | "share-dialog"
  | "share-link-created"
  | "shared-links"
  | "trash"
  | "trashed-note"
  | "viewer-password"
  | "viewer-unlocked"
  | "install-bar"
  | "install-bar-login"
  | "install-bar-ios"
  | "install-howto";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const BEST_PRACTICE_RULES = [
  "region",
  "landmark-one-main",
  "page-has-heading-one",
];

type Scheme = "light" | "dark";

async function useScheme(page: Page, scheme: Scheme): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await page.waitForFunction(
    (expected) =>
      getComputedStyle(document.documentElement).colorScheme.includes(expected),
    scheme,
  );
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

async function scan(page: Page, state: A11yState, scheme: Scheme) {
  await useScheme(page, scheme);
  const results = await new AxeBuilder({ page })
    .exclude(".test-mode-banner")
    .options({
      runOnly: { type: "tag", values: TAGS },
      rules: Object.fromEntries(
        BEST_PRACTICE_RULES.map((rule) => [rule, { enabled: true }]),
      ),
    })
    .analyze();
  const lines: string[] = [];
  for (const violation of results.violations) {
    for (const node of violation.nodes) {
      const target = node.target.join(" ");
      const excluded = A11Y_EXCLUSIONS.some(
        (entry) =>
          entry.rule === violation.id &&
          entry.states.includes(state) &&
          (entry.projects === undefined ||
            entry.projects.includes(test.info().project.name)) &&
          (entry.target === undefined || target.includes(entry.target)),
      );
      if (!excluded) {
        lines.push(
          `${violation.id} [${state}, ${scheme}] ${target} — ${violation.help}`,
        );
      }
    }
  }
  return lines;
}

export async function expectNoA11yViolations(
  page: Page,
  state: A11yState,
): Promise<void> {
  const lines = [
    ...(await scan(page, state, "light")),
    ...(await scan(page, state, "dark")),
  ];
  expect(lines.join("\n")).toBe("");
}
