import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export interface LogInOptions {
  readonly repo: string;
  readonly token?: string;
  readonly passphrase: string;
  readonly rememberMe?: boolean;
  readonly provider?: string;
}

export async function continueWithToken(
  page: Page,
  token = "test-token",
): Promise<void> {
  await page.getByLabel("Access token").fill(token);
  await page.getByRole("button", { name: "Continue" }).click();
}

export interface ChooseRepositoryOptions {
  readonly repo: string;
  readonly token?: string;
  readonly provider?: string;
}

export async function chooseRepository(
  page: Page,
  options: ChooseRepositoryOptions,
): Promise<void> {
  if (options.provider) {
    await page.getByRole("radio", { name: options.provider }).check();
  }
  await continueWithToken(page, options.token);
  await page.getByLabel("Repository", { exact: true }).selectOption({
    label: options.repo.replace(/^https:\/\/[^/]+\//, ""),
  });
}

export async function logIn(page: Page, options: LogInOptions): Promise<void> {
  await chooseRepository(page, options);
  const passphrase = page.getByLabel("Passphrase", { exact: true });
  await expect(passphrase).toBeVisible();
  await passphrase.fill(options.passphrase);
  if (options.rememberMe) {
    await page.getByRole("checkbox", { name: "Remember me" }).check();
  }
  await page.getByRole("button", { name: "Log in" }).click();
}

export async function setUpNotesRepo(
  page: Page,
  options: LogInOptions,
): Promise<void> {
  await chooseRepository(page, options);
  await page.getByLabel("Create passphrase").fill(options.passphrase);
  await page.getByLabel("Repeat passphrase").fill(options.passphrase);
  if (options.rememberMe) {
    await page.getByRole("checkbox", { name: "Remember me" }).check();
  }
  await page.getByRole("button", { name: "Set up notes repo" }).click();
}

export async function expectTree(page: Page): Promise<void> {
  // Real Argon2id key derivation runs on every login (~1s in Chromium, more
  // under parallel test workers), so give it more room than the default
  // 5s expect timeout.
  await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible({
    timeout: 15_000,
  });
}
