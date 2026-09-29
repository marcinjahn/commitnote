import { isForgeError } from "../forge/errors";
import type { ForgeAdapter } from "../forge/forge-adapter";
import type { ForgeAdapterFactory } from "../forge/registry";
import type { LoginError } from "../login/login";
import type { RepoCoordinates } from "../repo-url/parse-repo-url";

export type TokenCheck =
  | { readonly kind: "ok"; readonly adapter: ForgeAdapter }
  | { readonly kind: "failed"; readonly error: LoginError };

function mapError(error: unknown): LoginError {
  if (!isForgeError(error)) throw error;
  switch (error.kind) {
    case "Unauthorized":
      return { kind: "unauthorized" };
    case "Forbidden":
    case "NotFound":
      return { kind: "noAccess" };
    case "RateLimited":
      return {
        kind: "rateLimited",
        retryAfterMs: error.retryAfterMs ?? 60_000,
      };
    case "Network":
      return { kind: "network" };
    default:
      return { kind: "server" };
  }
}

export async function checkReplacementToken(
  createAdapter: ForgeAdapterFactory,
  coordinates: RepoCoordinates,
  accessToken: string,
): Promise<TokenCheck> {
  const adapter = createAdapter(coordinates, {
    accessToken: accessToken.trim(),
  });
  try {
    const inspection = await adapter.inspect();
    if (!inspection.canWrite) {
      return { kind: "failed", error: { kind: "readOnly" } };
    }
    return { kind: "ok", adapter };
  } catch (e) {
    return { kind: "failed", error: mapError(e) };
  }
}
