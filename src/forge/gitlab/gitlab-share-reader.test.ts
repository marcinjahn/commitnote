import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { useMswServer } from "../fake/msw-test-server";
import type { ShareLocator, ShareReadErrorKind } from "../share-host";
import { ShareReadError } from "../share-host";
import { createGitLabShareReader } from "./gitlab-share-reader";

const SNIPPET_ID = "98765432";
const URL = `https://gitlab.com/api/v4/snippets/${SNIPPET_ID}/raw`;
const locator: ShareLocator = { provider: "gitlab", snippetId: SNIPPET_ID };

const getServer = useMswServer();
const reader = createGitLabShareReader();

async function kindOf(promise: Promise<unknown>): Promise<ShareReadErrorKind> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ShareReadError);
  expect((error as Error).message).not.toContain(SNIPPET_ID);
  return (error as ShareReadError).kind;
}

function respondWith(init: () => Response) {
  getServer().use(http.get(URL, init));
}

describe("createGitLabShareReader", () => {
  it("requests the raw snippet anonymously and returns the envelope", async () => {
    let authorization: string | null = "unset";
    getServer().use(
      http.get(URL, ({ request }) => {
        authorization = request.headers.get("authorization");
        return new HttpResponse("envelope-text");
      }),
    );

    await expect(reader.read(locator)).resolves.toBe("envelope-text");
    expect(authorization).toBeNull();
  });

  it.each([
    ["404", () => new HttpResponse(null, { status: 404 }), "notFound"],
    ["429", () => new HttpResponse(null, { status: 429 }), "rateLimited"],
    [
      "403 with exhausted rate limit",
      () =>
        new HttpResponse(null, {
          status: 403,
          headers: { "ratelimit-remaining": "0" },
        }),
      "rateLimited",
    ],
    [
      "403 with retry-after",
      () =>
        new HttpResponse(null, { status: 403, headers: { "retry-after": "30" } }),
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
      await kindOf(
        reader.read({ provider: "github", gistId: "g", revision: "r" }),
      ),
    ).toBe("damaged");
  });
});
