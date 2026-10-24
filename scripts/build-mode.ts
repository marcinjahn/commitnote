import { GOATCOUNTER_SITE_CODE } from "../analytics.config.ts";

export interface BuildModeFacts {
  desktopShell: boolean;
  fakeForge: boolean;
  analyticsEndpoint: string | null;
}

export const FAKE_ANALYTICS_ENDPOINT = "https://analytics.invalid/count";

export function goatCounterEndpoint(siteCode: string | null): string | null {
  if (siteCode === null) {
    return null;
  }
  if (!/^[a-z0-9-]+$/.test(siteCode)) {
    throw new Error(
      `Invalid GoatCounter site code ${JSON.stringify(siteCode)}: only lowercase letters, digits and hyphens are allowed`,
    );
  }
  return `https://${siteCode}.goatcounter.com/count`;
}

export function buildModeFacts(
  mode: string,
  siteCode: string | null = GOATCOUNTER_SITE_CODE,
): BuildModeFacts {
  const goatCounter = goatCounterEndpoint(siteCode);
  const fakeForge = mode === "fake-forge" || mode === "desktop-fake";
  const analyticsEndpoint = fakeForge
    ? FAKE_ANALYTICS_ENDPOINT
    : mode === "production" || mode === "desktop"
      ? goatCounter
      : null;
  return {
    desktopShell: mode === "desktop" || mode === "desktop-fake",
    fakeForge,
    analyticsEndpoint,
  };
}
