import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import {
  chromium,
  expect,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { preview } from "vite";
import {
  headerSyncIcon,
  openHistory,
  waitForSynced,
} from "../e2e/helpers/tree";
import { readPngSize } from "./png-size";
import { openShowcaseHeroNote } from "./showcase-screens";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotsDir = resolve(root, "landing/screenshots");
const socialPath = resolve(root, "landing/public/social.png");
const fixedTime = new Date("2026-10-01T09:30:00Z");
const maxBytes = 400 * 1024;

type Scheme = "light" | "dark";
type Scale = 1 | 2;

interface Shot {
  readonly name: string;
  readonly viewport: { width: number; height: number };
  readonly phone: boolean;
  prepare(page: Page): Promise<void>;
}

const desktop = { width: 1280, height: 800 };
const phone = { width: 412, height: 915 };

async function saveEditAt(
  page: Page,
  time: string,
  edit: () => Promise<void>,
): Promise<void> {
  await page.clock.setFixedTime(new Date(time));
  await edit();
  await expect(headerSyncIcon(page)).toBeVisible();
  await waitForSynced(page);
}

async function editHeroNote(page: Page): Promise<void> {
  await saveEditAt(page, "2026-10-01T10:12:00Z", () =>
    page
      .getByRole("checkbox", { name: "Task: Send a frost alert below 2 °C" })
      .click(),
  );
  await saveEditAt(page, "2026-10-01T11:05:00Z", async () => {
    await page
      .locator(".cm-line", { hasText: "Send a frost alert below 2 °C" })
      .click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Weatherproof the enclosure");
  });
}

const shots: readonly Shot[] = [
  {
    name: "desktop-editor",
    viewport: desktop,
    phone: false,
    async prepare(page) {
      await openShowcaseHeroNote(page);
    },
  },
  {
    name: "desktop-history",
    viewport: desktop,
    phone: false,
    async prepare(page) {
      await openShowcaseHeroNote(page);
      await editHeroNote(page);
      const dialog = await openHistory(page);
      await dialog.getByRole("button", { name: /Created/ }).click();
      await expect(dialog.getByTestId("diff-summary")).toBeVisible();
    },
  },
  {
    name: "phone-note",
    viewport: phone,
    phone: true,
    async prepare(page) {
      await openShowcaseHeroNote(page);
    },
  },
];

const social: Shot = {
  name: "social",
  viewport: { width: 1200, height: 630 },
  phone: false,
  async prepare(page) {
    await openShowcaseHeroNote(page);
    // Scroll past the note details so the cut falls inside the code block.
    await page.locator(".note-content").evaluate((pane) => {
      pane.scrollTop = 64;
    });
  },
};

function recompressPng(bytes: Uint8Array): Buffer {
  const buffer = Buffer.from(bytes);
  const signature = buffer.subarray(0, 8);
  const idat: Buffer[] = [];
  const kept: { before: Buffer[]; after: Buffer[] } = { before: [], after: [] };
  let seenData = false;
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const chunk = buffer.subarray(offset, offset + 12 + length);
    if (type === "IDAT") {
      idat.push(buffer.subarray(offset + 8, offset + 8 + length));
      seenData = true;
    } else {
      (seenData ? kept.after : kept.before).push(chunk);
    }
    offset += 12 + length;
  }
  const data = deflateSync(inflateSync(Buffer.concat(idat)), { level: 9 });
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write("IDAT", 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0);
  return Buffer.concat([
    signature,
    ...kept.before,
    header,
    data,
    crc,
    ...kept.after,
  ]);
}

async function capture(
  browser: Browser,
  baseURL: string,
  shot: Shot,
  scheme: Scheme,
  scale: Scale,
  path: string,
): Promise<void> {
  const options: BrowserContextOptions = {
    viewport: shot.viewport,
    deviceScaleFactor: scale,
    ...(shot.phone ? { isMobile: true, hasTouch: true } : {}),
    baseURL,
    colorScheme: scheme,
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
  };
  const context = await browser.newContext(options);
  try {
    // tsx wraps functions with __name, which e2e helpers serialize into the page.
    await context.addInitScript("window.__name = (fn) => fn;");
    const page = await context.newPage();
    await page.clock.setFixedTime(fixedTime);
    await shot.prepare(page);
    await page.addStyleTag({
      content:
        ".test-mode-banner { display: none !important; } .commit-sha { visibility: hidden; }",
    });
    await page.mouse.move(0, 0);
    await page.screenshot({ path, animations: "disabled", caret: "hide" });
  } finally {
    await context.close();
  }
  await writeFile(path, recompressPng(await readFile(path)));
}

async function verify(
  path: string,
  viewport: { width: number; height: number },
  scale: Scale,
): Promise<string[]> {
  const bytes = await readFile(path);
  const { width, height } = readPngSize(bytes);
  const problems: string[] = [];
  const name = relative(root, path);
  if (width !== viewport.width * scale || height !== viewport.height * scale) {
    problems.push(
      `${name}: ${width}x${height}, expected ${viewport.width * scale}x${viewport.height * scale}`,
    );
  }
  if (bytes.length > maxBytes) {
    problems.push(`${name}: ${bytes.length} bytes exceeds ${maxBytes}`);
  }
  return problems;
}

async function main(): Promise<void> {
  const port = Number(process.env.E2E_PORT ?? 4173);
  await mkdir(screenshotsDir, { recursive: true });
  await mkdir(dirname(socialPath), { recursive: true });
  const server = await preview({
    root,
    build: { outDir: "dist-fake" },
    preview: { port, strictPort: true },
  });
  const problems: string[] = [];
  try {
    const baseURL = `http://localhost:${port}/app/`;
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      for (const shot of shots) {
        for (const scheme of ["light", "dark"] as const) {
          for (const scale of [1, 2] as const) {
            const path = resolve(
              screenshotsDir,
              `${shot.name}-${scheme}@${scale}x.png`,
            );
            await capture(browser, baseURL, shot, scheme, scale, path);
            problems.push(...(await verify(path, shot.viewport, scale)));
            console.log(path);
          }
        }
      }
      await capture(browser, baseURL, social, "light", 1, socialPath);
      problems.push(...(await verify(socialPath, social.viewport, 1)));
      console.log(socialPath);
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
  if (problems.length > 0) {
    throw new Error(`Invalid landing screenshots:\n${problems.join("\n")}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
