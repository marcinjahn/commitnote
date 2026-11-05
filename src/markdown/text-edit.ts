export interface TextChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface TextSelection {
  readonly anchor: number;
  readonly head: number;
}

export interface TextEdit {
  readonly changes: readonly TextChange[];
  readonly selection: TextSelection;
}

export function applyTextEdit(text: string, edit: TextEdit): string {
  let result = "";
  let position = 0;
  for (const change of edit.changes) {
    result += text.slice(position, change.from) + change.insert;
    position = change.to;
  }
  return result + text.slice(position);
}
