<script lang="ts">
  import ScopeToggle from "./ScopeToggle.svelte";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings, scopes, changeSettingScope }: SettingsSectionProps =
    $props();

  const hintId = "vim-mode-hint";
</script>

<div class="scope-row">
<label class="checkbox-field">
  <input
    type="checkbox"
    checked={settings.vimMode}
    aria-describedby={hintId}
    onchange={(event) =>
      changeSettings({ vimMode: event.currentTarget.checked })}
  />
  Vim mode
</label>
<ScopeToggle
  label="Vim mode"
  scope={scopes.vimMode}
  onToggle={() =>
    changeSettingScope("vimMode", scopes.vimMode === "device" ? "synced" : "device")}
/>
</div>
<p id={hintId} class="field-hint vim-mode-hint">
  Edit notes with Vim keys: Normal, Insert and Visual modes, relative line numbers and a status bar at the bottom.
</p>

<style>
  .scope-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .vim-mode-hint {
    margin: 0;
  }
</style>
