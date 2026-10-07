<script lang="ts">
  import type { Settings } from "../../settings/settings";
  import type { SyncState } from "../../sync/sync-state";
  import SettingsSaveStatus from "../settings/SettingsSaveStatus.svelte";
  import type { DeviceSettings } from "../settings/device-settings";
  import ThisDeviceSection from "../settings/ThisDeviceSection.svelte";
  import { SETTINGS_SECTIONS } from "../settings/settings-sections";
  import Dialog from "./Dialog.svelte";

  interface Props {
    settings: Settings;
    changeSettings: (edits: Partial<Settings>) => void;
    saveState: SyncState;
    device: DeviceSettings;
    onRetry: () => void;
    onClose: () => void;
  }

  const {
    settings,
    changeSettings,
    saveState,
    device,
    onRetry,
    onClose,
  }: Props = $props();
</script>

<Dialog open={true} title="Settings" {onClose} closeButton accentBorder desktopLarge>
  {#snippet headerStatus()}
    <SettingsSaveStatus {saveState} {onRetry} />
  {/snippet}
  {#snippet children()}
    {#each SETTINGS_SECTIONS as section (section.id)}
      <h3 class="settings-section-title">{section.title}</h3>
      <section.component {settings} {changeSettings} />
    {/each}
    <h3 class="settings-section-title">This device</h3>
    <ThisDeviceSection {...device} />
  {/snippet}
</Dialog>

<style>
  .settings-section-title {
    margin: var(--space-3) 0 var(--space-2);
    font-size: var(--font-size-base);
  }

  @media (min-width: 768px) {
    .settings-section-title {
      margin-top: var(--space-4);
    }
  }
</style>
