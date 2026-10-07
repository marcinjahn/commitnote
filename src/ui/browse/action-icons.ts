import type { ShareMenuId } from "../share/share-menu";
import type { RowAction } from "./row-menu-types";

const FOLDER_OUTLINE =
  "M1.75 12.5v-9a.75.75 0 0 1 .75-.75h3.25l1.5 1.75h6.25a.75.75 0 0 1 .75.75v7.25a.75.75 0 0 1-.75.75H2.5a.75.75 0 0 1-.75-.75z";

const TRASH_CAN = "M2.5 4.5h11M6.5 2.25h3M4 4.5l.75 9.25h6.5L12 4.5";

const LINK = [
  "M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2.5-2.5a2.5 2.5 0 0 0-3.54-3.54l-.75.75",
  "M9.25 6.75a2.5 2.5 0 0 0-3.54 0l-2.5 2.5a2.5 2.5 0 0 0 3.54 3.54l.75-.75",
] as const;

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
  share: LINK,
} as const satisfies Record<RowAction, readonly string[]>;

const LOCK = [
  "M3.75 7.25h8.5a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-.75.75h-8.5a.75.75 0 0 1-.75-.75V8a.75.75 0 0 1 .75-.75z",
  "M5.25 7.25V5a2.75 2.75 0 0 1 5.5 0v2.25",
] as const;

export const shareMenuIcons = {
  "copy-link": LINK,
  "copy-password": LOCK,
  update: [
    "M13.5 8a5.5 5.5 0 1 1-1.7-3.98M13.5 2.5v3.5H10",
  ],
  view: [
    "M1.5 8s2.25-4.5 6.5-4.5S14.5 8 14.5 8s-2.25 4.5-6.5 4.5S1.5 8 1.5 8z",
    "M8 6.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z",
  ],
  open: [
    "M6.5 3h-3a.75.75 0 0 0-.75.75v8.5c0 .41.34.75.75.75h8.5a.75.75 0 0 0 .75-.75v-3",
    "M9.5 2.5h4v4M13.5 2.5 7.5 8.5",
  ],
  rename: actionIcons.rename,
  revoke: [TRASH_CAN],
} as const satisfies Record<ShareMenuId, readonly string[]>;

export const commandIcons = {
  settings: [
    "M8.14 1.75h-.28a1.25 1.25 0 0 0-1.25 1.25v.11a1.25 1.25 0 0 1-.62 1.08l-.27.16a1.25 1.25 0 0 1-1.25 0l-.1-.05a1.25 1.25 0 0 0-1.7.46l-.14.23a1.25 1.25 0 0 0 .46 1.71l.09.06a1.25 1.25 0 0 1 .63 1.08v.32a1.25 1.25 0 0 1-.63 1.08l-.09.06a1.25 1.25 0 0 0-.46 1.71l.14.23a1.25 1.25 0 0 0 1.7.46l.1-.05a1.25 1.25 0 0 1 1.25 0l.27.16a1.25 1.25 0 0 1 .62 1.08V13a1.25 1.25 0 0 0 1.25 1.25h.28a1.25 1.25 0 0 0 1.25-1.25v-.11a1.25 1.25 0 0 1 .62-1.08l.27-.16a1.25 1.25 0 0 1 1.25 0l.1.05a1.25 1.25 0 0 0 1.7-.46l.14-.24a1.25 1.25 0 0 0-.46-1.71l-.09-.05a1.25 1.25 0 0 1-.63-1.08v-.32a1.25 1.25 0 0 1 .63-1.08l.09-.06a1.25 1.25 0 0 0 .46-1.71l-.14-.23a1.25 1.25 0 0 0-1.7-.46l-.1.05a1.25 1.25 0 0 1-1.25 0l-.27-.16a1.25 1.25 0 0 1-.62-1.08V3a1.25 1.25 0 0 0-1.25-1.25z",
    "M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  ],
  sharedLinks: LINK,
  logOut: [
    "M6.25 2.5H3.25a.75.75 0 0 0-.75.75v9.5c0 .41.34.75.75.75h3",
    "M6.5 8h7M10.75 5.25 13.5 8l-2.75 2.75",
  ],
} as const;

export const noteIcons = {
  history: [
    "M2.75 8a5.25 5.25 0 1 0 1.54-3.71L2.5 6.1",
    "M2.5 2.85V6.1h3.25",
    "M8 5.25V8l1.9 1.4",
  ],
  share: LINK,
  lock: [
    "M3.75 7.25h8.5a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-.75.75h-8.5a.75.75 0 0 1-.75-.75V8a.75.75 0 0 1 .75-.75z",
    "M5.25 7.25V5a2.75 2.75 0 0 1 5.5 0v2.25",
  ],
  tag: ["M2.5 2.5h5.3l6.2 6.2-5.3 5.3-6.2-6.2z", "M5.25 5.25h.01"],
} as const;

export const searchIcon = [
  "M7 2.25a4.75 4.75 0 1 0 0 9.5a4.75 4.75 0 1 0 0-9.5z",
  "M10.5 10.5l3.25 3.25",
] as const;

export const syncStatusIcons = {
  note: ["M3.5 1.5h6l3 3v10h-9z", "M9.5 1.5v3h3"],
  retry: ["M13.5 8a5.5 5.5 0 1 1-1.7-3.98M13.5 2.5v3.5H10"],
} as const;
