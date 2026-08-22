import { validateName } from "../../tree/note-names";
import { describeNameError } from "../dialogs/name-messages";

export type NameCommitDecision =
  | { readonly kind: "noop" }
  | { readonly kind: "restore" }
  | { readonly kind: "commit"; readonly name: string }
  | { readonly kind: "error"; readonly message: string };

export interface NameCommitInput {
  readonly currentName: string | null;
  readonly edited: string;
  readonly siblingNames: readonly string[];
  readonly conflicted: boolean;
}

export function decideNameCommit(input: NameCommitInput): NameCommitDecision {
  if (input.conflicted) {
    return { kind: "noop" };
  }
  if (input.edited.trim() === "") {
    return input.currentName !== null ? { kind: "restore" } : { kind: "noop" };
  }
  const validation = validateName(input.edited, input.siblingNames);
  if (!validation.ok) {
    return { kind: "error", message: describeNameError(validation.error) };
  }
  if (validation.name === input.currentName) {
    return { kind: "noop" };
  }
  return { kind: "commit", name: validation.name };
}
