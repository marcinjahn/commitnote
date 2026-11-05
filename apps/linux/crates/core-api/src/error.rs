use serde::{Deserialize, Deserializer, Serialize, Serializer};

macro_rules! error_kinds {
    ($($variant:ident => $name:literal),+ $(,)?) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash)]
        pub enum CoreErrorKind {
            $($variant,)+
            Unknown(String),
        }

        impl CoreErrorKind {
            pub fn as_str(&self) -> &str {
                match self {
                    $(Self::$variant => $name,)+
                    Self::Unknown(name) => name,
                }
            }

            pub fn from_name(name: &str) -> Self {
                match name {
                    $($name => Self::$variant,)+
                    other => Self::Unknown(other.to_owned()),
                }
            }
        }

        #[cfg(test)]
        pub(crate) const KNOWN_ERROR_KINDS: &[&str] = &[$($name),+];
    };
}

error_kinds! {
    Unauthorized => "unauthorized",
    NoAccess => "noAccess",
    Forbidden => "forbidden",
    NotFound => "notFound",
    RateLimited => "rateLimited",
    Network => "network",
    Server => "server",
    ReadOnly => "readOnly",
    Foreign => "foreign",
    NoMainBranch => "noMainBranch",
    NewerFormat => "newerFormat",
    WrongPassphrase => "wrongPassphrase",
    InitializationRaced => "initializationRaced",
    RepositoryChanged => "repositoryChanged",
    TreeTruncated => "treeTruncated",
    Undecryptable => "undecryptable",
    KeyChanged => "keyChanged",
    UnknownCommand => "unknownCommand",
    InvalidParams => "invalidParams",
    NotReady => "notReady",
    Internal => "internal",
}

impl Serialize for CoreErrorKind {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for CoreErrorKind {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let name = String::deserialize(deserializer)?;
        Ok(Self::from_name(&name))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreError {
    pub kind: CoreErrorKind,
    pub message: String,
    pub transient: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format_version: Option<u32>,
}

impl CoreError {
    pub fn new(kind: CoreErrorKind, message: impl Into<String>, transient: bool) -> Self {
        Self {
            kind,
            message: message.into(),
            transient,
            retry_after_ms: None,
            format_version: None,
        }
    }
}

impl std::fmt::Display for CoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.kind.as_str())
    }
}

impl std::error::Error for CoreError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_known_kind_round_trips_to_a_known_variant() {
        for name in KNOWN_ERROR_KINDS {
            let kind = CoreErrorKind::from_name(name);
            assert!(!matches!(kind, CoreErrorKind::Unknown(_)), "{name}");
            assert_eq!(kind.as_str(), *name);
            let json = serde_json::to_string(&kind).unwrap();
            assert_eq!(serde_json::from_str::<CoreErrorKind>(&json).unwrap(), kind);
        }
        assert_eq!(KNOWN_ERROR_KINDS.len(), 21);
    }

    #[test]
    fn decodes_a_minimal_error() {
        let error: CoreError =
            serde_json::from_str(r#"{"kind":"notReady","message":"m","transient":false}"#).unwrap();
        assert_eq!(error, CoreError::new(CoreErrorKind::NotReady, "m", false));
    }

    #[test]
    fn decodes_optional_fields() {
        let limited: CoreError = serde_json::from_str(
            r#"{"kind":"rateLimited","message":"m","transient":true,"retryAfterMs":1500}"#,
        )
        .unwrap();
        assert_eq!(limited.retry_after_ms, Some(1500));
        assert_eq!(limited.format_version, None);
        let newer: CoreError = serde_json::from_str(
            r#"{"kind":"newerFormat","message":"m","transient":false,"formatVersion":9}"#,
        )
        .unwrap();
        assert_eq!(newer.format_version, Some(9));
    }

    #[test]
    fn optional_fields_are_omitted_when_absent() {
        let error = CoreError::new(CoreErrorKind::Network, "m", true);
        assert_eq!(
            serde_json::to_string(&error).unwrap(),
            r#"{"kind":"network","message":"m","transient":true}"#
        );
    }

    #[test]
    fn unknown_kind_is_preserved() {
        let error: CoreError =
            serde_json::from_str(r#"{"kind":"brandNew","message":"m","transient":false}"#).unwrap();
        assert_eq!(error.kind, CoreErrorKind::Unknown("brandNew".into()));
        let json = serde_json::to_value(&error).unwrap();
        assert_eq!(json["kind"], "brandNew");
    }
}
