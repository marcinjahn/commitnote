use serde::{Deserialize, Serialize};

use crate::settings::{
    ScopedSettingKey, SettingKeyView, SettingScope, SettingsCopy, SettingsSaveView, SettingsView,
};

empty_shape!(
    SettingsOpenParams,
    SettingsChangeResult,
    SettingsSetScopeResult,
    SettingsRetryParams,
    SettingsRetryResult,
    SettingsFlushParams,
    SettingsFlushResult,
);

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSetScopeParams {
    pub key: ScopedSettingKey,
    pub scope: SettingScope,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSetNameParams {
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSetNameResult {
    pub name: String,
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
command!(
    SettingsSetScope,
    "settings.setScope",
    SettingsSetScopeParams,
    SettingsSetScopeResult
);
command!(
    SettingsRetry,
    "settings.retry",
    SettingsRetryParams,
    SettingsRetryResult
);
command!(
    SettingsFlush,
    "settings.flush",
    SettingsFlushParams,
    SettingsFlushResult
);
command!(
    DeviceSetName,
    "device.setName",
    DeviceSetNameParams,
    DeviceSetNameResult
);
