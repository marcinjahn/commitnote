<script lang="ts">
  import { onMount } from "svelte";
  import type { Extension } from "@codemirror/state";
  import {
    createMarkdownEditor,
    type MarkdownEditor,
  } from "../../editor/create-markdown-editor";

  interface Props {
    text: string;
    readOnly: boolean;
    onChange: (text: string) => void;
    extensions?: Extension[];
    ariaLabel?: string;
  }

  const { text, readOnly, onChange, extensions, ariaLabel }: Props = $props();

  let container: HTMLDivElement;
  let editor: MarkdownEditor | undefined;

  onMount(() => {
    editor = createMarkdownEditor({
      parent: container,
      text,
      readOnly,
      onChange,
      extensions,
      ariaLabel,
    });

    return () => {
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
</script>

<div class="markdown-editor" bind:this={container}></div>

<style>
  .markdown-editor {
    width: 100%;
    max-width: var(--content-max-width);
    margin: 0 auto;
  }

  .markdown-editor :global(.cm-editor) {
    font-family: var(--font-sans);
    font-size: var(--font-size-base);
    line-height: var(--line-height);
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
  }

  .markdown-editor :global(.cm-content) {
    padding: var(--space-4) var(--space-3);
  }

  .markdown-editor :global(.cm-editor.cm-focused) {
    outline: 2px solid var(--color-focus);
    outline-offset: -1px;
  }
</style>
