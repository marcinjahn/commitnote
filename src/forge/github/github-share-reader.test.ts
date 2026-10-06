import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { useMswServer } from "../fake/msw-test-server";
import type { ShareLocator, ShareReadErrorKind } from "../share-host";
import { ShareReadError } from "../share-host";
import { createGitHubShareReader } from "./github-share-reader";

const GIST_ID = "abc123gist";
const REVISION = "rev456";
const URL = `https://api.github.com/gists/${GIST_ID}/${REVISION}`;
const locator: ShareLocator = {
  provider: "github",
  gistId: GIST_ID,
  revision: REVISION,
};

const getServer = useMswServer();
const reader = createGitHubShareReader();

async function kindOf(promise: Promise<unknown>): Promise<ShareReadErrorKind> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ShareReadError);
  expect((error as Error).message).not.toContain(GIST_ID);
  expect((error as Error).message).not.toContain(REVISION);
  return (error as ShareReadError).kind;
}

function respondWith(init: () => Response) {
  getServer().use(http.get(URL, init));
}

describe("createGitHubShareReader", () => {
  it("requests the gist revision anonymously and returns the envelope", async () => {
    let authorization: string | null = "unset";
    let accept: string | null = null;
    getServer().use(
      http.get(URL, ({ request }) => {
        authorization = request.headers.get("authorization");
        accept = request.headers.get("accept");
        return HttpResponse.json({
          files: { "commitnote-share.json": { content: "envelope-text" } },
        });
      }),
    );

    await expect(reader.read(locator)).resolves.toBe("envelope-text");
    expect(authorization).toBeNull();
    expect(accept).toBe("application/vnd.github+json");
  });

  it.each([
    ["truncated", { files: { "commitnote-share.json": { content: "x", truncated: true } } }],
    ["missing file", { files: { "other.txt": { content: "x" } } }],
    ["missing content", { files: { "commitnote-share.json": {} } }],
    ["non-string content", { files: { "commitnote-share.json": { content: 5 } } }],
    ["no files", {}],
  ])("maps %s to damaged", async (_name, body) => {
    respondWith(() => HttpResponse.json(body));
    expect(await kindOf(reader.read(locator))).toBe("damaged");
  });

  it("maps invalid JSON to damaged", async () => {
    respondWith(() => new HttpResponse("not json", { status: 200 }));
    expect(await kindOf(reader.read(locator))).toBe("damaged");
  });

  it.each([
    ["404", () => new HttpResponse(null, { status: 404 }), "notFound"],
    ["429", () => new HttpResponse(null, { status: 429 }), "rateLimited"],
    [
      "403 with exhausted rate limit",
      () =>
        new HttpResponse(null, {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        }),
      "rateLimited",
    ],
    [
      "403 with retry-after",
      () =>
        new HttpResponse(null, { status: 403, headers: { "retry-after": "30" } }),
      "rateLimited",
    ],
    [
      "403 with rate limit message",
      () => HttpResponse.json({ message: "API rate limit exceeded" }, { status: 403 }),
      "rateLimited",
    ],
    ["other 403", () => new HttpResponse(null, { status: 403 }), "notFound"],
    ["500", () => new HttpResponse(null, { status: 500 }), "server"],
    ["unexpected status", () => new HttpResponse(null, { status: 418 }), "server"],
    ["network failure", () => HttpResponse.error(), "network"],
  ] as const)("maps %s", async (_name, response, expected) => {
    respondWith(response);
    expect(await kindOf(reader.read(locator))).toBe(expected);
  });

  it("rejects a locator of another provider as damaged", async () => {
    expect(
      await kindOf(reader.read({ provider: "gitlab", snippetId: "1" })),
    ).toBe("damaged");
  });
});
