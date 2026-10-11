<script lang="ts">
  import { Compartment } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import type { HeldConflict, SyncEngine } from "../../sync/sync-engine";
  import { conflictMarkerHighlight } from "../../editor/conflict-highlight";
  import MarkdownEditor from "../editor/MarkdownEditor.svelte";
  import VimStatusBar from "./VimStatusBar.svelte";
  import { createVimWiring } from "./vim-wiring.svelte";
  import {
    CONFLICT_BANNER_TEXT,
    CONFLICT_EDIT_HINT,
    CONFLICT_EDIT_MERGED_LABEL,
    conflictBannerHeading,
    conflictLegendLabel,
    keepOtherDeviceLabel,
    keepThisDeviceLabel,
  } from "./conflict-copy";

  import type { NoteFont } from "../../settings/note-font";

  interface Props {
    engine: SyncEngine;
    conflict: HeldConflict;
    noteFont: NoteFont;
    thisDeviceName: string;
    vimMode?: boolean;
    animatedCaret?: boolean;
    onVimWrite?: () => Promise<void>;
    onVimQuit?: () => void;
  }

  const {
    engine,
    conflict,
    noteFont,
    thisDeviceName,
    vimMode = false,
    animatedCaret = true,
    onVimWrite = async () => {},
    onVimQuit = () => {},
  }: Props = $props();

  let editor: ReturnType<typeof MarkdownEditor> | undefined = $state();

  const vim = createVimWiring({
    editor: () => editor,
    enabled: () => vimMode,
    animatedCaret: () => animatedCaret,
    initialMode: () => "normal",
    onWrite: () => onVimWrite(),
    onQuit: () => onVimQuit(),
  });

  const focusable = new Compartment();
  const editorExtensions = $derived([conflictMarkerHighlight(), vim.extension, focusable.of([])]);

  $effect(() => {
    editor?.reconfigure(
      focusable,
      vimMode ? EditorView.contentAttributes.of({ tabindex: "0" }) : [],
    );
  });
  const vimHint = $derived(
    vimMode ? "Vim mode is on. Press Escape, then Tab, to leave the editor." : undefined,
  );

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
    <h2>{conflictBannerHeading(conflict.theirsDevice)}</h2>
    <p>{CONFLICT_BANNER_TEXT}</p>
    <ul class="conflict-legend" aria-label="Legend">
      <li>
        <span class="conflict-swatch conflict-swatch-mine" aria-hidden="true"></span>
        {conflictLegendLabel("mine", thisDeviceName)}
      </li>
      <li>
        <span class="conflict-swatch conflict-swatch-theirs" aria-hidden="true"></span>
        {conflictLegendLabel("theirs", conflict.theirsDevice)}
      </li>
    </ul>
    <div class="conflict-actions">
      <button type="button" class="button button-ghost" onclick={keepMine}>
        {keepThisDeviceLabel(thisDeviceName)}
      </button>
      <button type="button" class="button button-ghost" onclick={keepTheirs}>
        {keepOtherDeviceLabel(conflict.theirsDevice)}
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
      bind:this={editor}
      text={conflict.merged}
      noteSwitch={0}
      readOnly={true}
      onChange={() => {}}
      extensions={editorExtensions}
      hint={vimHint}
      {noteFont}
      ariaLabel="Merged text"
    />
  {:else}
    <p role="status" class="conflict-hint">{CONFLICT_EDIT_HINT}</p>
    <MarkdownEditor
      bind:this={editor}
      text={conflict.editing}
      noteSwitch={0}
      readOnly={false}
      onChange={onMergedChange}
      extensions={editorExtensions}
      hint={vimHint}
      {noteFont}
      ariaLabel="Merged text"
    />
  {/if}
</div>
{#if vimMode && vim.status !== null}
  <VimStatusBar status={vim.status} commands={vim.commands} />
{/if}

<style>
  .conflict-view {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior-y: contain;
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

  .conflict-legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    font-size: var(--font-size-sm);
  }

  .conflict-legend li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .conflict-swatch {
    flex: none;
    width: 0.75rem;
    height: 0.75rem;
    border: var(--hairline) solid var(--color-border);
  }

  .conflict-swatch-mine {
    background: var(--color-conflict-mine);
  }

  .conflict-swatch-theirs {
    background: var(--color-conflict-theirs);
  }

  .conflict-actions .button {
    white-space: normal;
    text-align: center;
  }

  @media (max-width: 767px) {
    .conflict-actions {
      flex-direction: column;
    }

    .conflict-actions .button {
      width: 100%;
    }
  }

  .conflict-hint {
    margin: var(--space-3) var(--space-4) 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
</style>
