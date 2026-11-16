import { describe, expect, it } from "vitest";
import { visitUrl } from "./visit-url";

const ENDPOINT = "https://x.invalid/count";

describe("visitUrl", () => {
  it("sends only the path and title when nothing else is known", () => {
    expect(visitUrl(ENDPOINT, { path: "/app/web", title: "App (web)" })).toBe(
      `${ENDPOINT}?p=%2Fapp%2Fweb&t=App%20(web)`,
    );
  });

  it("encodes every dimension in count.js's parameter names", () => {
    expect(
      visitUrl(ENDPOINT, {
        path: "/landing/web",
        title: "Landing (web)",
        referrer: "https://news.example/item",
        screenWidth: 390,
        bot: 153,
        campaignQuery: "?utm_source=hn&utm_campaign=launch week",
      }),
    ).toBe(
      `${ENDPOINT}?p=%2Flanding%2Fweb&t=Landing%20(web)` +
        "&r=https%3A%2F%2Fnews.example%2Fitem&s=390&b=153" +
        "&q=%3Futm_source%3Dhn%26utm_campaign%3Dlaunch%20week",
    );
  });

  it("leaves out null and empty dimensions", () => {
    expect(
      visitUrl(ENDPOINT, {
        path: "/app/ios",
        title: "App (iOS)",
        referrer: "",
        screenWidth: null,
        bot: null,
        campaignQuery: null,
      }),
    ).toBe(`${ENDPOINT}?p=%2Fapp%2Fios&t=App%20(iOS)`);
  });
});
