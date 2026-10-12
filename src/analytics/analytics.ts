export type AnalyticsPage = "landing" | "app";
export type AnalyticsPlatform = "web" | "pwa" | "appimage";

export const ANALYTICS_OPT_OUT_KEY = "commitnote.analyticsOptOut";

export type AnalyticsStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export interface AnalyticsNavigator {
  readonly doNotTrack?: string | null;
  readonly globalPrivacyControl?: boolean;
  readonly onLine?: boolean;
}

export interface VisitInputs {
  readonly endpoint: string | null;
  readonly page: AnalyticsPage;
  readonly desktopShell: boolean;
  readonly standalone: boolean;
  readonly navigator: AnalyticsNavigator;
  readonly optedOut: boolean;
}

const PLATFORM_LABELS: Record<AnalyticsPlatform, string> = {
  web: "web",
  pwa: "PWA",
  appimage: "AppImage",
};

export function analyticsPlatform(
  desktopShell: boolean,
  standalone: boolean,
): AnalyticsPlatform {
  if (desktopShell) return "appimage";
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

export function browserOptsOut(navigator: AnalyticsNavigator): boolean {
  return navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true;
}

export function decideVisit(
  inputs: VisitInputs,
): { readonly url: string } | null {
  if (inputs.endpoint === null) return null;
  if (
    inputs.optedOut ||
    browserOptsOut(inputs.navigator) ||
    inputs.navigator.onLine === false
  ) {
    return null;
  }
  const platform = analyticsPlatform(inputs.desktopShell, inputs.standalone);
  const path = visitPath(inputs.page, platform);
  const title = visitTitle(inputs.page, platform);
  return {
    url: `${inputs.endpoint}?p=${encodeURIComponent(path)}&t=${encodeURIComponent(title)}`,
  };
}

function resolveStorage(
  storage: AnalyticsStorage | null | undefined,
): AnalyticsStorage | null {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readAnalyticsOptOut(
  storage?: AnalyticsStorage | null,
): boolean {
  const resolved = resolveStorage(storage);
  if (!resolved) return false;
  try {
    return resolved.getItem(ANALYTICS_OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeAnalyticsOptOut(
  optedOut: boolean,
  storage?: AnalyticsStorage | null,
): void {
  const resolved = resolveStorage(storage);
  if (!resolved) return;
  try {
    if (optedOut) resolved.setItem(ANALYTICS_OPT_OUT_KEY, "1");
    else resolved.removeItem(ANALYTICS_OPT_OUT_KEY);
  } catch {
    // The preference only lasts for this page load if it cannot be stored.
  }
}

export interface SendVisitDeps {
  readonly endpoint: string | null;
  readonly desktopShell: boolean;
  readonly standalone: boolean;
  readonly navigator: AnalyticsNavigator;
  readonly fetch: (url: string, init: RequestInit) => Promise<unknown>;
  readonly storage?: AnalyticsStorage | null;
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
      desktopShell: deps.desktopShell,
      standalone: deps.standalone,
      navigator: deps.navigator,
      optedOut: readAnalyticsOptOut(deps.storage),
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
