<script lang="ts">
  import {
    NEW_NOTE_PLACEMENT_OPTIONS,
    type NewNotePlacement,
  } from "../../settings/placement-options";
  import SegmentedControl from "./SegmentedControl.svelte";
  import SettingRow from "./SettingRow.svelte";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings }: SettingsSectionProps = $props();
</script>

<SettingRow stacked>
  {#snippet label()}New notes{/snippet}
  <SegmentedControl
    label="New notes"
    name="new-note-placement"
    options={NEW_NOTE_PLACEMENT_OPTIONS}
    value={settings.newNotePlacement}
    onSelect={(id) => changeSettings({ newNotePlacement: id as NewNotePlacement })}
  />
</SettingRow>
