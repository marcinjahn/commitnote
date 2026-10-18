import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import { buildModeFacts } from "./scripts/build-mode.ts";
import { commitNoteCsp } from "./scripts/csp-plugin.ts";
import { serviceWorker } from "./scripts/service-worker-plugin.ts";

const OUT_DIRS: Record<string, string> = {
  production: "dist/app",
  "fake-forge": "dist-fake/app",
  desktop: "dist-desktop",
  "desktop-fake": "dist-desktop-fake",
};

export default defineConfig(({ mode, command }) => {
  const facts = buildModeFacts(mode);
  const { desktopShell, fakeForge } = facts;
  return {
    base: "./",
    define: {
      __DESKTOP_SHELL__: JSON.stringify(desktopShell),
      __FAKE_FORGE__: JSON.stringify(fakeForge),
      __ANALYTICS_ENDPOINT__: JSON.stringify(
        command === "build" ? facts.analyticsEndpoint : null,
      ),
    },
    plugins: desktopShell
      ? [svelte(), commitNoteCsp("desktop", facts.analyticsEndpoint)]
      : [svelte(), commitNoteCsp("web", facts.analyticsEndpoint), serviceWorker()],
    optimizeDeps: {
      include: [
        "@replit/codemirror-vim",
        "@jsquash/webp/codec/enc/webp_enc.js",
        "@jsquash/webp/meta.js",
      ],
    },
    build: {
      ...(OUT_DIRS[mode] ? { outDir: OUT_DIRS[mode] } : {}),
      assetsInlineLimit: (filePath: string) =>
        /\.(woff2|svg)$/.test(filePath) ? false : undefined,
    },
    test: {
      include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "landing/**/*.test.ts"],
      environment: "node",
      css: { include: /\.css\?raw$/ },
      passWithNoTests: true,
      testTimeout: 30000,
    },
  };
});
