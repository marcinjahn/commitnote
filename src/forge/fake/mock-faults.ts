import { HttpResponse } from "msw";
import type { JsonBodyType } from "msw";

export type MockFailure =
  | {
      status: 401 | 403 | 404 | 429 | 500 | 502;
      body?: unknown;
      headers?: Record<string, string>;
    }
  | { network: true };

export interface FailureMatch {
  readonly method: string;
  readonly pathPattern: RegExp;
}

interface QueuedFailure {
  readonly match: FailureMatch;
  readonly failure: MockFailure;
}

export type JsonResponder = (
  body: JsonBodyType,
  status: number,
  headers?: Record<string, string>,
) => Response;

function matches(match: FailureMatch, method: string, path: string): boolean {
  return (
    match.method.toUpperCase() === method && match.pathPattern.test(path)
  );
}

export class MockFaults {
  private readonly failureQueue: QueuedFailure[] = [];
  private readonly dropResponseQueue: FailureMatch[] = [];

  constructor(private readonly jsonResponse: JsonResponder) {}

  failNext(match: FailureMatch, failure: MockFailure): void {
    this.failureQueue.push({ match, failure });
  }

  /** Applies the next matching request, then fails it as a network error. */
  dropNextResponse(match: FailureMatch): void {
    this.dropResponseQueue.push(match);
  }

  /** Consumes the first queued failure matching the request, if any. */
  takeFailure(method: string, path: string): Response | null {
    const index = this.failureQueue.findIndex((queued) =>
      matches(queued.match, method, path),
    );
    if (index === -1) return null;
    const [queued] = this.failureQueue.splice(index, 1);
    return this.respondFailure(queued.failure);
  }

  /** Consumes the first queued drop matching the request, if any. */
  shouldDrop(method: string, path: string): boolean {
    const index = this.dropResponseQueue.findIndex((match) =>
      matches(match, method, path),
    );
    if (index === -1) return false;
    this.dropResponseQueue.splice(index, 1);
    return true;
  }

  private respondFailure(failure: MockFailure): Response {
    if ("network" in failure) {
      return HttpResponse.error();
    }
    return this.jsonResponse(
      (failure.body ?? { message: "Injected failure" }) as JsonBodyType,
      failure.status,
      failure.headers,
    );
  }
}
