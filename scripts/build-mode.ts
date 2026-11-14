import { ANALYTICS_ENDPOINT } from "../analytics.config.ts";

export interface BuildModeFacts {
  fakeForge: boolean;
  analyticsEndpoint: string | null;
}

export const FAKE_ANALYTICS_ENDPOINT = "https://analytics.invalid/count";

export function validAnalyticsEndpoint(endpoint: string | null): string | null {
  if (endpoint === null) {
    return null;
  }
  const invalid = (reason: string) =>
    new Error(
      `Invalid analytics endpoint ${JSON.stringify(endpoint)}: ${reason}`,
    );
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw invalid("not a URL");
  }
  if (url.protocol !== "https:") {
    throw invalid("it must use https");
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw invalid("it must not carry credentials, a query or a fragment");
  }
  if (url.href !== endpoint) {
    throw invalid(
      `write it in its normalised form ${JSON.stringify(url.href)}`,
    );
  }
  return endpoint;
}

export function buildModeFacts(
  mode: string,
  endpoint: string | null = ANALYTICS_ENDPOINT,
): BuildModeFacts {
  const configured = validAnalyticsEndpoint(endpoint);
  const fakeForge = mode === "fake-forge" || mode === "native-core-fake";
  const analyticsEndpoint = fakeForge
    ? FAKE_ANALYTICS_ENDPOINT
    : mode === "production" || mode === "native-core"
      ? configured
      : null;
  return {
    fakeForge,
    analyticsEndpoint,
  };
}
