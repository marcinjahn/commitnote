import { ACCENT_PALETTE, type AccentOption } from "../settings/accent-palette";
import { COLOR_MODE_OPTIONS } from "../settings/color-mode";
import { DEVICE_NAME_MAX_LENGTH } from "../settings/device-name";
import { NOTE_FONT_OPTIONS } from "../settings/note-font";
import {
  NEW_FOLDER_PLACEMENT_OPTIONS,
  NEW_NOTE_PLACEMENT_OPTIONS,
} from "../settings/placement-options";
import type { SettingOption } from "../settings/setting-option";
import { IMPORTING_LABEL } from "../ui/import/import-messages";
import {
  ANALYTICS_LABEL,
  describeAnalytics,
} from "../ui/settings/analytics-option";
import {
  DEVICE_NAME_HINT,
  DEVICE_NAME_LABEL,
} from "../ui/settings/device-name-option";
import { REOPEN_LAST_VIEW_LABEL } from "../ui/settings/reopen-last-view-option";
import {
  ACCENT_COLOR_LABEL,
  APPEARANCE_SECTION,
  CHANGE_PASSPHRASE_LABEL,
  COLOR_MODE_LABEL,
  DATA_SECURITY_SECTION,
  EDITOR_SECTION,
  EXPORT_NOTES_LABEL,
  EXPORTING_LABEL,
  IMPORT_NOTES_LABEL,
  NEW_FOLDERS_LABEL,
  NEW_NOTES_LABEL,
  NOTE_FONT_LABEL,
  NOTE_FONT_PREVIEW_BODY,
  NOTE_FONT_PREVIEW_CODE,
  NOTE_FONT_PREVIEW_HEADING,
  NOTES_SECTION,
  SCOPE_DEVICE_LABEL,
  SCOPE_SYNCED_LABEL,
  SETTINGS_EXPORT_FAILED_MESSAGE,
  SETTINGS_INTRO,
  SETTINGS_RETRY_LABEL,
  SETTINGS_TITLE,
  THIS_DEVICE_SECTION,
} from "../ui/settings/settings-messages";
import type { SettingOptionView, SettingsCopy } from "./api";

export const EDITOR_UNAVAILABLE_MESSAGE =
  "Vim mode and the animated caret are not available on iOS. Their settings stay as they are for your other devices.";
export const EXPORT_SHARE_LABEL = "Share";
export const EXPORT_FILES_LABEL = "Save to Files";

function optionViews(
  options: readonly (SettingOption & { readonly description?: string })[],
): SettingOptionView[] {
  return options.map((option) => ({
    id: option.id,
    label: option.label,
    description: option.description ?? null,
  }));
}

export function buildSettingsCopy(): SettingsCopy {
  return {
    title: SETTINGS_TITLE,
    intro: SETTINGS_INTRO,
    sections: {
      appearance: APPEARANCE_SECTION,
      editor: EDITOR_SECTION,
      notes: NOTES_SECTION,
      thisDevice: THIS_DEVICE_SECTION,
      dataSecurity: DATA_SECURITY_SECTION,
    },
    scopeLabels: { synced: SCOPE_SYNCED_LABEL, device: SCOPE_DEVICE_LABEL },
    colorMode: {
      label: COLOR_MODE_LABEL,
      options: optionViews(COLOR_MODE_OPTIONS),
    },
    accentColor: {
      label: ACCENT_COLOR_LABEL,
      options: (ACCENT_PALETTE as readonly AccentOption[]).map((option) => ({
        id: option.id,
        label: option.label,
        light: option.light ?? null,
        dark: option.dark ?? null,
      })),
    },
    noteFont: {
      label: NOTE_FONT_LABEL,
      options: optionViews(NOTE_FONT_OPTIONS),
      previewHeading: NOTE_FONT_PREVIEW_HEADING,
      previewBody: NOTE_FONT_PREVIEW_BODY,
      previewCode: NOTE_FONT_PREVIEW_CODE,
    },
    editorUnavailable: EDITOR_UNAVAILABLE_MESSAGE,
    newNotePlacement: {
      label: NEW_NOTES_LABEL,
      options: optionViews(NEW_NOTE_PLACEMENT_OPTIONS),
    },
    newFolderPlacement: {
      label: NEW_FOLDERS_LABEL,
      options: optionViews(NEW_FOLDER_PLACEMENT_OPTIONS),
    },
    deviceName: {
      label: DEVICE_NAME_LABEL,
      hint: DEVICE_NAME_HINT,
      maxLength: DEVICE_NAME_MAX_LENGTH,
    },
    reopenLastView: { label: REOPEN_LAST_VIEW_LABEL },
    analytics: { label: ANALYTICS_LABEL, hint: describeAnalytics(false) },
    data: {
      exportLabel: EXPORT_NOTES_LABEL,
      exportingLabel: EXPORTING_LABEL,
      exportShareLabel: EXPORT_SHARE_LABEL,
      exportFilesLabel: EXPORT_FILES_LABEL,
      exportFailed: SETTINGS_EXPORT_FAILED_MESSAGE,
      importLabel: IMPORT_NOTES_LABEL,
      importingLabel: IMPORTING_LABEL,
      changePassphraseLabel: CHANGE_PASSPHRASE_LABEL,
    },
    retryLabel: SETTINGS_RETRY_LABEL,
  };
}
