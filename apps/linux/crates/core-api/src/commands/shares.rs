use serde::{Deserialize, Serialize};

use crate::secret::Secret;

empty_shape!(ShareUpdateResult, ShareRevokeResult);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ShareActionId {
    CopyLink,
    CopyPassword,
    Update,
    View,
    Open,
    Rename,
    Revoke,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShareActionView {
    pub id: ShareActionId,
    pub label: String,
    pub disabled: bool,
    pub destructive: bool,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRowView {
    pub id: String,
    pub title: String,
    pub label: Option<String>,
    pub date: String,
    pub password_protected: bool,
    pub link: String,
    pub password: Option<Secret>,
    pub note_path: Option<Vec<String>>,
    pub menu_label: String,
    pub actions: Vec<ShareActionView>,
}

impl std::fmt::Debug for ShareRowView {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ShareRowView")
            .field("id", &self.id)
            .field("password_protected", &self.password_protected)
            .field("password", &self.password)
            .field("link", &"<redacted>")
            .field("actions", &self.actions)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRevokeCopy {
    pub title: String,
    pub message: String,
    pub confirm_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRenameCopy {
    pub title: String,
    pub field_label: String,
    pub confirm_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareCopy {
    pub explanation: String,
    pub label_field: String,
    pub password_field: String,
    pub password_hint: String,
    pub create: String,
    pub creating: String,
    pub create_another: String,
    pub share_link: String,
    pub share_password: String,
    pub shared_links_title: String,
    pub shared_links_empty: String,
    pub password_protected: String,
    pub updating: String,
    pub link_copied: String,
    pub password_copied: String,
    pub revoke: ShareRevokeCopy,
    pub rename: ShareRenameCopy,
    pub shared_version_title: String,
    pub loading_shared_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MessagePart {
    Text { text: String },
    Link { text: String, href: String },
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ShareCreateOutcome {
    Created {
        link: String,
        password: Option<Secret>,
    },
    Error {
        parts: Vec<MessagePart>,
    },
}

impl std::fmt::Debug for ShareCreateOutcome {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Created { password, .. } => f
                .debug_struct("Created")
                .field("link", &"<redacted>")
                .field("password", password)
                .finish(),
            Self::Error { parts } => f.debug_struct("Error").field("parts", parts).finish(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ShareRenameOutcome {
    Ok,
    Error { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SharedVersionOutcome {
    Readable {
        name: Option<String>,
        content: String,
        date: String,
    },
    Message {
        message: String,
    },
    Failed {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareFormParams {
    pub path: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareFormResult {
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareCreateParams {
    pub path: Vec<String>,
    pub password: Secret,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareCreateResult {
    pub outcome: ShareCreateOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareUpdateParams {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRenameParams {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRenameResult {
    pub outcome: ShareRenameOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRevokeParams {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSharedVersionParams {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSharedVersionResult {
    pub outcome: SharedVersionOutcome,
}

command!(ShareForm, "share.form", ShareFormParams, ShareFormResult);
command!(
    ShareCreate,
    "share.create",
    ShareCreateParams,
    ShareCreateResult
);
command!(
    ShareUpdate,
    "share.update",
    ShareUpdateParams,
    ShareUpdateResult
);
command!(
    ShareRename,
    "share.rename",
    ShareRenameParams,
    ShareRenameResult
);
command!(
    ShareRevoke,
    "share.revoke",
    ShareRevokeParams,
    ShareRevokeResult
);
command!(
    ShareSharedVersion,
    "share.sharedVersion",
    ShareSharedVersionParams,
    ShareSharedVersionResult
);
