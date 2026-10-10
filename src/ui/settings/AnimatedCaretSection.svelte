<script lang="ts">
  import ScopeToggle from "./ScopeToggle.svelte";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings, scopes, changeSettingScope }: SettingsSectionProps =
    $props();

  const hintId = "animated-caret-hint";
</script>

<div class="scope-row">
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
<ScopeToggle
  label="Animated caret"
  scope={scopes.animatedCaret}
  onToggle={() =>
    changeSettingScope("animatedCaret", scopes.animatedCaret === "device" ? "synced" : "device")}
/>
</div>
<p id={hintId} class="field-hint caret-hint">
  A thicker accent caret that blinks softly and tints the letters just before
  it. Turn it off for the browser’s standard caret.
</p>

<style>
  .scope-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .caret-hint {
    margin: 0;
  }
</style>
