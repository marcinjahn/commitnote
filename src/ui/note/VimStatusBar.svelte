<script lang="ts">
  import { untrack } from "svelte";
  import type { VimStatus } from "../../editor/vim/vim-status";
  import {
    commandLineLabel,
    editingModeAnnouncement,
    editingModeLabel,
    formatPosition,
    isAccentedMode,
    modeButtonName,
    positionLabel,
  } from "./vim-status-labels";
  import type { VimBarCommands } from "./vim-bar-commands";

  interface Props {
    status: VimStatus;
    commands: VimBarCommands;
  }

  const { status, commands }: Props = $props();

  let announcement = $state("");
  let announcedMode = untrack(() => status.mode);
  let announcedMessageId = untrack(() => status.message?.id ?? null);
  let input = $state<HTMLInputElement>();
  let colonButton = $state<HTMLButtonElement>();

  const commandLineOpen = $derived(status.commandLine !== null);
  const commandLineValue = $derived(status.commandLine?.value ?? "");

  $effect(() => {
    const mode = status.mode;
    if (mode === announcedMode) return;
    announcedMode = mode;
    announcement = editingModeAnnouncement(mode);
  });

  $effect(() => {
    const message = status.message;
    if (!message || message.id === announcedMessageId) return;
    announcedMessageId = message.id;
    announcement = message.text;
  });

  $effect(() => {
    if (commandLineOpen) input?.focus();
  });

  $effect(() => {
    const value = commandLineValue;
    if (input && input.value !== value) input.value = value;
  });

  function onModeClick() {
    if (status.mode === "normal") commands.enterInsert();
    else commands.escape();
  }

  function onBlur(event: FocusEvent) {
    if (status.commandLine === null) return;
    if (event.relatedTarget === colonButton) return;
    if (event.relatedTarget === null && !document.hasFocus()) return;
    commands.close();
  }
</script>

<div class="vim-status-bar">
  <button
    type="button"
    class="mode-button"
    class:accented={isAccentedMode(status.mode)}
    aria-label={modeButtonName(status.mode)}
    onclick={onModeClick}
  >
    <span class="mode-label">{editingModeLabel(status.mode)}</span>
  </button>

  <div class="info">
    {#if status.commandLine}
      <span class="prefix" aria-hidden="true">{status.commandLine.kind}</span>
      <input
        bind:this={input}
        class="command-input"
        type="text"
        aria-label={commandLineLabel(status.commandLine.kind)}
        autocomplete="off"
        spellcheck="false"
        autocapitalize="off"
        value={status.commandLine.value}
        onkeydown={(event) =>
          commands.keyDown(event, event.currentTarget.value)}
        onkeyup={(event) => commands.keyUp(event, event.currentTarget.value)}
        oninput={(event) => commands.input(event, event.currentTarget.value)}
        onblur={onBlur}
      />
    {:else}
      {#if status.pendingKeys}
        <span class="pending">{status.pendingKeys}</span>
      {/if}
      {#if status.recording}
        <span class="recording">recording @{status.recording}</span>
      {/if}
      {#if status.message}
        <span class="message" class:error={status.message.error}
          >{status.message.text}</span
        >
      {/if}
    {/if}
  </div>

  <div class="trailing">
    <button
      bind:this={colonButton}
      type="button"
      class="colon-button"
      aria-label="Open command line"
      onclick={() => commands.openCommandLine(":")}>:</button
    >
    <span class="position" aria-hidden="true"
      >{formatPosition(status.line, status.column)}</span
    >
    <span class="visually-hidden">{positionLabel(status.line, status.column)}</span>
  </div>

  <p class="visually-hidden" role="status">{announcement}</p>
</div>

<style>
  .vim-status-bar {
    display: flex;
    align-items: stretch;
    gap: var(--space-3);
    flex-shrink: 0;
    box-sizing: border-box;
    height: calc(32px + env(safe-area-inset-bottom, 0px));
    padding: 0 var(--space-2) env(safe-area-inset-bottom, 0px);
    border-top: var(--hairline) solid var(--color-border);
    background: var(--color-background);
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 0 var(--space-2);
    border: 0;
    border-radius: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .mode-button {
    padding: 0;
    align-self: center;
  }

  .mode-label {
    display: inline-block;
    padding: 1px var(--space-2);
    border: var(--hairline) solid transparent;
  }

  .accented .mode-label {
    border-color: var(--color-accent);
    background: var(--color-vim-mode-wash);
    color: var(--color-text);
  }

  .info {
    display: flex;
    flex: 1 1 0;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    color: var(--color-text-muted);
  }

  .info > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .message {
    min-width: 0;
  }

  .message.error {
    color: var(--color-danger);
  }

  .prefix {
    flex-shrink: 0;
    color: var(--color-text);
  }

  .command-input {
    flex: 1 1 0;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: none;
    color: var(--color-text);
    font: inherit;
  }

  .trailing {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-2);
  }

  .position {
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  @media (pointer: coarse) {
    .vim-status-bar {
      height: calc(var(--touch-target) + env(safe-area-inset-bottom, 0px));
    }

    button {
      min-width: var(--touch-target);
      min-height: var(--touch-target);
    }

    .mode-button {
      padding: 0 var(--space-2);
    }
  }

  @media (forced-colors: active) {
    .vim-status-bar {
      border-top-color: CanvasText;
    }

    .accented .mode-label {
      border-color: Highlight;
    }
  }
</style>
