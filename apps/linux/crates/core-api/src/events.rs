use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::envelope::{ParseError, decode_value};
use crate::error::CoreError;
use crate::settings::SettingsView;
use crate::shapes::{
    ColorTag, LoadingStep, NoticeAction, NoticeTone, OpenNote, RemoteTextEdit, SessionEndReason,
    SyncState, SyncStatusMenuItem, TagOptionView, TreeNode,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadingProgress {
    pub step: LoadingStep,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeChanged {
    pub tree: Option<Vec<TreeNode>>,
    pub tag_filter: Option<ColorTag>,
    pub used_tags: Vec<ColorTag>,
    pub tags_writable: bool,
    pub tag_options: Vec<TagOptionView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteChanged {
    pub note: Option<OpenNote>,
    #[serde(default)]
    pub edits: Option<Vec<RemoteTextEdit>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RemoteChange {
    Updated,
    Relocated,
    Trashed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteContentChangedRemotely {
    pub change: RemoteChange,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStateChanged {
    pub online: bool,
    pub refreshing: bool,
    pub tree_loaded: bool,
    pub last_refresh_error: Option<CoreError>,
    pub state: SyncState,
    pub label: String,
    pub status: Option<String>,
    pub unsaved_count: u32,
    pub can_retry: bool,
    pub unsaved_menu: Vec<SyncStatusMenuItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub id: String,
    pub tone: NoticeTone,
    pub message: String,
    pub persistent: bool,
    pub action: Option<NoticeAction>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoticeCleared {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyChangedPayload {
    pub unsaved_count: u32,
    pub message: String,
    pub detail: String,
    pub export_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEndedPayload {
    pub reason: SessionEndReason,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsChangedPayload {
    pub view: SettingsView,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreEvent {
    LoadingProgress(LoadingProgress),
    TreeChanged(TreeChanged),
    NoteChanged(NoteChanged),
    NoteContentChangedRemotely(NoteContentChangedRemotely),
    SyncStateChanged(SyncStateChanged),
    Notice(Notice),
    NoticeCleared(NoticeCleared),
    KeyChanged {
        unsaved_count: u32,
        message: String,
        detail: String,
        export_label: String,
    },
    SessionEnded {
        reason: SessionEndReason,
    },
    SettingsChanged {
        view: SettingsView,
    },
    Other {
        name: String,
        payload: Value,
    },
}

impl CoreEvent {
    pub fn from_parts(name: &str, payload: Value) -> Result<Self, ParseError> {
        Ok(match name {
            "loadingProgress" => Self::LoadingProgress(decode_value(payload)?),
            "treeChanged" => Self::TreeChanged(decode_value(payload)?),
            "noteChanged" => Self::NoteChanged(decode_value(payload)?),
            "noteContentChangedRemotely" => {
                Self::NoteContentChangedRemotely(decode_value(payload)?)
            }
            "syncStateChanged" => Self::SyncStateChanged(decode_value(payload)?),
            "notice" => Self::Notice(decode_value(payload)?),
            "noticeCleared" => Self::NoticeCleared(decode_value(payload)?),
            "keyChanged" => {
                let KeyChangedPayload {
                    unsaved_count,
                    message,
                    detail,
                    export_label,
                } = decode_value(payload)?;
                Self::KeyChanged {
                    unsaved_count,
                    message,
                    detail,
                    export_label,
                }
            }
            "sessionEnded" => {
                let SessionEndedPayload { reason } = decode_value(payload)?;
                Self::SessionEnded { reason }
            }
            "settingsChanged" => {
                let SettingsChangedPayload { view } = decode_value(payload)?;
                Self::SettingsChanged { view }
            }
            other => Self::Other {
                name: other.to_owned(),
                payload,
            },
        })
    }

    pub fn name(&self) -> &str {
        match self {
            Self::LoadingProgress(_) => "loadingProgress",
            Self::TreeChanged(_) => "treeChanged",
            Self::NoteChanged(_) => "noteChanged",
            Self::NoteContentChangedRemotely(_) => "noteContentChangedRemotely",
            Self::SyncStateChanged(_) => "syncStateChanged",
            Self::Notice(_) => "notice",
            Self::NoticeCleared(_) => "noticeCleared",
            Self::KeyChanged { .. } => "keyChanged",
            Self::SessionEnded { .. } => "sessionEnded",
            Self::SettingsChanged { .. } => "settingsChanged",
            Self::Other { name, .. } => name,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::envelope::{Incoming, parse_incoming};
    use crate::error::CoreErrorKind;
    use crate::settings::SettingScope;
    use crate::shapes::OutOfSyncReason;

    fn event(text: &str) -> CoreEvent {
        match parse_incoming(text).unwrap() {
            Incoming::Event(event) => event,
            other => panic!("expected an event, got {other:?}"),
        }
    }

    fn payload_round_trip<T>(value: &T)
    where
        T: Serialize + serde::de::DeserializeOwned + PartialEq + std::fmt::Debug,
    {
        let json = serde_json::to_value(value).unwrap();
        assert_eq!(&serde_json::from_value::<T>(json).unwrap(), value);
    }

    #[test]
    fn loading_progress() {
        let decoded = event(
            r#"{"kind":"event","event":"loadingProgress","payload":{"step":"derivingKeys","message":"Deriving"}}"#,
        );
        assert_eq!(
            decoded,
            CoreEvent::LoadingProgress(LoadingProgress {
                step: LoadingStep::DerivingKeys,
                message: "Deriving".into()
            })
        );
        for step in [
            "listingRepositories",
            "checkingRepository",
            "derivingKeys",
            "initializing",
        ] {
            let text = format!(
                r#"{{"kind":"event","event":"loadingProgress","payload":{{"step":"{step}","message":"m"}}}}"#
            );
            assert!(matches!(event(&text), CoreEvent::LoadingProgress(_)));
        }
    }

    #[test]
    fn tree_changed_with_tree_and_tags() {
        let decoded = event(
            r#"{"kind":"event","event":"treeChanged","payload":{"tree":[
            {"kind":"note","name":"A","path":["A"],"colorTag":"blue","shared":true}],
            "tagFilter":"blue","usedTags":["blue","red"],"tagsWritable":true,
            "tagOptions":[{"tag":"red","label":"Red"},{"tag":"blue","label":"Blue"}]}}"#,
        );
        let expected = TreeChanged {
            tree: Some(vec![TreeNode::Note {
                name: "A".into(),
                path: vec!["A".into()],
                color_tag: Some(ColorTag::Blue),
                shared: true,
            }]),
            tag_filter: Some(ColorTag::Blue),
            used_tags: vec![ColorTag::Blue, ColorTag::Red],
            tags_writable: true,
            tag_options: vec![
                TagOptionView {
                    tag: ColorTag::Red,
                    label: "Red".into(),
                },
                TagOptionView {
                    tag: ColorTag::Blue,
                    label: "Blue".into(),
                },
            ],
        };
        assert_eq!(decoded, CoreEvent::TreeChanged(expected.clone()));
        payload_round_trip(&expected);
    }

    #[test]
    fn tree_changed_without_tree() {
        let decoded = event(
            r#"{"kind":"event","event":"treeChanged","payload":{"tree":null,"tagFilter":null,"usedTags":[],"tagsWritable":false,"tagOptions":[]}}"#,
        );
        assert_eq!(
            decoded,
            CoreEvent::TreeChanged(TreeChanged {
                tree: None,
                tag_filter: None,
                used_tags: vec![],
                tags_writable: false,
                tag_options: vec![],
            })
        );
    }

    #[test]
    fn note_changed_variants() {
        assert_eq!(
            event(r#"{"kind":"event","event":"noteChanged","payload":{"note":null}}"#),
            CoreEvent::NoteChanged(NoteChanged {
                note: None,
                edits: None
            })
        );
        let CoreEvent::NoteChanged(changed) = event(
            r##"{"kind":"event","event":"noteChanged","payload":{"note":{"state":"loaded","path":["A"],"content":"c","conflict":null,"colorTag":"green","shared":true},"edits":null}}"##,
        ) else {
            panic!("noteChanged");
        };
        assert_eq!(
            changed.note,
            Some(OpenNote::Loaded {
                path: vec!["A".into()],
                content: "c".into(),
                conflict: None,
                color_tag: Some(ColorTag::Green),
                shared: true,
            })
        );
        assert_eq!(changed.edits, None);

        let CoreEvent::NoteChanged(with_edits) = event(
            r#"{"kind":"event","event":"noteChanged","payload":{"note":{"state":"loaded","path":["A"],
            "content":"Hi there","conflict":{"otherDevice":"Other device","heading":"h","text":"t",
            "keepThisLabel":"a","keepOtherLabel":"b","editMergedLabel":"Edit merged","editHint":"hint",
            "merged":"<<<<<<< x","editing":true},"colorTag":null,"shared":false},
            "edits":[{"from":2,"to":2,"insert":" there"}]}}"#,
        ) else {
            panic!("noteChanged with edits");
        };
        assert_eq!(
            with_edits.edits,
            Some(vec![RemoteTextEdit {
                from: 2,
                to: 2,
                insert: " there".into()
            }])
        );
        let Some(OpenNote::Loaded {
            conflict: Some(conflict),
            ..
        }) = with_edits.note
        else {
            panic!("conflict");
        };
        assert_eq!(conflict.other_device.as_deref(), Some("Other device"));
        assert_eq!(conflict.edit_merged_label, "Edit merged");
        assert!(conflict.editing);
        payload_round_trip(&changed);
    }

    #[test]
    fn note_content_changed_remotely() {
        for (wire, change) in [
            ("updated", RemoteChange::Updated),
            ("relocated", RemoteChange::Relocated),
            ("trashed", RemoteChange::Trashed),
        ] {
            let text = format!(
                r#"{{"kind":"event","event":"noteContentChangedRemotely","payload":{{"change":"{wire}","message":"m"}}}}"#
            );
            let decoded = event(&text);
            let expected = NoteContentChangedRemotely {
                change,
                message: "m".into(),
            };
            assert_eq!(
                decoded,
                CoreEvent::NoteContentChangedRemotely(expected.clone())
            );
            assert_eq!(decoded.name(), "noteContentChangedRemotely");
            payload_round_trip(&expected);
        }
        assert!(
            parse_incoming(
                r#"{"kind":"event","event":"noteContentChangedRemotely","payload":{"change":"moved","message":"m"}}"#
            )
            .is_err()
        );
    }

    #[test]
    fn sync_state_changed() {
        let CoreEvent::SyncStateChanged(sync) = event(
            r#"{"kind":"event","event":"syncStateChanged","payload":{"online":true,"refreshing":false,
            "treeLoaded":true,"lastRefreshError":{"kind":"network","message":"m","transient":true},
            "state":{"kind":"out-of-sync","reason":"failed"},"label":"Out of sync: failed to save",
            "status":"Out of sync: failed to save","unsavedCount":1,"canRetry":true,
            "unsavedMenu":[{"id":"note-0","label":"Welcome","path":["Welcome"]},
            {"id":"retry","label":"Retry now","path":null}]}}"#,
        ) else {
            panic!("syncStateChanged");
        };
        assert!(sync.online && sync.tree_loaded && sync.can_retry && !sync.refreshing);
        assert_eq!(
            sync.last_refresh_error.as_ref().map(|e| &e.kind),
            Some(&CoreErrorKind::Network)
        );
        assert_eq!(
            sync.state,
            SyncState::OutOfSync {
                reason: OutOfSyncReason::Failed
            }
        );
        assert_eq!(sync.status.as_deref(), Some("Out of sync: failed to save"));
        assert_eq!(sync.unsaved_count, 1);
        assert_eq!(sync.unsaved_menu.len(), 2);
        assert_eq!(sync.unsaved_menu[1].path, None);
        payload_round_trip(&sync);

        let CoreEvent::SyncStateChanged(clean) = event(
            r#"{"kind":"event","event":"syncStateChanged","payload":{"online":false,"refreshing":true,"treeLoaded":false,"lastRefreshError":null,"state":{"kind":"synced"},"label":"Synced","status":null,"unsavedCount":0,"canRetry":false,"unsavedMenu":[{"id":"none","label":"No unsaved changes","path":null}]}}"#,
        ) else {
            panic!("syncStateChanged");
        };
        assert_eq!(clean.last_refresh_error, None);
        assert_eq!(clean.state, SyncState::Synced);
        assert_eq!(clean.status, None);
        payload_round_trip(&clean);
    }

    #[test]
    fn sync_states_round_trip() {
        for (state, json) in [
            (SyncState::Synced, json!({"kind":"synced"})),
            (SyncState::Syncing, json!({"kind":"syncing"})),
            (
                SyncState::OutOfSync {
                    reason: OutOfSyncReason::Pending,
                },
                json!({"kind":"out-of-sync","reason":"pending"}),
            ),
            (
                SyncState::OutOfSync {
                    reason: OutOfSyncReason::Conflict,
                },
                json!({"kind":"out-of-sync","reason":"conflict"}),
            ),
        ] {
            assert_eq!(serde_json::to_value(&state).unwrap(), json);
            assert_eq!(serde_json::from_value::<SyncState>(json).unwrap(), state);
        }
    }

    #[test]
    fn notices() {
        let CoreEvent::Notice(notice) = event(
            r#"{"kind":"event","event":"notice","payload":{"id":"n1","tone":"warning","message":"m","persistent":true,
            "action":{"kind":"openNote","label":"Open note","path":["a","b"]}}}"#,
        ) else {
            panic!("notice");
        };
        assert_eq!(notice.tone, NoticeTone::Warning);
        assert_eq!(
            notice.action,
            Some(NoticeAction::OpenNote {
                label: "Open note".into(),
                path: vec!["a".into(), "b".into()]
            })
        );
        payload_round_trip(&notice);

        let CoreEvent::Notice(undo) = event(
            r#"{"kind":"event","event":"notice","payload":{"id":"n2","tone":"success","message":"m","persistent":false,
            "action":{"kind":"undo","label":"Undo"}}}"#,
        ) else {
            panic!("notice");
        };
        assert_eq!(
            undo.action,
            Some(NoticeAction::Undo {
                label: "Undo".into()
            })
        );
        payload_round_trip(&undo);

        let CoreEvent::Notice(plain) = event(
            r#"{"kind":"event","event":"notice","payload":{"id":"n3","tone":"info","message":"m","persistent":false,"action":null}}"#,
        ) else {
            panic!("notice");
        };
        assert_eq!(plain.action, None);

        for tone in ["info", "warning", "error", "success"] {
            let text = format!(
                r#"{{"kind":"event","event":"notice","payload":{{"id":"x","tone":"{tone}","message":"m","persistent":false,"action":null}}}}"#
            );
            assert!(matches!(event(&text), CoreEvent::Notice(_)));
        }

        assert_eq!(
            event(r#"{"kind":"event","event":"noticeCleared","payload":{"id":"n1"}}"#),
            CoreEvent::NoticeCleared(NoticeCleared { id: "n1".into() })
        );
    }

    #[test]
    fn key_changed_and_session_ended() {
        assert_eq!(
            event(
                r#"{"kind":"event","event":"keyChanged","payload":{"unsavedCount":3,"message":"m","detail":"d","exportLabel":"Export"}}"#
            ),
            CoreEvent::KeyChanged {
                unsaved_count: 3,
                message: "m".into(),
                detail: "d".into(),
                export_label: "Export".into(),
            }
        );
        assert_eq!(
            event(r#"{"kind":"event","event":"sessionEnded","payload":{"reason":"loggedOut"}}"#),
            CoreEvent::SessionEnded {
                reason: SessionEndReason::LoggedOut
            }
        );
    }

    #[test]
    fn settings_changed() {
        let CoreEvent::SettingsChanged { view } = event(
            r#"{"kind":"event","event":"settingsChanged","payload":{"view":{"values":{"colorMode":"system","accentColor":"system","noteFont":"sans","newNotePlacement":"top","newFolderPlacement":"bottom","typeToStart":true,"vimMode":false},"scopes":{"colorMode":"synced","accentColor":"device","noteFont":"synced","typeToStart":"device"},"deviceName":"","automaticDeviceName":"Laptop","reopenLastView":true,"analyticsCounted":false,"canExport":true,"canImport":true,"canChangePassphrase":false}}}"#,
        ) else {
            panic!("settingsChanged");
        };
        assert_eq!(view.automatic_device_name, "Laptop");
        assert_eq!(view.values.vim_mode, Some(false));
        assert_eq!(view.scopes.type_to_start, SettingScope::Device);
    }

    #[test]
    fn unknown_events_are_preserved() {
        assert_eq!(
            event(r#"{"kind":"event","event":"somethingNew","payload":{"x":1}}"#),
            CoreEvent::Other {
                name: "somethingNew".into(),
                payload: json!({"x":1})
            }
        );
        assert_eq!(
            event(r#"{"kind":"event","event":"trashChanged","payload":{"entries":[]}}"#).name(),
            "trashChanged"
        );
    }

    #[test]
    fn event_without_payload_is_other_with_null() {
        assert_eq!(
            event(r#"{"kind":"event","event":"somethingNew"}"#),
            CoreEvent::Other {
                name: "somethingNew".into(),
                payload: Value::Null
            }
        );
    }

    #[test]
    fn malformed_known_event_is_an_error() {
        assert!(
            parse_incoming(r#"{"kind":"event","event":"noticeCleared","payload":{}}"#).is_err()
        );
    }

    #[test]
    fn every_typed_event_reports_its_wire_name() {
        let names = [
            (
                "loadingProgress",
                json!({"step":"initializing","message":"m"}),
            ),
            (
                "treeChanged",
                json!({"tree":null,"tagFilter":null,"usedTags":[],"tagsWritable":false,"tagOptions":[]}),
            ),
            ("noteChanged", json!({"note":null,"edits":null})),
            (
                "noteContentChangedRemotely",
                json!({"change":"updated","message":"m"}),
            ),
            ("noticeCleared", json!({"id":"x"})),
            ("sessionEnded", json!({"reason":"loggedOut"})),
            (
                "keyChanged",
                json!({"unsavedCount":0,"message":"m","detail":"d","exportLabel":"e"}),
            ),
        ];
        for (name, payload) in names {
            let event = CoreEvent::from_parts(name, payload).unwrap();
            assert_eq!(event.name(), name);
            assert!(crate::CORE_EVENT_NAMES.contains(&name));
        }
    }
}
