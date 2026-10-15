<script lang="ts">
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings }: SettingsSectionProps = $props();

  const hintId = "vim-mode-hint";
</script>

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
<p id={hintId} class="field-hint vim-mode-hint">
  Edit notes with Vim keys: Normal, Insert and Visual modes, relative line numbers and a status bar at the bottom.
</p>

<style>
  .vim-mode-hint {
    margin: 0;
  }
</style>
