<script lang="ts">
  import {
    describeReopenLastViewUnavailable,
    REOPEN_LAST_VIEW_LABEL,
    type ReopenLastViewOption,
  } from "./reopen-last-view-option";
  import SettingRow from "./SettingRow.svelte";
  import { getStandalone } from "../standalone-context";

  const { reopenLastView, remembered, onReopenLastViewChange }: ReopenLastViewOption =
    $props();

  const standalone = getStandalone();
  const hintId = "reopen-last-view-hint";
  const inputId = $props.id();
</script>

<SettingRow
  {hintId}
  hint={remembered ? undefined : describeReopenLastViewUnavailable(standalone)}
>
  {#snippet label()}
    <label for={inputId}>{REOPEN_LAST_VIEW_LABEL}</label>
  {/snippet}
  <label class="setting-checkbox">
    <input
      id={inputId}
      type="checkbox"
      checked={reopenLastView && remembered}
      disabled={!remembered}
      aria-describedby={remembered ? undefined : hintId}
      onchange={(event) => onReopenLastViewChange(event.currentTarget.checked)}
    />
  </label>
</SettingRow>
