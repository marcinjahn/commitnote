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
import { pasteLink } from "./paste-link";

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
}

export interface MarkdownEditor {
  readonly view: EditorView;
  setText(text: string): void;
  setReadOnly(readOnly: boolean): void;
  focus(): void;
  destroy(): void;
}

function baseExtensions(): Extension[] {
  return [
    markdown({ base: markdownLanguage, pasteURLAsLink: false }),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.lineWrapping,
    pasteLink(),
  ];
}

export function markdownEditorExtensions(): Extension[] {
  return [...baseExtensions(), history()];
}

function readOnlyExtensions(readOnly: boolean): Extension[] {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
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
      readOnlyCompartment.of(readOnlyExtensions(readOnly)),
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
    setReadOnly(nextReadOnly: boolean): void {
      view.dispatch({
        effects: readOnlyCompartment.reconfigure(
          readOnlyExtensions(nextReadOnly),
        ),
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
