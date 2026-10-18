import type { Component } from "svelte";
import type { Settings } from "../../settings/settings";
import type {
  SettingScope,
  SettingScopes,
  SwitchableSettingKey,
} from "../../settings/setting-scope";
import ColorModeSection from "./ColorModeSection.svelte";
import AccentColorSection from "./AccentColorSection.svelte";
import NoteFontSection from "./NoteFontSection.svelte";
import AnimatedCaretSection from "./AnimatedCaretSection.svelte";
import VimModeSection from "./VimModeSection.svelte";
import NewFolderPlacementSection from "./NewFolderPlacementSection.svelte";
import TypeToStartSection from "./TypeToStartSection.svelte";
import NewNotePlacementSection from "./NewNotePlacementSection.svelte";

export interface SettingsSectionProps {
  readonly settings: Settings;
  readonly changeSettings: (edits: Partial<Settings>) => void;
  readonly scopes: SettingScopes;
  readonly changeSettingScope: (
    key: SwitchableSettingKey,
    scope: SettingScope,
  ) => void;
}

export interface SettingsGroup {
  readonly id: string;
  readonly title: string;
  readonly components: readonly Component<SettingsSectionProps>[];
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: "appearance",
    title: "Appearance",
    components: [ColorModeSection, AccentColorSection, NoteFontSection],
  },
  {
    id: "editor",
    title: "Editor",
    components: [AnimatedCaretSection, VimModeSection, TypeToStartSection],
  },
  {
    id: "notes",
    title: "Notes",
    components: [NewNotePlacementSection, NewFolderPlacementSection],
  },
];
