import type { SettingOption } from "./setting-option";

export type PlacementOption = SettingOption;

export const NEW_NOTE_PLACEMENT_OPTIONS = [
  { id: "beginning", label: "At the beginning" },
  { id: "end", label: "At the end" },
] as const satisfies readonly PlacementOption[];

export const NEW_FOLDER_PLACEMENT_OPTIONS = [
  { id: "beginning", label: "At the beginning" },
  { id: "end", label: "At the end" },
  { id: "afterLastFolder", label: "After the last folder" },
] as const satisfies readonly PlacementOption[];

export type NewNotePlacement = (typeof NEW_NOTE_PLACEMENT_OPTIONS)[number]["id"];
export type NewFolderPlacement =
  (typeof NEW_FOLDER_PLACEMENT_OPTIONS)[number]["id"];

export function parseNewNotePlacement(
  raw: unknown,
): NewNotePlacement | undefined {
  return NEW_NOTE_PLACEMENT_OPTIONS.find((option) => option.id === raw)?.id;
}

export function parseNewFolderPlacement(
  raw: unknown,
): NewFolderPlacement | undefined {
  return NEW_FOLDER_PLACEMENT_OPTIONS.find((option) => option.id === raw)?.id;
}
