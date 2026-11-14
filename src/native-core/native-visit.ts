import { visitUrl } from "../analytics/analytics";
import type { NativePlatform } from "./api";

export const NATIVE_VISITS: Record<
  NativePlatform,
  { path: string; title: string }
> = {
  linux: { path: "/app/linux", title: "App (Linux)" },
};

export function nativeVisitUrl(
  endpoint: string | null,
  platform: NativePlatform,
): string | null {
  if (endpoint === null) return null;
  const { path, title } = NATIVE_VISITS[platform];
  return visitUrl(endpoint, path, title);
}
