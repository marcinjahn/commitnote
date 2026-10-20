import { describe, expect, it } from "vitest";
import { URL, URLSearchParams } from "./url";

const NativeURL = globalThis.URL;

function snapshot(url: { href: string; origin: string; pathname: string; search: string; hash: string; host: string; protocol: string }) {
  const { href, origin, pathname, search, hash, host, protocol } = url;
  return { href, origin, pathname, search, hash, host, protocol };
}

describe("URL", () => {
  const cases: [string, string?][] = [
    ["https://api.github.com/repos/acme/notes/git/trees/abc?recursive=1"],
    ["https://gitlab.com/api/v4/projects/acme%2Fteam%2Fnotes/repository/commits?ref_name=main&path=a.md&per_page=1&page=2"],
    ["https://gitlab.com/api/v4/projects/acme%2Fteam%2Fnotes/repository/files/a%2Fb.md/raw?ref=main"],
    ["https://github.com/settings/personal-access-tokens/new?name=commitnote+2026-09-30&contents=write"],
    ["https://github.com/new?name=notes&visibility=private"],
    ["https://gitlab.com/projects/new#blank_project"],
    ["HTTPS://GitLab.COM:443/a/./b/../c?x=1#frag"],
    ["https://example.com:8443/a b/ü?q=a b&r='#h h"],
    ["https://user:pw@example.com"],
    ["https://example.com"],
    ["/projects/1/repository/tree?page=2", "https://gitlab.com/api/v4"],
    ["/api/v4/projects?page=2", "https://gitlab.com/api/v4/x"],
    ["tree?page=2", "https://gitlab.com/api/v4/projects/1/"],
    ["../tree?page=2", "https://gitlab.com/api/v4/projects/1/repo"],
    ["?page=3", "https://gitlab.com/api/v4/projects?page=2#h"],
    ["#only", "https://gitlab.com/api/v4/projects?page=2"],
    ["//other.example/x", "https://gitlab.com/api/v4"],
  ];

  it.each(cases)("parses %s like the platform", (input, base) => {
    expect(snapshot(new URL(input, base))).toEqual(snapshot(new NativeURL(input, base)));
  });

  it("builds the pagination URL the GitLab adapter builds", () => {
    const mine = new URL("https://gitlab.com/api/v4/projects/1/repository/tree?per_page=20&page=1");
    mine.searchParams.set("page", "2");
    const native = new NativeURL("https://gitlab.com/api/v4/projects/1/repository/tree?per_page=20&page=1");
    native.searchParams.set("page", "2");
    expect(mine.toString()).toBe(native.toString());
    expect(mine.search).toBe("?per_page=20&page=2");
  });

  it("reflects searchParams edits in href and search edits in searchParams", () => {
    const url = new URL("https://example.com/p?a=1#h");
    url.searchParams.append("b", "x y");
    expect(url.href).toBe("https://example.com/p?a=1&b=x+y#h");
    url.search = "?c=3";
    expect(url.searchParams.get("c")).toBe("3");
    expect(url.searchParams.has("a")).toBe(false);
  });

  it.each(["", "not a url", "/relative", "ftp://example.com/", "https://", "https://exa mple.com", "https://example.com:99999", "https://[::1"])(
    "throws TypeError for %j",
    (input) => {
      expect(() => new URL(input)).toThrow(TypeError);
    },
  );
});

describe("URLSearchParams", () => {
  it("serializes like the platform from a record", () => {
    const record = {
      name: "commitnote 2026-09-30",
      description: "commitnote: reads & saves (encrypted) notes. ünï~*'!",
      expires_in: "365",
    };
    expect(new URLSearchParams(record).toString()).toBe(
      new globalThis.URLSearchParams(record).toString(),
    );
  });

  it("parses strings with and without a leading question mark", () => {
    const text = "?a=1&b=x+y%20z&c&a=2&d=%E2%82%AC&e=%zz";
    const params = new URLSearchParams(text);
    const native = new globalThis.URLSearchParams(text);
    expect([...params]).toEqual([...native]);
    expect(new URLSearchParams("a=1").get("a")).toBe("1");
  });

  it("supports get, getAll, has, set, append and delete", () => {
    const params = new URLSearchParams("a=1&b=2&a=3");
    expect(params.get("a")).toBe("1");
    expect(params.getAll("a")).toEqual(["1", "3"]);
    expect(params.get("missing")).toBeNull();
    params.set("a", "9");
    expect(params.toString()).toBe("a=9&b=2");
    params.append("a", "4");
    expect(params.has("a")).toBe(true);
    params.delete("a");
    expect(params.has("a")).toBe(false);
    expect(params.size).toBe(1);
  });

  it("accepts pairs and another instance", () => {
    expect(new URLSearchParams([["a", "1"], ["b", "2"]]).toString()).toBe("a=1&b=2");
    expect(new URLSearchParams(new URLSearchParams("x=1")).toString()).toBe("x=1");
  });
});
