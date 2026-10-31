import { describe, expect, it } from "vitest";
import {
  ANALYTICS_OPT_OUT_KEY,
  analyticsPlatform,
  decideVisit,
  readAnalyticsOptOut,
  sendVisit,
  visitPath,
  visitTitle,
  visitUrl,
  writeAnalyticsOptOut,
  type AnalyticsNavigator,
  type AnalyticsPage,
  type AnalyticsPlatform,
  type AnalyticsStorage,
  type SendVisitDeps,
  type VisitInputs,
} from "./analytics";

const ENDPOINT = "https://analytics.invalid/count";

class MemoryStorage implements AnalyticsStorage {
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

class ThrowingStorage implements AnalyticsStorage {
  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  setItem(): void {
    throw new Error("storage unavailable");
  }

  removeItem(): void {
    throw new Error("storage unavailable");
  }
}

function inputs(overrides: Partial<VisitInputs> = {}): VisitInputs {
  return {
    endpoint: ENDPOINT,
    page: "app",
    desktopShell: false,
    standalone: false,
    navigator: {},
    optedOut: false,
    ...overrides,
  };
}

describe("analyticsPlatform", () => {
  it.each<[boolean, boolean, AnalyticsPlatform]>([
    [false, false, "web"],
    [false, true, "pwa"],
    [true, false, "appimage"],
    [true, true, "appimage"],
  ])("desktopShell %s, standalone %s -> %s", (shell, standalone, expected) => {
    expect(analyticsPlatform(shell, standalone)).toBe(expected);
  });
});

describe("visit path and title", () => {
  it.each<[AnalyticsPage, AnalyticsPlatform, string, string]>([
    ["landing", "web", "/landing/web", "Landing (web)"],
    ["landing", "pwa", "/landing/pwa", "Landing (PWA)"],
    ["landing", "appimage", "/landing/appimage", "Landing (AppImage)"],
    ["app", "web", "/app/web", "App (web)"],
    ["app", "pwa", "/app/pwa", "App (PWA)"],
    ["app", "appimage", "/app/appimage", "App (AppImage)"],
  ])("%s on %s", (page, platform, path, title) => {
    expect(visitPath(page, platform)).toBe(path);
    expect(visitTitle(page, platform)).toBe(title);
  });
});

describe("decideVisit", () => {
  it.each<[string, Partial<VisitInputs>, string]>([
    [
      "landing web",
      { page: "landing" },
      `${ENDPOINT}?p=%2Flanding%2Fweb&t=Landing%20(web)`,
    ],
    ["app web", {}, `${ENDPOINT}?p=%2Fapp%2Fweb&t=App%20(web)`],
    [
      "app pwa",
      { standalone: true },
      `${ENDPOINT}?p=%2Fapp%2Fpwa&t=App%20(PWA)`,
    ],
    [
      "app appimage",
      { desktopShell: true },
      `${ENDPOINT}?p=%2Fapp%2Fappimage&t=App%20(AppImage)`,
    ],
  ])("builds the exact URL for %s", (_name, overrides, url) => {
    expect(decideVisit(inputs(overrides))).toEqual({ url });
  });

  it.each<[string, Partial<VisitInputs>]>([
    ["no endpoint", { endpoint: null }],
    ["analytics opt-out", { optedOut: true }],
    ["Do Not Track", { navigator: { doNotTrack: "1" } }],
    ["Global Privacy Control", { navigator: { globalPrivacyControl: true } }],
    ["offline", { navigator: { onLine: false } }],
  ])("sends nothing with %s", (_name, overrides) => {
    expect(decideVisit(inputs(overrides))).toBeNull();
  });

  it.each<[string, AnalyticsNavigator]>([
    ["DNT 0", { doNotTrack: "0" }],
    ["DNT null", { doNotTrack: null }],
    ["GPC false", { globalPrivacyControl: false }],
    ["GPC undefined", { globalPrivacyControl: undefined }],
    ["onLine undefined", { onLine: undefined }],
    ["onLine true", { onLine: true }],
  ])("still sends with %s", (_name, navigator) => {
    expect(decideVisit(inputs({ navigator }))).not.toBeNull();
  });
});

describe("analytics opt-out", () => {
  it("is off by default", () => {
    expect(readAnalyticsOptOut(new MemoryStorage())).toBe(false);
  });

  it("round-trips and removes the key when turned off", () => {
    const storage = new MemoryStorage();
    writeAnalyticsOptOut(true, storage);
    expect(storage.map.get(ANALYTICS_OPT_OUT_KEY)).toBe("1");
    expect(readAnalyticsOptOut(storage)).toBe(true);
    writeAnalyticsOptOut(false, storage);
    expect(storage.map.has(ANALYTICS_OPT_OUT_KEY)).toBe(false);
    expect(readAnalyticsOptOut(storage)).toBe(false);
  });

  it("does nothing without storage", () => {
    expect(readAnalyticsOptOut(null)).toBe(false);
    expect(() => writeAnalyticsOptOut(true, null)).not.toThrow();
  });

  it("swallows storage errors", () => {
    const storage = new ThrowingStorage();
    expect(readAnalyticsOptOut(storage)).toBe(false);
    expect(() => writeAnalyticsOptOut(true, storage)).not.toThrow();
    expect(() => writeAnalyticsOptOut(false, storage)).not.toThrow();
  });
});

describe("sendVisit", () => {
  const init = {
    method: "GET",
    mode: "no-cors",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    keepalive: true,
  };

  function setup(overrides: Partial<SendVisitDeps> = {}) {
    const fetched: { url: string; init: RequestInit }[] = [];
    const scheduled: (() => void)[] = [];
    const deps: SendVisitDeps = {
      endpoint: ENDPOINT,
      desktopShell: false,
      standalone: false,
      navigator: {},
      storage: new MemoryStorage(),
      fetch: (url, requestInit) => {
        fetched.push({ url, init: requestInit });
        return Promise.resolve();
      },
      schedule: (run) => {
        scheduled.push(run);
      },
      ...overrides,
    };
    return { deps, fetched, scheduled };
  }

  it("fetches once, only after the scheduled callback runs", () => {
    const { deps, fetched, scheduled } = setup();
    sendVisit("landing", deps);
    expect(scheduled).toHaveLength(1);
    expect(fetched).toEqual([]);
    scheduled[0]();
    expect(fetched).toEqual([
      {
        url: `${ENDPOINT}?p=%2Flanding%2Fweb&t=Landing%20(web)`,
        init,
      },
    ]);
  });

  it("reports the platform of the page", () => {
    const { deps, fetched, scheduled } = setup({ desktopShell: true });
    sendVisit("app", deps);
    scheduled[0]();
    expect(fetched[0].url).toBe(
      `${ENDPOINT}?p=%2Fapp%2Fappimage&t=App%20(AppImage)`,
    );
  });

  it.each<[string, () => Partial<SendVisitDeps>]>([
    ["no endpoint", () => ({ endpoint: null })],
    [
      "analytics opt-out",
      () => {
        const storage = new MemoryStorage();
        writeAnalyticsOptOut(true, storage);
        return { storage };
      },
    ],
    ["Do Not Track", () => ({ navigator: { doNotTrack: "1" } })],
    [
      "Global Privacy Control",
      () => ({ navigator: { globalPrivacyControl: true } }),
    ],
    ["offline", () => ({ navigator: { onLine: false } })],
  ])("schedules nothing with %s", (_name, overrides) => {
    const { deps, scheduled } = setup(overrides());
    sendVisit("app", deps);
    expect(scheduled).toEqual([]);
  });

  it("does not throw when fetch throws", () => {
    const { deps, scheduled } = setup({
      fetch: () => {
        throw new Error("blocked");
      },
    });
    expect(() => sendVisit("app", deps)).not.toThrow();
    expect(() => scheduled[0]()).not.toThrow();
  });

  it("swallows a rejected fetch", async () => {
    const { deps, scheduled } = setup({
      fetch: () => Promise.reject(new Error("network")),
    });
    expect(() => sendVisit("app", deps)).not.toThrow();
    expect(() => scheduled[0]()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("does not throw when scheduling throws", () => {
    const { deps } = setup({
      schedule: () => {
        throw new Error("no scheduler");
      },
    });
    expect(() => sendVisit("app", deps)).not.toThrow();
  });
});

describe("visitUrl", () => {
  it("encodes the path and title into the query", () => {
    expect(visitUrl("https://x.invalid/count", "/app/web", "App (web)")).toBe(
      "https://x.invalid/count?p=%2Fapp%2Fweb&t=App%20(web)",
    );
  });
});
