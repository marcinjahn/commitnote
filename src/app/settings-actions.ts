import type { DeviceSettingsStore } from "../settings/device-settings-store";
import {
  resolveEffectiveSettings,
  routeSettingsEdits,
  switchSettingScope,
  type DeviceSettingsRecord,
  type EffectiveSettings,
  type SettingScope,
  type SettingScopes,
  type SwitchableSettingKey,
} from "../settings/setting-scope";
import {
  applySettingsEdits,
  resolveSettings,
  SETTINGS_SCHEMA,
  type RawSettings,
  type SettingsEdits,
} from "../settings/settings";
import type { SettingsSaver } from "../settings/settings-saver";

export interface SettingsActionsDeps {
  readonly saver: Pick<SettingsSaver, "change">;
  readonly deviceStore: Pick<DeviceSettingsStore, "writeValues" | "setScope">;
}

export function syncedRawSettings(
  engineRaw: RawSettings,
  pending: SettingsEdits,
): RawSettings {
  return applySettingsEdits(engineRaw, pending);
}

export function effectiveSettingsOf(
  engineRaw: RawSettings,
  pending: SettingsEdits,
  device: DeviceSettingsRecord,
): EffectiveSettings {
  return resolveEffectiveSettings(syncedRawSettings(engineRaw, pending), device);
}

export function changeSettings(
  deps: SettingsActionsDeps,
  edits: SettingsEdits,
  scopes: SettingScopes,
): void {
  const { device, synced } = routeSettingsEdits(edits, scopes);
  if (Object.keys(device).length > 0) deps.deviceStore.writeValues(device);
  if (Object.keys(synced).length > 0) deps.saver.change(synced);
}

export function changeSettingScope(
  deps: SettingsActionsDeps,
  key: SwitchableSettingKey,
  to: SettingScope,
  effective: EffectiveSettings,
  syncedRaw: RawSettings,
): void {
  const syncedResolved = resolveSettings(SETTINGS_SCHEMA, syncedRaw);
  const { deviceValue, syncedEdits } = switchSettingScope(
    key,
    to,
    effective.settings,
    syncedResolved,
  );
  if (Object.keys(syncedEdits).length > 0) deps.saver.change(syncedEdits);
  deps.deviceStore.setScope(key, to, deviceValue);
}

export function shouldApplyColorMode(input: {
  readonly settingsLoaded: boolean;
  readonly colorModePending: boolean;
  readonly colorModeScope: SettingScope;
}): boolean {
  return (
    input.settingsLoaded ||
    input.colorModePending ||
    input.colorModeScope === "device"
  );
}
