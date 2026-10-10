import {
  resolveSettings,
  SETTINGS_SCHEMA,
  settingValuesEqual,
  type RawSettings,
  type Settings,
} from "./settings";

export type SettingScope = "synced" | "device";

export const SWITCHABLE_SETTING_KEYS = [
  "colorMode",
  "accentColor",
  "noteFont",
  "animatedCaret",
  "vimMode",
  "typeToStart",
] as const;

export type SwitchableSettingKey = (typeof SWITCHABLE_SETTING_KEYS)[number];

export const DEFAULT_SETTING_SCOPES: Readonly<
  Record<SwitchableSettingKey, SettingScope>
> = {
  colorMode: "synced",
  accentColor: "synced",
  noteFont: "synced",
  animatedCaret: "synced",
  vimMode: "device",
  typeToStart: "device",
};

export function isSwitchableSetting(key: string): key is SwitchableSettingKey {
  return (SWITCHABLE_SETTING_KEYS as readonly string[]).includes(key);
}

export interface DeviceSettingsRecord {
  readonly scopes: Readonly<Partial<Record<SwitchableSettingKey, SettingScope>>>;
  readonly values: Readonly<Partial<Settings>>;
}

export const EMPTY_DEVICE_SETTINGS: DeviceSettingsRecord = {
  scopes: {},
  values: {},
};

export type SettingScopes = Readonly<Record<keyof Settings, SettingScope>>;

export interface EffectiveSettings {
  readonly settings: Settings;
  readonly scopes: SettingScopes;
}

const SETTING_KEYS = Object.keys(SETTINGS_SCHEMA) as (keyof Settings)[];

function scopeOf(key: keyof Settings, device: DeviceSettingsRecord) {
  if (!isSwitchableSetting(key)) return "synced";
  return device.scopes[key] ?? DEFAULT_SETTING_SCOPES[key];
}

export function resolveEffectiveSettings(
  synced: RawSettings,
  device: DeviceSettingsRecord,
): EffectiveSettings {
  const syncedResolved = resolveSettings(SETTINGS_SCHEMA, synced);
  const settings: Record<string, unknown> = {};
  const scopes: Record<string, SettingScope> = {};
  for (const key of SETTING_KEYS) {
    const scope = scopeOf(key, device);
    scopes[key] = scope;
    if (scope === "synced") {
      settings[key] = syncedResolved[key];
    } else {
      const definition = SETTINGS_SCHEMA[key];
      const parsed = definition.parse(device.values[key]);
      settings[key] = parsed === undefined ? definition.default : parsed;
    }
  }
  return {
    settings: settings as unknown as Settings,
    scopes: scopes as SettingScopes,
  };
}

export function routeSettingsEdits(
  edits: Partial<Settings>,
  scopes: SettingScopes,
): { device: Partial<Settings>; synced: Partial<Settings> } {
  const device: Record<string, unknown> = {};
  const synced: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const value = edits[key];
    if (value === undefined) continue;
    (scopes[key] === "device" ? device : synced)[key] = value;
  }
  return { device: device as Partial<Settings>, synced: synced as Partial<Settings> };
}

export function switchSettingScope(
  key: SwitchableSettingKey,
  to: SettingScope,
  effective: Settings,
  syncedResolved: Settings,
): { deviceValue: unknown; syncedEdits: Partial<Settings> } {
  if (to === "device") {
    return { deviceValue: effective[key], syncedEdits: {} };
  }
  const unchanged = settingValuesEqual(effective[key], syncedResolved[key]);
  return {
    deviceValue: undefined,
    syncedEdits: unchanged ? {} : { [key]: effective[key] },
  };
}
