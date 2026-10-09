import type { UpdateGateState } from "./update-gate";

export type UpdateToastKind = "available" | "waitingForSave" | "reloadPending";

export function updateToastKind(
  updateWaiting: boolean,
  gateState: UpdateGateState,
): UpdateToastKind | null {
  switch (gateState) {
    case "idle":
      return updateWaiting ? "available" : null;
    case "waitingForSave":
    case "reloadPending":
      return gateState;
    case "activating":
    case "reloading":
      return null;
  }
}
