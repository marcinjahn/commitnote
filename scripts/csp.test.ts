import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCsp, inlineScriptHashes } from "./csp.ts";

const TAIL =
  "img-src 'self' https: data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'self'; manifest-src 'self'";

describe("buildCsp", () => {
  it("builds the web policy with one hash", () => {
    expect(buildCsp("web", ["'sha256-AAA'"], null)).toBe(
      `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-AAA'; style-src 'self' 'unsafe-inline'; connect-src https://api.github.com https://gitlab.com; ${TAIL}`,
    );
  });

  it("builds the web policy with two hashes", () => {
    expect(buildCsp("web", ["'sha256-AAA'", "'sha256-BBB'"], null)).toBe(
      `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-AAA' 'sha256-BBB'; style-src 'self' 'unsafe-inline'; connect-src https://api.github.com https://gitlab.com; ${TAIL}`,
    );
  });

  it("builds the desktop policy with one hash", () => {
    expect(buildCsp("desktop", ["'sha256-AAA'"], null)).toBe(
      `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-AAA'; style-src 'self' 'unsafe-inline'; connect-src https://api.github.com https://gitlab.com ipc: http://ipc.localhost; ${TAIL}`,
    );
  });

  it("builds the desktop policy with two hashes", () => {
    expect(buildCsp("desktop", ["'sha256-AAA'", "'sha256-BBB'"], null)).toBe(
      `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-AAA' 'sha256-BBB'; style-src 'self' 'unsafe-inline'; connect-src https://api.github.com https://gitlab.com ipc: http://ipc.localhost; ${TAIL}`,
    );
  });
});

describe("buildCsp with an analytics endpoint", () => {
  const endpoint = "https://commitnote.goatcounter.com/count";

  it("appends the origin to the web connect-src", () => {
    expect(buildCsp("web", ["'sha256-AAA'"], endpoint)).toBe(
      `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-AAA'; style-src 'self' 'unsafe-inline'; connect-src https://api.github.com https://gitlab.com https://commitnote.goatcounter.com; ${TAIL}`,
    );
  });

  it("appends the origin after the desktop ipc sources", () => {
    expect(buildCsp("desktop", ["'sha256-AAA'"], endpoint)).toBe(
      `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-AAA'; style-src 'self' 'unsafe-inline'; connect-src https://api.github.com https://gitlab.com ipc: http://ipc.localhost https://commitnote.goatcounter.com; ${TAIL}`,
    );
  });

  it("replaces 'none' in the landing connect-src", () => {
    expect(buildCsp("landing", ["'sha256-AAA'"], endpoint)).toBe(
      "default-src 'self'; script-src 'self' 'sha256-AAA'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src https://commitnote.goatcounter.com; worker-src 'none'; manifest-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
    );
  });
});

describe("buildCsp landing", () => {
  const policy = (hashes: string) =>
    `default-src 'self'; script-src 'self' ${hashes}; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; worker-src 'none'; manifest-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;

  it("builds the landing policy with one hash", () => {
    expect(buildCsp("landing", ["'sha256-AAA'"], null)).toBe(policy("'sha256-AAA'"));
  });

  it("builds the landing policy with two hashes", () => {
    expect(buildCsp("landing", ["'sha256-AAA'", "'sha256-BBB'"], null)).toBe(
      policy("'sha256-AAA' 'sha256-BBB'"),
    );
  });
});

describe("inlineScriptHashes", () => {
  const sha = (text: string) =>
    `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

  it("hashes inline scripts and skips external ones", () => {
    const html = `<head><script src="/a.js"></script><script>var a = 1;</script><script type="module">import "x";</script></head>`;
    expect(inlineScriptHashes(html)).toEqual([
      sha("var a = 1;"),
      sha('import "x";'),
    ]);
  });

  it("returns nothing when there are no inline scripts", () => {
    expect(inlineScriptHashes(`<script src="/a.js"></script>`)).toEqual([]);
  });
});
