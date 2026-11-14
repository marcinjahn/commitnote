import { describe, expect, it } from "vitest";
import { WEB_APP_URL } from "../share/share-link";
import { LANDING_URL } from "./site-urls";

describe("site URLs", () => {
  it("derives every site URL from the landing URL", () => {
    expect(LANDING_URL).toBe("https://commitnote.eu/");
    expect(WEB_APP_URL).toBe("https://commitnote.eu/app/");
  });
});
