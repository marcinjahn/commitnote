use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::commands::{AtomicBlockedView, HistoryView, ShareCopy, ShareRowView};
use crate::envelope::{ParseError, decode_value};
use crate::error::CoreError;
use crate::settings::{SettingsSaveView, SettingsView};
use crate::shapes::{
    ColorTag, LoadingStep, NoticeAction, NoticeTone, OpenNote, RemoteTextEdit, SessionEndReason,
    SyncState, SyncStatusMenuItem, TagOptionView, TrashConfirmationText, TrashEntryView, TreeNode,
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
pub struct TrashChanged {
    pub entries: Vec<TrashEntryView>,
    pub delete_confirmation: TrashConfirmationText,
    pub empty_confirmation: TrashConfirmationText,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStatusChanged {
    pub status: Option<String>,
    pub progress: Option<f64>,
    pub partial: bool,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSaveChangedPayload {
    pub save: SettingsSaveView,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStatusChanged {
    pub importing: bool,
    pub atomic_blocked: Option<AtomicBlockedView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassphraseChangeProgress {
    pub message: String,
    pub done: Option<u32>,
    pub total: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryChanged {
    pub history: Option<HistoryView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharesChanged {
    pub shares: Vec<ShareRowView>,
    pub unreadable: Option<String>,
    pub updating_id: Option<String>,
    pub copy: Box<ShareCopy>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CoreEvent {
    LoadingProgress(LoadingProgress),
    TreeChanged(TreeChanged),
    TrashChanged(TrashChanged),
    NoteChanged(NoteChanged),
    SearchStatusChanged(SearchStatusChanged),
    HistoryChanged(HistoryChanged),
    SharesChanged(SharesChanged),
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
    SettingsSaveChanged {
        save: SettingsSaveView,
    },
    ImportStatusChanged(ImportStatusChanged),
    PassphraseChangeProgress(PassphraseChangeProgress),
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
            "trashChanged" => Self::TrashChanged(decode_value(payload)?),
            "noteChanged" => Self::NoteChanged(decode_value(payload)?),
            "searchStatusChanged" => Self::SearchStatusChanged(decode_value(payload)?),
            "historyChanged" => Self::HistoryChanged(decode_value(payload)?),
            "sharesChanged" => Self::SharesChanged(decode_value(payload)?),
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
            "settingsSaveChanged" => {
                let SettingsSaveChangedPayload { save } = decode_value(payload)?;
                Self::SettingsSaveChanged { save }
            }
            "importStatusChanged" => Self::ImportStatusChanged(decode_value(payload)?),
            "passphraseChangeProgress" => Self::PassphraseChangeProgress(decode_value(payload)?),
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
            Self::TrashChanged(_) => "trashChanged",
            Self::NoteChanged(_) => "noteChanged",
            Self::SearchStatusChanged(_) => "searchStatusChanged",
            Self::HistoryChanged(_) => "historyChanged",
            Self::SharesChanged(_) => "sharesChanged",
            Self::NoteContentChangedRemotely(_) => "noteContentChangedRemotely",
            Self::SyncStateChanged(_) => "syncStateChanged",
            Self::Notice(_) => "notice",
            Self::NoticeCleared(_) => "noticeCleared",
            Self::KeyChanged { .. } => "keyChanged",
            Self::SessionEnded { .. } => "sessionEnded",
            Self::SettingsChanged { .. } => "settingsChanged",
            Self::SettingsSaveChanged { .. } => "settingsSaveChanged",
            Self::ImportStatusChanged(_) => "importStatusChanged",
            Self::PassphraseChangeProgress(_) => "passphraseChangeProgress",
            Self::Other { name, .. } => name,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::commands::{
        HistoryPhase, HistoryRow, HistorySection, HistoryVersionView, ShareActionId,
    };
    use crate::envelope::{Incoming, parse_incoming};
    use crate::error::CoreErrorKind;
    use crate::secret::Secret;
    use crate::settings::{SettingScope, SettingsSaveState};
    use crate::shapes::{OutOfSyncReason, TrashItemKind, TrashItemView};

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
    fn trash_changed_with_nested_folder_entry() {
        let decoded = event(
            r#"{"kind":"event","event":"trashChanged","payload":{"entries":[
            {"id":"e1","kind":"folder","name":"Plans","originalFolder":"Work","daysLeft":"29 days left",
            "colorTag":null,"children":[
              {"kind":"folder","name":"Q1","subPath":["Q1"],"children":[
                {"kind":"note","name":"Goals","subPath":["Q1","Goals"],"children":[]}]}]},
            {"id":"e2","kind":"note","name":"Idea","originalFolder":"","daysLeft":"1 day left",
            "colorTag":"green","children":[]}],
            "deleteConfirmation":{"title":"Delete forever?","message":"dm"},
            "emptyConfirmation":{"title":"Empty Trash?","message":"em"}}}"#,
        );
        let expected = TrashChanged {
            entries: vec![
                TrashEntryView {
                    id: "e1".into(),
                    kind: TrashItemKind::Folder,
                    name: "Plans".into(),
                    original_folder: "Work".into(),
                    days_left: "29 days left".into(),
                    color_tag: None,
                    children: vec![TrashItemView {
                        kind: TrashItemKind::Folder,
                        name: "Q1".into(),
                        sub_path: vec!["Q1".into()],
                        children: vec![TrashItemView {
                            kind: TrashItemKind::Note,
                            name: "Goals".into(),
                            sub_path: vec!["Q1".into(), "Goals".into()],
                            children: vec![],
                        }],
                    }],
                },
                TrashEntryView {
                    id: "e2".into(),
                    kind: TrashItemKind::Note,
                    name: "Idea".into(),
                    original_folder: String::new(),
                    days_left: "1 day left".into(),
                    color_tag: Some(ColorTag::Green),
                    children: vec![],
                },
            ],
            delete_confirmation: TrashConfirmationText {
                title: "Delete forever?".into(),
                message: "dm".into(),
            },
            empty_confirmation: TrashConfirmationText {
                title: "Empty Trash?".into(),
                message: "em".into(),
            },
        };
        assert_eq!(decoded, CoreEvent::TrashChanged(expected.clone()));
        assert_eq!(decoded.name(), "trashChanged");
        payload_round_trip(&expected);
    }

    #[test]
    fn search_status_changed_with_and_without_progress() {
        assert_eq!(
            event(
                r#"{"kind":"event","event":"searchStatusChanged","payload":{"status":"Reading notes","progress":0.25,"partial":true}}"#
            ),
            CoreEvent::SearchStatusChanged(SearchStatusChanged {
                status: Some("Reading notes".into()),
                progress: Some(0.25),
                partial: true,
            })
        );
        let idle = event(
            r#"{"kind":"event","event":"searchStatusChanged","payload":{"status":null,"progress":null,"partial":false}}"#,
        );
        assert_eq!(
            idle,
            CoreEvent::SearchStatusChanged(SearchStatusChanged {
                status: None,
                progress: None,
                partial: false,
            })
        );
        assert_eq!(idle.name(), "searchStatusChanged");
    }

    fn shares_copy_json() -> &'static str {
        r#""copy":{"explanation":"e","labelField":"Label","passwordField":"Password","passwordHint":"h","create":"Create link","creating":"Creating…","createAnother":"Create another","shareLink":"Link","sharePassword":"Password","sharedLinksTitle":"Shared links","sharedLinksEmpty":"None","passwordProtected":"Password protected","updating":"Updating…","linkCopied":"Link copied","passwordCopied":"Password copied","revoke":{"title":"Revoke?","message":"m","confirmLabel":"Revoke"},"rename":{"title":"Rename","fieldLabel":"Label","confirmLabel":"Save"},"sharedVersionTitle":"Shared version","loadingSharedVersion":"Loading…"}"#
    }

    #[test]
    fn shares_changed_without_shares() {
        let text = format!(
            r#"{{"kind":"event","event":"sharesChanged","payload":{{"shares":[],"unreadable":null,"updatingId":null,{}}}}}"#,
            shares_copy_json()
        );
        let decoded = event(&text);
        assert_eq!(decoded.name(), "sharesChanged");
        let CoreEvent::SharesChanged(changed) = decoded else {
            panic!("sharesChanged");
        };
        assert!(changed.shares.is_empty());
        assert_eq!(changed.unreadable, None);
        assert_eq!(changed.updating_id, None);
        assert_eq!(changed.copy.shared_links_title, "Shared links");
        assert_eq!(changed.copy.revoke.confirm_label, "Revoke");
        assert_eq!(changed.copy.rename.field_label, "Label");
        payload_round_trip(&changed);
    }

    #[test]
    fn shares_changed_with_a_password_protected_row() {
        let text = format!(
            r#"{{"kind":"event","event":"sharesChanged","payload":{{"shares":[{{
              "id":"g1","title":"For Sam","label":"For Sam","date":"Shared today",
              "passwordProtected":true,"link":"https://example.test/s#k","password":"hunter2",
              "notePath":["Welcome"],"menuLabel":"Share actions for For Sam",
              "actions":[
                {{"id":"copy-link","label":"Copy link","disabled":false,"destructive":false}},
                {{"id":"copy-password","label":"Copy password","disabled":false,"destructive":false}},
                {{"id":"update","label":"Update","disabled":true,"destructive":false}},
                {{"id":"view","label":"View","disabled":false,"destructive":false}},
                {{"id":"open","label":"Open note","disabled":false,"destructive":false}},
                {{"id":"rename","label":"Rename","disabled":false,"destructive":false}},
                {{"id":"revoke","label":"Revoke","disabled":false,"destructive":true}}]}},
              {{"id":"g2","title":"Gone","label":null,"date":"Shared today",
              "passwordProtected":false,"link":"l","password":null,"notePath":null,
              "menuLabel":"m","actions":[]}}],
              "unreadable":"Some links could not be read","updatingId":"g1",{}}}}}"#,
            shares_copy_json()
        );
        let CoreEvent::SharesChanged(changed) = event(&text) else {
            panic!("sharesChanged");
        };
        assert_eq!(changed.updating_id.as_deref(), Some("g1"));
        assert_eq!(
            changed.unreadable.as_deref(),
            Some("Some links could not be read")
        );
        let [row, other] = changed.shares.as_slice() else {
            panic!("two rows");
        };
        assert_eq!(row.password.as_ref().map(Secret::expose), Some("hunter2"));
        assert_eq!(row.note_path.as_deref(), Some(&["Welcome".to_owned()][..]));
        assert_eq!(row.label.as_deref(), Some("For Sam"));
        assert!(row.password_protected);
        let ids: Vec<ShareActionId> = row.actions.iter().map(|action| action.id).collect();
        assert_eq!(
            ids,
            [
                ShareActionId::CopyLink,
                ShareActionId::CopyPassword,
                ShareActionId::Update,
                ShareActionId::View,
                ShareActionId::Open,
                ShareActionId::Rename,
                ShareActionId::Revoke,
            ]
        );
        assert!(row.actions[2].disabled);
        assert!(row.actions[6].destructive);
        assert_eq!(other.password, None);
        assert_eq!(other.note_path, None);
        assert_eq!(other.label, None);
        payload_round_trip(&changed);
        let debug = format!("{changed:?}");
        assert!(!debug.contains("hunter2"));
        assert!(!debug.contains("https://example.test"));
    }

    #[test]
    fn history_changed_with_null() {
        let decoded =
            event(r#"{"kind":"event","event":"historyChanged","payload":{"history":null}}"#);
        assert_eq!(
            decoded,
            CoreEvent::HistoryChanged(HistoryChanged { history: None })
        );
        assert_eq!(decoded.name(), "historyChanged");
    }

    #[test]
    fn history_changed_with_single_and_session_rows() {
        let decoded = event(
            r#"{"kind":"event","event":"historyChanged","payload":{"history":{
            "path":["Work","Plan"],"phase":"ready","message":null,"loading":false,"error":null,
            "end":null,"canLoadMore":true,
            "sections":[{"title":"Today","rows":[
              {"kind":"single","version":{"sha":"a1","time":"10:30","dateTime":"Today, 10:30",
               "current":true,"shared":false,"events":[],"name":"Plan"}},
              {"kind":"session","title":"2 edits","shared":true,"versions":[
               {"sha":"b1","time":"09:10","dateTime":"Today, 09:10","current":false,"shared":true,
                "events":["Edited"],"name":null}]}]}]}}}"#,
        );
        let version = |sha: &str,
                       time: &str,
                       current: bool,
                       shared: bool,
                       events: Vec<String>,
                       name: Option<&str>| {
            HistoryVersionView {
                sha: sha.into(),
                time: time.into(),
                date_time: format!("Today, {time}"),
                current,
                shared,
                events,
                name: name.map(Into::into),
            }
        };
        let expected = HistoryChanged {
            history: Some(HistoryView {
                path: vec!["Work".into(), "Plan".into()],
                phase: HistoryPhase::Ready,
                message: None,
                sections: vec![HistorySection {
                    title: "Today".into(),
                    rows: vec![
                        HistoryRow::Single {
                            version: version("a1", "10:30", true, false, vec![], Some("Plan")),
                        },
                        HistoryRow::Session {
                            title: "2 edits".into(),
                            shared: true,
                            versions: vec![version(
                                "b1",
                                "09:10",
                                false,
                                true,
                                vec!["Edited".into()],
                                None,
                            )],
                        },
                    ],
                }],
                loading: false,
                error: None,
                end: None,
                can_load_more: true,
            }),
        };
        assert_eq!(decoded, CoreEvent::HistoryChanged(expected.clone()));
        payload_round_trip(&expected);
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
            event(r#"{"kind":"event","event":"historyChanged","payload":{"entries":[]}}"#).name(),
            "historyChanged"
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
            (
                "trashChanged",
                json!({"entries":[],"deleteConfirmation":{"title":"t","message":"m"},"emptyConfirmation":{"title":"t","message":"m"}}),
            ),
            ("noteChanged", json!({"note":null,"edits":null})),
            (
                "searchStatusChanged",
                json!({"status":null,"progress":null,"partial":false}),
            ),
            (
                "noteContentChangedRemotely",
                json!({"change":"updated","message":"m"}),
            ),
            ("noticeCleared", json!({"id":"x"})),
            (
                "sharesChanged",
                serde_json::from_str(&format!(
                    r#"{{"shares":[],"unreadable":null,"updatingId":null,{}}}"#,
                    shares_copy_json()
                ))
                .unwrap(),
            ),
            ("sessionEnded", json!({"reason":"loggedOut"})),
            (
                "keyChanged",
                json!({"unsavedCount":0,"message":"m","detail":"d","exportLabel":"e"}),
            ),
            (
                "settingsSaveChanged",
                json!({"save":{"state":"synced","label":"l","detail":"d","canRetry":false}}),
            ),
            (
                "importStatusChanged",
                json!({"importing":false,"atomicBlocked":null}),
            ),
            (
                "passphraseChangeProgress",
                json!({"message":"m","done":null,"total":null}),
            ),
        ];
        for (name, payload) in names {
            let event = CoreEvent::from_parts(name, payload).unwrap();
            assert_eq!(event.name(), name);
            assert!(crate::CORE_EVENT_NAMES.contains(&name));
        }
    }

    #[test]
    fn settings_save_changed_carries_the_save_view() {
        let decoded = event(
            r#"{"kind":"event","event":"settingsSaveChanged","payload":{"save":{"state":"failed","label":"Not saved","detail":"Offline","canRetry":true}}}"#,
        );
        assert_eq!(
            decoded,
            CoreEvent::SettingsSaveChanged {
                save: SettingsSaveView {
                    state: SettingsSaveState::Failed,
                    label: "Not saved".into(),
                    detail: "Offline".into(),
                    can_retry: true,
                }
            }
        );
    }

    #[test]
    fn import_status_changed_reports_a_blocked_atomic_merge() {
        let decoded = event(
            r#"{"kind":"event","event":"importStatusChanged","payload":{"importing":true,"atomicBlocked":{"title":"t","message":"m","enableLabel":"e","saveWithoutLabel":"s","canConfigure":true}}}"#,
        );
        let expected = ImportStatusChanged {
            importing: true,
            atomic_blocked: Some(AtomicBlockedView {
                title: "t".into(),
                message: "m".into(),
                enable_label: "e".into(),
                save_without_label: "s".into(),
                can_configure: true,
            }),
        };
        payload_round_trip(&expected);
        assert_eq!(decoded, CoreEvent::ImportStatusChanged(expected));
        assert!(matches!(
            event(
                r#"{"kind":"event","event":"importStatusChanged","payload":{"importing":false,"atomicBlocked":null}}"#
            ),
            CoreEvent::ImportStatusChanged(ImportStatusChanged {
                importing: false,
                atomic_blocked: None
            })
        ));
    }

    #[test]
    fn passphrase_change_progress_has_optional_counts() {
        let decoded = event(
            r#"{"kind":"event","event":"passphraseChangeProgress","payload":{"message":"Re-encrypting","done":3,"total":10}}"#,
        );
        assert_eq!(
            decoded,
            CoreEvent::PassphraseChangeProgress(PassphraseChangeProgress {
                message: "Re-encrypting".into(),
                done: Some(3),
                total: Some(10),
            })
        );
        assert!(matches!(
            event(
                r#"{"kind":"event","event":"passphraseChangeProgress","payload":{"message":"Starting","done":null,"total":null}}"#
            ),
            CoreEvent::PassphraseChangeProgress(PassphraseChangeProgress {
                done: None,
                total: None,
                ..
            })
        ));
    }
}
