<script lang="ts">
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings }: SettingsSectionProps = $props();

  const hintId = "animated-caret-hint";
</script>

<label class="checkbox-field">
  <input
    type="checkbox"
    checked={settings.animatedCaret}
    aria-describedby={hintId}
    onchange={(event) =>
      changeSettings({ animatedCaret: event.currentTarget.checked })}
  />
  Animated caret
</label>
<p id={hintId} class="field-hint caret-hint">
  A thicker accent caret that blinks softly and tints the letters just before
  it. Turn it off for the browser’s standard caret.
</p>

<style>
  .caret-hint {
    margin: 0;
  }
</style>
