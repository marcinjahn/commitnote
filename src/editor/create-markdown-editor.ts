import {
  Compartment,
  EditorState,
  Transaction,
  type Extension,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { formatKeymap } from "./format-keymap";
import { pasteLink } from "./paste-link";
import { minimalChanges } from "./minimal-changes";

const DEFAULT_ARIA_LABEL = "Note editor";

// Marks a setText replacement so the update listener can tell it apart from
// a user edit and skip firing onChange for it.
const SET_TEXT_USER_EVENT = "set";

export interface MarkdownEditorOptions {
  readonly parent: HTMLElement;
  readonly text: string;
  readonly readOnly: boolean;
  readonly onChange: (text: string) => void;
  readonly extensions?: readonly Extension[];
  readonly ariaLabel?: string;
  readonly describedBy?: string;
}

export interface MarkdownEditor {
  readonly view: EditorView;
  setText(text: string): void;
  updateText(text: string): void;
  setReadOnly(readOnly: boolean): void;
  getSelection(): { anchor: number; head: number };
  setSelection(anchor: number, head: number): void;
  focus(): void;
  destroy(): void;
}

function baseExtensions(): Extension[] {
  return [
    markdown({ base: markdownLanguage, pasteURLAsLink: false }),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.lineWrapping,
    pasteLink(),
    formatKeymap(),
  ];
}

export function markdownEditorExtensions(): Extension[] {
  return [...baseExtensions(), history()];
}

function readOnlyExtensions(
  readOnly: boolean,
  describedBy: string | undefined,
): Extension[] {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    !readOnly && describedBy
      ? EditorView.contentAttributes.of({ "aria-describedby": describedBy })
      : [],
  ];
}

export function createMarkdownEditor(
  options: MarkdownEditorOptions,
): MarkdownEditor {
  const {
    parent,
    text,
    readOnly,
    onChange,
    extensions = [],
    ariaLabel = DEFAULT_ARIA_LABEL,
    describedBy,
  } = options;

  const readOnlyCompartment = new Compartment();
  const historyCompartment = new Compartment();

  const updateListener = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    const isSetText = update.transactions.some(
      (tr) => tr.annotation(Transaction.userEvent) === SET_TEXT_USER_EVENT,
    );
    if (isSetText) return;
    onChange(update.state.doc.toString());
  });

  const state = EditorState.create({
    doc: text,
    extensions: [
      baseExtensions(),
      historyCompartment.of(history()),
      readOnlyCompartment.of(readOnlyExtensions(readOnly, describedBy)),
      EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
      updateListener,
      ...extensions,
    ],
  });

  const view = new EditorView({ state, parent });

  return {
    view,
    setText(newText: string): void {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: newText },
        annotations: Transaction.userEvent.of(SET_TEXT_USER_EVENT),
      });
      view.dispatch({ effects: historyCompartment.reconfigure([]) });
      view.dispatch({ effects: historyCompartment.reconfigure(history()) });
    },
    updateText(newText: string): void {
      const changes = minimalChanges(view.state.doc.toString(), newText);
      if (changes.length === 0) return;
      view.dispatch({
        changes,
        annotations: [
          Transaction.userEvent.of(SET_TEXT_USER_EVENT),
          Transaction.addToHistory.of(false),
        ],
        effects: view.scrollSnapshot(),
      });
    },
    setReadOnly(nextReadOnly: boolean): void {
      view.dispatch({
        effects: readOnlyCompartment.reconfigure(
          readOnlyExtensions(nextReadOnly, describedBy),
        ),
      });
    },
    getSelection(): { anchor: number; head: number } {
      const { anchor, head } = view.state.selection.main;
      return { anchor, head };
    },
    setSelection(anchor: number, head: number): void {
      const length = view.state.doc.length;
      const clamp = (value: number) => Math.min(Math.max(value, 0), length);
      view.dispatch({
        selection: { anchor: clamp(anchor), head: clamp(head) },
      });
    },
    focus(): void {
      view.focus();
    },
    destroy(): void {
      view.destroy();
    },
  };
}
