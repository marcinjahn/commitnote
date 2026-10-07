import type { ShareEntry } from "../../share/share-index";
import { shareMenuIcons } from "../browse/action-icons";
import type { MenuItem } from "../browse/row-menu-types";

export type ShareMenuId = "copy-link" | "copy-password" | "update" | "view" | "open" | "revoke";

export interface ShareMenuContext {
  readonly canOpen: boolean;
  readonly writable: boolean;
  readonly updating: boolean;
}

export function shareMenuItems(
  entry: ShareEntry,
  context: ShareMenuContext,
): MenuItem<ShareMenuId>[] {
  const item = (
    id: ShareMenuId,
    label: string,
    extra: { disabled?: boolean; destructive?: boolean } = {},
  ): MenuItem<ShareMenuId> => ({ id, label, icon: shareMenuIcons[id], ...extra });

  const items: MenuItem<ShareMenuId>[] = [item("copy-link", "Copy link")];
  if (entry.password !== null) items.push(item("copy-password", "Copy password"));
  if (entry.note.state === "active") {
    items.push(
      item("update", "Update to current version", {
        disabled: !context.writable || context.updating,
      }),
    );
  }
  items.push(item("view", "View shared version"));
  if (context.canOpen) items.push(item("open", "Open note"));
  items.push(item("revoke", "Revoke…", { destructive: true, disabled: !context.writable }));
  return items;
}
