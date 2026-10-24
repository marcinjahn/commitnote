<script lang="ts">
  import {
    NEW_NOTE_PLACEMENT_OPTIONS,
    type NewNotePlacement,
  } from "../../settings/placement-options";
  import SegmentedControl from "./SegmentedControl.svelte";
  import SettingRow from "./SettingRow.svelte";
  import { NEW_NOTES_LABEL } from "./settings-messages";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings }: SettingsSectionProps = $props();
</script>

<SettingRow stacked>
  {#snippet label()}{NEW_NOTES_LABEL}{/snippet}
  <SegmentedControl
    label={NEW_NOTES_LABEL}
    name="new-note-placement"
    options={NEW_NOTE_PLACEMENT_OPTIONS}
    value={settings.newNotePlacement}
    onSelect={(id) => changeSettings({ newNotePlacement: id as NewNotePlacement })}
  />
</SettingRow>
