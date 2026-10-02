import type { VersionContent } from "./note-history";

export type RestoreBlock =
  | "gone"
  | "conflicted"
  | "unavailable"
  | "loading"
  | "unreadable"
  | "undecryptable"
  | "same";

export interface RestoreInput {
  /** The note as it is now, unsaved edits included; null when it no longer exists. */
  readonly current: { readonly content: string; readonly name: string } | null;
  /** Null while the version is being read. */
  readonly version: VersionContent | null;
  readonly restoreTitle: boolean;
  readonly conflicted: boolean;
  /** False when syncing stopped or is suspended. */
  readonly canSave: boolean;
}

/** Each step is null when it would change nothing. */
export type RestorePlan =
  | {
      readonly kind: "ready";
      readonly content: string | null;
      readonly name: string | null;
    }
  | { readonly kind: "blocked"; readonly reason: RestoreBlock };

export function titleDiffers(
  version: VersionContent | null,
  currentName: string,
): boolean {
  return (
    version !== null &&
    version.kind !== "failed" &&
    version.name !== null &&
    version.name !== currentName
  );
}

export function planRestore(input: RestoreInput): RestorePlan {
  const { current, version } = input;
  if (current === null) return blocked("gone");
  if (input.conflicted) return blocked("conflicted");
  if (!input.canSave) return blocked("unavailable");
  if (version === null) return blocked("loading");
  if (version.kind === "failed") return blocked("unreadable");
  if (version.kind === "undecryptable") return blocked("undecryptable");

  const content = version.content === current.content ? null : version.content;
  const name =
    input.restoreTitle && titleDiffers(version, current.name)
      ? version.name
      : null;
  if (content === null && name === null) return blocked("same");
  return { kind: "ready", content, name };
}

function blocked(reason: RestoreBlock): RestorePlan {
  return { kind: "blocked", reason };
}
