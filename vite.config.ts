import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import { buildModeFacts } from "./scripts/build-mode.ts";
import { commitNoteCsp } from "./scripts/csp-plugin.ts";
import { serviceWorker } from "./scripts/service-worker-plugin.ts";

const OUT_DIRS: Record<string, string> = {
  desktop: "dist-desktop",
  "desktop-fake": "dist-desktop-fake",
};

export default defineConfig(({ mode }) => {
  const { desktopShell, fakeForge } = buildModeFacts(mode);
  return {
    base: "./",
    define: {
      __DESKTOP_SHELL__: JSON.stringify(desktopShell),
      __FAKE_FORGE__: JSON.stringify(fakeForge),
    },
    plugins: desktopShell
      ? [svelte(), commitNoteCsp("desktop")]
      : [svelte(), commitNoteCsp("web"), serviceWorker()],
    optimizeDeps: { include: ["@replit/codemirror-vim"] },
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
