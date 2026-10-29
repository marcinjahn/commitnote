import {
  readAnalyticsOptOut,
  visitUrl,
  type AnalyticsStorage,
} from "../analytics/analytics";
import type { NativePlatform } from "./api";

export const NATIVE_VISITS: Record<
  NativePlatform,
  { path: string; title: string }
> = {
  ios: { path: "/app/ios", title: "App (iOS)" },
  linux: { path: "/app/linux", title: "App (Linux)" },
};

export function nativeVisitUrl(
  endpoint: string | null,
  storage: AnalyticsStorage,
  platform: NativePlatform,
): string | null {
  if (endpoint === null || readAnalyticsOptOut(storage)) return null;
  const { path, title } = NATIVE_VISITS[platform];
  return visitUrl(endpoint, path, title);
}
