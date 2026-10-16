import { describe, expect, it } from "vitest";
import { createRateLimitRecorder } from "./forge-http";

const GITHUB = {
  remaining: "x-ratelimit-remaining",
  reset: "x-ratelimit-reset",
};
const GITLAB = { remaining: "ratelimit-remaining", reset: "ratelimit-reset" };

function respond(
  headers: Record<string, string>,
  status = 200,
): Response {
  return new Response(null, { status, headers });
}

describe("createRateLimitRecorder", () => {
  it("is null before any response", () => {
    expect(createRateLimitRecorder(GITHUB).current()).toBeNull();
  });

  it("reads the GitHub headers, converting the reset to milliseconds", () => {
    const recorder = createRateLimitRecorder(GITHUB);
    recorder.record(
      respond({ "x-ratelimit-remaining": "4999", "x-ratelimit-reset": "1700" }),
    );
    expect(recorder.current()).toEqual({ remaining: 4999, resetAt: 1_700_000 });
  });

  it("reads the GitLab headers", () => {
    const recorder = createRateLimitRecorder(GITLAB);
    recorder.record(
      respond({ "ratelimit-remaining": "12", "ratelimit-reset": "2000" }),
    );
    expect(recorder.current()).toEqual({ remaining: 12, resetAt: 2_000_000 });
  });

  it("ignores headers of the other forge", () => {
    const recorder = createRateLimitRecorder(GITLAB);
    recorder.record(
      respond({ "x-ratelimit-remaining": "1", "x-ratelimit-reset": "2" }),
    );
    expect(recorder.current()).toBeNull();
  });

  it("keeps the previous record when a header is missing", () => {
    const recorder = createRateLimitRecorder(GITHUB);
    recorder.record(
      respond({ "x-ratelimit-remaining": "10", "x-ratelimit-reset": "100" }),
    );
    recorder.record(respond({ "x-ratelimit-remaining": "9" }));
    recorder.record(respond({ "x-ratelimit-reset": "200" }));
    recorder.record(respond({}));
    expect(recorder.current()).toEqual({ remaining: 10, resetAt: 100_000 });
  });

  it("ignores non-numeric values", () => {
    const recorder = createRateLimitRecorder(GITHUB);
    recorder.record(
      respond({ "x-ratelimit-remaining": "10", "x-ratelimit-reset": "100" }),
    );
    recorder.record(
      respond({ "x-ratelimit-remaining": "abc", "x-ratelimit-reset": "200" }),
    );
    recorder.record(
      respond({ "x-ratelimit-remaining": "8", "x-ratelimit-reset": "soon" }),
    );
    expect(recorder.current()).toEqual({ remaining: 10, resetAt: 100_000 });
  });

  it("records responses of any status", () => {
    const recorder = createRateLimitRecorder(GITHUB);
    for (const status of [304, 403, 500]) {
      recorder.record(
        respond(
          {
            "x-ratelimit-remaining": String(status),
            "x-ratelimit-reset": "100",
          },
          status,
        ),
      );
      expect(recorder.current()?.remaining).toBe(status);
    }
  });
});
