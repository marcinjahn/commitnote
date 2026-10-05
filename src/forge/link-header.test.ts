import { describe, expect, it } from "vitest";
import { parseLinkHeader } from "./link-header";

describe("parseLinkHeader", () => {
  it("returns an empty map for a missing or empty header", () => {
    expect(parseLinkHeader(null).size).toBe(0);
    expect(parseLinkHeader("").size).toBe(0);
  });

  it("maps each rel to its URL", () => {
    const links = parseLinkHeader(
      '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=9>; rel="last"',
    );
    expect(Object.fromEntries(links)).toEqual({
      next: "https://api.github.com/x?page=2",
      last: "https://api.github.com/x?page=9",
    });
  });

  it("keeps URLs containing commas and query strings intact", () => {
    const links = parseLinkHeader(
      '<https://api.github.com/x?path=a,b&per_page=1&page=3>; rel="last"',
    );
    expect(links.get("last")).toBe(
      "https://api.github.com/x?path=a,b&per_page=1&page=3",
    );
  });

  it("accepts unquoted rels, extra parameters and several rels in one entry", () => {
    const links = parseLinkHeader(
      '<https://a/1>; rel=next; title="t", <https://a/2>; rel="prev first"',
    );
    expect(Object.fromEntries(links)).toEqual({
      next: "https://a/1",
      prev: "https://a/2",
      first: "https://a/2",
    });
  });

  it("ignores entries without a rel", () => {
    expect(parseLinkHeader("<https://a/1>; title=x").size).toBe(0);
  });
});
