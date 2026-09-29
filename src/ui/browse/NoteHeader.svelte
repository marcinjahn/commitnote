<script lang="ts">
  import type { SyncState } from "../../sync/sync-state";
  import { describeSyncState } from "./sync-messages";
  import SyncStateIcon from "./SyncStateIcon.svelte";
  import NameField from "../note/NameField.svelte";

  interface Props {
    name: string;
    syncState: SyncState;
    nameError: string | null;
    nameReadOnly: boolean;
    nameResetKey: number;
    onNameCommit: (edited: string) => void;
    onNameEscape: () => void;
    onBack: () => void;
  }

  const {
    name,
    syncState,
    nameError,
    nameReadOnly,
    nameResetKey,
    onNameCommit,
    onNameEscape,
    onBack,
  }: Props = $props();

  const syncLabel = $derived(describeSyncState(syncState));
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
    onCommit={onNameCommit}
    onEscape={onNameEscape}
  />
  <span class="sync-status">
    <SyncStateIcon state={syncState} />
    <span class="sync-status-label">{syncLabel}</span>
  </span>
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
  }

  .back-button svg {
    flex-shrink: 0;
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
