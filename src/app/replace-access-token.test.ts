import { describe, expect, it } from "vitest";
import { ForgeError } from "../forge/errors";
import { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import type { ForgeAdapter, ForgeAdapterOptions } from "../forge/forge-adapter";
import type { RepoCoordinates } from "../repo-url/parse-repo-url";
import { checkReplacementToken } from "./replace-access-token";

const coordinates: RepoCoordinates = {
  forge: "github",
  owner: "sample",
  repo: "notes",
};

describe("checkReplacementToken", () => {
  it("returns the adapter created with the trimmed token", async () => {
    const adapter = new FakeForgeAdapter();
    let received: ForgeAdapterOptions | null = null;
    const result = await checkReplacementToken(
      (_coordinates, options) => {
        received = options;
        return adapter;
      },
      coordinates,
      "  new-token \n",
    );

    expect(result).toEqual({ kind: "ok", adapter });
    expect(received).toEqual({ accessToken: "new-token" });
  });

  it("reports a token without write access as readOnly", async () => {
    const adapter = new FakeForgeAdapter({ canWrite: false });
    const result = await checkReplacementToken(() => adapter, coordinates, "t");
    expect(result).toEqual({ kind: "failed", error: { kind: "readOnly" } });
  });

  it.each([
    ["Unauthorized", { kind: "unauthorized" }],
    ["Forbidden", { kind: "noAccess" }],
    ["NotFound", { kind: "noAccess" }],
    ["Network", { kind: "network" }],
    ["Server", { kind: "server" }],
  ] as const)("maps %s to %j", async (kind, expected) => {
    const adapter = new FakeForgeAdapter();
    adapter.failNext("inspect", new ForgeError(kind));
    const result = await checkReplacementToken(() => adapter, coordinates, "t");
    expect(result).toEqual({ kind: "failed", error: expected });
  });

  it("carries the retry delay of a rate limit", async () => {
    const adapter = new FakeForgeAdapter();
    adapter.failNext(
      "inspect",
      new ForgeError("RateLimited", { retryAfterMs: 120_000 }),
    );
    const result = await checkReplacementToken(() => adapter, coordinates, "t");
    expect(result).toEqual({
      kind: "failed",
      error: { kind: "rateLimited", retryAfterMs: 120_000 },
    });
  });

  it("propagates rejections that are not forge errors", async () => {
    const reject = () => Promise.reject(new TypeError("boom"));
    const broken: ForgeAdapter = {
      inspect: reject,
      initialize: reject,
      getHead: reject,
      listTree: reject,
      readBlob: reject,
      commit: reject,
    };
    await expect(
      checkReplacementToken(() => broken, coordinates, "t"),
    ).rejects.toThrow("boom");
  });
});
