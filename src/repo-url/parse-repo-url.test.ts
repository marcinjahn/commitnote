import { describe, expect, it } from "vitest";
import { parseRepoUrl } from "./parse-repo-url";

describe("parseRepoUrl", () => {
  describe("accepted shapes", () => {
    it("parses a plain https GitHub URL", () => {
      const result = parseRepoUrl("https://github.com/alice/notes");
      expect(result).toEqual({
        ok: true,
        coordinates: { forge: "github", owner: "alice", repo: "notes" },
      });
    });

    it("strips a trailing .git suffix", () => {
      const result = parseRepoUrl("https://github.com/alice/notes.git");
      expect(result).toEqual({
        ok: true,
        coordinates: { forge: "github", owner: "alice", repo: "notes" },
      });
    });

    it("strips a trailing slash", () => {
      const result = parseRepoUrl("https://github.com/alice/notes/");
      expect(result).toEqual({
        ok: true,
        coordinates: { forge: "github", owner: "alice", repo: "notes" },
      });
    });

    it("strips a trailing slash followed by .git", () => {
      const result = parseRepoUrl("https://github.com/alice/notes.git/");
      expect(result).toEqual({
        ok: true,
        coordinates: { forge: "github", owner: "alice", repo: "notes" },
      });
    });

    it("accepts www.github.com", () => {
      const result = parseRepoUrl("https://www.github.com/alice/notes");
      expect(result).toEqual({
        ok: true,
        coordinates: { forge: "github", owner: "alice", repo: "notes" },
      });
    });

    it("accepts an upper-case host and scheme, case-insensitively", () => {
      const result = parseRepoUrl("HTTPS://GITHUB.COM/alice/notes");
      expect(result).toEqual({
        ok: true,
        coordinates: { forge: "github", owner: "alice", repo: "notes" },
      });
    });

    it("accepts a host with no scheme", () => {
      const result = parseRepoUrl("github.com/alice/notes");
      expect(result).toEqual({
        ok: true,
        coordinates: { forge: "github", owner: "alice", repo: "notes" },
      });
    });

    it("accepts the SSH form", () => {
      const result = parseRepoUrl("git@github.com:alice/notes");
      expect(result).toEqual({
        ok: true,
        coordinates: { forge: "github", owner: "alice", repo: "notes" },
      });
    });

    it("accepts the SSH form with a .git suffix", () => {
      const result = parseRepoUrl("git@github.com:alice/notes.git");
      expect(result).toEqual({
        ok: true,
        coordinates: { forge: "github", owner: "alice", repo: "notes" },
      });
    });

    it("trims surrounding whitespace", () => {
      const result = parseRepoUrl("  https://github.com/alice/notes  \n");
      expect(result).toEqual({
        ok: true,
        coordinates: { forge: "github", owner: "alice", repo: "notes" },
      });
    });

    it("preserves owner and repo casing", () => {
      const result = parseRepoUrl("https://github.com/Alice-Owner/Notes.Repo");
      expect(result).toEqual({
        ok: true,
        coordinates: {
          forge: "github",
          owner: "Alice-Owner",
          repo: "Notes.Repo",
        },
      });
    });
  });

  describe("rejections", () => {
    it("rejects an empty string", () => {
      expect(parseRepoUrl("")).toEqual({
        ok: false,
        error: { kind: "malformed" },
      });
    });

    it("rejects whitespace-only input", () => {
      expect(parseRepoUrl("   ")).toEqual({
        ok: false,
        error: { kind: "malformed" },
      });
    });

    it("rejects the http scheme", () => {
      expect(parseRepoUrl("http://github.com/a/b")).toEqual({
        ok: false,
        error: { kind: "malformed" },
      });
    });

    it("rejects other schemes", () => {
      expect(parseRepoUrl("ftp://github.com/a/b")).toEqual({
        ok: false,
        error: { kind: "malformed" },
      });
    });

    it("rejects a single path segment", () => {
      expect(parseRepoUrl("https://github.com/a")).toEqual({
        ok: false,
        error: { kind: "malformed" },
      });
    });

    it("rejects three path segments", () => {
      expect(parseRepoUrl("https://github.com/a/b/c")).toEqual({
        ok: false,
        error: { kind: "malformed" },
      });
    });

    it("rejects a deeper path", () => {
      expect(parseRepoUrl("https://github.com/a/b/tree/main")).toEqual({
        ok: false,
        error: { kind: "malformed" },
      });
    });

    it("rejects a query string", () => {
      expect(parseRepoUrl("https://github.com/a/b?tab=readme")).toEqual({
        ok: false,
        error: { kind: "malformed" },
      });
    });

    it("rejects a fragment", () => {
      expect(parseRepoUrl("https://github.com/a/b#readme")).toEqual({
        ok: false,
        error: { kind: "malformed" },
      });
    });

    it("rejects a port", () => {
      expect(parseRepoUrl("https://github.com:443/a/b")).toEqual({
        ok: false,
        error: { kind: "malformed" },
      });
    });

    it("rejects an owner with a leading hyphen", () => {
      expect(parseRepoUrl("https://github.com/-a/b")).toEqual({
        ok: false,
        error: { kind: "malformed" },
      });
    });

    it("rejects an owner that is too long", () => {
      const longOwner = "a".repeat(40);
      expect(parseRepoUrl(`https://github.com/${longOwner}/b`)).toEqual({
        ok: false,
        error: { kind: "malformed" },
      });
    });

    it("rejects a repo of '..'", () => {
      expect(parseRepoUrl("https://github.com/a/..")).toEqual({
        ok: false,
        error: { kind: "malformed" },
      });
    });

    it("returns unsupportedForge with the lower-cased host for a non-GitHub forge", () => {
      expect(parseRepoUrl("https://gitlab.com/a/b")).toEqual({
        ok: false,
        error: { kind: "unsupportedForge", host: "gitlab.com" },
      });
    });
  });
});
