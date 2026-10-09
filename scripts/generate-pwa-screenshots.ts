import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContextOptions } from "@playwright/test";
import { preview } from "vite";
import { openNotes } from "../e2e/helpers";
import { openWelcome } from "../e2e/helpers/tree";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "public/screenshots");

async function capture(
  browser: Browser,
  baseURL: string,
  options: BrowserContextOptions,
  file: string,
  openNote: boolean,
): Promise<void> {
  const context = await browser.newContext({
    ...options,
    baseURL,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    await openNotes(page);
    if (openNote) {
      await openWelcome(page);
    }
    await page.addStyleTag({
      content: ".test-mode-banner { display: none !important; }",
    });
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
    const baseURL = `http://localhost:${port}`;
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
        false,
      );
      await capture(
        browser,
        baseURL,
        { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
        "wide.png",
        true,
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
