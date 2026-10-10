<script lang="ts">
  import type { Settings } from "../../settings/settings";
  import type {
    SettingScope,
    SettingScopes,
    SwitchableSettingKey,
  } from "../../settings/setting-scope";
  import ScopeToggle from "../settings/ScopeToggle.svelte";
  import type { SyncState } from "../../sync/sync-state";
  import SettingsSaveStatus from "../settings/SettingsSaveStatus.svelte";
  import type { ReopenLastViewOption } from "../settings/reopen-last-view-option";
  import DataSecuritySection from "../settings/DataSecuritySection.svelte";
  import type { DataSecurityActions } from "../settings/data-security-actions";
  import ThisDeviceSection from "../settings/ThisDeviceSection.svelte";
  import { SETTINGS_SECTIONS } from "../settings/settings-sections";
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
    {#each SETTINGS_SECTIONS as section (section.id)}
      {@const scopeKey = section.scopeKey}
      {#if scopeKey !== undefined}
        <div class="settings-heading-row">
          <h3 class="settings-section-title">{section.title}</h3>
          <ScopeToggle
            label={section.scopeLabel ?? section.title}
            scope={scopes[scopeKey]}
            onToggle={() =>
              changeSettingScope(
                scopeKey,
                scopes[scopeKey] === "device" ? "synced" : "device",
              )}
          />
        </div>
      {:else}
        <h3 class="settings-section-title">{section.title}</h3>
      {/if}
      <section.component
        {settings}
        {changeSettings}
        {scopes}
        {changeSettingScope}
      />
    {/each}
    <h3 class="settings-section-title">This device</h3>
    <ThisDeviceSection {...device} />
    <h3 class="settings-section-title">Data &amp; security</h3>
    <DataSecuritySection {...dataSecurity} />
  {/snippet}
</Dialog>

<style>
  .settings-intro {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .settings-heading-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

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
