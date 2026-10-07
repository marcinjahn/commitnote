import { describe, expect, it, vi } from "vitest";
import { COLOR_MODE_CACHE_KEY } from "../session/color-mode-cache";
import type { StorageLike } from "../session/session-store";
import { createColorModeApplier } from "./color-mode-applier";

class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

class FakeMediaQuery {
  readonly listeners = new Set<() => void>();

  constructor(public matches: boolean) {}

  addEventListener(_type: "change", listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "change", listener: () => void): void {
    this.listeners.delete(listener);
  }

  flip(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) listener();
  }
}

interface FakeMeta {
  name: string;
  media: string;
  content: string;
}

interface Setup {
  osDark?: boolean;
  reducedMotion?: boolean;
  hidden?: boolean;
  viewTransitions?: boolean;
  themeColorMetas?: boolean;
  bootColorMode?: string;
}

function setup({
  osDark = false,
  reducedMotion = false,
  hidden = false,
  viewTransitions = true,
  themeColorMetas = true,
  bootColorMode,
}: Setup = {}) {
  const prefersDark = new FakeMediaQuery(osDark);
  const prefersReducedMotion = new FakeMediaQuery(reducedMotion);
  const root = {
    dataset: {} as DOMStringMap,
    style: { colorScheme: "" },
  };
  if (bootColorMode) root.dataset.colorMode = bootColorMode;

  const schemeMeta: FakeMeta = {
    name: "color-scheme",
    media: "",
    content: "light dark",
  };
  const lightThemeMeta: FakeMeta = {
    name: "theme-color",
    media: "(prefers-color-scheme: light)",
    content: "#fafafa",
  };
  const darkThemeMeta: FakeMeta = {
    name: "theme-color",
    media: "(prefers-color-scheme: dark)",
    content: "#0b0b0b",
  };
  const metas = themeColorMetas
    ? [schemeMeta, lightThemeMeta, darkThemeMeta]
    : [schemeMeta];
  const byName = (selector: string) =>
    metas.filter((meta) => selector === `meta[name="${meta.name}"]`);

  const writesInsideTransition: string[] = [];
  const startViewTransition = vi.fn((update: () => void) => {
    update();
    writesInsideTransition.push(root.style.colorScheme);
    return {
      ready: Promise.reject(new Error("skipped")),
      finished: Promise.reject(new Error("skipped")),
      updateCallbackDone: Promise.resolve(),
    };
  });

  const document = {
    documentElement: root,
    visibilityState: hidden ? "hidden" : "visible",
    querySelector: (selector: string) => byName(selector)[0] ?? null,
    querySelectorAll: (selector: string) => byName(selector),
    ...(viewTransitions ? { startViewTransition } : {}),
  };
  const win = {
    document,
    matchMedia: (query: string) => {
      if (query === "(prefers-color-scheme: dark)") return prefersDark;
      if (query === "(prefers-reduced-motion: reduce)") {
        return prefersReducedMotion;
      }
      throw new Error(`unexpected media query ${query}`);
    },
  } as unknown as Window & typeof globalThis;

  const storage = new MemoryStorage();
  const onSchemeChange = vi.fn(() => {
    expect(root.style.colorScheme).not.toBe("");
  });
  const applier = createColorModeApplier(win, { storage, onSchemeChange });

  return {
    applier,
    root,
    schemeMeta,
    lightThemeMeta,
    darkThemeMeta,
    prefersDark,
    startViewTransition,
    writesInsideTransition,
    storage,
    onSchemeChange,
  };
}

