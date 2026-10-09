import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  workers: 5,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    serviceWorkers: "block",
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@mobile-only/,
      testIgnore: /installability\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      grep: /@mobile/,
      testIgnore: /installability\.spec\.ts/,
    },
    {
      name: "installability",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
      testMatch: /installability\.spec\.ts/,
    },
  ],
  webServer: {
    command: `npm run build:fake -- --if-stale && npm run preview:fake -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
