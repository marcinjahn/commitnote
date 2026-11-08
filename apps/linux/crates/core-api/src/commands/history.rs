use serde::{Deserialize, Serialize};

empty_shape!(
    HistoryOpenResult,
    HistoryCloseParams,
    HistoryCloseResult,
    HistoryLoadMoreParams,
    HistoryLoadMoreResult,
    HistoryRetryParams,
    HistoryRetryResult,
);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryVersionView {
    pub sha: String,
    pub time: String,
    pub date_time: String,
    pub current: bool,
    pub shared: bool,
    pub events: Vec<String>,
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HistoryRow {
    Single {
        version: HistoryVersionView,
    },
    Session {
        title: String,
        shared: bool,
        versions: Vec<HistoryVersionView>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySection {
    pub title: String,
    pub rows: Vec<HistoryRow>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HistoryPhase {
    Saving,
    Unsaved,
    Ready,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryView {
    pub path: Vec<String>,
    pub phase: HistoryPhase,
    pub message: Option<String>,
    pub sections: Vec<HistorySection>,
    pub loading: bool,
    pub error: Option<String>,
    pub end: Option<String>,
    pub can_load_more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffSegment {
    pub text: String,
    pub changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiffLineView {
    Same { text: String },
    Added { segments: Vec<DiffSegment> },
    Removed { segments: Vec<DiffSegment> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiffItemView {
    Line {
        line: DiffLineView,
    },
    Fold {
        label: String,
        lines: Vec<DiffLineView>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PreviewBody {
    TooLarge {
        message: String,
    },
    Unchanged {
        message: String,
    },
    Diff {
        items: Vec<DiffItemView>,
        final_newline: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RestoreAction {
    pub label: String,
    pub enabled: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum VersionPreview {
    Failed {
        message: String,
    },
    Undecryptable {
        message: String,
    },
    Closed {
        message: String,
    },
    Version {
        title_change: Option<String>,
        body: PreviewBody,
        restore_title: Option<String>,
        restore: RestoreAction,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RestoreVersionOutcome {
    Restored,
    Blocked { message: String },
    Error { message: String },
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryOpenParams {
    pub path: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPreviewParams {
    pub sha: String,
    pub restore_title: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPreviewResult {
    pub preview: VersionPreview,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRestoreParams {
    pub sha: String,
    pub restore_title: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRestoreResult {
    pub outcome: RestoreVersionOutcome,
}

command!(
    HistoryOpen,
    "history.open",
    HistoryOpenParams,
    HistoryOpenResult
);
command!(
    HistoryClose,
    "history.close",
    HistoryCloseParams,
    HistoryCloseResult
);
command!(
    HistoryLoadMore,
    "history.loadMore",
    HistoryLoadMoreParams,
    HistoryLoadMoreResult
);
command!(
    HistoryRetry,
    "history.retry",
    HistoryRetryParams,
    HistoryRetryResult
);
command!(
    HistoryPreview,
    "history.preview",
    HistoryPreviewParams,
    HistoryPreviewResult
);
command!(
    HistoryRestore,
    "history.restore",
    HistoryRestoreParams,
    HistoryRestoreResult
);
