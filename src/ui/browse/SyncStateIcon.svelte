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
      class="glyph synced"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3 8.5l3 3 7-7"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  {:else if state.kind === "syncing"}
    <svg
      class="glyph syncing spinning"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.7-3.98"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
      <path
        d="M2.5 8a5.5 5.5 0 1 1 1.7 3.98"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
  {:else if state.reason === "pending"}
    <svg
      class="glyph pending"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="4" fill="currentColor" />
    </svg>
  {:else if state.reason === "failed"}
    <svg
      class="glyph failed"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M8 2L14.5 13.5H1.5Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
      <line
        x1="8"
        y1="6.3"
        x2="8"
        y2="9.3"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
      />
      <circle cx="8" cy="11.4" r="0.65" fill="currentColor" />
    </svg>
  {:else}
    <svg
      class="glyph conflict"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
      />
      <line
        x1="8"
        y1="5"
        x2="8"
        y2="9"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
      />
      <circle cx="8" cy="11.2" r="0.7" fill="currentColor" />
    </svg>
  {/if}
</span>

<style>
  .sync-state-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .glyph {
    width: 100%;
    height: 100%;
  }

  .synced {
    color: var(--color-text-muted);
    opacity: 0.7;
  }

  .syncing,
  .pending {
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
