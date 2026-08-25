<script lang="ts">
  import { onMount, untrack } from "svelte";

  interface Props {
    value: string;
    readOnly: boolean;
    error: string | null;
    resetKey: number;
    autofocus?: boolean;
    pendingText?: string | null;
    onPendingConsumed?: () => void;
    onCommit: (edited: string) => void;
    onEscape: () => void;
    onEnterDone?: () => void;
    onInput?: (edited: string) => void;
  }

  const {
    value,
    readOnly,
    error,
    resetKey,
    autofocus = false,
    pendingText = null,
    onPendingConsumed,
    onCommit,
    onEscape,
    onEnterDone,
    onInput,
  }: Props = $props();

  let edited = $state("");
  let inputEl: HTMLInputElement | undefined = $state();
  let committedByEnter = false;

  $effect(() => {
    void resetKey;
    const next = value;
    untrack(() => {
      if (pendingText !== null) {
        edited = pendingText;
        onPendingConsumed?.();
      } else {
        edited = next;
      }
    });
  });

  onMount(() => {
    if (autofocus) inputEl?.focus();
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      committedByEnter = true;
      onCommit(edited);
      onEnterDone?.();
    } else if (event.key === "Escape") {
      event.preventDefault();
      committedByEnter = true;
      edited = value;
      onEscape();
    }
  }

  function handleInput(): void {
    committedByEnter = false;
    onInput?.(edited);
  }

  function handleBlur(): void {
    if (committedByEnter) {
      committedByEnter = false;
      return;
    }
    onCommit(edited);
  }
</script>

<div class="name-field">
  <input
    bind:this={inputEl}
    type="text"
    class="name-input"
    aria-label="Note name"
    aria-invalid={error !== null ? "true" : undefined}
    readonly={readOnly}
    autocomplete="off"
    spellcheck="false"
    bind:value={edited}
    onkeydown={handleKeydown}
    oninput={handleInput}
    onblur={handleBlur}
  />
  {#if error !== null}
    <p role="alert" class="name-error">{error}</p>
  {/if}
</div>

<style>
  .name-field {
    flex: 1;
    min-width: 0;
  }

  .name-input {
    box-sizing: border-box;
    width: 100%;
    min-height: var(--touch-target);
    padding: 0 var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: 1.25rem;
    font-weight: 600;
    text-overflow: ellipsis;
  }

  .name-input:hover:not([readonly]),
  .name-input:focus {
    border-color: var(--color-border);
  }

  .name-input[aria-invalid="true"] {
    border-color: var(--color-danger);
  }

  .name-error {
    margin: var(--space-1) 0 0;
    padding: 0 var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--color-danger);
  }
</style>
