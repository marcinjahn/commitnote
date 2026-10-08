<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte";
  import { systemClock } from "../../sync/clock";
  import { livePreview } from "../../editor/live-preview";
  import { linkOpen } from "../../editor/link-open";
  import { accentCaret } from "../../editor/accent-caret";
  import { Compartment } from "@codemirror/state";
  import type { HeldConflict, OpenNoteState, SyncEngine } from "../../sync/sync-engine";
  import MarkdownEditor from "../editor/MarkdownEditor.svelte";
  import { describeSyncError } from "../browse/sync-messages";
  import ConflictView from "./ConflictView.svelte";
  import NoteDetails from "./NoteDetails.svelte";
  import type { NoteDates } from "../../history/note-dates";
  import { createNoteSwitchMotion } from "./note-switch-motion";
  import { playLeaveFade, playSwitchEnter } from "./switch-motion-driver";
  import { clampNotePosition, createNotePositions, type NotePosition } from "./note-position";
  import type { NotePath } from "../../changes/change";

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
    animatedCaret?: boolean;
    shared?: boolean;
    onShared?: () => void;
  }

  const { engine, forgeName, openNote, noteSwitch, conflict, draft, noteDates, treeLoaded, hasNotes, onDraftContent, onNewNote, noteFont, animatedCaret = true, shared = false, onShared }: Props = $props();

  const caretCompartment = new Compartment();
  const caretExtension = (on: boolean) => (on ? accentCaret() : []);
  const editorExtensions = $derived([
    livePreview(),
    linkOpen(),
    caretCompartment.of(caretExtension(animatedCaret)),
  ]);
  let appliedCaret = untrack(() => animatedCaret);

  $effect(() => {
    const on = animatedCaret;
    if (on === appliedCaret) return;
    appliedCaret = on;
    untrack(() => editor?.reconfigure(caretCompartment, caretExtension(on)));
  });

  interface Presented {
    noteSwitch: number;
    openNote: OpenNoteState | null;
    conflict: HeldConflict | undefined;
    draft: boolean;
    noteDates: NoteDates | null;
    treeLoaded: boolean;
    hasNotes: boolean;
    shared: boolean;
    onShared: (() => void) | undefined;
  }

  const live = $derived<Presented>({ noteSwitch, openNote, conflict, draft, noteDates, treeLoaded, hasNotes, shared, onShared });

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
  let trackedScrollTop = 0;

  const positions = createNotePositions();
  let savedSwitch = untrack(() => noteSwitch);
  let presentedPath: NotePath | null = null;

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
    if (noteSwitch === savedSwitch) return;
    savedSwitch = noteSwitch;
    untrack(() => {
      const selection = editor?.getSelection();
      if (presentedPath === null || selection === undefined || contentEl === undefined) return;
      positions.save(presentedPath, { ...selection, scrollTop: trackedScrollTop });
    });
  });

  $effect(() => {
    presentedPath = editorText !== null && !shown.draft && shown.openNote?.kind === "loaded" ? shown.openNote.path : null;
  });

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
      trackedScrollTop = 0;
      scrollPending = false;
      const saved = !draft && openNote?.kind === "loaded" ? positions.get(openNote.path) : undefined;
      if (saved !== undefined) restorePosition(saved, noteSwitch);
    } else if (loadingRevealed) {
      contentEl.scrollTop = 0;
      trackedScrollTop = 0;
    }
  });

  // Deferred past the flush so the editor already holds the incoming text;
  // still a microtask, so it lands before the next paint.
  function restorePosition(saved: NotePosition, forSwitch: number): void {
    void tick().then(() => {
      if (forSwitch !== seenSwitch || editor === undefined || contentEl === undefined || editorText === null) return;
      const position = clampNotePosition(saved, editorText.length);
      editor.setSelection(position.anchor, position.head);
      contentEl.scrollTop = position.scrollTop;
      trackedScrollTop = contentEl.scrollTop;
    });
  }

  function handleScroll(): void {
    if (contentEl === undefined || contentEl.clientHeight === 0) return;
    trackedScrollTop = contentEl.scrollTop;
  }

  export function focusEditor(): void {
    editor?.focus();
  }

  export function hasEditor(): boolean {
    return editor !== undefined;
  }

  export function insertEditorText(text: string): void {
    editor?.insertText(text);
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

<div class="note-content" class:held={heldContent !== null} bind:this={contentEl} onscroll={handleScroll}>
  {#if editorText !== null}
    <NoteDetails
      text={editorText}
      dates={shown.draft ? null : shown.noteDates}
      notSaved={shown.draft || (shown.openNote?.kind === "loaded" && shown.openNote.blobSha === null)}
      noteSwitch={shown.noteSwitch}
      shared={shown.shared}
      onShared={shown.onShared}
    />
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
    <p class="note-status note-loading" role="status">Loading…</p>
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
    scrollbar-color: color-mix(in srgb, var(--color-accent) 25%, var(--color-border-strong)) transparent;
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
