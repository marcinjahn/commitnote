<script lang="ts">
  import {
    NEW_NOTE_PLACEMENT_OPTIONS,
    type NewNotePlacement,
  } from "../../settings/placement-options";
  import SettingOptionList from "./SettingOptionList.svelte";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings }: SettingsSectionProps = $props();
</script>

<SettingOptionList
  label="New notes"
  name="new-note-placement"
  options={NEW_NOTE_PLACEMENT_OPTIONS}
  value={settings.newNotePlacement}
  onSelect={(id) => changeSettings({ newNotePlacement: id as NewNotePlacement })}
/>
<label class="checkbox-field">
  <input
    type="checkbox"
    checked={settings.typeToStart}
    onchange={(event) =>
      changeSettings({ typeToStart: event.currentTarget.checked })}
  />
  Start a note by typing
</label>
