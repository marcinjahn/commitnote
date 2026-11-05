use std::collections::BTreeMap;

#[cfg(test)]
#[path = "../tests/support/ts_names.rs"]
mod ts_names;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

empty_shape!(
    FakeRemoteEditResult,
    FakeChangeRepoKeyResult,
    FakeFailNextResult,
    FakeClearFailuresResult,
    FakeHoldLoadingParams,
    FakeHoldLoadingResult,
    FakeReleaseLoadingParams,
    FakeReleaseLoadingResult,
    FakeExpectedSampleNotesParams,
    FakeSaveNoteResult,
);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeRemoteEditParams {
    pub repo: String,
    pub path: Vec<String>,
    pub text: String,
    pub device: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeChangeRepoKeyParams {
    pub repo: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeFailNextParams {
    pub repo: String,
    pub operation: String,
    pub kind: String,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeClearFailuresParams {
    pub repo: String,
    pub operation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeTimerProbeParams {
    pub delays_ms: Vec<u64>,
    pub cancel_index: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeTimerProbeResult {
    pub fired: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeCheckVectorsParams {
    pub files: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeCheckVectorsResult {
    pub checked: u32,
    pub failures: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeSampleNote {
    pub path: Vec<String>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeExpectedSampleNotesResult {
    pub notes: Vec<FakeSampleNote>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeExportRepoParams {
    pub repo_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeExportRepoResult {
    pub exported: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeHttpRequestParams {
    pub method: String,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeHttpRequestResult {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeSaveNoteParams {
    pub path: Vec<String>,
    pub text: String,
}

command!(
    FakeRemoteEdit,
    "fake.remoteEdit",
    FakeRemoteEditParams,
    FakeRemoteEditResult
);
command!(
    FakeChangeRepoKey,
    "fake.changeRepoKey",
    FakeChangeRepoKeyParams,
    FakeChangeRepoKeyResult
);
command!(
    FakeFailNext,
    "fake.failNext",
    FakeFailNextParams,
    FakeFailNextResult
);
command!(
    FakeClearFailures,
    "fake.clearFailures",
    FakeClearFailuresParams,
    FakeClearFailuresResult
);
command!(
    FakeHoldLoading,
    "fake.holdLoading",
    FakeHoldLoadingParams,
    FakeHoldLoadingResult
);
command!(
    FakeReleaseLoading,
    "fake.releaseLoading",
    FakeReleaseLoadingParams,
    FakeReleaseLoadingResult
);
command!(
    FakeTimerProbe,
    "fake.timerProbe",
    FakeTimerProbeParams,
    FakeTimerProbeResult
);
command!(
    FakeCheckVectors,
    "fake.checkVectors",
    FakeCheckVectorsParams,
    FakeCheckVectorsResult
);
command!(
    FakeExpectedSampleNotes,
    "fake.expectedSampleNotes",
    FakeExpectedSampleNotesParams,
    FakeExpectedSampleNotesResult
);
command!(
    FakeExportRepo,
    "fake.exportRepo",
    FakeExportRepoParams,
    FakeExportRepoResult
);
command!(
    FakeHttpRequest,
    "fake.httpRequest",
    FakeHttpRequestParams,
    FakeHttpRequestResult
);
command!(
    FakeSaveNote,
    "fake.saveNote",
    FakeSaveNoteParams,
    FakeSaveNoteResult
);

#[cfg(test)]
mod tests {
    use serde::de::DeserializeOwned;
    use serde_json::json;
    use std::fmt::Debug;

    use super::*;
    use crate::commands::Command;
    use crate::names::FAKE_CORE_COMMAND_NAMES;

    fn round_trip<T: Serialize + DeserializeOwned + PartialEq + Debug>(value: &T) -> Value {
        let json = serde_json::to_value(value).unwrap();
        let back: T = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(&back, value);
        json
    }

    #[test]
    fn fake_names_match_typescript() {
        let source = ts_names::api_source();
        let names = ts_names::names_in(&source, "FAKE_CORE_COMMAND_NAMES");
        let rust: Vec<String> = FAKE_CORE_COMMAND_NAMES
            .iter()
            .map(|n| (*n).to_owned())
            .collect();
        assert_eq!(rust, names);
    }

    #[test]
    fn typed_fake_commands_are_declared_in_typescript() {
        let typed = [
            FakeRemoteEdit::NAME,
            FakeChangeRepoKey::NAME,
            FakeFailNext::NAME,
            FakeClearFailures::NAME,
            FakeHoldLoading::NAME,
            FakeReleaseLoading::NAME,
            FakeTimerProbe::NAME,
            FakeCheckVectors::NAME,
            FakeExpectedSampleNotes::NAME,
            FakeExportRepo::NAME,
            FakeHttpRequest::NAME,
            FakeSaveNote::NAME,
        ];
        for name in typed {
            assert!(FAKE_CORE_COMMAND_NAMES.contains(&name), "{name}");
        }
    }

    #[test]
    fn empty_params_encode_as_empty_objects() {
        assert_eq!(round_trip(&FakeHoldLoadingParams {}), json!({}));
        assert_eq!(round_trip(&FakeReleaseLoadingParams {}), json!({}));
        assert_eq!(round_trip(&FakeExpectedSampleNotesParams {}), json!({}));
    }

    #[test]
    fn params_use_camel_case_wire_names() {
        assert_eq!(
            round_trip(&FakeRemoteEditParams {
                repo: "r".into(),
                path: vec!["a".into(), "b".into()],
                text: "t".into(),
                device: "d".into(),
            }),
            json!({"repo":"r","path":["a","b"],"text":"t","device":"d"})
        );
        assert_eq!(
            round_trip(&FakeChangeRepoKeyParams { repo: "r".into() }),
            json!({"repo":"r"})
        );
        assert_eq!(
            round_trip(&FakeFailNextParams {
                repo: "r".into(),
                operation: "push".into(),
                kind: "network".into(),
                count: 2,
            }),
            json!({"repo":"r","operation":"push","kind":"network","count":2})
        );
        assert_eq!(
            round_trip(&FakeClearFailuresParams {
                repo: "r".into(),
                operation: "push".into(),
            }),
            json!({"repo":"r","operation":"push"})
        );
        assert_eq!(
            round_trip(&FakeTimerProbeParams {
                delays_ms: vec![10, 20],
                cancel_index: Some(1),
            }),
            json!({"delaysMs":[10,20],"cancelIndex":1})
        );
        assert_eq!(
            round_trip(&FakeTimerProbeParams {
                delays_ms: vec![],
                cancel_index: None,
            }),
            json!({"delaysMs":[],"cancelIndex":null})
        );
        assert_eq!(
            round_trip(&FakeExportRepoParams {
                repo_key: "k".into()
            }),
            json!({"repoKey":"k"})
        );
        assert_eq!(
            round_trip(&FakeSaveNoteParams {
                path: vec!["n".into()],
                text: "t".into(),
            }),
            json!({"path":["n"],"text":"t"})
        );
    }

    #[test]
    fn check_vectors_params_carry_arbitrary_files() {
        let params: FakeCheckVectorsParams =
            serde_json::from_value(json!({"files":{"a.json":{"x":[1,2]},"b.json":"raw"}})).unwrap();
        assert_eq!(params.files.len(), 2);
        round_trip(&params);
    }

    #[test]
    fn http_request_round_trips() {
        let params = FakeHttpRequestParams {
            method: "POST".into(),
            url: "https://example.test/x".into(),
            headers: BTreeMap::from([("content-type".into(), "text/plain".into())]),
            body_text: "hello".into(),
        };
        assert_eq!(
            round_trip(&params),
            json!({"method":"POST","url":"https://example.test/x","headers":{"content-type":"text/plain"},"bodyText":"hello"})
        );
        let result: FakeHttpRequestResult =
            serde_json::from_value(json!({"status":201,"headers":{"etag":"x"},"bodyText":"ok"}))
                .unwrap();
        assert_eq!(result.status, 201);
        assert_eq!(result.headers["etag"], "x");
        round_trip(&result);
    }

    #[test]
    fn results_decode() {
        let probe: FakeTimerProbeResult = serde_json::from_value(json!({"fired":[0,2]})).unwrap();
        assert_eq!(probe.fired, vec![0, 2]);
        round_trip(&probe);
        let vectors: FakeCheckVectorsResult =
            serde_json::from_value(json!({"checked":4,"failures":["f"]})).unwrap();
        assert_eq!(vectors.checked, 4);
        round_trip(&vectors);
        let notes: FakeExpectedSampleNotesResult =
            serde_json::from_value(json!({"notes":[{"path":["a","b"],"text":"t"}]})).unwrap();
        assert_eq!(notes.notes[0].path, vec!["a", "b"]);
        round_trip(&notes);
        let exported: FakeExportRepoResult =
            serde_json::from_value(json!({"exported":"zz"})).unwrap();
        assert_eq!(exported.exported, "zz");
        round_trip(&exported);
        let empty = json!({});
        serde_json::from_value::<FakeRemoteEditResult>(empty.clone()).unwrap();
        serde_json::from_value::<FakeChangeRepoKeyResult>(empty.clone()).unwrap();
        serde_json::from_value::<FakeFailNextResult>(empty.clone()).unwrap();
        serde_json::from_value::<FakeClearFailuresResult>(empty.clone()).unwrap();
        serde_json::from_value::<FakeHoldLoadingResult>(empty.clone()).unwrap();
        serde_json::from_value::<FakeReleaseLoadingResult>(empty.clone()).unwrap();
        serde_json::from_value::<FakeSaveNoteResult>(empty).unwrap();
    }
}
