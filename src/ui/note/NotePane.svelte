<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte";
  import { systemClock } from "../../sync/clock";
  import { livePreview } from "../../editor/live-preview";
  import { linkOpen } from "../../editor/link-open";
  import type { HeldConflict, OpenNoteState, SyncEngine } from "../../sync/sync-engine";
  import MarkdownEditor from "../editor/MarkdownEditor.svelte";
  import { describeSyncError } from "../browse/sync-messages";
  import ConflictView from "./ConflictView.svelte";
  import NoteDetails from "./NoteDetails.svelte";
  import type { NoteDates } from "../../history/note-dates";
  import { createNoteSwitchMotion } from "./note-switch-motion";
  import { playLeaveFade, playSwitchEnter } from "./switch-motion-driver";

  import type { NoteFont } from "../../settings/note-font";

  interface Props {
    engine: SyncEngine;
    forgeName: string;
    openNote: OpenNoteState | null;
    noteSwitch: number;
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

  const { engine, forgeName, openNote, noteSwitch, conflict, draft, noteDates, treeLoaded, hasNotes, onDraftContent, onNewNote, noteFont, shared = false, onShared }: Props = $props();

  const editorExtensions = [livePreview(), linkOpen()];

  interface Presented {
    openNote: OpenNoteState | null;
    conflict: HeldConflict | undefined;
    draft: boolean;
    noteDates: NoteDates | null;
    treeLoaded: boolean;
    hasNotes: boolean;
    shared: boolean;
    onShared: (() => void) | undefined;
  }

  const live = $derived<Presented>({ openNote, conflict, draft, noteDates, treeLoaded, hasNotes, shared, onShared });

  let lastPresented: Presented = untrack(() => live);
  let heldContent = $state<Presented | null>(null);
  let loadingRevealed = $state(false);
  const shown = $derived(heldContent ?? live);

  const editorText = $derived<string | null>(
    shown.draft
      ? ""
      : shown.openNote?.kind === "loaded" && shown.conflict === undefined
        ? shown.openNote.content
        : null,
  );

  let editor: ReturnType<typeof MarkdownEditor> | undefined = $state();

  let contentEl: HTMLDivElement | undefined = $state();
  let seenSwitch = untrack(() => noteSwitch);
  let scrollPending = false;

  function motionTargets(): Element[] {
    if (contentEl === undefined) return [];
    return [...contentEl.children].filter((child) => !child.classList.contains("note-loading"));
  }

  const motion = createNoteSwitchMotion({
    clock: systemClock,
    onView: (view) => {
      heldContent = view.held ? lastPresented : null;
      loadingRevealed = view.loadingRevealed;
    },
    onLeave: () => playLeaveFade(motionTargets()),
    onEnter: () => {
      void tick().then(() => playSwitchEnter(motionTargets(), { translate: true }));
    },
  });

  onDestroy(() => motion.dispose());

  $effect.pre(() => {
    const current = live;
    motion.update({
      noteSwitch,
      target: current.openNote?.kind === "loading" ? "loading" : "presentable",
    });
    untrack(() => {
      if (heldContent === null) lastPresented = current;
    });
  });

  $effect(() => {
    const held = heldContent !== null;
    for (const child of motionTargets()) {
      if (child instanceof HTMLElement) child.inert = held;
    }
  });

  $effect(() => {
    if (noteSwitch !== seenSwitch) {
      seenSwitch = noteSwitch;
      scrollPending = true;
    }
    if (!scrollPending || contentEl === undefined) return;
    if (openNote?.kind !== "loading") {
      contentEl.scrollTop = 0;
      scrollPending = false;
    } else if (loadingRevealed) {
      contentEl.scrollTop = 0;
    }
  });

  export function focusEditor(): void {
    editor?.focus();
  }

  function handleEditorChange(text: string): void {
    if (heldContent !== null) return;
    if (draft) {
      onDraftContent(text);
    } else if (openNote?.kind === "loaded") {
      engine.editNote(openNote.path, text);
    }
  }
</script>

<div class="note-content" class:held={heldContent !== null} bind:this={contentEl}>
  {#if editorText !== null}
    {#key shown.draft ? "" : shown.openNote?.path.join("/")}
      <NoteDetails
        text={editorText}
        dates={shown.draft ? null : shown.noteDates}
        notSaved={shown.draft || (shown.openNote?.kind === "loaded" && shown.openNote.blobSha === null)}
        shared={shown.shared}
        onShared={shown.onShared}
      />
    {/key}
    <MarkdownEditor
      bind:this={editor}
      text={editorText}
      readOnly={heldContent !== null}
      extensions={editorExtensions}
      {noteFont}
      onChange={handleEditorChange}
    />
  {:else if shown.openNote === null}
    {#if shown.treeLoaded}
    <p class="note-placeholder">
      <span>
        {shown.hasNotes ? "Select a note to read it, or" : ""}
        <button type="button" class="link-button" onclick={onNewNote}>
          <span aria-hidden="true">+</span> {shown.hasNotes ? "create a new note" : "Create a new note"}</button
        >.
      </span>
    </p>
    {/if}
  {:else if shown.openNote.kind === "loaded" && shown.conflict !== undefined}
    <ConflictView {engine} conflict={shown.conflict} {noteFont} />
  {:else if shown.openNote.kind === "missing"}
    <p class="note-status">This note no longer exists.</p>
  {:else if shown.openNote.kind === "failed"}
    <p role="alert" class="alert-error">
      {describeSyncError(shown.openNote.error, forgeName)}
    </p>
  {/if}
  {#if loadingRevealed}
    <p class="note-status note-loading">Loading…</p>
  {/if}
</div>

<style>
  .note-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .held > :global(:not(.note-loading)) {
    opacity: 0;
  }

  .note-loading {
    position: absolute;
    inset: 0 0 auto;
    margin: 0 auto;
    pointer-events: none;
    animation: note-loading-in var(--motion-duration) var(--motion-easing);
  }

  @keyframes note-loading-in {
    from {
      opacity: 0;
    }
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
