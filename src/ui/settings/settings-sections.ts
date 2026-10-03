import type { Component } from "svelte";
import type { Settings } from "../../settings/settings";
import AccentColorSection from "./AccentColorSection.svelte";
import NewFolderPlacementSection from "./NewFolderPlacementSection.svelte";
import NewNotePlacementSection from "./NewNotePlacementSection.svelte";

export interface SettingsSectionProps {
  readonly settings: Settings;
  readonly changeSettings: (edits: Partial<Settings>) => void;
}

export interface SettingsSection {
  readonly id: string;
  readonly title: string;
  readonly component: Component<SettingsSectionProps>;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "accent-color", title: "Accent color", component: AccentColorSection },
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
