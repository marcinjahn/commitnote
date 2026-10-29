import {
  EditorSelection,
  Prec,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { keymap, type EditorView } from "@codemirror/view";
import {
  TABLE_COMMANDS,
  applyTableCommand,
  tableCommandAvailability,
  type ColumnAlignment,
  type TableCommand,
} from "../markdown/table-commands";
import { editingModeOf } from "./vim/vim-status";

export function runTableCommand(
  view: EditorView,
  command: TableCommand,
  argument?: ColumnAlignment,
): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  const { anchor, head } = state.selection.main;
  const edit = applyTableCommand(
    state.doc.toString(),
    { anchor, head },
    command,
    argument,
  );
  if (!edit) return false;
  const selection = EditorSelection.single(
    edit.selection.anchor,
    edit.selection.head,
  );
  if (edit.changes.length === 0) {
    if (!selection.eq(state.selection)) {
      view.dispatch({ selection, userEvent: "select" });
    }
    return true;
  }
  view.dispatch({
    changes: edit.changes,
    selection,
    userEvent: "input",
    annotations: isolateHistory.of("full"),
    scrollIntoView: true,
  });
  return true;
}

export function tableCommandAvailabilityOf(
  state: EditorState,
): Readonly<Record<TableCommand, boolean>> {
  if (state.readOnly) {
    return Object.fromEntries(
      TABLE_COMMANDS.map((command) => [command, false]),
    ) as Record<TableCommand, boolean>;
  }
  const { anchor, head } = state.selection.main;
  return tableCommandAvailability(state.doc.toString(), { anchor, head });
}

function navigate(command: "next-cell" | "previous-cell") {
  return (view: EditorView): boolean => {
    const { state } = view;
    const mode = editingModeOf(state);
    if (mode !== null && mode !== "insert") return false;
    if (!tableCommandAvailabilityOf(state)["next-cell"]) return false;
    return runTableCommand(view, command);
  };
}

export function tableCellNavigation(): Extension {
  return Prec.highest(
    keymap.of([
      { key: "Tab", run: navigate("next-cell") },
      { key: "Shift-Tab", run: navigate("previous-cell") },
    ]),
  );
}
