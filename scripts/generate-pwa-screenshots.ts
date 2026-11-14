import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chromium,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { preview } from "vite";
import {
  expandFolders,
  openShowcase,
  openShowcaseHeroNote,
} from "./showcase-screens";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "public/screenshots");

async function capture(
  browser: Browser,
  baseURL: string,
  options: BrowserContextOptions,
  file: string,
  prepare: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({
    ...options,
    baseURL,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    await prepare(page);
    await page.addStyleTag({
      content: ".test-mode-banner { display: none !important; }",
    });
    await page.mouse.move(0, 0);
    const path = resolve(outDir, file);
    await page.screenshot({ path, animations: "disabled", caret: "hide" });
    console.log(path);
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const port = Number(process.env.E2E_PORT ?? 4173);
  await mkdir(outDir, { recursive: true });
  const server = await preview({
    root,
    build: { outDir: "dist-fake" },
    preview: { port, strictPort: true },
  });
  try {
    const baseURL = `http://localhost:${port}/app/`;
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      await capture(
        browser,
        baseURL,
        {
          viewport: { width: 412, height: 915 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
        },
        "narrow.png",
        async (page) => {
          await openShowcase(page);
          await expandFolders(page, ["Projects", "Travel"]);
        },
      );
      await capture(
        browser,
        baseURL,
        { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
        "wide.png",
        openShowcaseHeroNote,
      );
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
