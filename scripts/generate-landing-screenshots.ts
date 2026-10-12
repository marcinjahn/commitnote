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
import { openNotes } from "../e2e/helpers";
import {
  headerSyncIcon,
  openHistory,
  openWelcome,
  waitForSynced,
} from "../e2e/helpers/tree";
import { readPngSize } from "./png-size";

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

async function openWelcomeSettled(page: Page): Promise<void> {
  await openWelcome(page);
  await expect(
    page.getByRole("list", { name: "Note details" }).locator("time"),
  ).toHaveCount(2);
}

async function appendText(page: Page, text: string): Promise<void> {
  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
  await expect(headerSyncIcon(page)).toBeVisible();
  await waitForSynced(page);
}

const shots: readonly Shot[] = [
  {
    name: "desktop-editor",
    viewport: desktop,
    phone: false,
    async prepare(page) {
      await openNotes(page);
      await openWelcomeSettled(page);
    },
  },
  {
    name: "desktop-history",
    viewport: desktop,
    phone: false,
    async prepare(page) {
      await openNotes(page);
      await openWelcomeSettled(page);
      await appendText(page, "one");
      await appendText(page, " two");
      await appendText(page, " three");
      const dialog = await openHistory(page);
      await expect(dialog.getByTestId("diff-summary")).toBeVisible();
    },
  },
  {
    name: "phone-tree",
    viewport: phone,
    phone: true,
    async prepare(page) {
      await openNotes(page);
    },
  },
  {
    name: "phone-note",
    viewport: phone,
    phone: true,
    async prepare(page) {
      await openNotes(page);
      await openWelcomeSettled(page);
    },
  },
];

const social: Shot = {
  name: "social",
  viewport: { width: 1200, height: 630 },
  phone: false,
  async prepare(page) {
    await openNotes(page);
    await openWelcomeSettled(page);
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
    const baseURL = `http://localhost:${port}`;
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
