import { parseOptionId, type SettingOption } from "./setting-option";

export interface NoteFontOption extends SettingOption {
  readonly description: string;
  readonly family: string;
}

const SYSTEM_UI_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF_STACK =
  'ui-serif, Charter, "Bitstream Charter", "Iowan Old Style", Georgia, Cambria, "Noto Serif", "Times New Roman", serif';

export const NOTE_FONT_OPTIONS = [
  {
    id: "inter",
    label: "Inter",
    description: "The app's font",
    family: "var(--font-sans)",
  },
  {
    id: "system",
    label: "System UI",
    description:
      "Your device's interface font, like San Francisco, Segoe UI or Roboto",
    family: SYSTEM_UI_STACK,
  },
  {
    id: "ibm-plex-sans",
    label: "IBM Plex Sans",
    description: "Technical sans-serif",
    family: `"IBM Plex Sans Variable", ${SYSTEM_UI_STACK}`,
  },
  {
    id: "atkinson-hyperlegible",
    label: "Atkinson Hyperlegible Next",
    description: "Sans-serif designed for legibility",
    family: `"Atkinson Hyperlegible Next Variable", ${SYSTEM_UI_STACK}`,
  },
  {
    id: "nunito",
    label: "Nunito",
    description: "Rounded sans-serif",
    family: `"Nunito Variable", ${SYSTEM_UI_STACK}`,
  },
  {
    id: "ia-writer-quattro",
    label: "iA Writer Quattro",
    description: "Writing font, nearly monospaced",
    family: `"iA Writer Quattro", ${SYSTEM_UI_STACK}`,
  },
  {
    id: "literata",
    label: "Literata",
    description: "Serif made for long reading",
    family: `"Literata Variable", ${SERIF_STACK}`,
  },
  {
    id: "source-serif",
    label: "Source Serif 4",
    description: "Classic text serif",
    family: `"Source Serif 4 Variable", ${SERIF_STACK}`,
  },
  {
    id: "lora",
    label: "Lora",
    description: "Calligraphic serif",
    family: `"Lora Variable", ${SERIF_STACK}`,
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    description: "Monospace for code and plain text",
    family: '"JetBrains Mono Variable", var(--font-mono)',
  },
  {
    id: "ibm-plex-mono",
    label: "IBM Plex Mono",
    description: "Typewriter-like monospace",
    family: '"IBM Plex Mono", var(--font-mono)',
  },
] as const satisfies readonly NoteFontOption[];

export type NoteFont = (typeof NOTE_FONT_OPTIONS)[number]["id"];

export function parseNoteFont(raw: unknown): NoteFont | undefined {
  return parseOptionId(NOTE_FONT_OPTIONS, raw);
}

export function noteFontFamily(id: NoteFont): string {
  const option: NoteFontOption | undefined = NOTE_FONT_OPTIONS.find(
    (candidate) => candidate.id === id,
  );
  return option?.family ?? NOTE_FONT_OPTIONS[0].family;
}
