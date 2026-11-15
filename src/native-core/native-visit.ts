import { visitUrl } from "../analytics/visit-url";
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
  screenWidth: number | null,
): string | null {
  if (endpoint === null) return null;
  return visitUrl(endpoint, { ...NATIVE_VISITS[platform], screenWidth });
}
