<script lang="ts">
  import { untrack } from "svelte";
  import { notePathEquals } from "../../changes/change";
  import { livePreview } from "../../editor/live-preview";
  import type { OpenNoteState, SyncEngine, SyncEngineState } from "../../sync/sync-engine";
  import MarkdownEditor from "../editor/MarkdownEditor.svelte";
  import ReadingView from "../browse/ReadingView.svelte";
  import { describeSyncError } from "../browse/sync-messages";

  interface Props {
    engine: SyncEngine;
    openNote: OpenNoteState | null;
    viewMode: "editor" | "reading";
  }

  const { engine, openNote, viewMode }: Props = $props();

  const editorExtensions = [livePreview()];

  let engineState = $state<SyncEngineState>(untrack(() => engine.getState()));

  $effect(() => {
    return engine.subscribe((next) => {
      engineState = next;
    });
  });

  const conflicted = $derived(
    openNote?.kind === "loaded" &&
      engineState.conflicts.some((conflict) => notePathEquals(conflict.path, openNote.path)),
  );
</script>

<div class="note-content">
  {#if openNote === null}
    <p class="note-placeholder">Select a note to read it.</p>
  {:else if openNote.kind === "loading"}
    <p class="note-status">Loading…</p>
  {:else if openNote.kind === "loaded"}
    {#if conflicted || viewMode === "reading"}
      <ReadingView content={openNote.content} />
    {:else}
      <MarkdownEditor
        text={openNote.content}
        readOnly={false}
        extensions={editorExtensions}
        onChange={(text) => engine.editNote(openNote.path, text)}
      />
    {/if}
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
    padding: var(--space-4);
    text-align: center;
  }

  .note-status {
    padding: var(--space-3);
    color: var(--color-text-muted);
  }

  .alert-error {
    margin: var(--space-2) var(--space-3) 0;
  }
</style>
