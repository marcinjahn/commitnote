import { isTransient, type LoginError } from "../login/login";
import type { SyncError } from "../sync/sync-engine";
import { describeLoginError } from "../ui/login/login-messages";
import { describeSyncError, KEY_CHANGED_MESSAGE } from "../ui/browse/sync-messages";

export type EarlyDraftLoadAction = "tryAgain" | "logIn";

export type EarlyDraftLoadStatus =
  | { readonly kind: "loading" }
  | {
      readonly kind: "failed";
      readonly message: string;
      readonly actions: readonly EarlyDraftLoadAction[];
      readonly notSavedYet: boolean;
    };

export interface EarlyDraftLoadInputs {
  readonly resumeError: LoginError | null;
  readonly phase: "restoring" | "login" | "app";
  readonly refreshError: SyncError | null;
  readonly treeLoaded: boolean;
  readonly keyChanged: boolean;
  readonly sessionRemembered: boolean;
  readonly forgeName: string;
}

export function earlyDraftLoadStatus(inputs: EarlyDraftLoadInputs): EarlyDraftLoadStatus {
  const { resumeError, refreshError, forgeName } = inputs;
  const notSavedYet = !inputs.sessionRemembered;
  if (inputs.keyChanged) {
    return { kind: "failed", message: KEY_CHANGED_MESSAGE, actions: ["logIn"], notSavedYet };
  }
  if (resumeError !== null) {
    const message = describeLoginError(resumeError, forgeName);
    return isTransient(resumeError)
      ? { kind: "failed", message, actions: ["tryAgain", "logIn"], notSavedYet }
      : { kind: "failed", message, actions: ["logIn"], notSavedYet: true };
  }
  if (inputs.phase === "app" && !inputs.treeLoaded && refreshError !== null) {
    return {
      kind: "failed",
      message: describeSyncError(refreshError, forgeName),
      actions: [],
      notSavedYet,
    };
  }
  return { kind: "loading" };
}
