import {
  readAnalyticsOptOut,
  visitUrl,
  type AnalyticsStorage,
} from "../analytics/analytics";

export const IOS_VISIT_PATH = "/app/ios";
export const IOS_VISIT_TITLE = "App (iOS)";

export function iosVisitUrl(
  endpoint: string | null,
  storage: AnalyticsStorage,
): string | null {
  if (endpoint === null || readAnalyticsOptOut(storage)) return null;
  return visitUrl(endpoint, IOS_VISIT_PATH, IOS_VISIT_TITLE);
}
