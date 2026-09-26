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
      class="icon glyph syncing"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle class="dot" cx="3" cy="8" r="2" />
      <circle class="dot" cx="8" cy="8" r="2" />
      <circle class="dot" cx="13" cy="8" r="2" />
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
  .pending,
  .syncing {
    color: var(--color-text-muted);
  }

  .failed,
  .conflict {
    color: var(--color-danger);
  }

  .syncing .dot {
    fill: currentColor;
    stroke: none;
    opacity: 0.7;
    animation: sync-state-wave 2.4s ease-in-out infinite;
  }

  /* Negative delays start every dot mid-cycle, so none jumps when it begins. */
  .syncing .dot:nth-child(1) {
    animation-delay: -2.4s;
  }

  .syncing .dot:nth-child(2) {
    animation-delay: -2s;
  }

  .syncing .dot:nth-child(3) {
    animation-delay: -1.6s;
  }

  @keyframes sync-state-wave {
    0%,
    60%,
    100% {
      opacity: 0.4;
    }
    30% {
      opacity: 1;
    }
  }
</style>
