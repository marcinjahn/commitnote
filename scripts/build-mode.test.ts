import { describe, expect, it } from "vitest";
import {
  buildModeFacts,
  FAKE_ANALYTICS_ENDPOINT,
  validAnalyticsEndpoint,
} from "./build-mode";

const ENDPOINT = "https://stats.example.com/count";

describe("buildModeFacts", () => {
  it.each([
    ["production", false, null],
    ["fake-forge", true, FAKE_ANALYTICS_ENDPOINT],
    ["native-core", false, null],
    ["native-core-fake", true, FAKE_ANALYTICS_ENDPOINT],
    ["development", false, null],
    ["test", false, null],
    ["something-else", false, null],
  ])("maps %s", (mode, fakeForge, analyticsEndpoint) => {
    expect(buildModeFacts(mode, null)).toEqual({
      fakeForge,
      analyticsEndpoint,
    });
  });

  it.each([
    ["production", ENDPOINT],
    ["fake-forge", FAKE_ANALYTICS_ENDPOINT],
    ["native-core", ENDPOINT],
    ["native-core-fake", FAKE_ANALYTICS_ENDPOINT],
    ["development", null],
  ])("maps %s with an endpoint", (mode, analyticsEndpoint) => {
    expect(buildModeFacts(mode, ENDPOINT).analyticsEndpoint).toBe(
      analyticsEndpoint,
    );
  });

  it("rejects an invalid endpoint in every mode", () => {
    expect(() =>
      buildModeFacts("development", "http://stats.example.com/count"),
    ).toThrow(/must use https/);
  });
});

describe("validAnalyticsEndpoint", () => {
  it("returns null without an endpoint", () => {
    expect(validAnalyticsEndpoint(null)).toBeNull();
  });

  it("accepts an https count URL", () => {
    expect(validAnalyticsEndpoint(ENDPOINT)).toBe(ENDPOINT);
  });

  it.each<[string, RegExp]>([
    ["", /not a URL/],
    ["stats.example.com/count", /not a URL/],
    ["http://stats.example.com/count", /must use https/],
    [
      "https://user:pw@stats.example.com/count",
      /credentials, a query or a fragment/,
    ],
    [
      "https://stats.example.com/count?x=1",
      /credentials, a query or a fragment/,
    ],
    ["https://stats.example.com/count#x", /credentials, a query or a fragment/],
    ["https://Stats.example.com/count", /normalised form/],
  ])("rejects %j", (endpoint, message) => {
    expect(() => validAnalyticsEndpoint(endpoint)).toThrow(message);
  });
});
