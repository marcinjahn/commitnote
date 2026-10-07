<script lang="ts">
  import {
    REOPEN_LAST_VIEW_LABEL,
    REOPEN_LAST_VIEW_NEEDS_REMEMBER,
    type DeviceSettings,
  } from "./device-settings";

  const { reopenLastView, remembered, onReopenLastViewChange }: DeviceSettings =
    $props();

  const hintId = "reopen-last-view-hint";
</script>

<label class="checkbox-field">
  <input
    type="checkbox"
    checked={reopenLastView && remembered}
    disabled={!remembered}
    aria-describedby={remembered ? undefined : hintId}
    onchange={(event) => onReopenLastViewChange(event.currentTarget.checked)}
  />
  {REOPEN_LAST_VIEW_LABEL}
</label>
{#if !remembered}
  <p id={hintId} class="field-hint device-hint">
    {REOPEN_LAST_VIEW_NEEDS_REMEMBER}
  </p>
{/if}

<style>
  .device-hint {
    margin: 0;
  }
</style>
