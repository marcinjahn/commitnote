import type { NotePath } from "../changes/change";
import type { SyncEngine } from "../sync/sync-engine";
import { findWorkingNode, type WorkingTree } from "../sync/working-tree";
import { resolveNoteDraft, type NoteDraft } from "../ui/note/note-draft";
import { describeStructureError } from "../ui/browse/structure-messages";

export type NoteDraftOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "created";
      readonly path: NotePath;
      readonly fieldError: string | null;
    };

export function draftSiblingNames(
  tree: WorkingTree | null,
  parent: NotePath,
): string[] {
  if (tree === null) return [];
  const folder = findWorkingNode(tree, parent);
  if (folder === undefined || folder.kind !== "folder") return [];
  return folder.children.map((child) => child.name);
}

export function commitNoteDraftName(
  engine: Pick<SyncEngine, "createNote">,
  draft: NoteDraft,
  siblingNames: readonly string[],
): NoteDraftOutcome {
  const action = resolveNoteDraft(draft, { kind: "nameConfirmed" }, siblingNames);
  switch (action.kind) {
    case "showError":
      return { kind: "error", message: action.message };
    case "create": {
      const result = engine.createNote(action.parent, action.name);
      if (!result.ok) {
        return { kind: "error", message: describeStructureError(result.error) };
      }
      return { kind: "created", path: result.path, fieldError: null };
    }
    default:
      return { kind: "none" };
  }
}

export function commitNoteDraftContent(
  engine: Pick<SyncEngine, "createNote" | "editNote">,
  draft: NoteDraft,
  content: string,
  now: Date,
  siblingNames: readonly string[],
): NoteDraftOutcome {
  const action = resolveNoteDraft(
    draft,
    { kind: "contentChanged", content, now },
    siblingNames,
  );
  if (action.kind !== "createWithContent") return { kind: "none" };
  const result = engine.createNote(action.parent, action.name);
  if (!result.ok) {
    return { kind: "error", message: describeStructureError(result.error) };
  }
  engine.editNote(result.path, action.content);
  return { kind: "created", path: result.path, fieldError: action.fieldError };
}
