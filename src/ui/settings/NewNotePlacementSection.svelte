<script lang="ts">
  import {
    NEW_NOTE_PLACEMENT_OPTIONS,
    type NewNotePlacement,
  } from "../../settings/placement-options";
  import ScopeToggle from "./ScopeToggle.svelte";
  import SettingOptionList from "./SettingOptionList.svelte";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings, scopes, changeSettingScope }: SettingsSectionProps =
    $props();
</script>

<SettingOptionList
  label="New notes"
  name="new-note-placement"
  options={NEW_NOTE_PLACEMENT_OPTIONS}
  value={settings.newNotePlacement}
  onSelect={(id) => changeSettings({ newNotePlacement: id as NewNotePlacement })}
/>
<div class="scope-row">
<label class="checkbox-field">
  <input
    type="checkbox"
    checked={settings.typeToStart}
    onchange={(event) =>
      changeSettings({ typeToStart: event.currentTarget.checked })}
  />
  Start a note by typing
</label>
<ScopeToggle
  label="Start a note by typing"
  scope={scopes.typeToStart}
  onToggle={() =>
    changeSettingScope("typeToStart", scopes.typeToStart === "device" ? "synced" : "device")}
/>
</div>

<style>
  .scope-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
</style>
