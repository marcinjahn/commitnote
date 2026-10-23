<script lang="ts">
  import { onMount, untrack, type Snippet } from "svelte";
  import { EditorView } from "@codemirror/view";
  import { accentCaret } from "../../editor/accent-caret";
  import { linkOpen } from "../../editor/link-open";
  import { livePreview } from "../../editor/live-preview";
  import {
    confirmEarlyDraftName,
    withEarlyDraftBody,
    withEarlyDraftName,
    type EarlyDraft,
    type EarlyDraftField,
    type EarlyDraftSelection,
  } from "../../app/early-draft";
  import type { NoteFont } from "../../settings/note-font";
  import MarkdownEditor from "../editor/MarkdownEditor.svelte";
  import NameField from "./NameField.svelte";

  interface Props {
    draft: EarlyDraft;
    onChange: (draft: EarlyDraft) => void;
    onBack: () => void;
    noteFont: NoteFont;
    animatedCaret: boolean;
    showBack?: boolean;
    status: Snippet;
  }

  const {
    draft,
    onChange,
    onBack,
    noteFont,
    animatedCaret,
    showBack = true,
    status,
  }: Props = $props();

  const initial = untrack(() => draft);
  let current = initial;

  let nameEl: HTMLDivElement | undefined = $state();
  let editor: ReturnType<typeof MarkdownEditor> | undefined = $state();

  const extensions = [
    livePreview(),
    linkOpen(),
    ...(untrack(() => animatedCaret) ? [accentCaret()] : []),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) return;
      if (update.selectionSet || (update.focusChanged && update.view.hasFocus)) {
        const { anchor, head } = update.state.selection.main;
        reportSelection("body", { anchor, head });
      }
    }),
  ];

  function nameInput(): HTMLInputElement | null {
    return nameEl?.querySelector<HTMLInputElement>(".name-input") ?? null;
  }

  function readNameSelection(input: HTMLInputElement): EarlyDraftSelection {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    return input.selectionDirection === "backward"
      ? { anchor: end, head: start }
      : { anchor: start, head: end };
  }

  function publish(next: EarlyDraft): void {
    current = next;
    onChange(next);
  }

  function reportSelection(focus: EarlyDraftField, selection: EarlyDraftSelection): void {
    if (
      current.focus === focus &&
      current.selection.anchor === selection.anchor &&
      current.selection.head === selection.head
    ) {
      return;
    }
    publish({ ...current, focus, selection });
  }

  function handleNameInput(name: string): void {
    const input = nameInput();
    const selection = input === null ? { anchor: name.length, head: name.length } : readNameSelection(input);
    publish(withEarlyDraftName(current, name, selection));
  }

  function handleNameSelection(): void {
    const input = nameInput();
    if (input === null || document.activeElement !== input) return;
    reportSelection("name", readNameSelection(input));
  }

  function handleBodyChange(body: string): void {
    const selection = editor?.getSelection() ?? { anchor: body.length, head: body.length };
    publish(withEarlyDraftBody(current, body, selection, Date.now()));
  }

  function handleNameEnter(): void {
    publish(confirmEarlyDraftName(current));
    editor?.setSelection(current.selection.anchor, current.selection.head);
    editor?.focus();
  }

  export function focus(): void {
    const { focus: field, selection } = current;
    if (field === "name") {
      const input = nameInput();
      if (input === null) return;
      input.focus();
      const length = input.value.length;
      const start = Math.min(selection.anchor, selection.head, length);
      const end = Math.min(Math.max(selection.anchor, selection.head), length);
      input.setSelectionRange(start, end, selection.anchor > selection.head ? "backward" : "forward");
    } else {
      const length = current.body.length;
      editor?.setSelection(Math.min(selection.anchor, length), Math.min(selection.head, length));
      editor?.focus();
    }
  }

  export function insertBodyText(text: string): void {
    editor?.focus();
    editor?.insertText(text);
  }

  onMount(() => {
    focus();
    document.addEventListener("selectionchange", handleNameSelection);
    return () => document.removeEventListener("selectionchange", handleNameSelection);
  });
</script>

<div class="early-draft-view">
  <header class="early-draft-header" class:without-back={!showBack}>
    {#if showBack}
      <button
        type="button"
        class="button button-ghost button-icon back-button"
        aria-label="Back to notes"
        onclick={onBack}
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M10 3L5 8l5 5" />
        </svg>
      </button>
    {/if}
    <div
      class="name-slot"
      bind:this={nameEl}
      role="presentation"
      onfocusincapture={handleNameSelection}
      onkeyup={handleNameSelection}
      onpointerup={handleNameSelection}
      onselectcapture={handleNameSelection}
    >
      <NameField
        value={initial.name}
        readOnly={false}
        error={null}
        resetKey={0}
        onCommit={() => {}}
        onEscape={() => {}}
        onEnterDone={handleNameEnter}
        onInput={handleNameInput}
      />
    </div>
  </header>
  <div class="early-draft-status">{@render status()}</div>
  <div class="early-draft-content">
    <MarkdownEditor
      bind:this={editor}
      text={initial.body}
      noteSwitch={0}
      readOnly={false}
      {extensions}
      {noteFont}
      onChange={handleBodyChange}
    />
  </div>
</div>

<style>
  .early-draft-view {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
    background: var(--color-background);
    color: var(--color-text);
  }

  .early-draft-header {
    -webkit-user-select: none;
    user-select: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: calc(var(--touch-target) + var(--space-2) * 2 + env(safe-area-inset-top));
    padding: calc(var(--space-2) + env(safe-area-inset-top)) var(--space-3) var(--space-2)
      var(--space-1);
    border-bottom: var(--hairline) solid var(--color-border);
    background: var(--color-background);
    transition: border-bottom-color var(--motion-duration) var(--motion-easing);
  }

  .early-draft-view:has(:global(.cm-editor.cm-focused)) .early-draft-header {
    border-bottom-color: var(--color-accent-hairline);
  }

  .early-draft-header.without-back {
    padding-left: var(--space-3);
  }

  .back-button {
    flex-shrink: 0;
  }

  .back-button .icon {
    width: 22px;
    height: 22px;
    stroke-width: 1.75;
  }

  .name-slot {
    flex: 1;
    min-width: 0;
    display: flex;
  }

  .early-draft-header :global(:is(input, textarea)) {
    -webkit-user-select: text;
    user-select: text;
  }

  .early-draft-header :global(.name-input) {
    font-size: 1.0625rem;
  }

  .early-draft-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    display: flex;
    flex-direction: column;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  @media (min-width: 768px) {
    .early-draft-header {
      gap: var(--space-2);
      padding-left: var(--space-3);
    }

    .early-draft-header :global(.name-input) {
      font-size: var(--font-size-lg);
    }
  }
</style>
