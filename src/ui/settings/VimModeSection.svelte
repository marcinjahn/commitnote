<script lang="ts">
  import ScopeToggle from "./ScopeToggle.svelte";
  import SettingRow from "./SettingRow.svelte";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings, scopes, changeSettingScope }: SettingsSectionProps =
    $props();

  const hintId = "vim-mode-hint";
  const inputId = $props.id();
</script>

<SettingRow
  {hintId}
  hint="Edit notes with Vim keys: Normal, Insert and Visual modes, relative line numbers and a status bar at the bottom."
>
  {#snippet label()}
    <label for={inputId}>Vim mode</label>
  {/snippet}
  {#snippet aside()}
    <ScopeToggle
      label="Vim mode"
      scope={scopes.vimMode}
      onToggle={() =>
        changeSettingScope(
          "vimMode",
          scopes.vimMode === "device" ? "synced" : "device",
        )}
    />
  {/snippet}
  <label class="setting-checkbox">
    <input
      id={inputId}
      type="checkbox"
      checked={settings.vimMode}
      aria-describedby={hintId}
      onchange={(event) =>
        changeSettings({ vimMode: event.currentTarget.checked })}
    />
  </label>
</SettingRow>
