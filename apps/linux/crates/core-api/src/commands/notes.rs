use serde::{Deserialize, Serialize};

use crate::shapes::{OpenNote, TreeNode};

empty_shape!(TreeGetParams, SyncRefreshParams, SyncRefreshResult);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeGetResult {
    pub tree: Option<Vec<TreeNode>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteOpenParams {
    pub path: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteOpenResult {
    pub note: Option<OpenNote>,
}

command!(TreeGet, "tree.get", TreeGetParams, TreeGetResult);
command!(NoteOpen, "note.open", NoteOpenParams, NoteOpenResult);
command!(
    SyncRefresh,
    "sync.refresh",
    SyncRefreshParams,
    SyncRefreshResult
);
