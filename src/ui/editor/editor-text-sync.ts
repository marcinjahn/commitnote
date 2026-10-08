export type EditorTextSync = "set" | "update" | "accept" | "skip";

export function decideEditorTextSync(input: {
  noteSwitch: number;
  appliedSwitch: number;
  text: string;
  doc: string;
  base: string;
}): EditorTextSync {
  if (input.noteSwitch !== input.appliedSwitch) return "set";
  if (input.text === input.doc) return "accept";
  if (input.doc === input.base) return "update";
  return "skip";
}
