import type { SettingOption } from "./setting-option";

export interface NoteFontOption extends SettingOption {
  readonly family: string;
}

export const NOTE_FONT_OPTIONS = [
  { id: "inter", label: "Inter", family: "var(--font-sans)" },
  {
    id: "system",
    label: "System",
    family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  {
    id: "serif",
    label: "Serif",
    family:
      'ui-serif, Charter, "Bitstream Charter", "Iowan Old Style", Georgia, Cambria, "Noto Serif", "Times New Roman", serif',
  },
  { id: "mono", label: "Monospace", family: "var(--font-mono)" },
] as const satisfies readonly NoteFontOption[];

export type NoteFont = (typeof NOTE_FONT_OPTIONS)[number]["id"];

export function parseNoteFont(raw: unknown): NoteFont | undefined {
  return NOTE_FONT_OPTIONS.find((option) => option.id === raw)?.id;
}

export function noteFontFamily(id: NoteFont): string {
  const option: NoteFontOption | undefined = NOTE_FONT_OPTIONS.find(
    (candidate) => candidate.id === id,
  );
  return option?.family ?? NOTE_FONT_OPTIONS[0].family;
}
