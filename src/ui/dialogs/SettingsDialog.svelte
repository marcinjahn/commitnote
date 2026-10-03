<script lang="ts">
  import type { Settings } from "../../settings/settings";
  import {
    SETTINGS_SECTIONS,
    type SettingsSection,
  } from "../settings/settings-sections";
  import Dialog from "./Dialog.svelte";

  interface Props {
    open: boolean;
    settings: Settings;
    changeSettings: (edits: Partial<Settings>) => void;
    onClose: () => void;
    sections?: readonly SettingsSection[];
  }

  const {
    open,
    settings,
    changeSettings,
    onClose,
    sections = SETTINGS_SECTIONS,
  }: Props = $props();
</script>

<Dialog {open} title="Settings" {onClose} closeButton accentBorder>
  {#snippet children()}
    {#each sections as section (section.id)}
      <h3 class="settings-section-title">{section.title}</h3>
      <section.component {settings} {changeSettings} />
    {:else}
      <p class="field-hint">No settings yet.</p>
    {/each}
  {/snippet}
</Dialog>

<style>
  .settings-section-title {
    margin: var(--space-3) 0 var(--space-2);
    font-size: var(--font-size-base);
  }
</style>
