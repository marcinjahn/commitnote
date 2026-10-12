<script lang="ts">
  import { DEVICE_NAME_MAX_LENGTH, normalizeDeviceName } from "../../settings/device-name";
  import {
    ANALYTICS_LABEL,
    ANALYTICS_PRIVACY_URL,
    describeAnalytics,
    type AnalyticsOption,
  } from "./analytics-option";
  import {
    DEVICE_NAME_HINT,
    DEVICE_NAME_LABEL,
    type DeviceNameOption,
  } from "./device-name-option";
  import {
    describeReopenLastViewUnavailable,
    REOPEN_LAST_VIEW_LABEL,
    type ReopenLastViewOption,
  } from "./reopen-last-view-option";
  import SettingRow from "./SettingRow.svelte";
  import { getStandalone } from "../standalone-context";

  const {
    reopenLastView,
    remembered,
    onReopenLastViewChange,
    deviceName,
    automaticDeviceName,
    onDeviceNameChange,
    analyticsCounted,
    analyticsBlockedByBrowser,
    onAnalyticsCountedChange,
  }: ReopenLastViewOption & DeviceNameOption & AnalyticsOption = $props();

  const standalone = getStandalone();
  const hintId = "reopen-last-view-hint";
  const inputId = $props.id();
  const deviceNameId = `${inputId}-device-name`;
  const deviceNameHintId = `${inputId}-device-name-hint`;
  const analyticsId = `${inputId}-analytics`;
  const analyticsHintId = `${inputId}-analytics-hint`;

  function commitDeviceName(input: HTMLInputElement) {
    onDeviceNameChange(input.value);
    input.value = normalizeDeviceName(input.value) ?? "";
  }
</script>

<SettingRow stacked hint={DEVICE_NAME_HINT} hintId={deviceNameHintId}>
  {#snippet label()}
    <label for={deviceNameId}>{DEVICE_NAME_LABEL}</label>
  {/snippet}
  <input
    id={deviceNameId}
    class="device-name-input"
    type="text"
    maxlength={DEVICE_NAME_MAX_LENGTH}
    autocomplete="off"
    spellcheck="false"
    placeholder={automaticDeviceName}
    value={deviceName ?? ""}
    aria-describedby={deviceNameHintId}
    onchange={(event) => commitDeviceName(event.currentTarget)}
  />
</SettingRow>

<SettingRow
  {hintId}
  hint={remembered ? undefined : describeReopenLastViewUnavailable(standalone)}
>
  {#snippet label()}
    <label for={inputId}>{REOPEN_LAST_VIEW_LABEL}</label>
  {/snippet}
  <label class="setting-checkbox">
    <input
      id={inputId}
      type="checkbox"
      checked={reopenLastView && remembered}
      disabled={!remembered}
      aria-describedby={remembered ? undefined : hintId}
      onchange={(event) => onReopenLastViewChange(event.currentTarget.checked)}
    />
  </label>
</SettingRow>

<SettingRow hintId={analyticsHintId} hint={describeAnalytics(analyticsBlockedByBrowser)}>
  {#snippet label()}
    <label for={analyticsId}>{ANALYTICS_LABEL}</label>
  {/snippet}
  {#snippet aside()}
    <a href={ANALYTICS_PRIVACY_URL} target="_blank" rel="noopener noreferrer">What is sent</a>
  {/snippet}
  <label class="setting-checkbox">
    <input
      id={analyticsId}
      type="checkbox"
      checked={analyticsCounted && !analyticsBlockedByBrowser}
      disabled={analyticsBlockedByBrowser}
      aria-describedby={analyticsHintId}
      onchange={(event) => onAnalyticsCountedChange(event.currentTarget.checked)}
    />
  </label>
</SettingRow>

<style>
  .device-name-input {
    box-sizing: border-box;
    width: 100%;
    min-height: var(--touch-target);
    padding: 0 var(--space-2);
    border: var(--hairline) solid var(--color-border-strong);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    transition: border-color var(--motion-duration) var(--motion-easing);
  }

  .device-name-input:focus {
    border-color: var(--color-text);
  }

  @media (hover: hover) {
    .device-name-input:hover {
      border-color: var(--color-text);
    }
  }
</style>
