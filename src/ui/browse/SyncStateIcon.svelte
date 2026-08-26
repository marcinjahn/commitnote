<script lang="ts">
  import type { SyncState } from "../../sync/sync-state";
  import { describeSyncState } from "./sync-messages";

  interface Props {
    state: SyncState;
  }

  const { state }: Props = $props();

  const label = $derived(describeSyncState(state));
</script>

<span class="sync-state-icon" role="img" aria-label={label} title={label}>
  {#if state.kind === "synced"}
    <svg
      class="icon glyph synced"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 8.5l3.5 3.5 6.5-7.5" />
    </svg>
  {:else if state.kind === "syncing"}
    <svg
      class="icon glyph syncing spinning"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 8a5 5 0 0 1 9-3M12.5 2v3h-3" />
      <path d="M13 8a5 5 0 0 1-9 3M3.5 14v-3h3" />
    </svg>
  {:else if state.reason === "pending"}
    <svg
      class="icon glyph pending"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />
    </svg>
  {:else if state.reason === "failed"}
    <svg
      class="icon glyph failed"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 2.5L14 13H2z" />
      <path d="M8 6.5v3" />
      <circle cx="8" cy="11.25" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  {:else}
    <svg
      class="icon glyph conflict"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5" />
      <circle cx="8" cy="11" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  {/if}
</span>

<style>
  .sync-state-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--icon-size);
    height: var(--icon-size);
    flex-shrink: 0;
  }

  .synced,
  .pending {
    color: var(--color-text-muted);
  }

  .syncing {
    color: var(--color-accent);
  }

  .failed,
  .conflict {
    color: var(--color-danger);
  }

  .spinning {
    animation: sync-state-spin 0.9s linear infinite;
  }

  @keyframes sync-state-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
