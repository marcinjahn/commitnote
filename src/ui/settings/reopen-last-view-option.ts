export interface ReopenLastViewOption {
  readonly reopenLastView: boolean;
  readonly remembered: boolean;
  readonly onReopenLastViewChange: (on: boolean) => void;
}

export const REOPEN_LAST_VIEW_LABEL = "Reopen the last note and folders";

export function describeReopenLastViewUnavailable(standalone: boolean): string {
  return standalone
    ? "Unavailable because this device can't keep you logged in."
    : "Needs “Remember me” when you log in.";
}
