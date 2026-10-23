import type { ForgeId } from "../forge/repo-coordinates";
import { formatShareLink } from "../share/share-link";
import { sortedShares, type ShareIndex } from "../share/share-index";
import type { WorkingTree } from "../sync/working-tree";
import { shareMenuItems } from "../ui/share/share-menu";
import { shareRowTitle } from "../ui/share/share-row-title";
import { canOpenShare } from "../ui/share/share-rows";
import {
  CREATE_ANOTHER_LINK_LABEL,
  CREATE_LINK_LABEL,
  CREATING_LINK_LABEL,
  describeShareDate,
  describeShareError,
  LINK_COPIED_TEXT,
  LOADING_SHARED_VERSION_TEXT,
  messageText,
  PASSWORD_COPIED_TEXT,
  PASSWORD_PROTECTED_LABEL,
  RENAME_LINK_CONFIRM,
  RENAME_LINK_FIELD,
  RENAME_LINK_TITLE,
  REVOKE_LINK_CONFIRM,
  REVOKE_LINK_MESSAGE,
  REVOKE_LINK_TITLE,
  shareActionsLabel,
  SHARE_LABEL_FIELD,
  SHARE_LINK_LABEL,
  SHARE_PASSWORD_FIELD,
  SHARE_PASSWORD_HINT,
  SHARE_PASSWORD_LABEL,
  shareExplanation,
  SHARED_LINKS_EMPTY,
  SHARED_LINKS_TITLE,
  SHARED_VERSION_TITLE,
  UPDATING_LABEL,
} from "../ui/share/share-messages";
import type { CoreEvents, ShareCopy, ShareRowView } from "./api";

export function shareCopy(forgeId: ForgeId): ShareCopy {
  return {
    explanation: shareExplanation(forgeId),
    labelField: SHARE_LABEL_FIELD,
    passwordField: SHARE_PASSWORD_FIELD,
    passwordHint: SHARE_PASSWORD_HINT,
    create: CREATE_LINK_LABEL,
    creating: CREATING_LINK_LABEL,
    createAnother: CREATE_ANOTHER_LINK_LABEL,
    shareLink: SHARE_LINK_LABEL,
    sharePassword: SHARE_PASSWORD_LABEL,
    sharedLinksTitle: SHARED_LINKS_TITLE,
    sharedLinksEmpty: SHARED_LINKS_EMPTY,
    passwordProtected: PASSWORD_PROTECTED_LABEL,
    updating: UPDATING_LABEL,
    linkCopied: LINK_COPIED_TEXT,
    passwordCopied: PASSWORD_COPIED_TEXT,
    revoke: {
      title: REVOKE_LINK_TITLE,
      message: REVOKE_LINK_MESSAGE,
      confirmLabel: REVOKE_LINK_CONFIRM,
    },
    rename: {
      title: RENAME_LINK_TITLE,
      fieldLabel: RENAME_LINK_FIELD,
      confirmLabel: RENAME_LINK_CONFIRM,
    },
    sharedVersionTitle: SHARED_VERSION_TITLE,
    loadingSharedVersion: LOADING_SHARED_VERSION_TEXT,
  };
}

export function buildSharesView(input: {
  readonly shares: ShareIndex | null;
  readonly tree: WorkingTree | null;
  readonly updatingId: string | null;
  readonly forgeId: ForgeId;
  readonly linkBase: string;
}): CoreEvents["sharesChanged"] {
  const { shares, tree, updatingId, forgeId, linkBase } = input;
  const writable = shares?.writable ?? false;
  const rows: ShareRowView[] =
    shares === null
      ? []
      : sortedShares(shares).map((entry) => {
          const { title } = shareRowTitle(entry);
          return {
            id: entry.id,
            title,
            label: entry.label,
            date: describeShareDate(entry),
            passwordProtected: entry.password !== null,
            link: formatShareLink(linkBase, entry.locator, entry.linkSecret),
            password: entry.password,
            notePath:
              entry.note.state === "active" ? [...entry.note.path] : null,
            menuLabel: shareActionsLabel(title),
            actions: shareMenuItems(entry, {
              canOpen: canOpenShare(entry, tree),
              writable,
              updating: updatingId !== null,
            }).map((item) => ({
              id: item.id,
              label: item.label,
              disabled: item.disabled ?? false,
              destructive: item.destructive ?? false,
            })),
          };
        });
  return {
    shares: rows,
    unreadable:
      shares !== null && !shares.writable
        ? messageText(describeShareError({ kind: "sharesUnavailable" }, forgeId))
        : null,
    updatingId,
    copy: shareCopy(forgeId),
  };
}
