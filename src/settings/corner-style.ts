import { parseOptionId, type SettingOption } from "./setting-option";

export const CORNER_STYLE_OPTIONS = [
  { id: "rounded", label: "Rounded" },
  { id: "square", label: "Square" },
] as const satisfies readonly SettingOption[];

export type CornerStyle = (typeof CORNER_STYLE_OPTIONS)[number]["id"];

export function parseCornerStyle(raw: unknown): CornerStyle | undefined {
  return parseOptionId(CORNER_STYLE_OPTIONS, raw);
}
