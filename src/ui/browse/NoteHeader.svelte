<script lang="ts">
  import type { SyncState } from "../../sync/sync-state";
  import { describeSyncState } from "./sync-messages";
  import SyncStateIcon from "./SyncStateIcon.svelte";
  import NameField from "../note/NameField.svelte";

  interface Props {
    name: string;
    draft: boolean;
    syncState: SyncState | null;
    nameError: string | null;
    nameReadOnly: boolean;
    nameResetKey: number;
    namePendingText?: string | null;
    onNamePendingConsumed?: () => void;
    onNameCommit: (edited: string) => void;
    onNameEscape: () => void;
    onNameEnterDone: () => void;
    onNameInput?: (edited: string) => void;
    onBack: () => void;
  }

  const {
    name,
    draft,
    syncState,
    nameError,
    nameReadOnly,
    nameResetKey,
    namePendingText = null,
    onNamePendingConsumed,
    onNameCommit,
    onNameEscape,
    onNameEnterDone,
    onNameInput,
    onBack,
  }: Props = $props();
</script>

<header class="note-header">
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
  <NameField
    value={name}
    readOnly={nameReadOnly}
    error={nameError}
    resetKey={nameResetKey}
    autofocus={draft}
    pendingText={namePendingText}
    onPendingConsumed={onNamePendingConsumed}
    onCommit={onNameCommit}
    onEscape={onNameEscape}
    onEnterDone={onNameEnterDone}
    onInput={onNameInput}
  />
  {#if !draft && syncState !== null && syncState.kind !== "synced"}
    <span class="sync-status">
      <SyncStateIcon state={syncState} />
      <span class="sync-status-label">{describeSyncState(syncState)}</span>
    </span>
  {/if}
</header>

<style>
  .note-header {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: calc(var(--touch-target) + var(--space-2) * 2);
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-1);
    border-bottom: var(--hairline) solid var(--color-border);
    background: var(--color-background);
  }

  .back-button {
    flex-shrink: 0;
  }

  .back-button .icon {
    width: 22px;
    height: 22px;
    stroke-width: 1.75;
  }

  .note-header :global(.name-input) {
    font-size: 1.0625rem;
  }

  .sync-status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    font-variant-numeric: tabular-nums;
  }

  .sync-status-label {
    display: none;
  }

  @media (min-width: 768px) {
    .note-header {
      gap: var(--space-2);
      padding-left: var(--space-3);
    }

    .back-button {
      display: none;
    }

    .note-header :global(.name-input) {
      font-size: var(--font-size-lg);
    }

    .sync-status-label {
      display: inline;
    }
  }
</style>
