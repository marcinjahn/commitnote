<script lang="ts">
  import ScopeToggle from "./ScopeToggle.svelte";
  import SettingRow from "./SettingRow.svelte";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings, scopes, changeSettingScope }: SettingsSectionProps =
    $props();

  const hintId = "animated-caret-hint";
  const inputId = $props.id();
</script>

<SettingRow
  {hintId}
  hint="A thicker accent caret that blinks softly and tints the letters just before it. Turn it off for the browser’s standard caret."
>
  {#snippet label()}
    <label for={inputId}>Animated caret</label>
  {/snippet}
  {#snippet aside()}
    <ScopeToggle
      label="Animated caret"
      scope={scopes.animatedCaret}
      onToggle={() =>
        changeSettingScope(
          "animatedCaret",
          scopes.animatedCaret === "device" ? "synced" : "device",
        )}
    />
  {/snippet}
  <input
    id={inputId}
    type="checkbox"
    checked={settings.animatedCaret}
    aria-describedby={hintId}
    onchange={(event) =>
      changeSettings({ animatedCaret: event.currentTarget.checked })}
  />
</SettingRow>
