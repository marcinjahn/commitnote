import { describe, expect, it } from "vitest";
import {
  analyticsPlatform,
  decideVisit,
  sendVisit,
  visitPath,
  visitTitle,
  visitUrl,
  type AnalyticsNavigator,
  type AnalyticsPage,
  type AnalyticsPlatform,
  type SendVisitDeps,
  type VisitInputs,
} from "./analytics";

const ENDPOINT = "https://analytics.invalid/count";

function inputs(overrides: Partial<VisitInputs> = {}): VisitInputs {
  return {
    endpoint: ENDPOINT,
    page: "app",
    standalone: false,
    navigator: {},
    ...overrides,
  };
}

describe("analyticsPlatform", () => {
  it.each<[boolean, AnalyticsPlatform]>([
    [false, "web"],
    [true, "pwa"],
  ])("standalone %s -> %s", (standalone, expected) => {
    expect(analyticsPlatform(standalone)).toBe(expected);
  });
});

describe("visit path and title", () => {
  it.each<[AnalyticsPage, AnalyticsPlatform, string, string]>([
    ["landing", "web", "/landing/web", "Landing (web)"],
    ["landing", "pwa", "/landing/pwa", "Landing (PWA)"],
    ["app", "web", "/app/web", "App (web)"],
    ["app", "pwa", "/app/pwa", "App (PWA)"],
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
  ])("builds the exact URL for %s", (_name, overrides, url) => {
    expect(decideVisit(inputs(overrides))).toEqual({ url });
  });

  it.each<[string, Partial<VisitInputs>]>([
    ["no endpoint", { endpoint: null }],
    ["offline", { navigator: { onLine: false } }],
  ])("sends nothing with %s", (_name, overrides) => {
    expect(decideVisit(inputs(overrides))).toBeNull();
  });

  it.each<[string, AnalyticsNavigator]>([
    ["onLine undefined", { onLine: undefined }],
    ["onLine true", { onLine: true }],
  ])("still sends with %s", (_name, navigator) => {
    expect(decideVisit(inputs({ navigator }))).not.toBeNull();
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
      standalone: false,
      navigator: {},
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
    const { deps, fetched, scheduled } = setup({ standalone: true });
    sendVisit("app", deps);
    scheduled[0]();
    expect(fetched[0].url).toBe(`${ENDPOINT}?p=%2Fapp%2Fpwa&t=App%20(PWA)`);
  });

  it.each<[string, () => Partial<SendVisitDeps>]>([
    ["no endpoint", () => ({ endpoint: null })],
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
