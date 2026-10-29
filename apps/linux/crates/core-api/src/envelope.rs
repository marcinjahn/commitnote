use std::fmt;
use std::io;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::Zeroizing;

use crate::commands::Command;
use crate::error::CoreError;
use crate::events::CoreEvent;

/// Failure to decode a message from the core. Carries no payload text, because
/// serde error messages can quote note content or credentials.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    category: serde_json::error::Category,
    line: usize,
    column: usize,
}

impl ParseError {
    pub fn category(&self) -> serde_json::error::Category {
        self.category
    }
}

impl From<serde_json::Error> for ParseError {
    fn from(error: serde_json::Error) -> Self {
        Self {
            category: error.classify(),
            line: error.line(),
            column: error.column(),
        }
    }
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "malformed core message ({:?} error at line {} column {})",
            self.category, self.line, self.column
        )
    }
}

impl std::error::Error for ParseError {}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Request {
    pub id: i64,
    pub command: String,
    pub params: Value,
}

impl Request {
    pub fn new(id: i64, command: impl Into<String>, params: Value) -> Self {
        Self {
            id,
            command: command.into(),
            params,
        }
    }

    pub fn for_command<C: Command>(id: i64, params: &C::Params) -> Result<Self, ParseError> {
        Ok(Self::new(id, C::NAME, serde_json::to_value(params)?))
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("a request is always serializable")
    }

    /// Serialises straight from the typed parameters, so no copy of them lives on after the
    /// returned buffer is dropped. The buffer is sized exactly up front so that it never
    /// reallocates and leaves an unwiped copy behind.
    pub fn command_json<C: Command>(
        id: i64,
        params: &C::Params,
    ) -> Result<Zeroizing<String>, ParseError> {
        let view = RequestView {
            id,
            command: C::NAME,
            params,
        };
        let mut counter = ByteCounter(0);
        serde_json::to_writer(&mut counter, &view)?;
        let mut bytes = Zeroizing::new(Vec::with_capacity(counter.0));
        serde_json::to_writer(&mut *bytes, &view)?;
        match String::from_utf8(std::mem::take(&mut *bytes)) {
            Ok(json) => Ok(Zeroizing::new(json)),
            Err(error) => {
                drop(Zeroizing::new(error.into_bytes()));
                Err(missing_field())
            }
        }
    }
}

#[derive(Serialize)]
struct RequestView<'a, P> {
    id: i64,
    command: &'a str,
    params: &'a P,
}

struct ByteCounter(usize);

impl io::Write for ByteCounter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0 += buf.len();
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Response {
        id: i64,
        result: Result<Value, CoreError>,
    },
    Event(CoreEvent),
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum RawIncoming {
    Response {
        id: i64,
        ok: bool,
        #[serde(default)]
        result: Option<Value>,
        #[serde(default)]
        error: Option<CoreError>,
    },
    Event {
        event: String,
        #[serde(default)]
        payload: Value,
    },
}

pub fn parse_incoming(text: &str) -> Result<Incoming, ParseError> {
    match serde_json::from_str::<RawIncoming>(text)? {
        RawIncoming::Response {
            id,
            ok: true,
            result,
            ..
        } => Ok(Incoming::Response {
            id,
            result: Ok(result.unwrap_or_else(|| Value::Object(Default::default()))),
        }),
        RawIncoming::Response {
            id,
            ok: false,
            error: Some(error),
            ..
        } => Ok(Incoming::Response {
            id,
            result: Err(error),
        }),
        RawIncoming::Response { error: None, .. } => Err(missing_field()),
        RawIncoming::Event { event, payload } => {
            CoreEvent::from_parts(&event, payload).map(Incoming::Event)
        }
    }
}

pub fn decode_result<C: Command>(value: Value) -> Result<C::Result, ParseError> {
    decode_value(value)
}

pub(crate) fn decode_value<T: DeserializeOwned>(value: Value) -> Result<T, ParseError> {
    Ok(serde_json::from_value(value)?)
}

