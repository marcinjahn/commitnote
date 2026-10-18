<script lang="ts">
  import type { Settings } from "../../settings/settings";
  import type {
    SettingScope,
    SettingScopes,
    SwitchableSettingKey,
  } from "../../settings/setting-scope";
  import type { SyncState } from "../../sync/sync-state";
  import SettingsSaveStatus from "../settings/SettingsSaveStatus.svelte";
  import type { ReopenLastViewOption } from "../settings/reopen-last-view-option";
  import DataSecuritySection from "../settings/DataSecuritySection.svelte";
  import type { DataSecurityActions } from "../settings/data-security-actions";
  import ThisDeviceSection from "../settings/ThisDeviceSection.svelte";
  import { SETTINGS_GROUPS } from "../settings/settings-sections";
  import Dialog from "./Dialog.svelte";

  interface Props {
    settings: Settings;
    changeSettings: (edits: Partial<Settings>) => void;
    scopes: SettingScopes;
    changeSettingScope: (key: SwitchableSettingKey, scope: SettingScope) => void;
    saveState: SyncState;
    device: ReopenLastViewOption;
    dataSecurity: DataSecurityActions;
    onRetry: () => void;
    onClose: () => void;
  }

  const {
    settings,
    changeSettings,
    scopes,
    changeSettingScope,
    saveState,
    device,
    dataSecurity,
    onRetry,
    onClose,
  }: Props = $props();
</script>

<Dialog open={true} title="Settings" {onClose} closeButton accentBorder desktopLarge>
  {#snippet headerStatus()}
    <SettingsSaveStatus {saveState} {onRetry} />
  {/snippet}
  {#snippet children()}
    <p class="settings-intro">
      Settings apply to all your devices unless marked This device.
    </p>
    {#each SETTINGS_GROUPS as group (group.id)}
      <section class="settings-group" aria-labelledby="settings-group-{group.id}">
        <h3 id="settings-group-{group.id}" class="settings-group-title">
          {group.title}
        </h3>
        {#each group.components as Section}
          <Section {settings} {changeSettings} {scopes} {changeSettingScope} />
        {/each}
      </section>
    {/each}
    <section class="settings-group" aria-labelledby="settings-group-device">
      <h3 id="settings-group-device" class="settings-group-title">This device</h3>
      <ThisDeviceSection {...device} />
    </section>
    <section class="settings-group" aria-labelledby="settings-group-data">
      <h3 id="settings-group-data" class="settings-group-title">Data &amp; security</h3>
      <DataSecuritySection {...dataSecurity} />
    </section>
  {/snippet}
</Dialog>

<style>
  .settings-intro {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .settings-group {
    margin-top: var(--space-3);
    border-top: var(--hairline) solid var(--color-border);
  }

  .settings-group-title {
    margin: var(--space-3) 0 var(--space-1);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-medium);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
  }

  @media (min-width: 768px) {
    .settings-group {
      margin-top: var(--space-4);
    }

    .settings-group-title {
      margin-top: var(--space-4);
    }
  }
</style>
