<script lang="ts">
  import { NOTE_FONT_OPTIONS } from "../../settings/note-font";
  import SettingOptionList from "./SettingOptionList.svelte";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings }: SettingsSectionProps = $props();
</script>

<SettingOptionList
  label="Note font"
  name="note-font"
  options={NOTE_FONT_OPTIONS}
  value={settings.noteFont}
  onSelect={(id) => changeSettings({ noteFont: id })}
>
  {#snippet optionLabel(option)}
    <span style:font-family={option.family}>{option.label}</span>
  {/snippet}
</SettingOptionList>
