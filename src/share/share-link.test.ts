import { describe, expect, it } from "vitest";
import { toBase64Url } from "../crypto/base64";
import type { ShareLocator } from "../forge/share-host";
import {
  formatShareLink,
  isShareHash,
  parseShareLink,
  shareLinkBase,
} from "./share-link";

const base = shareLinkBase({
  origin: "https://example.github.io",
  pathname: "/commitnote/",
});
const secret = toBase64Url(Uint8Array.from({ length: 32 }, (_, i) => i * 7));
const gistId = "0123456789abcdef0123456789abcdef";
const oldRevision = "a".repeat(40);
const github: ShareLocator = { provider: "github", gistId };
const gitlab: ShareLocator = { provider: "gitlab", snippetId: "4815162342" };

const validGithub = `#share=1.gh.${gistId}.${secret}`;
const validGitlab = `#share=1.gl.4815162342.${secret}`;

describe("shareLinkBase", () => {
  it("is origin plus pathname", () => {
    expect(base).toBe("https://example.github.io/commitnote/");
  });
});

describe("isShareHash", () => {
  it("matches only the share prefix", () => {
    expect(isShareHash("#share=1.gl.1.x")).toBe(true);
    expect(isShareHash("#share=")).toBe(true);
    expect(isShareHash("")).toBe(false);
    expect(isShareHash("#other")).toBe(false);
    expect(isShareHash("share=1")).toBe(false);
  });
});

describe("formatShareLink", () => {
  it("formats both providers", () => {
    expect(formatShareLink(base, github, secret)).toBe(base + validGithub);
    expect(formatShareLink(base, gitlab, secret)).toBe(base + validGitlab);
  });
});

describe("parseShareLink", () => {
  it("round-trips a GitHub share link", () => {
    const link = formatShareLink(base, github, secret);
    expect(parseShareLink(link.slice(base.length))).toEqual({
      kind: "valid",
      locator: github,
      linkSecret: secret,
    });
  });

  it("round-trips a GitLab share link", () => {
    const link = formatShareLink(base, gitlab, secret);
    expect(parseShareLink(link.slice(base.length))).toEqual({
      kind: "valid",
      locator: gitlab,
      linkSecret: secret,
    });
  });

  const invalid: [string, string][] = [
    ["empty hash", ""],
    ["prefix only", "#share="],
    ["wrong prefix", validGitlab.replace("#share=", "#shared=")],
    ["wrong version", validGitlab.replace("=1.", "=2.")],
    ["unknown provider", validGitlab.replace(".gl.", ".bb.")],
    ["github missing part", `#share=1.gh.${secret}`],
    ["github with revision part", `#share=1.gh.${gistId}.${oldRevision}.${secret}`],
    ["github extra part", `${validGithub}.x`],
    ["gitlab missing part", `#share=1.gl.${secret}`],
    ["gitlab extra part", `${validGitlab}.4`],
    ["gitlab link with github shape", `#share=1.gl.${gistId}.${oldRevision}.${secret}`],
    [
      "non-hex gist id",
      `#share=1.gh.${"g".repeat(32)}.${secret}`,
    ],
    [
      "uppercase gist id",
      `#share=1.gh.${gistId.toUpperCase()}.${secret}`,
    ],
    ["short gist id", `#share=1.gh.${"a".repeat(19)}.${secret}`],
    ["snippet id with leading zero", `#share=1.gl.0123.${secret}`],
    ["snippet id with letters", `#share=1.gl.12ab.${secret}`],
    ["42-character secret", `#share=1.gl.1.${secret.slice(0, 42)}`],
    ["44-character secret", `#share=1.gl.1.${secret}A`],
    ["non-canonical base64url secret", `#share=1.gl.1.${"B".repeat(43)}`],
    ["secret with invalid characters", `#share=1.gl.1.${"+".repeat(43)}`],
    ["trailing whitespace", `${validGitlab} `],
  ];

  it.each(invalid)("rejects %s", (_name, hash) => {
    expect(parseShareLink(hash)).toEqual({ kind: "invalid" });
  });
});
