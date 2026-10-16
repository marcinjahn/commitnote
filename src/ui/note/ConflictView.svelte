<script lang="ts">
  import type { HeldConflict, SyncEngine } from "../../sync/sync-engine";
  import { conflictMarkerHighlight } from "../../editor/conflict-highlight";
  import MarkdownEditor from "../editor/MarkdownEditor.svelte";
  import {
    CONFLICT_BANNER_HEADING,
    CONFLICT_BANNER_TEXT,
    CONFLICT_EDIT_HINT,
    CONFLICT_EDIT_MERGED_LABEL,
    CONFLICT_KEEP_MINE_LABEL,
    CONFLICT_KEEP_THEIRS_LABEL,
  } from "./conflict-copy";

  import type { NoteFont } from "../../settings/note-font";

  interface Props {
    engine: SyncEngine;
    conflict: HeldConflict;
    noteFont: NoteFont;
  }

  const { engine, conflict, noteFont }: Props = $props();

  const highlightExtensions = [conflictMarkerHighlight()];

  function keepMine(): void {
    engine.resolveConflict(conflict.path, "keepMine");
  }

  function keepTheirs(): void {
    engine.resolveConflict(conflict.path, "keepTheirs");
  }

  function editMerged(): void {
    engine.resolveConflict(conflict.path, "editMerged");
  }

  function onMergedChange(text: string): void {
    engine.editNote(conflict.path, text);
  }
</script>

<div class="conflict-view">
  <div role="region" aria-label="Conflict" class="conflict-banner">
    <h2>{CONFLICT_BANNER_HEADING}</h2>
    <p>{CONFLICT_BANNER_TEXT}</p>
    <div class="conflict-actions">
      <button type="button" class="button button-ghost" onclick={keepMine}>
        {CONFLICT_KEEP_MINE_LABEL}
      </button>
      <button type="button" class="button button-ghost" onclick={keepTheirs}>
        {CONFLICT_KEEP_THEIRS_LABEL}
      </button>
      <button
        type="button"
        class="button button-primary"
        onclick={editMerged}
      >
        {CONFLICT_EDIT_MERGED_LABEL}
      </button>
    </div>
  </div>
  {#if conflict.editing === null}
    <MarkdownEditor
      text={conflict.merged}
      noteSwitch={0}
      readOnly={true}
      onChange={() => {}}
      extensions={highlightExtensions}
      {noteFont}
      ariaLabel="Merged text"
    />
  {:else}
    <p role="status" class="conflict-hint">{CONFLICT_EDIT_HINT}</p>
    <MarkdownEditor
      text={conflict.editing}
      noteSwitch={0}
      readOnly={false}
      onChange={onMergedChange}
      extensions={highlightExtensions}
      {noteFont}
      ariaLabel="Note editor"
    />
  {/if}
</div>

<style>
  .conflict-view {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .conflict-banner {
    background: var(--color-surface);
    border-bottom: var(--hairline) solid var(--color-border);
    border-left: 2px solid var(--color-danger);
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .conflict-banner h2 {
    margin: 0;
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
  }

  .conflict-banner p {
    margin: 0;
    font-size: var(--font-size-sm);
  }

  .conflict-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .conflict-hint {
    margin: var(--space-3) var(--space-4) 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
</style>
