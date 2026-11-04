use serde::{Deserialize, Serialize};

use crate::shapes::LastViewState;

empty_shape!(
    LastViewLoadParams,
    LastViewSaveResult,
    LastViewSetEnabledResult
);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailItemText {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteStatsParams {
    pub path: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteStatsResult {
    pub words: DetailItemText,
    pub tasks: Option<DetailItemText>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDatesParams {
    pub path: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDatesResult {
    pub not_saved: bool,
    pub created: Option<DetailItemText>,
    pub updated: Option<DetailItemText>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastViewLoadResult {
    pub view: Option<LastViewState>,
}

pub type LastViewSaveParams = LastViewState;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastViewSetEnabledParams {
    pub enabled: bool,
    pub view: LastViewState,
}

command!(NoteStats, "note.stats", NoteStatsParams, NoteStatsResult);
command!(NoteDates, "note.dates", NoteDatesParams, NoteDatesResult);
command!(
    LastViewLoad,
    "lastView.load",
    LastViewLoadParams,
    LastViewLoadResult
);
command!(
    LastViewSave,
    "lastView.save",
    LastViewSaveParams,
    LastViewSaveResult
);
command!(
    LastViewSetEnabled,
    "lastView.setEnabled",
    LastViewSetEnabledParams,
    LastViewSetEnabledResult
);
