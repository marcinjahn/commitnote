import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { useMswServer } from "../fake/msw-test-server";
import type { ShareLocator, ShareReadErrorKind } from "../share-host";
import { ShareReadError } from "../share-host";
import { createGitLabShareReader } from "./gitlab-share-reader";

const SNIPPET_ID = "98765432";
const META_URL = `https://gitlab.com/api/v4/snippets/${SNIPPET_ID}`;
const fileUrl = (ref: string, path: string) =>
  `${META_URL}/files/${encodeURIComponent(ref)}/${encodeURIComponent(path)}/raw`;
const locator: ShareLocator = { provider: "gitlab", snippetId: SNIPPET_ID };

const getServer = useMswServer();
const reader = createGitLabShareReader();

function metadata(paths: readonly string[], ref = "main") {
  return {
    id: Number(SNIPPET_ID),
    files: paths.map((path) => ({
      path,
      raw_url: `https://gitlab.com/-/snippets/${SNIPPET_ID}/raw/${ref}/${path}`,
    })),
  };
}

async function kindOf(promise: Promise<unknown>): Promise<ShareReadErrorKind> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ShareReadError);
  expect((error as Error).message).not.toContain(SNIPPET_ID);
  return (error as ShareReadError).kind;
}

function respondToMetadata(init: () => Response) {
  getServer().use(http.get(META_URL, init));
}

describe("createGitLabShareReader", () => {
  it("reads the envelope by name anonymously even when it is not the first file", async () => {
    const authorizations: (string | null)[] = [];
    getServer().use(
      http.get(META_URL, ({ request }) => {
        authorizations.push(request.headers.get("authorization"));
        return HttpResponse.json(
          metadata(["commitnote-image-0.json", "commitnote-share.json"]),
        );
      }),
      http.get(fileUrl("main", "commitnote-share.json"), ({ request }) => {
        authorizations.push(request.headers.get("authorization"));
        return new HttpResponse("envelope-text");
      }),
    );

    const share = await reader.read(locator);

    expect(share.envelope).toBe("envelope-text");
    expect(authorizations).toEqual([null, null]);
  });

  it("takes the ref from the raw url and fetches image files lazily", async () => {
    const requested: string[] = [];
    getServer().use(
      http.get(META_URL, () =>
        HttpResponse.json(
          metadata(["commitnote-share.json", "commitnote-image-0.json"], "feature"),
        ),
      ),
      http.get(fileUrl("feature", "commitnote-share.json"), () => {
        requested.push("envelope");
        return new HttpResponse("env");
      }),
      http.get(fileUrl("feature", "commitnote-image-0.json"), () => {
        requested.push("image");
        return new HttpResponse("image-text");
      }),
    );

    const share = await reader.read(locator);
    expect(requested).toEqual(["envelope"]);
    await expect(share.readImageFile("commitnote-image-0.json")).resolves.toBe(
      "image-text",
    );
    expect(requested).toEqual(["envelope", "image"]);
  });

  describe("damaged shares", () => {
    function serveEnvelope(paths: readonly string[]) {
      getServer().use(
        http.get(META_URL, () => HttpResponse.json(metadata(paths))),
        http.get(fileUrl("main", "commitnote-share.json"), () => new HttpResponse("env")),
      );
    }

    it("rejects an image name that is invalid", async () => {
      serveEnvelope(["commitnote-share.json", "notes.txt"]);
      const share = await reader.read(locator);
      expect(await kindOf(share.readImageFile("notes.txt"))).toBe("damaged");
      expect(await kindOf(share.readImageFile("../commitnote-image-0.json"))).toBe(
        "damaged",
      );
    });

    it("rejects an image file missing from the snippet", async () => {
      serveEnvelope(["commitnote-share.json"]);
      const share = await reader.read(locator);
      expect(await kindOf(share.readImageFile("commitnote-image-0.json"))).toBe(
        "damaged",
      );
    });

    it("rejects metadata without files", async () => {
      respondToMetadata(() => HttpResponse.json({ id: 1 }));
      expect(await kindOf(reader.read(locator))).toBe("damaged");
    });

    it("rejects a raw url without a ref", async () => {
      respondToMetadata(() =>
        HttpResponse.json({
          files: [{ path: "commitnote-share.json", raw_url: "https://gitlab.com/x" }],
        }),
      );
      expect(await kindOf(reader.read(locator))).toBe("damaged");
    });

    it("rejects an envelope file missing from the snippet", async () => {
      respondToMetadata(() => HttpResponse.json(metadata(["commitnote-image-0.json"])));
      expect(await kindOf(reader.read(locator))).toBe("damaged");
    });

    it("rejects metadata that is not json", async () => {
      respondToMetadata(() => new HttpResponse("<html>"));
      expect(await kindOf(reader.read(locator))).toBe("damaged");
    });
  });

  const statuses = [
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
  ] as const;

  it.each(statuses)("maps %s of the metadata request", async (_name, response, expected) => {
    respondToMetadata(response);
    expect(await kindOf(reader.read(locator))).toBe(expected);
  });

  it.each(statuses)("maps %s of the envelope request", async (_name, response, expected) => {
    getServer().use(
      http.get(META_URL, () => HttpResponse.json(metadata(["commitnote-share.json"]))),
      http.get(fileUrl("main", "commitnote-share.json"), response),
    );
    expect(await kindOf(reader.read(locator))).toBe(expected);
  });

  it.each(statuses)("maps %s of an image request", async (_name, response, expected) => {
    getServer().use(
      http.get(META_URL, () =>
        HttpResponse.json(metadata(["commitnote-share.json", "commitnote-image-0.json"])),
      ),
      http.get(fileUrl("main", "commitnote-share.json"), () => new HttpResponse("env")),
      http.get(fileUrl("main", "commitnote-image-0.json"), response),
    );
    const share = await reader.read(locator);
    expect(await kindOf(share.readImageFile("commitnote-image-0.json"))).toBe(expected);
  });

  it("rejects a locator of another provider as damaged", async () => {
    expect(
      await kindOf(reader.read({ provider: "github", gistId: "g" })),
    ).toBe("damaged");
  });
});
