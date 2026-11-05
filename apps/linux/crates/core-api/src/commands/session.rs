use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::shapes::LogoutOutcome;

empty_shape!(SessionResumeParams);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SessionResumeResult {
    None,
    Resumed,
    Failed { error: CoreError, can_retry: bool },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLogoutParams {
    pub anyway: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLogoutResult {
    pub outcome: LogoutOutcome,
}

command!(
    SessionResume,
    "session.resume",
    SessionResumeParams,
    SessionResumeResult
);
command!(
    SessionLogout,
    "session.logout",
    SessionLogoutParams,
    SessionLogoutResult
);
