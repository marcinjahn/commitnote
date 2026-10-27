import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import { buildModeFacts } from "./scripts/build-mode.ts";
import { commitNoteCsp } from "./scripts/csp-plugin.ts";
import { nativeCoreArgon2Redirect } from "./scripts/native-core-argon2-plugin.ts";
import { dropUnusedWasmAsset } from "./scripts/drop-unused-wasm-asset.ts";
import { serviceWorker } from "./scripts/service-worker-plugin.ts";

const OUT_DIRS: Record<string, string> = {
  production: "dist/app",
  "fake-forge": "dist-fake/app",
  desktop: "dist-desktop",
  "desktop-fake": "dist-desktop-fake",
};

const NATIVE_CORE_BUILDS: Record<string, { entry: string; outDir: string }> = {
  "native-core": {
    entry: "src/native-core/entry.ts",
    outDir: "dist-native-core",
  },
  "native-core-fake": {
    entry: "src/native-core/entry-fake.ts",
    outDir: "dist-native-core-fake",
  },
};

export default defineConfig(({ mode, command }) => {
  const facts = buildModeFacts(mode);
  const { desktopShell, fakeForge } = facts;
  const nativeCore = NATIVE_CORE_BUILDS[mode];
  if (nativeCore !== undefined) {
    return {
      publicDir: false,
      define: {
        __DESKTOP_SHELL__: "false",
        __FAKE_FORGE__: JSON.stringify(fakeForge),
        __ANALYTICS_ENDPOINT__: "null",
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
      plugins: [nativeCoreArgon2Redirect()],
      build: {
        target: "es2022",
        outDir: nativeCore.outDir,
        emptyOutDir: true,
        copyPublicDir: false,
        lib: {
          entry: nativeCore.entry,
          formats: ["iife"],
          name: "__commitnoteCoreBundle",
          fileName: () => "commitnote-core.js",
        },
        rollupOptions: {
          output: { strictExecutionOrder: true, codeSplitting: false },
        },
      },
    };
  }
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
      ? [svelte(), commitNoteCsp("desktop", facts.analyticsEndpoint), dropUnusedWasmAsset()]
      : [
          svelte(),
          commitNoteCsp("web", facts.analyticsEndpoint),
          dropUnusedWasmAsset(),
          serviceWorker(),
        ],
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
      setupFiles: ["src/test-setup.ts"],
      css: { include: /\.css\?raw$/ },
      passWithNoTests: true,
      testTimeout: 30000,
    },
  };
});
