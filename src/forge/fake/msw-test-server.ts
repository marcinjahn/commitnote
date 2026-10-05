import { afterAll, afterEach, beforeAll } from "vitest";
import { setupServer } from "msw/node";
import type { RequestHandler } from "msw";
import type { SetupServer } from "msw/node";

export function useMswServer(
  ...handlers: RequestHandler[]
): () => SetupServer {
  let server: SetupServer;
  beforeAll(() => {
    server = setupServer(...handlers);
    server.listen({ onUnhandledRequest: "error" });
  });
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return () => server;
}
