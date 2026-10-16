import { describe, expect, it } from "vitest";
import { createGitHubAdapter } from "./github/github-adapter";
import { createGitLabAdapter } from "./gitlab/gitlab-adapter";

function stubFetch(
  headers: Record<string, string>,
  status: number,
): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ message: "x" }), { status, headers });
}

describe("observedRateLimit", () => {
  const github = (fetchImpl: typeof fetch) =>
    createGitHubAdapter(
      { owner: "acme", repo: "notes" },
      { accessToken: "t", fetch: fetchImpl },
    );
  const gitlab = (fetchImpl: typeof fetch) =>
    createGitLabAdapter(
      { owner: "acme", repo: "notes" },
      { accessToken: "t", fetch: fetchImpl },
    );
  const githubHeaders = {
    "x-ratelimit-remaining": "4000",
    "x-ratelimit-reset": "1700",
  };
  const gitlabHeaders = {
    "ratelimit-remaining": "300",
    "ratelimit-reset": "1800",
  };

  it("is null before any request", () => {
    expect(github(stubFetch({}, 200)).observedRateLimit?.()).toBeNull();
    expect(gitlab(stubFetch({}, 200)).observedRateLimit?.()).toBeNull();
  });

  it("records a GitHub success and an error response", async () => {
    let status = 200;
    const adapter = github(async () =>
      new Response(JSON.stringify({ object: { sha: "abc" } }), {
        status,
        headers: githubHeaders,
      }),
    );
    await adapter.getHead().catch(() => undefined);
    expect(adapter.observedRateLimit?.()).toEqual({
      remaining: 4000,
      resetAt: 1_700_000,
    });

    status = 500;
    const failing = github(stubFetch({ ...githubHeaders, "x-ratelimit-remaining": "3" }, 500));
    await failing.getHead().catch(() => undefined);
    expect(failing.observedRateLimit?.()).toEqual({
      remaining: 3,
      resetAt: 1_700_000,
    });
  });

  it("records a GitLab success and an error response", async () => {
    const ok = gitlab(stubFetch(gitlabHeaders, 200));
    await ok.getHead().catch(() => undefined);
    expect(ok.observedRateLimit?.()).toEqual({
      remaining: 300,
      resetAt: 1_800_000,
    });

    const failing = gitlab(
      stubFetch({ ...gitlabHeaders, "ratelimit-remaining": "0" }, 429),
    );
    await failing.getHead().catch(() => undefined);
    expect(failing.observedRateLimit?.()).toEqual({
      remaining: 0,
      resetAt: 1_800_000,
    });
  });
});
