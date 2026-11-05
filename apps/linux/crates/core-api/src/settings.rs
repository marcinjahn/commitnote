use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingScope {
    Synced,
    Device,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingKeyView {
    ColorMode,
    AccentColor,
    NoteFont,
    NewNotePlacement,
    NewFolderPlacement,
    TypeToStart,
    VimMode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingOptionView {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccentOptionView {
    pub id: String,
    pub label: String,
    pub light: Option<String>,
    pub dark: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingChoiceCopy {
    pub label: String,
    pub options: Vec<SettingOptionView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSections {
    pub appearance: String,
    pub editor: String,
    pub notes: String,
    pub this_device: String,
    pub data_security: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeLabels {
    pub synced: String,
    pub device: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccentColorCopy {
    pub label: String,
    pub options: Vec<AccentOptionView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFontCopy {
    pub label: String,
    pub options: Vec<SettingOptionView>,
    pub preview_heading: String,
    pub preview_body: String,
    pub preview_code: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelHint {
    pub label: String,
    pub hint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceNameCopy {
    pub label: String,
    pub hint: String,
    pub max_length: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelOnly {
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataCopy {
    pub export_label: String,
    pub exporting_label: String,
    pub export_share_label: String,
    pub export_files_label: String,
    pub export_failed: String,
    pub import_label: String,
    pub importing_label: String,
    pub change_passphrase_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsCopy {
    pub title: String,
    pub intro: String,
    pub sections: SettingsSections,
    pub scope_labels: ScopeLabels,
    pub color_mode: SettingChoiceCopy,
    pub accent_color: AccentColorCopy,
    pub note_font: NoteFontCopy,
    pub editor_unavailable: String,
    pub type_to_start: LabelHint,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vim_mode: Option<LabelHint>,
    pub new_note_placement: SettingChoiceCopy,
    pub new_folder_placement: SettingChoiceCopy,
    pub device_name: DeviceNameCopy,
    pub reopen_last_view: LabelOnly,
    pub analytics: LabelHint,
    pub data: DataCopy,
    pub retry_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsValues {
    pub color_mode: String,
    pub accent_color: String,
    pub note_font: String,
    pub new_note_placement: String,
    pub new_folder_placement: String,
    pub type_to_start: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vim_mode: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsScopes {
    pub color_mode: SettingScope,
    pub accent_color: SettingScope,
    pub note_font: SettingScope,
    pub type_to_start: SettingScope,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub values: SettingsValues,
    pub scopes: SettingsScopes,
    pub device_name: String,
    pub automatic_device_name: String,
    pub reopen_last_view: bool,
    pub analytics_counted: bool,
    pub can_export: bool,
    pub can_import: bool,
    pub can_change_passphrase: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingsSaveState {
    Synced,
    Syncing,
    Pending,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSaveView {
    pub state: SettingsSaveState,
    pub label: String,
    pub detail: String,
    pub can_retry: bool,
}