describe("color-mode applier", () => {
  describe.each([
    { osDark: false, os: "light OS" },
    { osDark: true, os: "dark OS" },
  ])("on a $os", ({ osDark }) => {
    it("writes the system color mode", () => {
      const s = setup({ osDark, bootColorMode: "light" });

      s.applier.applyColorMode("system", { animate: false });

      expect(s.root.dataset.colorMode).toBeUndefined();
      expect(s.root.style.colorScheme).toBe(osDark ? "dark" : "light");
      expect(s.schemeMeta.content).toBe("light dark");
      expect(s.lightThemeMeta.content).toBe("#fafafa");
      expect(s.darkThemeMeta.content).toBe("#0b0b0b");
    });

    it.each([
      { mode: "light", background: "#fafafa" },
      { mode: "dark", background: "#0b0b0b" },
    ] as const)(
      "writes the forced $mode color mode",
      ({ mode, background }) => {
        const s = setup({ osDark });

        s.applier.applyColorMode(mode, { animate: false });

        expect(s.root.dataset.colorMode).toBe(mode);
        expect(s.root.style.colorScheme).toBe(mode);
        expect(s.schemeMeta.content).toBe(mode);
        expect(s.lightThemeMeta.content).toBe(background);
        expect(s.darkThemeMeta.content).toBe(background);
      },
    );
  });

  it("tolerates missing theme-color metas", () => {
    const s = setup({ themeColorMetas: false });

    s.applier.applyColorMode("dark", { animate: false });

    expect(s.schemeMeta.content).toBe("dark");
  });

  it("writes the color-mode cache on the first application and on every mode change", () => {
    const s = setup();
    const setItem = vi.spyOn(s.storage, "setItem");

    s.applier.applyColorMode("system", { animate: true });
    s.applier.applyColorMode("system", { animate: true });
    s.applier.applyColorMode("light", { animate: true });

    expect(setItem.mock.calls).toEqual([
      [COLOR_MODE_CACHE_KEY, "system"],
      [COLOR_MODE_CACHE_KEY, "light"],
    ]);
  });

  it("never fades the first application", () => {
    const s = setup({ osDark: false });

    s.applier.applyColorMode("dark", { animate: true });

    expect(s.startViewTransition).not.toHaveBeenCalled();
    expect(s.root.style.colorScheme).toBe("dark");
  });

  it("fades a color scheme change by writing inside the view transition", () => {
    const s = setup({ osDark: false });
    s.applier.applyColorMode("system", { animate: true });

    s.applier.applyColorMode("dark", { animate: true });

    expect(s.startViewTransition).toHaveBeenCalledTimes(1);
    expect(s.writesInsideTransition).toEqual(["dark"]);
    expect(s.root.dataset.colorMode).toBe("dark");
  });

  it("writes without a fade when the pick keeps the color scheme", () => {
    const s = setup({ osDark: false });
    s.applier.applyColorMode("system", { animate: true });

    s.applier.applyColorMode("light", { animate: true });

    expect(s.startViewTransition).not.toHaveBeenCalled();
    expect(s.root.dataset.colorMode).toBe("light");
    expect(s.schemeMeta.content).toBe("light");
    expect(s.storage.getItem(COLOR_MODE_CACHE_KEY)).toBe("light");
  });

  it.each([
    {
      reason: "reduced motion",
      options: { reducedMotion: true },
      animate: true,
    },
    { reason: "a hidden document", options: { hidden: true }, animate: true },
    {
      reason: "a missing View Transitions API",
      options: { viewTransitions: false },
      animate: true,
    },
    { reason: "animate: false", options: {}, animate: false },
  ])("does not fade under $reason", ({ options, animate }) => {
    const s = setup({ osDark: false, ...options });
    s.applier.applyColorMode("light", { animate: true });

    s.applier.applyColorMode("dark", { animate });

    expect(s.startViewTransition).not.toHaveBeenCalled();
    expect(s.root.style.colorScheme).toBe("dark");
    expect(s.onSchemeChange).toHaveBeenCalledTimes(1);
  });

  it("re-applies and fades when the OS flips while on System", () => {
    const s = setup({ osDark: false });
    s.applier.applyColorMode("system", { animate: false });

    s.prefersDark.flip(true);

    expect(s.startViewTransition).toHaveBeenCalledTimes(1);
    expect(s.writesInsideTransition).toEqual(["dark"]);
    expect(s.root.dataset.colorMode).toBeUndefined();
    expect(s.onSchemeChange).toHaveBeenCalledTimes(1);
  });

  it("ignores OS flips while a color mode is forced", () => {
    const s = setup({ osDark: false });
    s.applier.applyColorMode("light", { animate: false });

    s.prefersDark.flip(true);

    expect(s.startViewTransition).not.toHaveBeenCalled();
    expect(s.root.style.colorScheme).toBe("light");
    expect(s.onSchemeChange).not.toHaveBeenCalled();
  });

  it("calls onSchemeChange exactly when the color scheme changes", () => {
    const s = setup({ osDark: false });

    s.applier.applyColorMode("system", { animate: true });
    expect(s.onSchemeChange).not.toHaveBeenCalled();

    s.applier.applyColorMode("light", { animate: true });
    expect(s.onSchemeChange).not.toHaveBeenCalled();

    s.applier.applyColorMode("dark", { animate: true });
    expect(s.onSchemeChange).toHaveBeenCalledTimes(1);

    s.applier.applyColorMode("dark", { animate: true });
    s.applier.applyColorMode("light", { animate: false });
    expect(s.onSchemeChange).toHaveBeenCalledTimes(2);
  });

  it("calls onSchemeChange when the first application differs from the boot-time color scheme", () => {
    const s = setup({ osDark: false, bootColorMode: "dark" });

    s.applier.applyColorMode("system", { animate: true });

    expect(s.startViewTransition).not.toHaveBeenCalled();
    expect(s.onSchemeChange).toHaveBeenCalledTimes(1);
  });

  it("removes the OS listener on dispose", () => {
    const s = setup({ osDark: false });
    s.applier.applyColorMode("system", { animate: false });

    s.applier.dispose();
    s.prefersDark.flip(true);

    expect(s.prefersDark.listeners.size).toBe(0);
    expect(s.root.style.colorScheme).toBe("light");
  });
});
