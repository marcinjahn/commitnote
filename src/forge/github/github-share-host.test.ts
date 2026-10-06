import { describe, expect, it } from "vitest";
import type { ContentCreatingRequest } from "../forge-adapter";
import { createGitHubAdapter } from "./github-adapter";

const TOKEN = "s3cr3t-token";

interface Recorded {
  readonly url: string;
  readonly method: string | undefined;
  readonly authorization: string | null;
  readonly body: unknown;
}

function setup(respond: () => Response) {
  const calls: Recorded[] = [];
  const reports: ContentCreatingRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method,
      authorization: headers.get("authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return respond();
  };
  const adapter = createGitHubAdapter(
    { owner: "acme", repo: "notes" },
    {
      accessToken: TOKEN,
      fetch: fetchImpl,
      now: () => 0,
      onContentCreatingRequest: (request) => reports.push(request),
    },
  );
  return { host: adapter.shareHost, calls, reports };
}

const json = (body: unknown, status: number, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });

describe("GitHub share host", () => {
  describe("create", () => {
    it("posts a secret gist and returns its locator", async () => {
      const { host, calls, reports } = setup(() =>
        json({ id: "abc123" }, 201),
      );

      const locator = await host.create("envelope-text");

      expect(locator).toEqual({ provider: "github", gistId: "abc123" });
      expect(calls).toEqual([
        {
          url: "https://api.github.com/gists",
          method: "POST",
          authorization: `Bearer ${TOKEN}`,
          body: {
            public: false,
            description: "Encrypted commitnote share",
            files: { "commitnote-share.json": { content: "envelope-text" } },
          },
        },
      ]);
      expect(reports).toEqual([{ operation: "createShare" }]);
    });

    it.each([403, 404])("maps %i to Forbidden", async (status) => {
      const { host } = setup(() => json({ message: "nope" }, status));
      await expect(host.create("x")).rejects.toMatchObject({
        kind: "Forbidden",
      });
    });

    it("maps 401 to Unauthorized", async () => {
      const { host } = setup(() => json({ message: "Bad" }, 401));
      await expect(host.create("x")).rejects.toMatchObject({
        kind: "Unauthorized",
      });
    });

    it("maps a rate-limited 403 and a 429 to RateLimited", async () => {
      const limited403 = setup(() =>
        json({ message: "API rate limit exceeded" }, 403),
      );
      await expect(limited403.host.create("x")).rejects.toMatchObject({
        kind: "RateLimited",
      });
      const limited429 = setup(() =>
        json({ message: "slow down" }, 429, { "retry-after": "30" }),
      );
      await expect(limited429.host.create("x")).rejects.toMatchObject({
        kind: "RateLimited",
        retryAfterMs: 30_000,
      });
    });

    it("rejects a response without a gist id with Server", async () => {
      for (const body of [{}, { id: 5 }]) {
        const { host } = setup(() => json(body, 201));
        await expect(host.create("x")).rejects.toMatchObject({
          kind: "Server",
        });
      }
    });

    it("reports the request even when it fails", async () => {
      const { host, reports } = setup(() => json({}, 500));
      await expect(host.create("x")).rejects.toMatchObject({ kind: "Server" });
      expect(reports).toEqual([{ operation: "createShare" }]);
    });
  });

  describe("delete", () => {
    const locator = { provider: "github", gistId: "abc123" } as const;

    it("deletes the gist", async () => {
      const { host, calls, reports } = setup(
        () => new Response(null, { status: 204 }),
      );

      await host.delete(locator);

      expect(calls).toEqual([
        {
          url: "https://api.github.com/gists/abc123",
          method: "DELETE",
          authorization: `Bearer ${TOKEN}`,
          body: undefined,
        },
      ]);
      expect(reports).toEqual([{ operation: "deleteShare" }]);
    });

    it("resolves when the gist is already gone", async () => {
      const { host } = setup(() => json({ message: "Not Found" }, 404));
      await expect(host.delete(locator)).resolves.toBeUndefined();
    });

    it("maps other failures", async () => {
      const forbidden = setup(() => json({ message: "no" }, 403));
      await expect(forbidden.host.delete(locator)).rejects.toMatchObject({
        kind: "Forbidden",
      });
      const limited = setup(() => json({ message: "x" }, 429));
      await expect(limited.host.delete(locator)).rejects.toMatchObject({
        kind: "RateLimited",
      });
    });

    it("rejects a gitlab locator without sending a request", async () => {
      const { host, calls, reports } = setup(() => json({}, 204));
      await expect(
        host.delete({ provider: "gitlab", snippetId: "7" }),
      ).rejects.toMatchObject({ kind: "Server" });
      expect(calls).toEqual([]);
      expect(reports).toEqual([]);
    });
  });
});
