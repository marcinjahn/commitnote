<script lang="ts">
  import ScopeToggle from "./ScopeToggle.svelte";
  import SettingRow from "./SettingRow.svelte";
  import { TYPE_TO_START_HINT, TYPE_TO_START_LABEL } from "./settings-messages";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings, scopes, changeSettingScope }: SettingsSectionProps =
    $props();

  const hintId = "type-to-start-hint";
  const inputId = $props.id();
</script>

<SettingRow {hintId} hint={TYPE_TO_START_HINT}>
  {#snippet label()}
    <label for={inputId}>{TYPE_TO_START_LABEL}</label>
  {/snippet}
  {#snippet aside()}
    <ScopeToggle
      label={TYPE_TO_START_LABEL}
      scope={scopes.typeToStart}
      onToggle={() =>
        changeSettingScope(
          "typeToStart",
          scopes.typeToStart === "device" ? "synced" : "device",
        )}
    />
  {/snippet}
  <label class="setting-checkbox">
    <input
      id={inputId}
      type="checkbox"
      checked={settings.typeToStart}
      aria-describedby={hintId}
      onchange={(event) =>
        changeSettings({ typeToStart: event.currentTarget.checked })}
    />
  </label>
</SettingRow>
