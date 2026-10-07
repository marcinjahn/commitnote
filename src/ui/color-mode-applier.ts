import { writeCachedColorMode } from "../session/color-mode-cache";
import type { StorageLike } from "../session/session-store";
import {
  COLOR_SCHEME_BACKGROUNDS,
  colorScheme,
  parseColorMode,
  type ColorModeId,
  type ColorScheme,
} from "../settings/color-mode";

export interface ColorModeApplier {
  applyColorMode(mode: ColorModeId, options: { animate: boolean }): void;
  dispose(): void;
}

const ignoreRejection = () => {};

export function createColorModeApplier(
  win: Window & typeof globalThis,
  options: {
    storage?: StorageLike | null;
    onSchemeChange?: () => void;
  } = {},
): ColorModeApplier {
  const doc = win.document;
  const root = doc.documentElement;
  const prefersDark = win.matchMedia("(prefers-color-scheme: dark)");
  const reducedMotion = win.matchMedia("(prefers-reduced-motion: reduce)");

  let appliedMode: ColorModeId | null = null;
  // Before the first application the page renders whatever the boot-time attribute selects.
  let appliedScheme: ColorScheme = colorScheme(
    parseColorMode(root.dataset.colorMode) ?? "system",
    prefersDark.matches,
  );

  function writeDocument(mode: ColorModeId, scheme: ColorScheme): void {
    if (mode === "system") delete root.dataset.colorMode;
    else root.dataset.colorMode = mode;
    root.style.colorScheme = scheme;

    const schemeMeta = doc.querySelector<HTMLMetaElement>(
      'meta[name="color-scheme"]',
    );
    if (schemeMeta) {
      schemeMeta.content = mode === "system" ? "light dark" : scheme;
    }

    for (const meta of doc.querySelectorAll<HTMLMetaElement>(
      'meta[name="theme-color"]',
    )) {
      meta.content =
        COLOR_SCHEME_BACKGROUNDS[
          mode === "system" ? (metaScheme(meta) ?? scheme) : scheme
        ];
    }
  }

  function canFade(): boolean {
    return (
      typeof doc.startViewTransition === "function" &&
      !reducedMotion.matches &&
      doc.visibilityState !== "hidden"
    );
  }

  function apply(mode: ColorModeId, animate: boolean): void {
    const scheme = colorScheme(mode, prefersDark.matches);
    const isFirst = appliedMode === null;
    const schemeChanged = scheme !== appliedScheme;

    if (mode !== appliedMode) writeCachedColorMode(mode, options.storage);
    appliedMode = mode;
    appliedScheme = scheme;

    const update = () => {
      writeDocument(mode, scheme);
      if (schemeChanged) options.onSchemeChange?.();
    };

    if (!isFirst && schemeChanged && animate && canFade()) {
      const transition = doc.startViewTransition(update);
      transition.ready.catch(ignoreRejection);
      transition.finished.catch(ignoreRejection);
      transition.updateCallbackDone.catch(ignoreRejection);
    } else {
      update();
    }
  }

  const onOsSchemeChange = () => {
    if (appliedMode === "system") apply("system", true);
  };
  prefersDark.addEventListener("change", onOsSchemeChange);

  return {
    applyColorMode(mode, { animate }) {
      apply(mode, animate);
    },
    dispose() {
      prefersDark.removeEventListener("change", onOsSchemeChange);
    },
  };
}

function metaScheme(meta: HTMLMetaElement): ColorScheme | null {
  if (meta.media.includes("dark")) return "dark";
  if (meta.media.includes("light")) return "light";
  return null;
}
