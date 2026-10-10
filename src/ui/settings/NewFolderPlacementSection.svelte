<script lang="ts">
  import {
    NEW_FOLDER_PLACEMENT_OPTIONS,
    type NewFolderPlacement,
  } from "../../settings/placement-options";
  import SettingOptionList from "./SettingOptionList.svelte";
  import SettingRow from "./SettingRow.svelte";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings }: SettingsSectionProps = $props();
</script>

<SettingRow stacked>
  {#snippet label()}New folders{/snippet}
  <SettingOptionList
    label="New folders"
    name="new-folder-placement"
    options={NEW_FOLDER_PLACEMENT_OPTIONS}
    value={settings.newFolderPlacement}
    onSelect={(id) =>
      changeSettings({ newFolderPlacement: id as NewFolderPlacement })}
  />
</SettingRow>
