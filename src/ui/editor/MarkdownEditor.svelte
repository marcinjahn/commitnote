<script lang="ts">
  import { onMount } from "svelte";
  import type { Compartment, Extension } from "@codemirror/state";
  import {
    createMarkdownEditor,
    type MarkdownEditor,
  } from "../../editor/create-markdown-editor";

  import type { NoteFont } from "../../settings/note-font";

  interface Props {
    text: string;
    readOnly: boolean;
    onChange: (text: string) => void;
    extensions?: Extension[];
    ariaLabel?: string;
    noteFont: NoteFont;
  }

  const { text, readOnly, onChange, extensions, ariaLabel, noteFont }: Props = $props();

  const hintId = $props.id();

  let container: HTMLDivElement;
  let editor: MarkdownEditor | undefined;

  export function focus(): void {
    editor?.focus();
  }

  export function getSelection(): { anchor: number; head: number } | undefined {
    return editor?.getSelection();
  }

  export function setSelection(anchor: number, head: number): void {
    editor?.setSelection(anchor, head);
  }

  export function reconfigure(compartment: Compartment, extension: Extension): void {
    editor?.view.dispatch({ effects: compartment.reconfigure(extension) });
  }

  export function insertText(inserted: string): void {
    if (editor === undefined) return;
    const view = editor.view;
    view.dispatch(view.state.replaceSelection(inserted), {
      userEvent: "input.type",
      scrollIntoView: true,
    });
    view.focus();
  }

  onMount(() => {
    editor = createMarkdownEditor({
      parent: container,
      text,
      readOnly,
      onChange,
      extensions,
      ariaLabel,
      describedBy: hintId,
    });

    const remeasure = () => editor?.view.requestMeasure();
    document.fonts.addEventListener("loadingdone", remeasure);

    return () => {
      document.fonts.removeEventListener("loadingdone", remeasure);
      editor?.destroy();
      editor = undefined;
    };
  });

  $effect(() => {
    if (editor !== undefined && text !== editor.view.state.doc.toString()) {
      editor.setText(text);
    }
  });

  $effect(() => {
    editor?.setReadOnly(readOnly);
  });

  $effect(() => {
    void noteFont;
    editor?.view.requestMeasure();
  });
</script>

<div class="markdown-editor" bind:this={container}></div>
<p id={hintId} hidden>Press Escape, then Tab, to leave the editor.</p>

<style>
  .markdown-editor {
    width: 100%;
    max-width: var(--content-max-width);
    margin: 0 auto;
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
  }

  .markdown-editor :global(.cm-editor) {
    font-family: var(--font-note);
    font-size: var(--font-size-base);
    line-height: var(--line-height);
    color: var(--color-text);
    background: transparent;
    border: none;
    border-radius: 0;
    flex: 1 0 auto;
  }

  .markdown-editor :global(.cm-content) {
    padding: var(--space-5) var(--space-4);
    caret-color: var(--color-accent);
  }

  .markdown-editor :global(.cm-scroller) {
    font-family: var(--font-note);
    scroll-padding-bottom: var(--toast-stack-height, 0px);
  }

  .markdown-editor :global(.cm-editor.cm-focused) {
    outline: none;
  }

  @media (forced-colors: active) {
    .markdown-editor :global(.cm-editor.cm-focused) {
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }
  }
</style>
