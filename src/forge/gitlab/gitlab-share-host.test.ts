import { describe, expect, it } from "vitest";
import type { ContentCreatingRequest } from "../forge-adapter";
import { createGitLabAdapter } from "./gitlab-adapter";

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
  const adapter = createGitLabAdapter(
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

describe("GitLab share host", () => {
  describe("create", () => {
    it("posts a public snippet and returns its locator", async () => {
      const { host, calls, reports } = setup(() => json({ id: 4711 }, 201));

      const locator = await host.create("envelope-text");

      expect(locator).toEqual({ provider: "gitlab", snippetId: "4711" });
      expect(calls).toEqual([
        {
          url: "https://gitlab.com/api/v4/snippets",
          method: "POST",
          authorization: `Bearer ${TOKEN}`,
          body: {
            title: "Encrypted commitnote share",
            visibility: "public",
            files: [
              { file_path: "commitnote-share.json", content: "envelope-text" },
            ],
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

    it("maps a 429 to RateLimited", async () => {
      const { host } = setup(() =>
        json({ message: "slow down" }, 429, { "retry-after": "30" }),
      );
      await expect(host.create("x")).rejects.toMatchObject({
        kind: "RateLimited",
        retryAfterMs: 30_000,
      });
    });

    it("maps a rate-limited 403 to RateLimited", async () => {
      const { host } = setup(() =>
        json({ message: "x" }, 403, { "retry-after": "5" }),
      );
      await expect(host.create("x")).rejects.toMatchObject({
        kind: "RateLimited",
      });
    });

    it("rejects a response without a numeric id with Server", async () => {
      for (const body of [{}, { id: "12" }]) {
        const { host } = setup(() => json(body, 201));
        await expect(host.create("x")).rejects.toMatchObject({
          kind: "Server",
        });
      }
    });
  });

  describe("update", () => {
    const locator = { provider: "gitlab", snippetId: "4711" } as const;

    it("puts an update action for the share file", async () => {
      const { host, calls, reports } = setup(() => json({ id: 4711 }, 200));

      await host.update(locator, "new-envelope");

      expect(calls).toEqual([
        {
          url: "https://gitlab.com/api/v4/snippets/4711",
          method: "PUT",
          authorization: `Bearer ${TOKEN}`,
          body: {
            files: [
              {
                action: "update",
                file_path: "commitnote-share.json",
                content: "new-envelope",
              },
            ],
          },
        },
      ]);
      expect(reports).toEqual([{ operation: "updateShare" }]);
    });

    it("maps 404 to NotFound", async () => {
      const { host } = setup(() => json({ message: "404 Not found" }, 404));
      await expect(host.update(locator, "x")).rejects.toMatchObject({
        kind: "NotFound",
      });
    });

    it("rejects a github locator without sending a request", async () => {
      const { host, calls, reports } = setup(() => json({}, 200));
      await expect(
        host.update({ provider: "github", gistId: "a" }, "x"),
      ).rejects.toMatchObject({ kind: "Server" });
      expect(calls).toEqual([]);
      expect(reports).toEqual([]);
    });
  });

  describe("delete", () => {
    const locator = { provider: "gitlab", snippetId: "4711" } as const;

    it("deletes the snippet", async () => {
      const { host, calls, reports } = setup(
        () => new Response(null, { status: 204 }),
      );

      await host.delete(locator);

      expect(calls).toEqual([
        {
          url: "https://gitlab.com/api/v4/snippets/4711",
          method: "DELETE",
          authorization: `Bearer ${TOKEN}`,
          body: undefined,
        },
      ]);
      expect(reports).toEqual([{ operation: "deleteShare" }]);
    });

    it("resolves when the snippet is already gone", async () => {
      const { host } = setup(() => json({ message: "404 Not found" }, 404));
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

    it("rejects a github locator without sending a request", async () => {
      const { host, calls, reports } = setup(() => json({}, 204));
      await expect(
        host.delete({ provider: "github", gistId: "a" }),
      ).rejects.toMatchObject({ kind: "Server" });
      expect(calls).toEqual([]);
      expect(reports).toEqual([]);
    });
  });
});
