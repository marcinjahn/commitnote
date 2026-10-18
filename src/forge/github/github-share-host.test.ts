import { describe, expect, it } from "vitest";
import type { ContentCreatingRequest } from "../forge-adapter";
import { SHARE_FILE, shareImageFileName } from "../share-files";
import { createGitHubAdapter } from "./github-adapter";

const TOKEN = "s3cr3t-token";

interface Recorded {
  readonly url: string;
  readonly method: string | undefined;
  readonly authorization: string | null;
  readonly body: unknown;
}

function setup(respond: (method: string | undefined) => Response) {
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
    return respond(init?.method);
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

const content = (envelope: string, images: string[] = []) => ({
  envelope,
  images,
});

const json = (body: unknown, status: number, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });

describe("GitHub share host", () => {
  describe("create", () => {
    it("posts every image as its own gist file", async () => {
      const { host, calls } = setup(() => json({ id: "abc123" }, 201));

      await host.create(content("env", ["one", "two"]));

      expect(calls[0]?.body).toMatchObject({
        files: {
          [SHARE_FILE]: { content: "env" },
          [shareImageFileName(0)]: { content: "one" },
          [shareImageFileName(1)]: { content: "two" },
        },
      });
    });

    it("exposes the image limit", () => {
      expect(setup(() => json({}, 200)).host.maxImages).toBe(20);
    });

    it("posts a secret gist and returns its locator", async () => {
      const { host, calls, reports } = setup(() =>
        json({ id: "abc123" }, 201),
      );

      const locator = await host.create({ envelope: "envelope-text", images: [] });

      expect(locator).toEqual({ provider: "github", gistId: "abc123" });
      expect(calls).toEqual([
        {
          url: "https://api.github.com/gists",
          method: "POST",
          authorization: `Bearer ${TOKEN}`,
          body: {
            public: false,
            description: "Encrypted commitnote share",
            files: { [SHARE_FILE]: { content: "envelope-text" } },
          },
        },
      ]);
      expect(reports).toEqual([{ operation: "createShare" }]);
    });

    it.each([403, 404])("maps %i to Forbidden", async (status) => {
      const { host } = setup(() => json({ message: "nope" }, status));
      await expect(host.create(content("x"))).rejects.toMatchObject({
        kind: "Forbidden",
      });
    });

    it("maps 401 to Unauthorized", async () => {
      const { host } = setup(() => json({ message: "Bad" }, 401));
      await expect(host.create(content("x"))).rejects.toMatchObject({
        kind: "Unauthorized",
      });
    });

    it("maps a rate-limited 403 and a 429 to RateLimited", async () => {
      const limited403 = setup(() =>
        json({ message: "API rate limit exceeded" }, 403),
      );
      await expect(limited403.host.create(content("x"))).rejects.toMatchObject({
        kind: "RateLimited",
      });
      const limited429 = setup(() =>
        json({ message: "slow down" }, 429, { "retry-after": "30" }),
      );
      await expect(limited429.host.create(content("x"))).rejects.toMatchObject({
        kind: "RateLimited",
        retryAfterMs: 30_000,
      });
    });

    it("rejects a response without a gist id with Server", async () => {
      for (const body of [{}, { id: 5 }]) {
        const { host } = setup(() => json(body, 201));
        await expect(host.create(content("x"))).rejects.toMatchObject({
          kind: "Server",
        });
      }
    });

    it("reports the request even when it fails", async () => {
      const { host, reports } = setup(() => json({}, 500));
      await expect(host.create(content("x"))).rejects.toMatchObject({ kind: "Server" });
      expect(reports).toEqual([{ operation: "createShare" }]);
    });
  });

  describe("update", () => {
    const locator = { provider: "github", gistId: "abc123" } as const;

    const gist = (...names: string[]) => ({
      files: Object.fromEntries(names.map((name) => [name, { content: "x" }])),
    });
    const respondGetThenPatch = (names: string[]) => (method?: string) =>
      method === "GET" ? json(gist(...names), 200) : json({ id: "abc123" }, 200);

    it("reads the gist then patches the share file content", async () => {
      const { host, calls, reports } = setup(respondGetThenPatch([SHARE_FILE]));

      await host.update(locator, content("new-envelope"));

      expect(calls).toEqual([
        {
          url: "https://api.github.com/gists/abc123",
          method: "GET",
          authorization: `Bearer ${TOKEN}`,
          body: undefined,
        },
        {
          url: "https://api.github.com/gists/abc123",
          method: "PATCH",
          authorization: `Bearer ${TOKEN}`,
          body: { files: { [SHARE_FILE]: { content: "new-envelope" } } },
        },
      ]);
      expect(reports).toEqual([{ operation: "updateShare" }]);
    });

    it("deletes stale image files with null and leaves other files alone", async () => {
      const { host, calls } = setup(
        respondGetThenPatch([
          SHARE_FILE,
          shareImageFileName(0),
          shareImageFileName(1),
          shareImageFileName(2),
          "notes.txt",
        ]),
      );

      await host.update(locator, content("env", ["img0"]));

      expect(calls[1]?.body).toEqual({
        files: {
          [SHARE_FILE]: { content: "env" },
          [shareImageFileName(0)]: { content: "img0" },
          [shareImageFileName(1)]: null,
          [shareImageFileName(2)]: null,
        },
      });
    });

    it("adds image files that are new", async () => {
      const { host, calls } = setup(respondGetThenPatch([SHARE_FILE]));

      await host.update(locator, content("env", ["a", "b"]));

      expect(calls[1]?.body).toEqual({
        files: {
          [SHARE_FILE]: { content: "env" },
          [shareImageFileName(0)]: { content: "a" },
          [shareImageFileName(1)]: { content: "b" },
        },
      });
    });

    it("maps a missing gist to NotFound without patching", async () => {
      const { host, calls } = setup(() => json({ message: "Not Found" }, 404));
      await expect(host.update(locator, content("x"))).rejects.toMatchObject({
        kind: "NotFound",
      });
      expect(calls.map((call) => call.method)).toEqual(["GET"]);
    });

    it("maps a failing patch", async () => {
      const { host } = setup((method) =>
        method === "GET" ? json(gist(SHARE_FILE), 200) : json({}, 500),
      );
      await expect(host.update(locator, content("x"))).rejects.toMatchObject({
        kind: "Server",
      });
    });

    it("rejects a gitlab locator without sending a request", async () => {
      const { host, calls, reports } = setup(() => json({}, 200));
      await expect(
        host.update({ provider: "gitlab", snippetId: "1" }, content("x")),
      ).rejects.toMatchObject({ kind: "Server" });
      expect(calls).toEqual([]);
      expect(reports).toEqual([]);
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
