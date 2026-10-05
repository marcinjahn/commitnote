import { accentOption, type AccentColorId } from "../settings/accent-palette";

export type ColorTag = "red" | "orange" | "yellow" | "green" | "blue" | "purple";

export interface ColorTagOption {
  readonly id: ColorTag;
  readonly label: string;
  readonly light: string;
  readonly dark: string;
}

const TAG_DEFINITIONS: readonly {
  id: ColorTag;
  label: string;
  accent: AccentColorId;
}[] = [
  { id: "red", label: "Red", accent: "red" },
  { id: "orange", label: "Orange", accent: "orange" },
  { id: "yellow", label: "Yellow", accent: "amber" },
  { id: "green", label: "Green", accent: "green" },
  { id: "blue", label: "Blue", accent: "blue" },
  { id: "purple", label: "Purple", accent: "violet" },
];

export const COLOR_TAG_PALETTE: readonly ColorTagOption[] = TAG_DEFINITIONS.map(
  ({ id, label, accent }) => {
    const { light, dark } = accentOption(accent);
    return { id, label, light: light as string, dark: dark as string };
  },
);

export function colorTagOption(id: ColorTag): ColorTagOption {
  return COLOR_TAG_PALETTE.find((option) => option.id === id) as ColorTagOption;
}

export function parseColorTag(raw: unknown): ColorTag | null {
  return COLOR_TAG_PALETTE.find((option) => option.id === raw)?.id ?? null;
}

export function colorTagStyle(id: ColorTag): string {
  const { light, dark } = colorTagOption(id);
  return `--tag-light: ${light}; --tag-dark: ${dark}`;
}
