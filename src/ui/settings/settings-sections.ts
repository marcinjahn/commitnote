import type { Component } from "svelte";
import type { Settings } from "../../settings/settings";

export interface SettingsSectionProps {
  readonly settings: Settings;
  readonly changeSettings: (edits: Partial<Settings>) => void;
}

export interface SettingsSection {
  readonly id: string;
  readonly title: string;
  readonly component: Component<SettingsSectionProps>;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [];
