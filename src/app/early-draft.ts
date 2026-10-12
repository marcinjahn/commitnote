export interface EarlyDraftSelection {
  readonly anchor: number;
  readonly head: number;
}

export type EarlyDraftField = "name" | "body";

export interface EarlyDraft {
  readonly name: string;
  readonly body: string;
  readonly focus: EarlyDraftField;
  readonly selection: EarlyDraftSelection;
  readonly nameConfirmed: boolean;
  readonly contentStartedAt: number | null;
}

export type EarlyDraftHandoff =
  | { readonly kind: "untouched" }
  | {
      readonly kind: "content";
      readonly name: string;
      readonly body: string;
      readonly contentStartedAt: number | null;
    }
  | { readonly kind: "confirmName"; readonly name: string }
  | { readonly kind: "name"; readonly name: string };

export function emptyEarlyDraft(focus: EarlyDraftField = "name"): EarlyDraft {
  return {
    name: "",
    body: "",
    focus,
    selection: { anchor: 0, head: 0 },
    nameConfirmed: false,
    contentStartedAt: null,
  };
}

export function isUntouched(draft: EarlyDraft): boolean {
  return draft.name === "" && draft.body === "";
}

export function withEarlyDraftName(
  draft: EarlyDraft,
  name: string,
  selection: EarlyDraftSelection,
): EarlyDraft {
  return {
    ...draft,
    name,
    focus: "name",
    selection,
    nameConfirmed: name === draft.name ? draft.nameConfirmed : false,
  };
}

export function confirmEarlyDraftName(draft: EarlyDraft): EarlyDraft {
  const end = draft.body.length;
  return {
    ...draft,
    nameConfirmed: true,
    focus: "body",
    selection: { anchor: end, head: end },
  };
}

export function withEarlyDraftBody(
  draft: EarlyDraft,
  body: string,
  selection: EarlyDraftSelection,
  now: number,
): EarlyDraft {
  let contentStartedAt: number | null;
  if (body === "") contentStartedAt = null;
  else if (draft.body === "") contentStartedAt = now;
  else contentStartedAt = draft.contentStartedAt;
  return { ...draft, body, focus: "body", selection, contentStartedAt };
}

export function planEarlyDraftHandoff(draft: EarlyDraft): EarlyDraftHandoff {
  if (isUntouched(draft)) return { kind: "untouched" };
  if (draft.body !== "") {
    return {
      kind: "content",
      name: draft.name,
      body: draft.body,
      contentStartedAt: draft.contentStartedAt,
    };
  }
  if (draft.nameConfirmed && draft.name !== "") {
    return { kind: "confirmName", name: draft.name };
  }
  return { kind: "name", name: draft.name };
}

function isOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function parseEarlyDraft(value: unknown): EarlyDraft | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const sel = v.selection;
  if (typeof sel !== "object" || sel === null) return null;
  const { anchor, head } = sel as Record<string, unknown>;
  if (typeof v.name !== "string" || typeof v.body !== "string") return null;
  if (v.focus !== "name" && v.focus !== "body") return null;
  if (!isOffset(anchor) || !isOffset(head)) return null;
  if (typeof v.nameConfirmed !== "boolean") return null;
  const started = v.contentStartedAt;
  if (started !== null && !(typeof started === "number" && Number.isFinite(started))) {
    return null;
  }
  return {
    name: v.name,
    body: v.body,
    focus: v.focus,
    selection: { anchor, head },
    nameConfirmed: v.nameConfirmed,
    contentStartedAt: started,
  };
}
