import { parseAccentColor, type AccentColorId } from "./accent-palette";
import { parseNoteFont, type NoteFont } from "./note-font";
import {
  parseNewFolderPlacement,
  parseNewNotePlacement,
  type NewFolderPlacement,
  type NewNotePlacement,
} from "./placement-options";

export type RawSettings = Readonly<Record<string, unknown>>;
export type SettingsEdits = Readonly<Record<string, unknown>>;

export interface SettingDefinition<T> {
  readonly default: T;
  /** Returns undefined for an invalid value, which resolves to the default. */
  parse(raw: unknown): T | undefined;
}

export type SettingsSchema = Readonly<
  Record<string, SettingDefinition<unknown>>
>;

export type SettingsOf<S extends SettingsSchema> = {
  readonly [K in keyof S]: S[K] extends SettingDefinition<infer T> ? T : never;
};

const accentColorSetting: SettingDefinition<AccentColorId> = {
  default: "system",
  parse: parseAccentColor,
};

const newNotePlacementSetting: SettingDefinition<NewNotePlacement> = {
  default: "beginning",
  parse: parseNewNotePlacement,
};

const newFolderPlacementSetting: SettingDefinition<NewFolderPlacement> = {
  default: "end",
  parse: parseNewFolderPlacement,
};

const noteFontSetting: SettingDefinition<NoteFont> = {
  default: "inter",
  parse: parseNoteFont,
};

export const SETTINGS_SCHEMA = {
  accentColor: accentColorSetting,
  newNotePlacement: newNotePlacementSetting,
  newFolderPlacement: newFolderPlacementSetting,
  noteFont: noteFontSetting,
} as const satisfies SettingsSchema;

export type Settings = SettingsOf<typeof SETTINGS_SCHEMA>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function rawSettingsOf(value: unknown): RawSettings {
  return isPlainObject(value) ? value : {};
}

export function resolveSettings<S extends SettingsSchema>(
  schema: S,
  raw: unknown,
): SettingsOf<S> {
  const rawSettings = rawSettingsOf(raw);
  const resolved: Record<string, unknown> = {};
  for (const key of Object.keys(schema)) {
    const definition = schema[key];
    const parsed = hasOwn(rawSettings, key)
      ? definition.parse(rawSettings[key])
      : undefined;
    resolved[key] = parsed === undefined ? definition.default : parsed;
  }
  return resolved as SettingsOf<S>;
}

export function settingValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => settingValuesEqual(item, b[index]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => hasOwn(b, key) && settingValuesEqual(a[key], b[key]))
    );
  }
  return false;
}

export function changedSettingKeys(
  raw: unknown,
  edits: SettingsEdits,
): string[] {
  const current = rawSettingsOf(raw);
  return Object.keys(edits)
    .filter(
      (key) =>
        !hasOwn(current, key) || !settingValuesEqual(current[key], edits[key]),
    )
    .sort();
}

export function applySettingsEdits(
  raw: unknown,
  edits: SettingsEdits,
): RawSettings {
  const result: Record<string, unknown> = { ...rawSettingsOf(raw) };
  for (const key of changedSettingKeys(raw, edits)) {
    result[key] = edits[key];
  }
  return result;
}
