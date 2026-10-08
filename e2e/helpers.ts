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

type OpenNotesOptions = { readonly repo?: string } & (
  | { readonly via?: "restore" }
  | {
      readonly via: "login";
      readonly token?: string;
      readonly passphrase?: string;
      readonly rememberMe?: boolean;
      readonly provider?: string;
    }
);

/**
 * Opens the notes of `repo`: by default from a remembered session the fake
 * forge stores before the app starts, or through the login screen with
 * `via: "login"`.
 */
export async function openNotes(
  page: Page,
  options: OpenNotesOptions = {},
): Promise<void> {
  const repo = options.repo ?? SAMPLE.repo;
  if (options.via === "login") {
    await page.goto("/");
    await logIn(page, {
      ...options,
      repo,
      passphrase: options.passphrase ?? SAMPLE.passphrase,
    });
  } else {
    await page.goto("/?fake-forge-session=" + encodeURIComponent(repo));
  }
  await expectTree(page);
}

interface FakeForgeControls {
  commitMessages(repoKey: string): string[];
  failNext(repoKey: string, operation: string, kind: string): void;
  editNote(
    repoKey: string,
    notePath: readonly string[],
    markdown: string,
  ): Promise<void>;
  exportRepo(repoKey: string): string;
  adoptRepo(repoKey: string, exported: string): void;
  changeRepoKey(repoKey: string): Promise<void>;
  blobReads(repoKey: string): readonly string[];
}

type FakeForgeWindow = { __commitNoteFakeForge: FakeForgeControls };

async function controlsReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as Partial<FakeForgeWindow>).__commitNoteFakeForge,
  );
}

export function fakeForge(page: Page, repoKey: string = SAMPLE.key) {
  return {
    commitMessages: () =>
      page.evaluate(
        (key) =>
          (window as unknown as FakeForgeWindow).__commitNoteFakeForge.commitMessages(
            key,
          ),
        repoKey,
      ),
    commitCount: async () =>
      (
        await page.evaluate(
          (key) =>
            (
              window as unknown as FakeForgeWindow
            ).__commitNoteFakeForge.commitMessages(key),
          repoKey,
        )
      ).length,
    failNext: async (operation: string, kind: string) => {
      await controlsReady(page);
      await page.evaluate(
        ([key, op, errorKind]) =>
          (window as unknown as FakeForgeWindow).__commitNoteFakeForge.failNext(
            key,
            op,
            errorKind,
          ),
        [repoKey, operation, kind] as const,
      );
    },
    editNote: (notePath: readonly string[], markdown: string) =>
      page.evaluate(
        ([key, path, text]) =>
          (window as unknown as FakeForgeWindow).__commitNoteFakeForge.editNote(
            key,
            path,
            text,
          ),
        [repoKey, notePath, markdown] as const,
      ),
    exportRepo: () =>
      page.evaluate(
        (key) =>
          (window as unknown as FakeForgeWindow).__commitNoteFakeForge.exportRepo(
            key,
          ),
        repoKey,
      ),
    adoptRepo: async (state: string) => {
      await controlsReady(page);
      await page.evaluate(
        ([key, exported]) =>
          (window as unknown as FakeForgeWindow).__commitNoteFakeForge.adoptRepo(
            key,
            exported,
          ),
        [repoKey, state] as const,
      );
    },
    blobReads: async () => {
      await controlsReady(page);
      return page.evaluate(
        (key) =>
          (window as unknown as FakeForgeWindow).__commitNoteFakeForge.blobReads(
            key,
          ),
        repoKey,
      );
    },
    changeRepoKey: () =>
      page.evaluate(
        (key) =>
          (
            window as unknown as FakeForgeWindow
          ).__commitNoteFakeForge.changeRepoKey(key),
        repoKey,
      ),
  };
}

export async function blobCacheEntryCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("commitnote-blobs");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("blobs")) {
            db.close();
            resolve(0);
            return;
          }
          const count = db
            .transaction("blobs", "readonly")
            .objectStore("blobs")
            .count();
          count.onerror = () => {
            db.close();
            reject(count.error);
          };
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
        };
      }),
  );
}

export async function handOverRepo(
  from: Page,
  to: Page,
  repoKey: string = SAMPLE.key,
): Promise<void> {
  await fakeForge(to, repoKey).adoptRepo(await fakeForge(from, repoKey).exportRepo());
}

/**
 * Runs `callback` with the fake-forge controls in every document of `page`,
 * as soon as the app publishes them. The callback is serialized, so it cannot
 * use variables from the surrounding scope; pass them as `arg`.
 */
export async function onFakeForgeReady<Arg>(
  page: Page,
  callback: (controls: FakeForgeControls, arg: Arg) => void,
  arg: Arg,
): Promise<void> {
  const hook = (
    run: (controls: FakeForgeControls, arg: Arg) => void,
    runArg: Arg,
  ) => {
    let controls: FakeForgeControls | undefined;
    Object.defineProperty(window, "__commitNoteFakeForge", {
      configurable: true,
      get: () => controls,
      set: (value: FakeForgeControls) => {
        controls = value;
        run(value, runArg);
      },
    });
  };
  await page.addInitScript({
    content: `(${hook.toString()})(${callback.toString()}, ${JSON.stringify(arg)})`,
  });
}

export async function flushPendingSaves(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    delete (document as { visibilityState?: unknown }).visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

export async function expectSettingsIdle(page: Page): Promise<void> {
  await expect(
    page.getByRole("dialog", { name: "Settings" }).locator(".settings-save-status"),
  ).not.toContainText(/Waiting to save|Saving\b/);
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
    .and(page.locator("[data-unsynced]"))
    .or(item.locator(
      "xpath=following-sibling::span[contains(concat(' ', normalize-space(@class), ' '), ' sync-indicator ')]",
    ));
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
  private static readonly EVENT_INTERVAL_S = 0.016;

  private at: TouchPoint = { x: 0, y: 0 };
  private clock = Date.now() / 1000;

  private constructor(private readonly cdp: CDPSession) {}

  static async on(page: Page): Promise<TouchFinger> {
    return new TouchFinger(await page.context().newCDPSession(page));
  }

  async down(point: TouchPoint, timestamp?: number): Promise<void> {
    this.at = point;
    await this.cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
      timestamp: this.stamp(timestamp),
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
        timestamp: this.stamp(timestamp, TouchFinger.EVENT_INTERVAL_S),
      });
    }
  }

  async up(timestamp?: number): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
      timestamp: this.stamp(timestamp),
    });
    await this.cdp.detach();
  }

  hold(ms: number): void {
    this.clock += ms / 1000;
  }

  private stamp(explicit?: number, advance = 0): number {
    this.clock = explicit ?? this.clock + advance;
    return this.clock;
  }
}

export const SERIF_STACK =
  'ui-serif, Charter, "Bitstream Charter", "Iowan Old Style", Georgia, Cambria, "Noto Serif", "Times New Roman", serif';
export const MONO_STACK = "var(--font-mono)";

export function expectedFamily(page: Page, stack: string): Promise<string> {
  return page.evaluate((value) => {
    const probe = document.createElement("span");
    probe.style.fontFamily = value;
    document.body.appendChild(probe);
    const family = getComputedStyle(probe).fontFamily;
    probe.remove();
    return family;
  }, stack);
}

export async function expectFamily(
  page: Page,
  locator: Locator,
  stack: string,
): Promise<void> {
  const expected = await expectedFamily(page, stack);
  await expect
    .poll(() => locator.evaluate((el) => getComputedStyle(el).fontFamily))
    .toBe(expected);
}
