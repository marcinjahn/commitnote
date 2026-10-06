<script lang="ts">
  import { livePreview } from "../../editor/live-preview";
  import { linkOpen } from "../../editor/link-open";
  import type { HeldConflict, OpenNoteState, SyncEngine } from "../../sync/sync-engine";
  import MarkdownEditor from "../editor/MarkdownEditor.svelte";
  import { describeSyncError } from "../browse/sync-messages";
  import ConflictView from "./ConflictView.svelte";
  import NoteDetails from "./NoteDetails.svelte";
  import type { NoteDates } from "../../history/note-dates";

  import type { NoteFont } from "../../settings/note-font";

  interface Props {
    engine: SyncEngine;
    forgeName: string;
    openNote: OpenNoteState | null;
    conflict: HeldConflict | undefined;
    draft: boolean;
    noteDates: NoteDates | null;
    treeLoaded: boolean;
    hasNotes: boolean;
    onDraftContent: (content: string) => void;
    onNewNote: () => void;
    noteFont: NoteFont;
    shared?: boolean;
    onShared?: () => void;
  }

  const { engine, forgeName, openNote, conflict, draft, noteDates, treeLoaded, hasNotes, onDraftContent, onNewNote, noteFont, shared = false, onShared }: Props = $props();

  const editorExtensions = [livePreview(), linkOpen()];

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
    {#key draft ? "" : openNote?.path.join("/")}
      <NoteDetails
        text={editorText}
        dates={draft ? null : noteDates}
        notSaved={draft || (openNote?.kind === "loaded" && openNote.blobSha === null)}
        {shared}
        {onShared}
      />
    {/key}
    <MarkdownEditor
      bind:this={editor}
      text={editorText}
      readOnly={false}
      extensions={editorExtensions}
      {noteFont}
      onChange={handleEditorChange}
    />
  {:else if openNote === null}
    {#if treeLoaded}
    <p class="note-placeholder">
      <span>
        {hasNotes ? "Select a note to read it, or" : ""}
        <button type="button" class="link-button" onclick={onNewNote}>
          <span aria-hidden="true">+</span> {hasNotes ? "create a new note" : "Create a new note"}</button
        >.
      </span>
    </p>
    {/if}
  {:else if openNote.kind === "loading"}
    <p class="note-status">Loading…</p>
  {:else if openNote.kind === "loaded" && conflict !== undefined}
    <ConflictView {engine} {conflict} {noteFont} />
  {:else if openNote.kind === "missing"}
    <p class="note-status">This note no longer exists.</p>
  {:else if openNote.kind === "failed"}
    <p role="alert" class="alert-error">
      {describeSyncError(openNote.error, forgeName)}
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
