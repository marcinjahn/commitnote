<script lang="ts">
  import type { SyncState } from "../../sync/sync-state";
  import SyncStateIcon from "../browse/SyncStateIcon.svelte";
  import { syncIndicatorFade } from "../browse/sync-indicator-fade";
  import { describeSettingsSaveStateInDetail } from "./settings-save-messages";

  interface Props {
    state: SyncState;
    onOpen: () => void;
  }

  const { state, onOpen }: Props = $props();

  const label = $derived(describeSettingsSaveStateInDetail(state));
  const failed = $derived(state.kind === "out-of-sync" && state.reason === "failed");
</script>

{#if state.kind !== "synced"}
  <button
    type="button"
    class="button button-ghost settings-save-indicator"
    class:failed
    aria-label="{label}. Open settings"
    title={label}
    onclick={onOpen}
    in:syncIndicatorFade={{ duration: 200 }}
    out:syncIndicatorFade={{ duration: 400 }}
  >
    <span class="indicator-icon" aria-hidden="true">
      <SyncStateIcon {state} {label} />
    </span>
    <span aria-hidden="true">Settings</span>
  </button>
{/if}

<style>
  .settings-save-indicator {
    flex-shrink: 0;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    font-weight: inherit;
  }

  .settings-save-indicator:hover {
    color: var(--color-text);
  }

  .settings-save-indicator.failed {
    color: var(--color-danger);
  }

  .indicator-icon {
    display: inline-flex;
  }
</style>
