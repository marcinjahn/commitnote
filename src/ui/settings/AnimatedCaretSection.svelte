<script lang="ts">
  import { getStandalone } from "../standalone-context";
  import ScopeToggle from "./ScopeToggle.svelte";
  import SettingRow from "./SettingRow.svelte";
  import { animatedCaretHint } from "./settings-messages";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings, scopes, changeSettingScope }: SettingsSectionProps =
    $props();

  const standalone = getStandalone();
  const hintId = "animated-caret-hint";
  const inputId = $props.id();
</script>

<SettingRow {hintId} hint={animatedCaretHint(standalone)}>
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
  <label class="setting-checkbox">
    <input
      id={inputId}
      type="checkbox"
      checked={settings.animatedCaret}
      aria-describedby={hintId}
      onchange={(event) =>
        changeSettings({ animatedCaret: event.currentTarget.checked })}
    />
  </label>
</SettingRow>
