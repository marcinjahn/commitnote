<script lang="ts">
  import { untrack } from "svelte";
  import { notePathEquals } from "../../changes/change";
  import { livePreview } from "../../editor/live-preview";
  import type {
    HeldConflict,
    OpenNoteState,
    SyncEngine,
    SyncEngineState,
  } from "../../sync/sync-engine";
  import MarkdownEditor from "../editor/MarkdownEditor.svelte";
  import { describeSyncError } from "../browse/sync-messages";
  import ConflictView from "./ConflictView.svelte";

  interface Props {
    engine: SyncEngine;
    openNote: OpenNoteState | null;
    draft: boolean;
    onDraftContent: (content: string) => void;
  }

  const { engine, openNote, draft, onDraftContent }: Props = $props();

  const editorExtensions = [livePreview()];

  let engineState = $state<SyncEngineState>(untrack(() => engine.getState()));

  $effect(() => {
    return engine.subscribe((next) => {
      engineState = next;
    });
  });

  const conflict = $derived<HeldConflict | undefined>(
    openNote?.kind === "loaded"
      ? engineState.conflicts.find((held) => notePathEquals(held.path, openNote.path))
      : undefined,
  );

  const editorText = $derived<string | null>(
    draft ? "" : openNote?.kind === "loaded" && conflict === undefined ? openNote.content : null,
  );

  let editor: ReturnType<typeof MarkdownEditor> | undefined = $state();

  export function focusEditor(): void {
    editor?.focus();
  }

  function handleEditorChange(text: string): void {
    if (draft) {
      onDraftContent(text);
    } else if (openNote?.kind === "loaded") {
      engine.editNote(openNote.path, text);
    }
  }
</script>

<div class="note-content">
  {#if editorText !== null}
    <MarkdownEditor
      bind:this={editor}
      text={editorText}
      readOnly={false}
      extensions={editorExtensions}
      onChange={handleEditorChange}
    />
  {:else if openNote === null}
    <p class="note-placeholder">Select a note to read it.</p>
  {:else if openNote.kind === "loading"}
    <p class="note-status">Loading…</p>
  {:else if openNote.kind === "loaded" && conflict !== undefined}
    <ConflictView {engine} {conflict} />
  {:else if openNote.kind === "missing"}
    <p class="note-status">This note no longer exists.</p>
  {:else if openNote.kind === "failed"}
    <p role="alert" class="alert-error">
      {describeSyncError(openNote.error)}
    </p>
  {/if}
</div>

<style>
  .note-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .note-placeholder {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    padding: var(--space-6) var(--space-4);
    text-align: center;
  }

  .note-status {
    box-sizing: border-box;
    width: 100%;
    max-width: var(--content-max-width);
    margin-inline: auto;
    padding: var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .alert-error {
    margin: var(--space-2) var(--space-3) 0;
  }
</style>
