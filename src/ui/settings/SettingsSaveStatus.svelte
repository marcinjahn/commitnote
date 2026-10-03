<script lang="ts">
  import type { SyncState } from "../../sync/sync-state";
  import SyncStateIcon from "../browse/SyncStateIcon.svelte";
  import { syncIndicatorFade } from "../browse/sync-indicator-fade";
  import {
    describeSettingsSaveState,
    describeSettingsSaveStateInDetail,
  } from "./settings-save-messages";

  interface Props {
    saveState: SyncState;
    onRetry: () => void;
  }

  const { saveState, onRetry }: Props = $props();

  let savedSinceOpen = $state(false);
  let statusEl: HTMLDivElement | undefined = $state();

  function retry(): void {
    statusEl?.focus();
    onRetry();
  }
  let previousKind: SyncState["kind"] | null = null;

  $effect.pre(() => {
    const kind = saveState.kind;
    if (kind === "synced" && previousKind !== null && previousKind !== "synced") {
      savedSinceOpen = true;
    }
    previousKind = kind;
  });

  const visible = $derived(saveState.kind !== "synced" || savedSinceOpen);
  const failed = $derived(saveState.kind === "out-of-sync" && saveState.reason === "failed");
</script>

<div class="settings-save-status" role="status" tabindex="-1" bind:this={statusEl}>
  {#if visible}
    <span class="status-content" in:syncIndicatorFade={{ duration: 200 }}>
      {#if saveState.kind === "synced"}
        <svg
          class="icon saved-check"
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
        >
          <path pathLength="1" d="M3 8.5l3.5 3.5 6.5-7.5" />
        </svg>
      {:else}
        <span aria-hidden="true" class="status-icon">
          <SyncStateIcon state={saveState} label={describeSettingsSaveStateInDetail(saveState)} />
        </span>
      {/if}
      <span class="status-label" class:failed aria-hidden="true">
        {describeSettingsSaveState(saveState)}
      </span>
      <span class="visually-hidden">{describeSettingsSaveStateInDetail(saveState)}</span>
    </span>
  {/if}
</div>
{#if failed}
  <button
    type="button"
    class="button button-ghost retry-button"
    onclick={retry}
  >
    Retry
  </button>
{/if}

<style>
  .settings-save-status {
    display: flex;
    outline: none;
    align-items: center;
    min-width: 0;
  }

  .status-content {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    white-space: nowrap;
  }

  .status-icon {
    display: inline-flex;
  }

  .status-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status-label.failed {
    color: var(--color-danger);
  }

  .saved-check {
    width: var(--icon-size);
    height: var(--icon-size);
    flex-shrink: 0;
    color: var(--color-accent);
  }

  .saved-check path {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: saved-check-draw 320ms var(--motion-easing) 60ms forwards;
  }

  @keyframes saved-check-draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  .retry-button {
    flex-shrink: 0;
    margin-block: calc(-1 * var(--space-2));
    margin-inline-start: var(--space-1);
    padding: 0 var(--space-2);
    font-size: var(--font-size-xs);
  }
</style>
