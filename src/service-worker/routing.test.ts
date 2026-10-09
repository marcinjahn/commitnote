import { describe, expect, it } from "vitest";
import { routeRequest } from "./routing";

const scope = "https://example.com/";
const precache = new Set([
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "assets/index-AbC123.js",
  "assets/my file.css",
]);

function get(url: string, mode = "no-cors") {
  return { url, method: "GET", mode };
}

describe("routeRequest", () => {
  it("serves same-origin navigations from the shell", () => {
    expect(routeRequest(get(scope, "navigate"), scope, precache)).toBe("shell");
    expect(
      routeRequest(get(`${scope}some/deep/path`, "navigate"), scope, precache),
    ).toBe("shell");
    expect(
      routeRequest(
        get(
          `${scope}?fake-forge-session=https%3A%2F%2Fgithub.com%2Fsample%2Fnotes`,
          "navigate",
        ),
        scope,
        precache,
      ),
    ).toBe("shell");
    expect(
      routeRequest(get(`${scope}#share=abc`, "navigate"), scope, precache),
    ).toBe("shell");
  });

  it("serves precached files as assets", () => {
    expect(
      routeRequest(get(`${scope}assets/index-AbC123.js`), scope, precache),
    ).toBe("asset");
    expect(
      routeRequest(get(`${scope}icons/icon-192.png#x`), scope, precache),
    ).toBe("asset");
    expect(
      routeRequest(get(`${scope}assets/my%20file.css`), scope, precache),
    ).toBe("asset");
  });

  it("passes through paths missing from the precache", () => {
    expect(routeRequest(get(`${scope}assets/other.js`), scope, precache)).toBe(
      "passthrough",
    );
  });

  it("serves an earlier build's hashed assets from the shell caches", () => {
    expect(
      routeRequest(
        get(`${scope}assets/vim-extension-DhCXTAeW.js`),
        scope,
        precache,
      ),
    ).toBe("asset");
  });

  it("passes through unhashed paths missing from the precache", () => {
    for (const path of ["assets/plain.js", "icons/other.png"]) {
      expect(routeRequest(get(`${scope}${path}`), scope, precache)).toBe(
        "passthrough",
      );
    }
  });

  it("passes through hashed paths requested with a query string", () => {
    expect(
      routeRequest(
        get(`${scope}assets/vim-extension-DhCXTAeW.js?v=1`),
        scope,
        precache,
      ),
    ).toBe("passthrough");
  });

  it("passes through non-GET requests", () => {
    expect(
      routeRequest(
        { url: `${scope}index.html`, method: "POST", mode: "cors" },
        scope,
        precache,
      ),
    ).toBe("passthrough");
    expect(
      routeRequest(
        { url: scope, method: "POST", mode: "navigate" },
        scope,
        precache,
      ),
    ).toBe("passthrough");
  });

  it("never intercepts cross-origin requests", () => {
    for (const url of [
      "https://api.github.com/repos/sample/notes/contents/a.md",
      "https://gitlab.com/api/v4/projects/1/repository/files/a",
      "https://gist.githubusercontent.com/user/abc/raw/note.md",
    ]) {
      expect(routeRequest(get(url, "cors"), scope, precache)).toBe(
        "passthrough",
      );
      expect(routeRequest(get(url, "navigate"), scope, precache)).toBe(
        "passthrough",
      );
    }
    expect(
      routeRequest(
        get("https://evil.example/assets/index-AbC123.js"),
        scope,
        precache,
      ),
    ).toBe("passthrough");
    expect(
      routeRequest(
        get("https://evil.example/assets/vim-extension-DhCXTAeW.js"),
        scope,
        precache,
      ),
    ).toBe("passthrough");
  });

  it("resolves paths against a non-root scope", () => {
    const appScope = "https://example.org/app/";
    expect(
      routeRequest(
        get("https://example.org/app/assets/index-AbC123.js"),
        appScope,
        precache,
      ),
    ).toBe("asset");
    expect(
      routeRequest(
        get("https://example.org/other/assets/index-AbC123.js"),
        appScope,
        precache,
      ),
    ).toBe("passthrough");
    expect(
      routeRequest(
        get("https://example.org/other/x.js"),
        appScope,
        precache,
      ),
    ).toBe("passthrough");
    expect(
      routeRequest(
        get("https://example.org/other/", "navigate"),
        appScope,
        precache,
      ),
    ).toBe("passthrough");
    expect(
      routeRequest(get("https://example.org/app/", "navigate"), appScope, precache),
    ).toBe("shell");
  });

  it("passes through a precached path requested with a query string", () => {
    expect(
      routeRequest(get(`${scope}assets/index-AbC123.js?v=1`), scope, precache),
    ).toBe("passthrough");
  });

  it("passes through malformed encoded paths", () => {
    expect(routeRequest(get(`${scope}assets/%E0%A4%A`), scope, precache)).toBe(
      "passthrough",
    );
  });
});
