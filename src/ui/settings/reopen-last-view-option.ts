export interface ReopenLastViewOption {
  readonly reopenLastView: boolean;
  readonly remembered: boolean;
  readonly onReopenLastViewChange: (on: boolean) => void;
}

export const REOPEN_LAST_VIEW_LABEL = "Reopen the last note and folders";
export const REOPEN_LAST_VIEW_NEEDS_REMEMBER =
  "Needs “Remember me” when you log in.";
