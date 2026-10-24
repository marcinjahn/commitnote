export interface AnalyticsOption {
  readonly analyticsCounted: boolean;
  readonly analyticsBlockedByBrowser: boolean;
  readonly onAnalyticsCountedChange: (counted: boolean) => void;
}

export const ANALYTICS_LABEL = "Anonymous usage statistics";
export const ANALYTICS_PRIVACY_URL = "https://commitnote.eu/#privacy";

export function describeAnalytics(blockedByBrowser: boolean): string {
  return blockedByBrowser
    ? "Off because your browser asks sites not to track you (Do Not Track or Global Privacy Control)."
    : "Counts one anonymous visit per app start: page and platform only, no cookies or identifiers.";
}