fn missing_field() -> ParseError {
    ParseError {
        category: serde_json::error::Category::Data,
        line: 0,
        column: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{
        DeviceName, DeviceNameResult, LifecycleSetVisible, LifecycleSetVisibleParams,
        LoginListRepositories, LoginListRepositoriesParams, PassphraseStrengthCheck,
        PassphraseStrengthParams,
    };
    use crate::error::CoreErrorKind;
    use crate::secret::Secret;
    use crate::shapes::ForgeKind;

    #[test]
    fn request_encodes_with_object_params() {
        let request = Request::for_command::<LifecycleSetVisible>(
            1,
            &LifecycleSetVisibleParams { visible: true },
        )
        .unwrap();
        let value: Value = serde_json::from_str(&request.to_json()).unwrap();
        assert_eq!(
            value,
            serde_json::json!({"id":1,"command":"lifecycle.setVisible","params":{"visible":true}})
        );
    }

    #[test]
    fn command_json_matches_the_value_based_encoding() {
        let params = LifecycleSetVisibleParams { visible: true };
        let typed = Request::command_json::<LifecycleSetVisible>(7, &params).unwrap();
        let through_value = Request::for_command::<LifecycleSetVisible>(7, &params)
            .unwrap()
            .to_json();
        assert_eq!(*typed, through_value);

        let params = PassphraseStrengthParams {
            passphrase: Secret::new("pass \"phrase\" \u{1F512} \n"),
            repository_label: "owner/repo".into(),
        };
        let typed = Request::command_json::<PassphraseStrengthCheck>(8, &params).unwrap();
        let through_value = Request::for_command::<PassphraseStrengthCheck>(8, &params)
            .unwrap()
            .to_json();
        assert_eq!(*typed, through_value);
    }

    #[test]
    fn command_json_has_the_same_content_whatever_the_field_order() {
        let params = LoginListRepositoriesParams {
            forge: ForgeKind::Github,
            access_token: Secret::new("token"),
        };
        let typed = Request::command_json::<LoginListRepositories>(9, &params).unwrap();
        let through_value = Request::for_command::<LoginListRepositories>(9, &params)
            .unwrap()
            .to_json();
        assert_eq!(
            serde_json::from_str::<Value>(&typed).unwrap(),
            serde_json::from_str::<Value>(&through_value).unwrap()
        );
    }

    #[test]
    fn success_response_decodes_typed_result() {
        let incoming =
            parse_incoming(r#"{"kind":"response","id":3,"ok":true,"result":{"name":"Laptop"}}"#)
                .unwrap();
        let Incoming::Response { id, result } = incoming else {
            panic!("expected response");
        };
        assert_eq!(id, 3);
        let typed = decode_result::<DeviceName>(result.unwrap()).unwrap();
        assert_eq!(
            typed,
            DeviceNameResult {
                name: "Laptop".into()
            }
        );
    }

    #[test]
    fn error_response_decodes() {
        let incoming = parse_incoming(
            r#"{"kind":"response","id":4,"ok":false,"error":{"kind":"notReady","message":"Try again.","transient":false}}"#,
        )
        .unwrap();
        assert_eq!(
            incoming,
            Incoming::Response {
                id: 4,
                result: Err(CoreError::new(CoreErrorKind::NotReady, "Try again.", false)),
            }
        );
    }

    #[test]
    fn unparseable_request_response_has_id_minus_one() {
        let incoming = parse_incoming(
            r#"{"kind":"response","id":-1,"ok":false,"error":{"kind":"invalidParams","message":"m","transient":false}}"#,
        )
        .unwrap();
        let Incoming::Response { id, result } = incoming else {
            panic!("expected response");
        };
        assert_eq!(id, -1);
        assert_eq!(result.unwrap_err().kind, CoreErrorKind::InvalidParams);
    }

    #[test]
    fn missing_result_becomes_empty_object() {
        let incoming = parse_incoming(r#"{"kind":"response","id":2,"ok":true}"#).unwrap();
        assert_eq!(
            incoming,
            Incoming::Response {
                id: 2,
                result: Ok(serde_json::json!({}))
            }
        );
    }

    #[test]
    fn failed_response_without_error_is_rejected() {
        assert!(parse_incoming(r#"{"kind":"response","id":2,"ok":false}"#).is_err());
    }

    #[test]
    fn unknown_message_kind_is_rejected() {
        assert!(parse_incoming(r#"{"kind":"banner","id":2}"#).is_err());
        assert!(parse_incoming("not json").is_err());
    }

    #[test]
    fn wrong_result_shape_fails_to_decode() {
        assert!(decode_result::<DeviceName>(serde_json::json!({"nombre":"x"})).is_err());
    }

    #[test]
    fn parse_errors_do_not_quote_the_payload() {
        let error = parse_incoming(
            r#"{"kind":"event","event":"noticeCleared","payload":{"id":"secret-note-text-17"}}"#,
        );
        assert!(error.is_ok());
        let error = parse_incoming(
            r#"{"kind":"event","event":"noticeCleared","payload":{"id":["secret-note-text-17"]}}"#,
        )
        .unwrap_err();
        assert!(!error.to_string().contains("secret-note-text-17"));
        assert!(!format!("{error:?}").contains("secret-note-text-17"));
    }
}
