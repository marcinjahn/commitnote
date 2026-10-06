import { parseOptionId, type SettingOption } from "./setting-option";

export const COLOR_MODE_OPTIONS = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const satisfies readonly SettingOption[];

export type ColorModeId = (typeof COLOR_MODE_OPTIONS)[number]["id"];

export type ColorScheme = "light" | "dark";

export function parseColorMode(raw: unknown): ColorModeId | undefined {
  return parseOptionId(COLOR_MODE_OPTIONS, raw);
}

export function colorScheme(
  mode: ColorModeId,
  osPrefersDark: boolean,
): ColorScheme {
  if (mode === "system") return osPrefersDark ? "dark" : "light";
  return mode;
}

export const COLOR_SCHEME_BACKGROUNDS: Readonly<Record<ColorScheme, string>> = {
  light: "#fafafa",
  dark: "#0b0b0b",
};
