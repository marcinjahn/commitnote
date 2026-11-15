import { visitUrl } from "./visit-url";

export type AnalyticsPage = "landing" | "app";
export type AnalyticsPlatform = "web" | "pwa";

export interface AnalyticsNavigator {
  readonly onLine?: boolean;
  readonly webdriver?: boolean;
}

export interface AnalyticsScreen {
  readonly width?: number;
}

export interface AnalyticsDocument {
  readonly referrer: string;
}

/** Where the page was loaded from, read at boot before the app rewrites its URL. */
export interface AnalyticsLocation {
  readonly origin: string;
  readonly search: string;
}

export interface VisitInputs {
  readonly endpoint: string | null;
  readonly page: AnalyticsPage;
  readonly standalone: boolean;
  readonly navigator: AnalyticsNavigator;
  readonly screen: AnalyticsScreen;
  readonly document: AnalyticsDocument;
  readonly location: AnalyticsLocation;
}

const PLATFORM_LABELS: Record<AnalyticsPlatform, string> = {
  web: "web",
  pwa: "PWA",
};

/** The query parameters GoatCounter reads a referral source or a campaign name from. */
const CAMPAIGN_PARAMS = [
  "utm_source",
  "ref",
  "src",
  "source",
  "utm_campaign",
  "campaign",
] as const;

const REFERRER_PROTOCOLS = new Set(["http:", "https:", "android-app:"]);

/** count.js's code for a browser driven by automation (`navigator.webdriver`). */
const WEBDRIVER_BOT = 153;

export function analyticsPlatform(standalone: boolean): AnalyticsPlatform {
  return standalone ? "pwa" : "web";
}

export function visitPath(
  page: AnalyticsPage,
  platform: AnalyticsPlatform,
): string {
  return `/${page}/${platform}`;
}

export function visitTitle(
  page: AnalyticsPage,
  platform: AnalyticsPlatform,
): string {
  const name = page === "landing" ? "Landing" : "App";
  return `${name} (${PLATFORM_LABELS[platform]})`;
}

/**
 * The referring page without its query or fragment, or null for no referrer, an unparsable or
 * non-web one, or one from our own origin (navigation between the landing page and the app).
 */
export function visitReferrer(
  referrer: string,
  ownOrigin: string,
): string | null {
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }
  if (!REFERRER_PROTOCOLS.has(url.protocol) || url.host === "") return null;
  if (url.origin === ownOrigin) return null;
  return `${url.protocol}//${url.host}${url.pathname}`;
}

/** Only the campaign parameters of the page's query, so nothing else in the URL is sent. */
export function campaignQuery(search: string): string | null {
  const source = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const name of CAMPAIGN_PARAMS) {
    const value = source.get(name)?.trim();
    if (value) kept.set(name, value);
  }
  const query = kept.toString();
  return query === "" ? null : `?${query}`;
}

export function visitScreenWidth(width: number | undefined): number | null {
  if (width === undefined || !Number.isFinite(width) || width <= 0) return null;
  return Math.round(width);
}

export function visitBot(navigator: AnalyticsNavigator): number | null {
  return navigator.webdriver === true ? WEBDRIVER_BOT : null;
}

export function decideVisit(
  inputs: VisitInputs,
): { readonly url: string } | null {
  if (inputs.endpoint === null) return null;
  if (inputs.navigator.onLine === false) return null;
  const platform = analyticsPlatform(inputs.standalone);
  return {
    url: visitUrl(inputs.endpoint, {
      path: visitPath(inputs.page, platform),
      title: visitTitle(inputs.page, platform),
      referrer: visitReferrer(inputs.document.referrer, inputs.location.origin),
      screenWidth: visitScreenWidth(inputs.screen.width),
      bot: visitBot(inputs.navigator),
      campaignQuery: campaignQuery(inputs.location.search),
    }),
  };
}

export interface SendVisitDeps extends Omit<VisitInputs, "page"> {
  readonly fetch: (url: string, init: RequestInit) => Promise<unknown>;
  readonly schedule?: (run: () => void) => void;
}

function defaultSchedule(run: () => void): void {
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(run, { timeout: 10_000 });
  } else {
    setTimeout(run, 2_000);
  }
}

export function sendVisit(page: AnalyticsPage, deps: SendVisitDeps): void {
  try {
    const visit = decideVisit({ ...deps, page });
    if (!visit) return;
    const run = (): void => {
      try {
        const result = deps.fetch(visit.url, {
          method: "GET",
          mode: "no-cors",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          cache: "no-store",
          keepalive: true,
        });
        if (result && typeof result.catch === "function") {
          result.catch(() => {});
        }
      } catch {
        // Analytics must never affect the page.
      }
    };
    (deps.schedule ?? defaultSchedule)(run);
  } catch {
    // Analytics must never affect the page.
  }
}
