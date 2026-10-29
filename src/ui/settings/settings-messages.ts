export function describeSystemAccent(input: {
  label: string;
  fromOs: boolean;
  standalone: boolean;
}): string {
  if (input.fromOs) {
    return `${input.label}, closest to your OS accent color`;
  }
  return input.standalone
    ? `${input.label}, because the OS accent color isn't available here`
    : `${input.label}, because the browser doesn't share your OS accent color`;
}

export function animatedCaretHint(standalone: boolean): string {
  const caret = standalone ? "the standard caret" : "the browser’s standard caret";
  return `A thicker accent caret that blinks softly and tints the letters just before it. Turn it off for ${caret}.`;
}

export const SETTINGS_TITLE = "Settings";
export const SETTINGS_INTRO =
  "Settings apply to all your devices unless marked This device.";
export const APPEARANCE_SECTION = "Appearance";
export const EDITOR_SECTION = "Editor";
export const NOTES_SECTION = "Notes";
export const THIS_DEVICE_SECTION = "This device";
export const DATA_SECURITY_SECTION = "Data & security";

export const SCOPE_SYNCED_LABEL = "All devices";
export const SCOPE_DEVICE_LABEL = "This device";

export function scopeToggleLabel(label: string): string {
  return `${label} only on this device`;
}

export const COLOR_MODE_LABEL = "Color mode";
export const ACCENT_COLOR_LABEL = "Accent color";
export const NOTE_FONT_LABEL = "Note font";
export const TYPE_TO_START_LABEL = "Start a note by typing";
export const TYPE_TO_START_HINT =
  "When no note is open, start typing to begin a new note.";
export const VIM_MODE_LABEL = "Vim mode";
export const VIM_MODE_HINT =
  "Edit notes with Vim keys: Normal, Insert and Visual modes.";
export const NEW_NOTES_LABEL = "New notes";
export const NEW_FOLDERS_LABEL = "New folders";
export const SETTINGS_RETRY_LABEL = "Retry";

export const NOTE_FONT_PREVIEW_HEADING = "Weekly notes";
export const NOTE_FONT_PREVIEW_BODY = "A **clear** list keeps a week _calm_.";
export const NOTE_FONT_PREVIEW_CODE = "Run `cargo clippy` before you push.";

export const EXPORT_NOTES_LABEL = "Export notes";
export const EXPORTING_LABEL = "Exporting…";
export const IMPORT_NOTES_LABEL = "Import notes";
export const CHANGE_PASSPHRASE_LABEL = "Change passphrase";
export const SETTINGS_EXPORT_FAILED_MESSAGE = "Export failed. Try again later.";
