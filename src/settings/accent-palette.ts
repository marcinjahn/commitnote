export interface AccentOption {
  readonly id: string;
  readonly label: string;
  readonly light?: string;
  readonly dark?: string;
}

export const ACCENT_PALETTE = [
  { id: "system", label: "System" },
  { id: "blue", label: "Blue", light: "#3358d4", dark: "#86a4ff" },
  { id: "violet", label: "Violet", light: "#6550b9", dark: "#baa7ff" },
  { id: "pink", label: "Pink", light: "#c2298a", dark: "#ff8dcc" },
  { id: "red", label: "Red", light: "#ce2c31", dark: "#ff9592" },
  { id: "orange", label: "Orange", light: "#cc4e00", dark: "#ffa057" },
  { id: "green", label: "Green", light: "#218358", dark: "#3dd68c" },
  { id: "teal", label: "Teal", light: "#008573", dark: "#0bd8b6" },
] as const satisfies readonly AccentOption[];

export type AccentColorId = (typeof ACCENT_PALETTE)[number]["id"];

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
