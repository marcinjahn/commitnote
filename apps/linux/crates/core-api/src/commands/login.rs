use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::secret::Secret;
use crate::shapes::{
    ForgeKind, ForgeView, LoggedIn, PassphraseStrength, RepositoryListing, RepositoryView,
};

empty_shape!(ForgesListParams, LoginLastRepositoryParams);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgesListResult {
    pub forges: Vec<ForgeView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginLastRepositoryResult {
    pub repo_url: Option<String>,
    pub forge: Option<ForgeKind>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginListRepositoriesParams {
    pub forge: ForgeKind,
    pub access_token: Secret,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginListRepositoriesResult {
    pub repositories: Vec<RepositoryListing>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginInspectRepositoryParams {
    pub forge: ForgeKind,
    pub access_token: Secret,
    pub repository_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LoginInspectRepositoryResult {
    NotesRepo {
        repository: RepositoryView,
    },
    Uninitialized {
        repository: RepositoryView,
        set_up_description: String,
    },
    Unusable {
        repository: RepositoryView,
        error: CoreError,
        can_check_again: bool,
        foreign_hint: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassphraseParams {
    pub passphrase: Secret,
}

pub type LoginUnlockParams = PassphraseParams;
pub type LoginInitializeParams = PassphraseParams;
pub type LoginUnlockResult = LoggedIn;
pub type LoginInitializeResult = LoggedIn;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassphraseStrengthParams {
    pub passphrase: Secret,
    pub repository_label: String,
}

pub type PassphraseStrengthResult = PassphraseStrength;

command!(
    ForgesList,
    "forges.list",
    ForgesListParams,
    ForgesListResult
);
command!(
    LoginLastRepository,
    "login.lastRepository",
    LoginLastRepositoryParams,
    LoginLastRepositoryResult
);
command!(
    LoginListRepositories,
    "login.listRepositories",
    LoginListRepositoriesParams,
    LoginListRepositoriesResult
);
command!(
    LoginInspectRepository,
    "login.inspectRepository",
    LoginInspectRepositoryParams,
    LoginInspectRepositoryResult
);
command!(
    LoginUnlock,
    "login.unlock",
    LoginUnlockParams,
    LoginUnlockResult
);
command!(
    LoginInitialize,
    "login.initialize",
    LoginInitializeParams,
    LoginInitializeResult
);
command!(
    PassphraseStrengthCheck,
    "passphrase.strength",
    PassphraseStrengthParams,
    PassphraseStrengthResult
);
