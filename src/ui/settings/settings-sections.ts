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

export interface SettingsSection {
  readonly id: string;
  readonly title: string;
  readonly scopeKey?: SwitchableSettingKey;
  readonly scopeLabel?: string;
  readonly component: Component<SettingsSectionProps>;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "color-mode",
    title: "Color mode",
    scopeKey: "colorMode",
    scopeLabel: "Color mode",
    component: ColorModeSection,
  },
  {
    id: "accent-color",
    title: "Accent color",
    scopeKey: "accentColor",
    scopeLabel: "Accent color",
    component: AccentColorSection,
  },
  {
    id: "note-font",
    title: "Note font",
    scopeKey: "noteFont",
    scopeLabel: "Note font",
    component: NoteFontSection,
  },
  { id: "caret", title: "Caret", component: AnimatedCaretSection },
  { id: "vim-mode", title: "Vim mode", component: VimModeSection },
  {
    id: "new-note-placement",
    title: "New notes",
    component: NewNotePlacementSection,
  },
  {
    id: "new-folder-placement",
    title: "New folders",
    component: NewFolderPlacementSection,
  },
];
