import type { ShareEntry } from "../share/share-index";
import type { SettingsEdits } from "../settings/settings";
import type { ColorTag } from "../tags/color-tag";

export type NotePath = readonly string[];

export type Change =
  | {
      readonly kind: "create-note";
      readonly path: NotePath;
      readonly content: string;
    }
  | {
      readonly kind: "update-note";
      readonly path: NotePath;
      readonly content: string;
    }
  | { readonly kind: "delete-note"; readonly path: NotePath }
  | { readonly kind: "create-folder"; readonly path: NotePath }
  | { readonly kind: "delete-folder"; readonly path: NotePath }
  | {
      readonly kind: "rename-note";
      readonly from: NotePath;
      readonly to: NotePath;
    }
  | {
      readonly kind: "rename-folder";
      readonly from: NotePath;
      readonly to: NotePath;
    }
  | {
      readonly kind: "trash-note";
      readonly path: NotePath;
      readonly entryId: string;
    }
  | {
      readonly kind: "trash-folder";
      readonly path: NotePath;
      readonly entryId: string;
    }
  | {
      readonly kind: "restore-trash";
      readonly entryId: string;
      readonly subPath: NotePath;
      readonly target: "note" | "folder";
      readonly to: NotePath;
    }
  | { readonly kind: "purge-trash"; readonly entryIds: readonly string[] }
  | {
      readonly kind: "set-order";
      readonly parent: NotePath;
      readonly positions: readonly OrderPosition[];
      /** The child the user placed, to show its saving state; never committed. */
      readonly moved?: string;
    }
  | { readonly kind: "set-settings"; readonly values: SettingsEdits }
  | {
      readonly kind: "set-color-tag";
      readonly path: NotePath;
      readonly color: ColorTag | null;
    }
  | { readonly kind: "add-share"; readonly entry: ShareEntry }
  | { readonly kind: "update-share"; readonly entry: ShareEntry }
  | { readonly kind: "remove-share"; readonly id: string }
  | {
      readonly kind: "set-share-label";
      readonly id: string;
      readonly label: string | null;
    };

/** The order key of the child `name` of a folder. */
export interface OrderPosition {
  readonly name: string;
  readonly key: string;
}

export type ChangeSet = readonly Change[];

export function notePathEquals(a: NotePath, b: NotePath): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function isWithinFolder(path: NotePath, folder: NotePath): boolean {
  if (path.length <= folder.length) return false;
  for (let i = 0; i < folder.length; i++) {
    if (path[i] !== folder[i]) return false;
  }
  return true;
}

export function isAtOrWithin(path: NotePath, folder: NotePath): boolean {
  return notePathEquals(path, folder) || isWithinFolder(path, folder);
}

export function parentPath(path: NotePath): NotePath {
  if (path.length === 0) {
    throw new RangeError("The root path has no parent");
  }
  return path.slice(0, -1);
}
