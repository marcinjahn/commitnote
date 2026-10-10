<script lang="ts">
  import {
    REOPEN_LAST_VIEW_LABEL,
    REOPEN_LAST_VIEW_NEEDS_REMEMBER,
    type ReopenLastViewOption,
  } from "./reopen-last-view-option";
  import SettingRow from "./SettingRow.svelte";

  const { reopenLastView, remembered, onReopenLastViewChange }: ReopenLastViewOption =
    $props();

  const hintId = "reopen-last-view-hint";
  const inputId = $props.id();
</script>

<SettingRow
  {hintId}
  hint={remembered ? undefined : REOPEN_LAST_VIEW_NEEDS_REMEMBER}
>
  {#snippet label()}
    <label for={inputId}>{REOPEN_LAST_VIEW_LABEL}</label>
  {/snippet}
  <input
    id={inputId}
    type="checkbox"
    checked={reopenLastView && remembered}
    disabled={!remembered}
    aria-describedby={remembered ? undefined : hintId}
    onchange={(event) => onReopenLastViewChange(event.currentTarget.checked)}
  />
</SettingRow>
