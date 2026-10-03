export interface AccentOption {
  readonly id: string;
  readonly label: string;
  readonly light?: string;
  readonly dark?: string;
  readonly neutral?: boolean;
}

export const ACCENT_PALETTE = [
  { id: "system", label: "System" },
  { id: "blue", label: "Blue", light: "#3358d4", dark: "#86a4ff" },
  { id: "violet", label: "Violet", light: "#8a46b8", dark: "#d59cff" },
  { id: "pink", label: "Pink", light: "#c4277d", dark: "#ff90c0" },
  { id: "red", label: "Red", light: "#ce2c31", dark: "#ff9592" },
  { id: "orange", label: "Orange", light: "#cc4e00", dark: "#ffa057" },
  { id: "amber", label: "Amber", light: "#9a6700", dark: "#ffc53d" },
  { id: "green", label: "Green", light: "#218358", dark: "#3dd68c" },
  { id: "teal", label: "Teal", light: "#008573", dark: "#0bd8b6" },
  {
    id: "slate",
    label: "Slate",
    light: "#5e6c7d",
    dark: "#a5b3c4",
    neutral: true,
  },
] as const satisfies readonly AccentOption[];

export type AccentColorId = (typeof ACCENT_PALETTE)[number]["id"];

const OPTIONS_BY_ID = Object.fromEntries(
  ACCENT_PALETTE.map((option) => [option.id, option]),
) as Record<AccentColorId, AccentOption>;

export function accentOption(id: AccentColorId): AccentOption {
  return OPTIONS_BY_ID[id];
}

export function parseAccentColor(raw: unknown): AccentColorId | undefined {
  return ACCENT_PALETTE.find((option) => option.id === raw)?.id;
}

export interface AccentCustomProperties {
  readonly "--accent-light": string | null;
  readonly "--accent-dark": string | null;
}

export function accentCustomProperties(
  id: AccentColorId,
): AccentCustomProperties {
  const option: AccentOption | undefined = ACCENT_PALETTE.find(
    (candidate) => candidate.id === id,
  );
  return {
    "--accent-light": option?.light ?? null,
    "--accent-dark": option?.dark ?? null,
  };
}
