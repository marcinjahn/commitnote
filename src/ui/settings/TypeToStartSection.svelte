<script lang="ts">
  import ScopeToggle from "./ScopeToggle.svelte";
  import SettingRow from "./SettingRow.svelte";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings, scopes, changeSettingScope }: SettingsSectionProps =
    $props();

  const inputId = $props.id();
</script>

<SettingRow>
  {#snippet label()}
    <label for={inputId}>Start a note by typing</label>
  {/snippet}
  {#snippet aside()}
    <ScopeToggle
      label="Start a note by typing"
      scope={scopes.typeToStart}
      onToggle={() =>
        changeSettingScope(
          "typeToStart",
          scopes.typeToStart === "device" ? "synced" : "device",
        )}
    />
  {/snippet}
  <input
    id={inputId}
    type="checkbox"
    checked={settings.typeToStart}
    onchange={(event) =>
      changeSettings({ typeToStart: event.currentTarget.checked })}
  />
</SettingRow>
