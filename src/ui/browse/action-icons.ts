import type { RowAction } from "./row-menu-types";

const FOLDER_OUTLINE =
  "M1.75 12.5v-9a.75.75 0 0 1 .75-.75h3.25l1.5 1.75h6.25a.75.75 0 0 1 .75.75v7.25a.75.75 0 0 1-.75.75H2.5a.75.75 0 0 1-.75-.75z";

const TRASH_CAN = "M2.5 4.5h11M6.5 2.25h3M4 4.5l.75 9.25h6.5L12 4.5";

export const actionIcons = {
  "new-note": [
    "M4.5 1.75h7a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-7a1.5 1.5 0 0 1-1.5-1.5v-9.5a1.5 1.5 0 0 1 1.5-1.5z",
    "M8 6v4M6 8h4",
  ],
  "new-folder": [FOLDER_OUTLINE, "M8 6.75v4M6 8.75h4"],
  rename: ["M10.5 2.5l3 3-8 8H2.5v-3z", "M8.75 4.25l3 3"],
  move: [FOLDER_OUTLINE, "M5.5 8.75h5M8.5 6.75l2 2-2 2"],
  delete: [TRASH_CAN],
  "delete-permanently": [TRASH_CAN],
} as const satisfies Record<RowAction, readonly string[]>;

export const commandIcons = {
  export: ["M8 2.25v7.5M4.75 6.5 8 9.75l3.25-3.25", "M2.5 10.75v2.5h11v-2.5"],
  import: ["M8 9.75v-7.5M4.75 5.5 8 2.25l3.25 3.25", "M2.5 10.75v2.5h11v-2.5"],
  passphrase: [
    "M3.75 7.25h8.5a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-.75.75h-8.5a.75.75 0 0 1-.75-.75V8a.75.75 0 0 1 .75-.75z",
    "M5.25 7.25V5a2.75 2.75 0 0 1 5.5 0v2.25",
  ],
} as const;
