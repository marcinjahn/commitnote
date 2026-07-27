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
    };

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

export function parentPath(path: NotePath): NotePath {
  if (path.length === 0) {
    throw new RangeError("The root path has no parent");
  }
  return path.slice(0, -1);
}
