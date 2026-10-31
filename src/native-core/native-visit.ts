import {
  readAnalyticsOptOut,
  visitUrl,
  type AnalyticsStorage,
} from "../analytics/analytics";

export const NATIVE_VISIT_PATH = "/app/native";
export const NATIVE_VISIT_TITLE = "App (native)";

export function nativeVisitUrl(
  endpoint: string | null,
  storage: AnalyticsStorage,
): string | null {
  if (endpoint === null || readAnalyticsOptOut(storage)) return null;
  return visitUrl(endpoint, NATIVE_VISIT_PATH, NATIVE_VISIT_TITLE);
}
