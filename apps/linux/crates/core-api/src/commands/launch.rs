use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LaunchAction {
    NewNote,
    Search,
}

impl LaunchAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NewNote => "new-note",
            Self::Search => "search",
        }
    }

    pub fn from_wire(value: &str) -> Option<Self> {
        match value {
            "new-note" => Some(Self::NewNote),
            "search" => Some(Self::Search),
            _ => None,
        }
    }
}

empty_shape!(
    LaunchDeliverResult,
    LaunchAttachResult,
    LaunchDetachParams,
    LaunchDetachResult,
);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchDeliverParams {
    pub action: LaunchAction,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchAttachParams {
    pub accepts: Vec<LaunchAction>,
}

command!(
    LaunchDeliver,
    "launch.deliver",
    LaunchDeliverParams,
    LaunchDeliverResult
);
command!(
    LaunchAttach,
    "launch.attach",
    LaunchAttachParams,
    LaunchAttachResult
);
command!(
    LaunchDetach,
    "launch.detach",
    LaunchDetachParams,
    LaunchDetachResult
);
