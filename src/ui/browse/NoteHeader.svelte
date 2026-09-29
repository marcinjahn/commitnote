<script lang="ts">
  import type { SyncState } from "../../sync/sync-state";
  import { describeSyncState } from "./sync-messages";
  import SyncStateIcon from "./SyncStateIcon.svelte";

  interface Props {
    name: string;
    syncState: SyncState;
    onBack: () => void;
  }

  const { name, syncState, onBack }: Props = $props();

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
  <h2 class="note-title" title={name}>{name}</h2>
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

  .note-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0;
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
