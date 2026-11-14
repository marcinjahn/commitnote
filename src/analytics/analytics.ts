export type AnalyticsPage = "landing" | "app";
export type AnalyticsPlatform = "web" | "pwa";

export interface AnalyticsNavigator {
  readonly doNotTrack?: string | null;
  readonly globalPrivacyControl?: boolean;
  readonly onLine?: boolean;
}

export interface VisitInputs {
  readonly endpoint: string | null;
  readonly page: AnalyticsPage;
  readonly standalone: boolean;
  readonly navigator: AnalyticsNavigator;
}

const PLATFORM_LABELS: Record<AnalyticsPlatform, string> = {
  web: "web",
  pwa: "PWA",
};

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

function browserOptsOut(navigator: AnalyticsNavigator): boolean {
  return navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true;
}

export function visitUrl(
  endpoint: string,
  path: string,
  title: string,
): string {
  return `${endpoint}?p=${encodeURIComponent(path)}&t=${encodeURIComponent(title)}`;
}

export function decideVisit(
  inputs: VisitInputs,
): { readonly url: string } | null {
  if (inputs.endpoint === null) return null;
  if (browserOptsOut(inputs.navigator) || inputs.navigator.onLine === false) {
    return null;
  }
  const platform = analyticsPlatform(inputs.standalone);
  const path = visitPath(inputs.page, platform);
  const title = visitTitle(inputs.page, platform);
  return { url: visitUrl(inputs.endpoint, path, title) };
}

export interface SendVisitDeps {
  readonly endpoint: string | null;
  readonly standalone: boolean;
  readonly navigator: AnalyticsNavigator;
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
    const visit = decideVisit({
      endpoint: deps.endpoint,
      page,
      standalone: deps.standalone,
      navigator: deps.navigator,
    });
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
