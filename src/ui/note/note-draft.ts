import type { NotePath } from "../../changes/change";
import { autoName } from "./auto-name";
import { decideNameCommit } from "./name-field-commit";

export interface NoteDraft {
  readonly parent: NotePath;
  readonly name: string;
}

export type NoteDraftEvent =
  | { readonly kind: "nameConfirmed" }
  | {
      readonly kind: "contentChanged";
      readonly content: string;
      readonly now: Date;
    }
  | { readonly kind: "left" };

export type NoteDraftAction =
  | { readonly kind: "none" }
  | { readonly kind: "showError"; readonly message: string }
  | {
      readonly kind: "create";
      readonly parent: NotePath;
      readonly name: string;
    }
  | {
      readonly kind: "createWithContent";
      readonly parent: NotePath;
      readonly name: string;
      readonly content: string;
      readonly fieldError: string | null;
    }
  | { readonly kind: "discard" };

export function resolveNoteDraft(
  draft: NoteDraft,
  event: NoteDraftEvent,
  siblingNames: readonly string[],
): NoteDraftAction {
  if (event.kind === "left") {
    return { kind: "discard" };
  }

  const decision = decideNameCommit({
    currentName: null,
    edited: draft.name,
    siblingNames,
    conflicted: false,
  });

  if (event.kind === "nameConfirmed") {
    switch (decision.kind) {
      case "commit":
        return { kind: "create", parent: draft.parent, name: decision.name };
      case "error":
        return { kind: "showError", message: decision.message };
      default:
        return { kind: "none" };
    }
  }

  const withContent = (name: string, fieldError: string | null) =>
    ({
      kind: "createWithContent",
      parent: draft.parent,
      name,
      content: event.content,
      fieldError,
    }) satisfies NoteDraftAction;

  switch (decision.kind) {
    case "commit":
      return withContent(decision.name, null);
    case "error":
      return withContent(autoName(event.now, siblingNames), decision.message);
    default:
      return withContent(autoName(event.now, siblingNames), null);
  }
}
