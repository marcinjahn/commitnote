export type Platform = "mac" | "windows" | "linux" | "ios" | "android" | "other";

export const PLATFORMS: readonly Platform[] = [
  "mac",
  "windows",
  "linux",
  "ios",
  "android",
  "other",
];

export function isPlatform(value: unknown): value is Platform {
  return PLATFORMS.includes(value as Platform);
}

export interface PlatformNavigator {
  readonly userAgentData?: { readonly platform?: string } | undefined;
  readonly userAgent?: string;
  readonly platform?: string;
  readonly maxTouchPoints?: number;
}

const CLIENT_HINT_PLATFORMS: Record<string, Platform> = {
  macos: "mac",
  windows: "windows",
  android: "android",
  linux: "linux",
  ios: "ios",
  "chrome os": "other",
  chromeos: "other",
};

const USER_AGENT_RULES: readonly (readonly [RegExp, Platform])[] = [
  [/CrOS/, "other"],
  // Android user agents also contain "Linux".
  [/Android/, "android"],
  // iOS user agents also contain "Mac OS X".
  [/iPhone|iPad|iPod/, "ios"],
  [/Macintosh|Mac OS X|MacIntel/, "mac"],
  [/Windows|Win32|Win64/, "windows"],
  [/Linux|X11/, "linux"],
];

function detectFromUserAgent(nav: PlatformNavigator): Platform | undefined {
  const source = nav.userAgent || nav.platform || "";
  return USER_AGENT_RULES.find(([pattern]) => pattern.test(source))?.[1];
}

export function detectPlatform(nav: PlatformNavigator): Platform {
  const hint = nav.userAgentData?.platform?.trim().toLowerCase();
  const platform =
    (hint ? CLIENT_HINT_PLATFORMS[hint] : undefined) ??
    detectFromUserAgent(nav) ??
    "other";
  // iPadOS in desktop mode reports itself as a Mac.
  if (platform === "mac" && (nav.maxTouchPoints ?? 0) > 1) {
    return "ios";
  }
  return platform;
}

export function applyPlatform(
  root: { dataset: DOMStringMap | Record<string, string | undefined> },
  platform: Platform,
): void {
  root.dataset.platform = platform;
}
