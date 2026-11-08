use serde::{Deserialize, Serialize};

use crate::shapes::ColorTag;

empty_shape!(
    TrashDeleteResult,
    TrashEmptyParams,
    TrashEmptyResult,
    TagsSetFilterResult,
);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StructureOutcome {
    Ok { path: Vec<String> },
    Error { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FolderCreateOutcome {
    Created { path: Vec<String> },
    Error { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MoveSiblingOutcome {
    Ok { path: Vec<String> },
    Error { message: String },
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MoveDirection {
    Up,
    Down,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveTargetView {
    pub path: Vec<String>,
    pub label: String,
    pub depth: u32,
    pub disabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashPreview {
    pub title: String,
    pub message: String,
    pub confirm_label: String,
    pub item_count: u32,
    pub share_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TrashOutcome {
    Trashed { entry_id: String },
    Deleted,
    Confirm { preview: TrashPreview },
    Error { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCreateParams {
    pub parent: Vec<String>,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCreateResult {
    pub outcome: FolderCreateOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureResult {
    pub outcome: StructureOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeRenameParams {
    pub path: Vec<String>,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeMoveParams {
    pub path: Vec<String>,
    pub parent: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePlaceParams {
    pub path: Vec<String>,
    pub parent: Vec<String>,
    pub before: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeMoveSiblingParams {
    pub path: Vec<String>,
    pub direction: MoveDirection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeMoveSiblingResult {
    pub outcome: MoveSiblingOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePathParams {
    pub path: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveTargetsResult {
    pub targets: Vec<MoveTargetView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeTrashPreviewResult {
    pub preview: TrashPreview,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeTrashParams {
    pub path: Vec<String>,
    pub share_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeTrashResult {
    pub outcome: TrashOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeSetColorTagParams {
    pub path: Vec<String>,
    pub tag: Option<ColorTag>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashRestoreTargetsParams {
    pub entry_id: String,
    pub sub_path: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashRestoreParams {
    pub entry_id: String,
    pub sub_path: Vec<String>,
    pub parent: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashDeleteParams {
    pub entry_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagsSetFilterParams {
    pub tag: Option<ColorTag>,
}

command!(
    FolderCreate,
    "folder.create",
    FolderCreateParams,
    FolderCreateResult
);
command!(NodeRename, "node.rename", NodeRenameParams, StructureResult);
command!(NodeMove, "node.move", NodeMoveParams, StructureResult);
command!(NodePlace, "node.place", NodePlaceParams, StructureResult);
command!(
    NodeMoveSibling,
    "node.moveSibling",
    NodeMoveSiblingParams,
    NodeMoveSiblingResult
);
command!(
    NodeMoveTargets,
    "node.moveTargets",
    NodePathParams,
    MoveTargetsResult
);
command!(
    NodeTrashPreview,
    "node.trashPreview",
    NodePathParams,
    NodeTrashPreviewResult
);
command!(NodeTrash, "node.trash", NodeTrashParams, NodeTrashResult);
command!(
    NodeSetColorTag,
    "node.setColorTag",
    NodeSetColorTagParams,
    StructureResult
);
command!(
    TrashRestoreTargets,
    "trash.restoreTargets",
    TrashRestoreTargetsParams,
    MoveTargetsResult
);
command!(
    TrashRestore,
    "trash.restore",
    TrashRestoreParams,
    StructureResult
);
command!(
    TrashDelete,
    "trash.delete",
    TrashDeleteParams,
    TrashDeleteResult
);
command!(
    TrashEmpty,
    "trash.empty",
    TrashEmptyParams,
    TrashEmptyResult
);
command!(
    TagsSetFilter,
    "tags.setFilter",
    TagsSetFilterParams,
    TagsSetFilterResult
);
