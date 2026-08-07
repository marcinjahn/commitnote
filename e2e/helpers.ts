import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export interface LogInOptions {
  readonly repo: string;
  readonly token?: string;
  readonly passphrase: string;
  readonly rememberMe?: boolean;
}

export async function logIn(page: Page, options: LogInOptions): Promise<void> {
  await page.getByLabel("Repo URL").fill(options.repo);
  await page.getByLabel("Access token").fill(options.token ?? "test-token");
  await page.getByLabel("Passphrase", { exact: true }).fill(options.passphrase);
  if (options.rememberMe) {
    await page.getByRole("checkbox", { name: "Remember me" }).check();
  }
  await page.getByRole("button", { name: "Log in" }).click();
}

export async function expectTree(page: Page): Promise<void> {
  // Real Argon2id key derivation runs on every login (~1s in Chromium, more
  // under parallel test workers), so give it more room than the default
  // 5s expect timeout.
  await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible({
    timeout: 15_000,
  });
}
