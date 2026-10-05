import type { CDPSession, Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

interface LogInOptions {
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

interface ChooseRepositoryOptions {
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
  const select = page.getByLabel("Repository", { exact: true });
  if ((await select.inputValue()) !== options.repo) {
    await select.selectOption({
      label: options.repo.replace(/^https:\/\/[^/]+\//, ""),
    });
  }
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

// Real Argon2id key derivation runs on every set-up and on the first login with
// a given passphrase and salt in a worker (~1s in Chromium, much more under CPU
// load), so waits that follow one need more room than the default 5s expect
// timeout.
export const KEY_DERIVATION_TIMEOUT = 15_000;

export async function expectTree(page: Page): Promise<void> {
  await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible({
    timeout: KEY_DERIVATION_TIMEOUT,
  });
}

export async function expectEmptyNotesRepo(page: Page): Promise<void> {
  await expect(page.getByText("No notes yet")).toBeVisible({
    timeout: KEY_DERIVATION_TIMEOUT,
  });
}

export async function expectLoginAlert(
  page: Page,
  text: string,
): Promise<void> {
  await expect(page.getByRole("alert")).toHaveText(text, {
    timeout: KEY_DERIVATION_TIMEOUT,
  });
}

export const SAMPLE = {
  repo: "https://github.com/sample/notes",
  key: "sample/notes",
  passphrase: "sample notes repo passphrase",
} as const;

interface OpenNotesOptions {
  readonly repo?: string;
  readonly token?: string;
  readonly passphrase?: string;
  readonly rememberMe?: boolean;
  readonly provider?: string;
}

export async function openNotes(
  page: Page,
  options: OpenNotesOptions = {},
): Promise<void> {
  await page.goto("/");
  await logIn(page, {
    ...options,
    repo: options.repo ?? SAMPLE.repo,
    passphrase: options.passphrase ?? SAMPLE.passphrase,
  });
  await expectTree(page);
}

export async function showTree(page: Page): Promise<void> {
  const back = page.getByRole("button", { name: "Back to notes" });
  if (await back.isVisible()) {
    await back.click();
  }
}

export async function logOut(page: Page): Promise<void> {
  await showTree(page);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
}

// Matches while the row shows any sync state: a waiting or saving label
// (described by its state) or a failed/conflict icon next to the row.
export function rowSyncState(
  page: Page,
  name: string,
  options: { readonly exact?: boolean } = {},
): Locator {
  const item = page.getByRole("treeitem", { name, exact: options.exact });
  return item
    .and(page.locator("[aria-describedby]"))
    .or(item.locator("xpath=following-sibling::span").getByRole("img"));
}

export interface TouchPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * One finger on a touch screen, driven through CDP so the browser's own
 * gesture handling (scrolling, long-press, tap) applies.
 */
export class TouchFinger {
  private at: TouchPoint = { x: 0, y: 0 };

  private constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}

  static async on(page: Page): Promise<TouchFinger> {
    return new TouchFinger(page, await page.context().newCDPSession(page));
  }

  async down(point: TouchPoint, timestamp?: number): Promise<void> {
    this.at = point;
    await this.cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
      ...(timestamp === undefined ? {} : { timestamp }),
    });
  }

  async move(
    to: TouchPoint,
    steps = 10,
    timestamp?: number,
  ): Promise<void> {
    const from = this.at;
    for (let i = 1; i <= steps; i++) {
      this.at = {
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
      };
      await this.cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [this.at],
        ...(timestamp === undefined ? {} : { timestamp }),
      });
    }
  }

  async up(timestamp?: number): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
      ...(timestamp === undefined ? {} : { timestamp }),
    });
    await this.cdp.detach();
  }

  async hold(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }
}
