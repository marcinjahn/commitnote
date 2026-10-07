import {
  EditorSelection,
  Prec,
  type EditorState,
  type Extension,
  type SelectionRange,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap, type Command } from "@codemirror/view";
import {
  CODE_NODES,
  LINK_NODES,
  escapeLinkLabel,
  overlapsBlockedNode,
} from "./paste-link";

interface RangeEdit {
  readonly changes: { from: number; to?: number; insert?: string }[];
  readonly range: SelectionRange;
}

function isWritable(state: EditorState): boolean {
  return state.facet(EditorView.editable) && !state.readOnly;
}

function spansLines(state: EditorState, from: number, to: number): boolean {
  return state.doc.lineAt(from).number !== state.doc.lineAt(to).number;
}

function directed(range: SelectionRange, a: number, b: number): SelectionRange {
  return range.anchor <= range.head
    ? EditorSelection.range(a, b)
    : EditorSelection.range(b, a);
}

function runLength(text: string, index: number, step: 1 | -1): number {
  let count = 0;
  for (
    let i = index;
    i >= 0 && i < text.length && text[i] === "*";
    i += step
  ) {
    count++;
  }
  return count;
}

function isPresent(
  text: string,
  marker: string,
  startsAt: number,
  endsAt: number,
): boolean {
  if (marker === "*") {
    return (
      runLength(text, startsAt, 1) % 2 === 1 &&
      runLength(text, endsAt - 1, -1) % 2 === 1
    );
  }
  return (
    text.startsWith(marker, startsAt) && text.startsWith(marker, endsAt - marker.length)
  );
}

function toggleRange(
  state: EditorState,
  range: SelectionRange,
  marker: string,
): RangeEdit | null {
  const { from, to } = range;
  const m = marker.length;
  if (from === to) {
    if (overlapsBlockedNode(state, from, to, CODE_NODES)) return null;
    return {
      changes: [{ from, insert: marker + marker }],
      range: EditorSelection.cursor(from + m),
    };
  }
  if (spansLines(state, from, to)) return null;
  if (overlapsBlockedNode(state, from, to, CODE_NODES)) return null;

  const text = state.sliceDoc(from, to);
  if (text.length > 2 * m && isPresent(text, marker, 0, text.length)) {
    return {
      changes: [
        { from, to: from + m },
        { from: to - m, to },
      ],
      range: directed(range, from, to - 2 * m),
    };
  }

  const line = state.doc.lineAt(from);
  const lineText = line.text;
  const lineFrom = from - line.from;
  const lineTo = to - line.from;
  const outside =
    lineFrom >= m &&
    lineTo + m <= lineText.length &&
    (marker === "*"
      ? runLength(lineText, lineFrom - 1, -1) % 2 === 1 &&
        runLength(lineText, lineTo, 1) % 2 === 1
      : lineText.startsWith(marker, lineFrom - m) &&
        lineText.startsWith(marker, lineTo));
  if (outside) {
    return {
      changes: [
        { from: from - m, to: from },
        { from: to, to: to + m },
      ],
      range: directed(range, from - m, to - m),
    };
  }

  return {
    changes: [{ from, insert: marker }, { from: to, insert: marker }],
    range: directed(range, from + m, to + m),
  };
}

function linkRange(
  state: EditorState,
  range: SelectionRange,
): RangeEdit | null {
  const { from, to } = range;
  if (
    overlapsBlockedNode(state, from, to, CODE_NODES) ||
    overlapsBlockedNode(state, from, to, LINK_NODES)
  ) {
    return null;
  }
  if (from === to) {
    return {
      changes: [{ from, insert: "[]()" }],
      range: EditorSelection.cursor(from + 1),
    };
  }
  if (spansLines(state, from, to)) return null;
  const label = escapeLinkLabel(state.sliceDoc(from, to));
  return {
    changes: [{ from, to, insert: `[${label}]()` }],
    range: EditorSelection.cursor(from + label.length + 3),
  };
}

function applyPerRange(
  state: EditorState,
  edit: (range: SelectionRange) => RangeEdit | null,
): TransactionSpec | null {
  if (!isWritable(state)) return null;
  let changed = false;
  const result = state.changeByRange((range) => {
    const planned = edit(range);
    if (planned === null) return { range };
    changed = true;
    return { changes: planned.changes, range: planned.range };
  });
  if (!changed) return null;
  return { ...result, userEvent: "input", scrollIntoView: true };
}

export function toggleInlineMarker(
  state: EditorState,
  marker: string,
): TransactionSpec | null {
  return applyPerRange(state, (range) => toggleRange(state, range, marker));
}

export function insertLink(state: EditorState): TransactionSpec | null {
  return applyPerRange(state, (range) => linkRange(state, range));
}

function command(build: (state: EditorState) => TransactionSpec | null): Command {
  return (view) => {
    const spec = build(view.state);
    if (spec !== null) view.dispatch(spec);
    return true;
  };
}

export function formatKeymap(): Extension {
  return Prec.high(
    keymap.of([
      { key: "Mod-b", run: command((s) => toggleInlineMarker(s, "**")) },
      { key: "Mod-i", run: command((s) => toggleInlineMarker(s, "*")) },
      { key: "Mod-Shift-x", run: command((s) => toggleInlineMarker(s, "~~")) },
      { key: "Mod-k", run: command(insertLink) },
    ]),
  );
}
