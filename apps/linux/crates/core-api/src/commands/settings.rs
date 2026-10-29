use serde::{Deserialize, Serialize};

use crate::settings::{SettingKeyView, SettingsCopy, SettingsSaveView, SettingsView};

empty_shape!(SettingsOpenParams, SettingsChangeResult);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsOpenResult {
    pub copy: SettingsCopy,
    pub view: SettingsView,
    pub save: SettingsSaveView,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsChangeParams {
    pub key: SettingKeyView,
    pub value: String,
}

command!(
    SettingsOpen,
    "settings.open",
    SettingsOpenParams,
    SettingsOpenResult
);
command!(
    SettingsChange,
    "settings.change",
    SettingsChangeParams,
    SettingsChangeResult
);
