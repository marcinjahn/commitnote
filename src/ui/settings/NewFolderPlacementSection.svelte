<script lang="ts">
  import {
    NEW_FOLDER_PLACEMENT_OPTIONS,
    type NewFolderPlacement,
  } from "../../settings/placement-options";
  import SegmentedControl from "./SegmentedControl.svelte";
  import SettingRow from "./SettingRow.svelte";
  import { NEW_FOLDERS_LABEL } from "./settings-messages";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings }: SettingsSectionProps = $props();
</script>

<SettingRow stacked>
  {#snippet label()}{NEW_FOLDERS_LABEL}{/snippet}
  <SegmentedControl
    label={NEW_FOLDERS_LABEL}
    name="new-folder-placement"
    options={NEW_FOLDER_PLACEMENT_OPTIONS}
    value={settings.newFolderPlacement}
    onSelect={(id) =>
      changeSettings({ newFolderPlacement: id as NewFolderPlacement })}
  />
</SettingRow>
