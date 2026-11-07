use serde::{Deserialize, Serialize};

empty_shape!(
    NoteEditResult,
    SyncFlushParams,
    SyncRetryParams,
    SyncRetryResult,
    ConflictResolveResult,
    DraftLeaveParams,
    DraftLeaveResult,
);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteEditParams {
    pub path: Vec<String>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FlushOutcome {
    Saved,
    Unsaved { count: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFlushResult {
    pub result: FlushOutcome,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictResolution {
    KeepMine,
    KeepTheirs,
    EditMerged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictResolveParams {
    pub path: Vec<String>,
    pub resolution: ConflictResolution,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDraft {
    pub parent: Vec<String>,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum NoteDraftOutcome {
    None,
    Error {
        message: String,
    },
    Created {
        path: Vec<String>,
        field_error: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftStartParams {
    pub parent: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftStartResult {
    pub draft: NoteDraft,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftCommitNameParams {
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftOutcomeResult {
    pub outcome: NoteDraftOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftContentParams {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum NameCommitOutcome {
    None,
    Restore,
    Error { message: String },
    Ok { path: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRenameParams {
    pub path: Vec<String>,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRenameResult {
    pub outcome: NameCommitOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum EarlyDraftOutcome {
    None,
    Draft {
        name: String,
        error: Option<String>,
    },
    Created {
        path: Vec<String>,
        field_error: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EarlyDraftHandOffParams {
    pub name: String,
    pub body: String,
    pub name_confirmed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EarlyDraftHandOffResult {
    pub outcome: EarlyDraftOutcome,
}

command!(NoteEdit, "note.edit", NoteEditParams, NoteEditResult);
command!(SyncFlush, "sync.flush", SyncFlushParams, SyncFlushResult);
command!(SyncRetry, "sync.retry", SyncRetryParams, SyncRetryResult);
command!(
    ConflictResolve,
    "conflict.resolve",
    ConflictResolveParams,
    ConflictResolveResult
);
command!(
    DraftStart,
    "draft.start",
    DraftStartParams,
    DraftStartResult
);
command!(
    DraftCommitName,
    "draft.commitName",
    DraftCommitNameParams,
    DraftOutcomeResult
);
command!(
    DraftContent,
    "draft.content",
    DraftContentParams,
    DraftOutcomeResult
);
command!(
    DraftLeave,
    "draft.leave",
    DraftLeaveParams,
    DraftLeaveResult
);
command!(
    NoteRename,
    "note.rename",
    NoteRenameParams,
    NoteRenameResult
);
command!(
    EarlyDraftHandOff,
    "earlyDraft.handOff",
    EarlyDraftHandOffParams,
    EarlyDraftHandOffResult
);
