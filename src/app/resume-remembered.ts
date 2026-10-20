import type { ForgeAdapter } from "../forge/forge-adapter";
import {
  isTransient,
  resumeSession,
  type LoginDependencies,
  type LoginError,
  type LoginStep,
} from "../login/login";
import type { SessionStore } from "../session/session-store";
import type { Session } from "../session/session";

export interface ResumeRememberedDeps {
  readonly store: Pick<SessionStore, "loadRememberedSession">;
  readonly loginDeps: LoginDependencies;
  readonly onStep?: (step: LoginStep) => void;
  onSessionLoaded?(session: Session): Promise<void>;
  clearAfterFailure(session: Session | null): Promise<void>;
}

export type ResumeRememberedResult =
  | { readonly kind: "none" }
  | {
      readonly kind: "loggedIn";
      readonly session: Session;
      readonly adapter: ForgeAdapter;
      readonly head?: string;
    }
  | {
      readonly kind: "failed";
      readonly error: LoginError;
      readonly transient: boolean;
    };

export async function resumeRemembered(
  deps: ResumeRememberedDeps,
): Promise<ResumeRememberedResult> {
  const session = await deps.store.loadRememberedSession();
  if (session === null) {
    await deps.clearAfterFailure(null);
    return { kind: "none" };
  }
  await deps.onSessionLoaded?.(session);
  const result = await resumeSession(session, deps.loginDeps, deps.onStep);
  if (result.kind === "loggedIn") return result;
  const transient = isTransient(result.error);
  if (!transient) await deps.clearAfterFailure(session);
  return { kind: "failed", error: result.error, transient };
}
