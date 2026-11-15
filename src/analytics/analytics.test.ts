import { describe, expect, it } from "vitest";
import {
  analyticsPlatform,
  campaignQuery,
  decideVisit,
  sendVisit,
  visitBot,
  visitPath,
  visitReferrer,
  visitScreenWidth,
  visitTitle,
  type AnalyticsNavigator,
  type AnalyticsPage,
  type AnalyticsPlatform,
  type SendVisitDeps,
  type VisitInputs,
} from "./analytics";

const ENDPOINT = "https://analytics.invalid/count";
const ORIGIN = "https://commitnote.eu";

const PAGE_CONTEXT = {
  screen: {},
  document: { referrer: "" },
  location: { origin: ORIGIN, search: "" },
} as const;

function inputs(overrides: Partial<VisitInputs> = {}): VisitInputs {
  return {
    endpoint: ENDPOINT,
    page: "app",
    standalone: false,
    navigator: {},
    ...PAGE_CONTEXT,
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

  it("adds the screen width, referrer, bot flag and campaign of the page", () => {
    expect(
      decideVisit(
        inputs({
          page: "landing",
          navigator: { webdriver: true },
          screen: { width: 1440 },
          document: { referrer: "https://news.example/item?id=1" },
          location: {
            origin: ORIGIN,
            search: "?utm_source=hn&utm_campaign=launch&code=secret",
          },
        }),
      ),
    ).toEqual({
      url:
        `${ENDPOINT}?p=%2Flanding%2Fweb&t=Landing%20(web)` +
        "&r=https%3A%2F%2Fnews.example%2Fitem&s=1440&b=153" +
        "&q=%3Futm_source%3Dhn%26utm_campaign%3Dlaunch",
    });
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
      ...PAGE_CONTEXT,
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

describe("visitReferrer", () => {
  it.each<[string, string, string | null]>([
    ["no referrer", "", null],
    ["an unparsable referrer", "not a url", null],
    ["a page of our own origin", `${ORIGIN}/app/?action=search`, null],
    [
      "an origin-only referrer",
      "https://www.google.com/",
      "https://www.google.com/",
    ],
    [
      "a referrer with query and fragment",
      "https://forum.example/t/notes?token=abc#reply",
      "https://forum.example/t/notes",
    ],
    [
      "an Android app referrer",
      "android-app://com.google.android.gm/",
      "android-app://com.google.android.gm/",
    ],
    ["a non-web referrer", "about:blank", null],
    [
      "a referrer on another port of our host",
      `${ORIGIN}:8443/`,
      `${ORIGIN}:8443/`,
    ],
  ])("%s", (_name, referrer, expected) => {
    expect(visitReferrer(referrer, ORIGIN)).toBe(expected);
  });
});

describe("campaignQuery", () => {
  it.each<[string, string, string | null]>([
    ["an empty query", "", null],
    [
      "a query without campaign parameters",
      "?action=search&code=abc&state=xyz",
      null,
    ],
    [
      "every parameter GoatCounter reads, in a fixed order",
      "?campaign=c&source=s&src=x&ref=r&utm_campaign=uc&utm_source=us",
      "?utm_source=us&ref=r&src=x&source=s&utm_campaign=uc&campaign=c",
    ],
    [
      "campaign parameters mixed with private ones",
      "?code=abc&utm_source=newsletter&access_token=t&utm_medium=email",
      "?utm_source=newsletter",
    ],
    ["blank values", "?utm_source=%20&ref=", null],
    ["differently cased names", "?UTM_SOURCE=x&Ref=y", null],
  ])("%s", (_name, search, expected) => {
    expect(campaignQuery(search)).toBe(expected);
  });
});

describe("visitScreenWidth", () => {
  it.each<[number | undefined, number | null]>([
    [undefined, null],
    [0, null],
    [-1, null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
    [390, 390],
    [1280.4, 1280],
  ])("%s -> %s", (width, expected) => {
    expect(visitScreenWidth(width)).toBe(expected);
  });
});

describe("visitBot", () => {
  it.each<[AnalyticsNavigator, number | null]>([
    [{}, null],
    [{ webdriver: false }, null],
    [{ webdriver: true }, 153],
  ])("%j -> %s", (navigator, expected) => {
    expect(visitBot(navigator)).toBe(expected);
  });
});
