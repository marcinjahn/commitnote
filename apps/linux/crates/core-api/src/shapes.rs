use serde::{Deserialize, Serialize};

use crate::error::CoreError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColorTag {
    Red,
    Orange,
    Yellow,
    Green,
    Blue,
    Purple,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ForgeKind {
    Github,
    Gitlab,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TreeNode {
    Folder {
        name: String,
        path: Vec<String>,
        note_count: u32,
        children: Vec<TreeNode>,
    },
    Note {
        name: String,
        path: Vec<String>,
        color_tag: Option<ColorTag>,
        shared: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum OpenNote {
    Loading {
        path: Vec<String>,
    },
    Loaded {
        path: Vec<String>,
        content: String,
        conflict: Option<serde_json::Value>,
        color_tag: Option<ColorTag>,
        shared: bool,
    },
    Missing {
        path: Vec<String>,
        message: String,
    },
    Trashed {
        path: Vec<String>,
        message: String,
    },
    Failed {
        path: Vec<String>,
        message: String,
        error: CoreError,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryView {
    pub label: String,
    pub url: String,
    pub private: bool,
    pub public_warning: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryListing {
    pub url: String,
    pub label: String,
    pub private: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeView {
    pub id: ForgeKind,
    pub name: String,
    pub access_token_hint: String,
    pub access_token_creation_url: String,
    pub repository_creation_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LoggedIn {
    LoggedIn,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LogoutOutcome {
    LoggedOut,
    Unsaved { count: u32, message: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassphraseStrength {
    pub score: u8,
    pub label: String,
    pub filled_segments: u8,
    pub weak: bool,
    pub warning: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LoadingStep {
    ListingRepositories,
    CheckingRepository,
    DerivingKeys,
    Initializing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OutOfSyncReason {
    Pending,
    Failed,
    Conflict,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum SyncState {
    #[serde(rename = "synced")]
    Synced,
    #[serde(rename = "syncing")]
    Syncing,
    #[serde(rename = "out-of-sync")]
    OutOfSync { reason: OutOfSyncReason },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusMenuItem {
    pub id: String,
    pub label: String,
    pub path: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagOptionView {
    pub tag: ColorTag,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTextEdit {
    pub from: u32,
    pub to: u32,
    pub insert: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NoticeTone {
    Info,
    Warning,
    Error,
    Success,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NoticeAction {
    OpenNote { label: String, path: Vec<String> },
    Undo { label: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionEndReason {
    LoggedOut,
}
