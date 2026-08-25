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
  <button type="button" class="button button-ghost back-button" onclick={onBack}>
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M10 3L5 8l5 5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    Back to notes
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
  {#if !draft && syncState !== null}
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
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border);
  }

  .back-button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .back-button svg {
    flex-shrink: 0;
    width: 1rem;
    height: 1rem;
  }

  .sync-status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .sync-status-label {
    display: none;
  }

  @media (min-width: 768px) {
    .back-button {
      display: none;
    }

    .sync-status-label {
      display: inline;
    }
  }
</style>
