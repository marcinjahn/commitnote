use std::fmt::Debug;

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use super::*;
use crate::error::{CoreError, CoreErrorKind};
use crate::settings::{SettingKeyView, SettingScope, SettingsSaveState};
use crate::shapes::*;

fn params_json<C: Command>(params: &C::Params) -> Value {
    serde_json::to_value(params).unwrap()
}

fn decode<C: Command>(text: &str) -> C::Result
where
    C::Result: Debug + PartialEq + Serialize,
{
    let result: C::Result = crate::decode_result::<C>(serde_json::from_str(text).unwrap()).unwrap();
    let again: C::Result = serde_json::from_value(serde_json::to_value(&result).unwrap()).unwrap();
    assert_eq!(again, result, "re-encoding changes the value");
    result
}

fn round_trip<T: Serialize + DeserializeOwned + PartialEq + Debug>(value: &T) -> Value {
    let json = serde_json::to_value(value).unwrap();
    let back: T = serde_json::from_value(json.clone()).unwrap();
    assert_eq!(&back, value);
    json
}

fn path(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_owned()).collect()
}

fn repository() -> RepositoryView {
    RepositoryView {
        label: "sample/notes".into(),
        url: "https://example.test/sample/notes".into(),
        private: true,
        public_warning: None,
    }
}

const REPOSITORY_JSON: &str = r#"{"label":"sample/notes","url":"https://example.test/sample/notes","private":true,"publicWarning":null}"#;

#[test]
fn empty_params_encode_as_empty_objects() {
    let empty = json!({});
    assert_eq!(params_json::<ForgesList>(&ForgesListParams {}), empty);
    assert_eq!(
        params_json::<LoginLastRepository>(&LoginLastRepositoryParams {}),
        empty
    );
    assert_eq!(params_json::<SessionResume>(&SessionResumeParams {}), empty);
    assert_eq!(params_json::<TreeGet>(&TreeGetParams {}), empty);
    assert_eq!(params_json::<SyncRefresh>(&SyncRefreshParams {}), empty);
    assert_eq!(params_json::<DeviceName>(&DeviceNameParams {}), empty);
    assert_eq!(params_json::<SettingsOpen>(&SettingsOpenParams {}), empty);
    assert_eq!(
        params_json::<AnalyticsVisit>(&AnalyticsVisitParams {}),
        empty
    );
    assert_eq!(params_json::<SyncFlush>(&SyncFlushParams {}), empty);
    assert_eq!(params_json::<SyncRetry>(&SyncRetryParams {}), empty);
    assert_eq!(params_json::<DraftLeave>(&DraftLeaveParams {}), empty);
    assert_eq!(params_json::<HistoryClose>(&HistoryCloseParams {}), empty);
    assert_eq!(
        params_json::<HistoryLoadMore>(&HistoryLoadMoreParams {}),
        empty
    );
    assert_eq!(params_json::<HistoryRetry>(&HistoryRetryParams {}), empty);
}

#[test]
fn every_command_has_a_distinct_name() {
    let names = [
        ForgesList::NAME,
        LoginLastRepository::NAME,
        LoginListRepositories::NAME,
        LoginInspectRepository::NAME,
        LoginUnlock::NAME,
        LoginInitialize::NAME,
        PassphraseStrengthCheck::NAME,
        SessionResume::NAME,
        SessionLogout::NAME,
        TreeGet::NAME,
        NoteOpen::NAME,
        SyncRefresh::NAME,
        LifecycleSetVisible::NAME,
        LifecycleSetOnline::NAME,
        DeviceName::NAME,
        NoticesDismiss::NAME,
        NoticesPerform::NAME,
        SettingsOpen::NAME,
        SettingsChange::NAME,
        AnalyticsVisit::NAME,
        NoteEdit::NAME,
        SyncFlush::NAME,
        SyncRetry::NAME,
        ConflictResolve::NAME,
        DraftStart::NAME,
        DraftCommitName::NAME,
        DraftContent::NAME,
        DraftLeave::NAME,
        NoteRename::NAME,
        EarlyDraftHandOff::NAME,
        FolderCreate::NAME,
        NodeRename::NAME,
        NodeMove::NAME,
        NodePlace::NAME,
        NodeMoveSibling::NAME,
        NodeMoveTargets::NAME,
        NodeTrashPreview::NAME,
        NodeTrash::NAME,
        NodeSetColorTag::NAME,
        TrashRestoreTargets::NAME,
        TrashRestore::NAME,
        TrashDelete::NAME,
        TrashEmpty::NAME,
        TagsSetFilter::NAME,
        ImageRead::NAME,
        ImageInsert::NAME,
        ImageClonePasted::NAME,
        HistoryOpen::NAME,
        HistoryClose::NAME,
        HistoryLoadMore::NAME,
        HistoryRetry::NAME,
        HistoryPreview::NAME,
        HistoryRestore::NAME,
    ];
    let mut sorted = names.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(sorted.len(), names.len());
    assert_eq!(LoginInspectRepository::NAME, "login.inspectRepository");
}

#[test]
fn params_use_camel_case_wire_names() {
    assert_eq!(
        round_trip(&LoginListRepositoriesParams {
            forge: ForgeKind::Github,
            access_token: "tok".into(),
        }),
        json!({"forge":"github","accessToken":"tok"})
    );
    assert_eq!(
        round_trip(&LoginInspectRepositoryParams {
            forge: ForgeKind::Gitlab,
            access_token: "tok".into(),
            repository_url: "https://example.test/a/b".into(),
        }),
        json!({"forge":"gitlab","accessToken":"tok","repositoryUrl":"https://example.test/a/b"})
    );
    assert_eq!(
        round_trip(&LoginUnlockParams {
            passphrase: "pw".into()
        }),
        json!({"passphrase":"pw"})
    );
    assert_eq!(
        round_trip(&LoginInitializeParams {
            passphrase: "pw".into()
        }),
        json!({"passphrase":"pw"})
    );
    assert_eq!(
        round_trip(&PassphraseStrengthParams {
            passphrase: "pw".into(),
            repository_label: "a/b".into(),
        }),
        json!({"passphrase":"pw","repositoryLabel":"a/b"})
    );
    assert_eq!(
        round_trip(&SessionLogoutParams { anyway: true }),
        json!({"anyway":true})
    );
    assert_eq!(
        round_trip(&NoteOpenParams {
            path: Some(path(&["a", "b"]))
        }),
        json!({"path":["a","b"]})
    );
    assert_eq!(
        round_trip(&NoteOpenParams { path: None }),
        json!({"path":null})
    );
    assert_eq!(
        round_trip(&LifecycleSetVisibleParams { visible: false }),
        json!({"visible":false})
    );
    assert_eq!(
        round_trip(&LifecycleSetOnlineParams { online: true }),
        json!({"online":true})
    );
    assert_eq!(
        round_trip(&NoticeIdParams { id: "n1".into() }),
        json!({"id":"n1"})
    );
    assert_eq!(
        round_trip(&SettingsChangeParams {
            key: SettingKeyView::VimMode,
            value: "true".into(),
        }),
        json!({"key":"vimMode","value":"true"})
    );
}

#[test]
fn setting_keys_use_their_wire_names() {
    for (key, name) in [
        (SettingKeyView::ColorMode, "colorMode"),
        (SettingKeyView::AccentColor, "accentColor"),
        (SettingKeyView::NoteFont, "noteFont"),
        (SettingKeyView::NewNotePlacement, "newNotePlacement"),
        (SettingKeyView::NewFolderPlacement, "newFolderPlacement"),
        (SettingKeyView::TypeToStart, "typeToStart"),
        (SettingKeyView::VimMode, "vimMode"),
    ] {
        assert_eq!(round_trip(&key), json!(name));
    }
}

#[test]
fn secrets_stay_out_of_debug_output() {
    let params = LoginInspectRepositoryParams {
        forge: ForgeKind::Github,
        access_token: "ghp_secret".into(),
        repository_url: "https://example.test/a/b".into(),
    };
    assert!(!format!("{params:?}").contains("ghp_secret"));
    let unlock = LoginUnlockParams {
        passphrase: "correct horse".into(),
    };
    assert!(!format!("{unlock:?}").contains("correct horse"));
}

#[test]
fn forges_and_repository_results() {
    let forges = decode::<ForgesList>(
        r#"{"forges":[{"id":"github","name":"GitHub","accessTokenHint":"hint",
        "accessTokenCreationUrl":"https://a.test/token","repositoryCreationUrl":"https://a.test/new"}]}"#,
    );
    assert_eq!(forges.forges.len(), 1);
    assert_eq!(forges.forges[0].id, ForgeKind::Github);
    assert_eq!(
        forges.forges[0].access_token_creation_url,
        "https://a.test/token"
    );
    assert_eq!(
        forges.forges[0].repository_creation_url,
        "https://a.test/new"
    );

    let last =
        decode::<LoginLastRepository>(r#"{"repoUrl":"https://a.test/x/y","forge":"gitlab"}"#);
    assert_eq!(last.repo_url.as_deref(), Some("https://a.test/x/y"));
    assert_eq!(last.forge, Some(ForgeKind::Gitlab));
    let none = decode::<LoginLastRepository>(r#"{"repoUrl":null,"forge":null}"#);
    assert_eq!(none.repo_url, None);
    assert_eq!(none.forge, None);

    let listed = decode::<LoginListRepositories>(
        r#"{"repositories":[{"url":"u","label":"a/b","private":false}]}"#,
    );
    assert_eq!(
        listed.repositories,
        vec![RepositoryListing {
            url: "u".into(),
            label: "a/b".into(),
            private: false
        }]
    );
}

#[test]
fn inspection_results_cover_every_variant() {
    assert_eq!(
        decode::<LoginInspectRepository>(&format!(
            r#"{{"kind":"notesRepo","repository":{REPOSITORY_JSON}}}"#
        )),
        LoginInspectRepositoryResult::NotesRepo {
            repository: repository()
        }
    );
    assert_eq!(
        decode::<LoginInspectRepository>(&format!(
            r#"{{"kind":"uninitialized","repository":{REPOSITORY_JSON},"setUpDescription":"d"}}"#
        )),
        LoginInspectRepositoryResult::Uninitialized {
            repository: repository(),
            set_up_description: "d".into()
        }
    );
    let unusable = decode::<LoginInspectRepository>(
        r#"{"kind":"unusable","repository":{"label":"a/b","url":"u","private":false,"publicWarning":"Public!"},
        "error":{"kind":"foreign","message":"m","transient":false},
        "canCheckAgain":true,"foreignHint":"hint"}"#,
    );
    assert_eq!(
        unusable,
        LoginInspectRepositoryResult::Unusable {
            repository: RepositoryView {
                label: "a/b".into(),
                url: "u".into(),
                private: false,
                public_warning: Some("Public!".into()),
            },
            error: CoreError::new(CoreErrorKind::Foreign, "m", false),
            can_check_again: true,
            foreign_hint: Some("hint".into()),
        }
    );
    let no_hint = decode::<LoginInspectRepository>(&format!(
        r#"{{"kind":"unusable","repository":{REPOSITORY_JSON},
        "error":{{"kind":"unauthorized","message":"m","transient":false}},
        "canCheckAgain":false,"foreignHint":null}}"#
    ));
    let LoginInspectRepositoryResult::Unusable {
        can_check_again,
        foreign_hint,
        ..
    } = no_hint
    else {
        panic!("expected unusable");
    };
    assert!(!can_check_again);
    assert_eq!(foreign_hint, None);
}

#[test]
fn login_and_strength_results() {
    assert_eq!(
        decode::<LoginUnlock>(r#"{"kind":"loggedIn"}"#),
        LoggedIn::LoggedIn
    );
    assert_eq!(
        decode::<LoginInitialize>(r#"{"kind":"loggedIn"}"#),
        LoggedIn::LoggedIn
    );
    assert_eq!(round_trip(&LoggedIn::LoggedIn), json!({"kind":"loggedIn"}));
    assert_eq!(
        decode::<PassphraseStrengthCheck>(
            r#"{"score":3,"label":"Good","filledSegments":3,"weak":false,"warning":""}"#
        ),
        PassphraseStrength {
            score: 3,
            label: "Good".into(),
            filled_segments: 3,
            weak: false,
            warning: String::new(),
        }
    );
}

#[test]
fn session_results() {
    assert_eq!(
        decode::<SessionResume>(r#"{"kind":"none"}"#),
        SessionResumeResult::None
    );
    assert_eq!(
        decode::<SessionResume>(r#"{"kind":"resumed"}"#),
        SessionResumeResult::Resumed
    );
    assert_eq!(
        decode::<SessionResume>(
            r#"{"kind":"failed","error":{"kind":"network","message":"m","transient":true,
            "retryAfterMs":500},"canRetry":true}"#
        ),
        SessionResumeResult::Failed {
            error: CoreError {
                retry_after_ms: Some(500),
                ..CoreError::new(CoreErrorKind::Network, "m", true)
            },
            can_retry: true,
        }
    );
    assert_eq!(
        decode::<SessionLogout>(r#"{"outcome":{"kind":"loggedOut"}}"#).outcome,
        LogoutOutcome::LoggedOut
    );
    assert_eq!(
        decode::<SessionLogout>(r#"{"outcome":{"kind":"unsaved","count":2,"message":"m"}}"#)
            .outcome,
        LogoutOutcome::Unsaved {
            count: 2,
            message: "m".into()
        }
    );
}

#[test]
fn empty_results_and_device_name() {
    decode::<SyncRefresh>("{}");
    decode::<LifecycleSetVisible>("{}");
    decode::<LifecycleSetOnline>("{}");
    decode::<NoticesDismiss>("{}");
    decode::<NoticesPerform>("{}");
    decode::<SettingsChange>("{}");
    assert_eq!(decode::<DeviceName>(r#"{"name":"Laptop"}"#).name, "Laptop");
    assert!(crate::decode_result::<DeviceName>(json!({"nombre":"x"})).is_err());
    assert_eq!(
        decode::<AnalyticsVisit>(r#"{"url":"https://example.test/"}"#)
            .url
            .as_deref(),
        Some("https://example.test/")
    );
    assert_eq!(decode::<AnalyticsVisit>(r#"{"url":null}"#).url, None);
}

fn plan_folder() -> TreeNode {
    TreeNode::Folder {
        name: "Work".into(),
        path: path(&["Work"]),
        note_count: 1,
        children: vec![TreeNode::Note {
            name: "Plan".into(),
            path: path(&["Work", "Plan"]),
            color_tag: Some(ColorTag::Red),
            shared: true,
        }],
    }
}

#[test]
fn tree_results() {
    let tree = decode::<TreeGet>(
        r#"{"tree":[{"kind":"folder","name":"Work","path":["Work"],"noteCount":1,"children":[
        {"kind":"note","name":"Plan","path":["Work","Plan"],"colorTag":"red","shared":true}]},
        {"kind":"note","name":"Inbox","path":["Inbox"],"colorTag":null,"shared":false}]}"#,
    );
    assert_eq!(
        tree.tree,
        Some(vec![
            plan_folder(),
            TreeNode::Note {
                name: "Inbox".into(),
                path: path(&["Inbox"]),
                color_tag: None,
                shared: false,
            },
        ])
    );
    assert_eq!(decode::<TreeGet>(r#"{"tree":null}"#).tree, None);
}

#[test]
fn every_color_tag_has_its_wire_name() {
    for (tag, name) in [
        (ColorTag::Red, "red"),
        (ColorTag::Orange, "orange"),
        (ColorTag::Yellow, "yellow"),
        (ColorTag::Green, "green"),
        (ColorTag::Blue, "blue"),
        (ColorTag::Purple, "purple"),
    ] {
        assert_eq!(round_trip(&tag), json!(name));
    }
}

#[test]
fn note_open_results_cover_every_state() {
    let p = path(&["a", "b"]);
    assert_eq!(decode::<NoteOpen>(r#"{"note":null}"#).note, None);
    assert_eq!(
        decode::<NoteOpen>(r#"{"note":{"state":"loading","path":["a","b"]}}"#).note,
        Some(OpenNote::Loading { path: p.clone() })
    );
    assert_eq!(
        decode::<NoteOpen>(
            r##"{"note":{"state":"loaded","path":["a","b"],"content":"# hi","conflict":null,"colorTag":"blue","shared":true}}"##
        )
        .note,
        Some(OpenNote::Loaded {
            path: p.clone(),
            content: "# hi".into(),
            conflict: None,
            color_tag: Some(ColorTag::Blue),
            shared: true,
        })
    );
    assert_eq!(
        decode::<NoteOpen>(r#"{"note":{"state":"missing","path":["a","b"],"message":"gone"}}"#)
            .note,
        Some(OpenNote::Missing {
            path: p.clone(),
            message: "gone".into()
        })
    );
    assert_eq!(
        decode::<NoteOpen>(r#"{"note":{"state":"trashed","path":["a","b"],"message":"bin"}}"#).note,
        Some(OpenNote::Trashed {
            path: p.clone(),
            message: "bin".into()
        })
    );
    assert_eq!(
        decode::<NoteOpen>(
            r#"{"note":{"state":"failed","path":["a","b"],"message":"oops",
            "error":{"kind":"undecryptable","message":"m","transient":false}}}"#
        )
        .note,
        Some(OpenNote::Failed {
            path: p,
            message: "oops".into(),
            error: CoreError::new(CoreErrorKind::Undecryptable, "m", false),
        })
    );
}

#[test]
fn open_note_round_trips_a_typed_conflict() {
    let conflict = OpenNoteConflict {
        other_device: Some("Other".into()),
        heading: "h".into(),
        text: "t".into(),
        keep_this_label: "k1".into(),
        keep_other_label: "k2".into(),
        edit_merged_label: "Edit merged".into(),
        edit_hint: "hint".into(),
        merged: "<<<<<<<".into(),
        editing: false,
    };
    let note = OpenNote::Loaded {
        path: path(&["a"]),
        content: "x".into(),
        conflict: Some(conflict.clone()),
        color_tag: Some(ColorTag::Red),
        shared: true,
    };
    let encoded = round_trip(&note);
    assert_eq!(
        encoded["conflict"],
        json!({
            "otherDevice":"Other","heading":"h","text":"t","keepThisLabel":"k1",
            "keepOtherLabel":"k2","editMergedLabel":"Edit merged","editHint":"hint",
            "merged":"<<<<<<<","editing":false
        })
    );
    assert_eq!(encoded["colorTag"], "red");

    let anonymous = OpenNoteConflict {
        other_device: None,
        editing: true,
        ..conflict
    };
    let encoded = round_trip(&anonymous);
    assert_eq!(encoded["otherDevice"], Value::Null);
    assert_eq!(encoded["editing"], true);
}

#[test]
fn open_note_round_trips_every_state() {
    let notes = [
        OpenNote::Loading { path: path(&["a"]) },
        OpenNote::Loaded {
            path: path(&["a"]),
            content: "x".into(),
            conflict: None,
            color_tag: None,
            shared: false,
        },
        OpenNote::Missing {
            path: path(&["a"]),
            message: "m".into(),
        },
        OpenNote::Trashed {
            path: path(&["a"]),
            message: "m".into(),
        },
        OpenNote::Failed {
            path: path(&["a"]),
            message: "m".into(),
            error: CoreError::new(CoreErrorKind::Network, "e", true),
        },
    ];
    for note in &notes {
        round_trip(note);
    }
}

#[test]
fn tree_nodes_round_trip() {
    let encoded = round_trip(&plan_folder());
    assert_eq!(encoded["kind"], "folder");
    assert_eq!(encoded["noteCount"], 1);
    assert_eq!(encoded["children"][0]["kind"], "note");
}

const SETTINGS_VIEW: &str = r#"{"values":{"colorMode":"system","accentColor":"system","noteFont":"sans","newNotePlacement":"top","newFolderPlacement":"bottom","typeToStart":true},"scopes":{"colorMode":"synced","accentColor":"device","noteFont":"synced","typeToStart":"device"},"deviceName":"","automaticDeviceName":"Laptop","reopenLastView":true,"analyticsCounted":false,"canExport":true,"canImport":true,"canChangePassphrase":false}"#;
const SETTINGS_VIEW_WITH_VIM: &str = r#"{"values":{"colorMode":"dark","accentColor":"blue","noteFont":"mono","newNotePlacement":"bottom","newFolderPlacement":"top","typeToStart":false,"vimMode":true},"scopes":{"colorMode":"synced","accentColor":"device","noteFont":"synced","typeToStart":"device"},"deviceName":"Desk","automaticDeviceName":"Laptop","reopenLastView":false,"analyticsCounted":true,"canExport":false,"canImport":false,"canChangePassphrase":true}"#;
const SAVE_VIEW: &str =
    r#"{"state":"failed","label":"Not saved","detail":"Settings not saved","canRetry":true}"#;
const CHOICE: &str = r#"{"label":"Mode","options":[{"id":"a","label":"A","description":null},{"id":"b","label":"B","description":"d"}]}"#;

fn settings_copy_json(vim: bool) -> String {
    let vim = if vim {
        r#""vimMode":{"label":"Vim keys","hint":"vh"},"#
    } else {
        ""
    };
    format!(
        r##"{{"title":"Settings","intro":"i","sections":{{"appearance":"a","editor":"e","notes":"n","thisDevice":"t","dataSecurity":"d"}},"scopeLabels":{{"synced":"All devices","device":"This device"}},"colorMode":{CHOICE},"accentColor":{{"label":"Accent","options":[{{"id":"system","label":"System","light":null,"dark":null}},{{"id":"blue","label":"Blue","light":"#0000ff","dark":"#8888ff"}}]}},"noteFont":{{"label":"Font","options":[{{"id":"sans","label":"Sans","description":null}}],"previewHeading":"h","previewBody":"b","previewCode":"c"}},"editorUnavailable":"u","typeToStart":{{"label":"Type to start","hint":"th"}},{vim}"newNotePlacement":{CHOICE},"newFolderPlacement":{CHOICE},"deviceName":{{"label":"l","hint":"h","maxLength":40}},"reopenLastView":{{"label":"r"}},"analytics":{{"label":"l","hint":"h"}},"data":{{"exportLabel":"1","exportingLabel":"2","exportShareLabel":"3","exportFilesLabel":"4","exportFailed":"5","importLabel":"6","importingLabel":"7","changePassphraseLabel":"8"}},"retryLabel":"Retry"}}"##
    )
}

#[test]
fn settings_open_result_without_vim_mode() {
    let value = decode::<SettingsOpen>(&format!(
        r#"{{"copy":{},"view":{SETTINGS_VIEW},"save":{SAVE_VIEW}}}"#,
        settings_copy_json(false)
    ));
    assert_eq!(value.copy.title, "Settings");
    assert_eq!(value.copy.scope_labels.device, "This device");
    assert_eq!(
        value.copy.color_mode.options[1].description.as_deref(),
        Some("d")
    );
    assert_eq!(value.copy.color_mode.options[0].description, None);
    assert_eq!(value.copy.accent_color.options[0].light, None);
    assert_eq!(
        value.copy.accent_color.options[1].dark.as_deref(),
        Some("#8888ff")
    );
    assert_eq!(value.copy.note_font.preview_code, "c");
    assert_eq!(value.copy.device_name.max_length, 40);
    assert_eq!(value.copy.data.change_passphrase_label, "8");
    assert_eq!(value.copy.type_to_start.hint, "th");
    assert_eq!(value.copy.vim_mode, None);
    assert_eq!(value.view.values.vim_mode, None);
    assert_eq!(value.view.scopes.accent_color, SettingScope::Device);
    assert_eq!(value.view.values.new_folder_placement, "bottom");
    assert!(value.view.values.type_to_start);
    assert_eq!(value.view.automatic_device_name, "Laptop");
    assert!(!value.view.can_change_passphrase);
    assert_eq!(value.save.state, SettingsSaveState::Failed);
    assert!(value.save.can_retry);

    let encoded = serde_json::to_value(&value.copy).unwrap();
    assert!(encoded.get("vimMode").is_none());
    let encoded_view = serde_json::to_value(&value.view).unwrap();
    assert!(encoded_view["values"].get("vimMode").is_none());
}

#[test]
fn settings_open_result_with_vim_mode() {
    let value = decode::<SettingsOpen>(&format!(
        r#"{{"copy":{},"view":{SETTINGS_VIEW_WITH_VIM},"save":{SAVE_VIEW}}}"#,
        settings_copy_json(true)
    ));
    let vim = value.copy.vim_mode.expect("vim copy");
    assert_eq!(vim.label, "Vim keys");
    assert_eq!(vim.hint, "vh");
    assert_eq!(value.view.values.vim_mode, Some(true));
    assert_eq!(value.view.device_name, "Desk");
    assert!(value.view.analytics_counted);
}

#[test]
fn settings_save_states_round_trip() {
    for (state, name) in [
        (SettingsSaveState::Synced, "synced"),
        (SettingsSaveState::Syncing, "syncing"),
        (SettingsSaveState::Pending, "pending"),
        (SettingsSaveState::Failed, "failed"),
    ] {
        assert_eq!(round_trip(&state), json!(name));
    }
}

#[test]
fn editing_params_use_camel_case_wire_names() {
    assert_eq!(
        round_trip(&NoteEditParams {
            path: path(&["a", "b"]),
            text: "x".into()
        }),
        json!({"path":["a","b"],"text":"x"})
    );
    assert_eq!(
        round_trip(&ConflictResolveParams {
            path: path(&["a"]),
            resolution: ConflictResolution::EditMerged
        }),
        json!({"path":["a"],"resolution":"editMerged"})
    );
    assert_eq!(
        round_trip(&DraftStartParams { parent: vec![] }),
        json!({"parent":[]})
    );
    assert_eq!(
        round_trip(&DraftCommitNameParams { name: "n".into() }),
        json!({"name":"n"})
    );
    assert_eq!(
        round_trip(&DraftContentParams {
            name: "n".into(),
            content: "c".into()
        }),
        json!({"name":"n","content":"c"})
    );
    assert_eq!(
        round_trip(&NoteRenameParams {
            path: path(&["a"]),
            name: "n".into()
        }),
        json!({"path":["a"],"name":"n"})
    );
    assert_eq!(
        round_trip(&EarlyDraftHandOffParams {
            name: "n".into(),
            body: "b".into(),
            name_confirmed: true
        }),
        json!({"name":"n","body":"b","nameConfirmed":true})
    );
}

#[test]
fn conflict_resolutions_are_plain_strings() {
    for (resolution, wire) in [
        (ConflictResolution::KeepMine, "keepMine"),
        (ConflictResolution::KeepTheirs, "keepTheirs"),
        (ConflictResolution::EditMerged, "editMerged"),
    ] {
        assert_eq!(round_trip(&resolution), json!(wire));
    }
}

#[test]
fn edit_and_sync_results_decode() {
    decode::<NoteEdit>("{}");
    decode::<SyncRetry>("{}");
    decode::<ConflictResolve>("{}");
    decode::<DraftLeave>("{}");
    assert_eq!(
        decode::<SyncFlush>(r#"{"result":{"kind":"saved"}}"#).result,
        FlushOutcome::Saved
    );
    assert_eq!(
        decode::<SyncFlush>(r#"{"result":{"kind":"unsaved","count":2}}"#).result,
        FlushOutcome::Unsaved { count: 2 }
    );
    assert_eq!(
        round_trip(&FlushOutcome::Unsaved { count: 2 }),
        json!({"kind":"unsaved","count":2})
    );
}

#[test]
fn draft_results_decode() {
    assert_eq!(
        decode::<DraftStart>(r#"{"draft":{"parent":["f"],"name":"Untitled"}}"#).draft,
        NoteDraft {
            parent: path(&["f"]),
            name: "Untitled".into()
        }
    );
    for (text, expected) in [
        (r#"{"outcome":{"kind":"none"}}"#, NoteDraftOutcome::None),
        (
            r#"{"outcome":{"kind":"error","message":"taken"}}"#,
            NoteDraftOutcome::Error {
                message: "taken".into(),
            },
        ),
        (
            r#"{"outcome":{"kind":"created","path":["f","n"],"fieldError":null}}"#,
            NoteDraftOutcome::Created {
                path: path(&["f", "n"]),
                field_error: None,
            },
        ),
        (
            r#"{"outcome":{"kind":"created","path":["f","n"],"fieldError":"bad"}}"#,
            NoteDraftOutcome::Created {
                path: path(&["f", "n"]),
                field_error: Some("bad".into()),
            },
        ),
    ] {
        assert_eq!(decode::<DraftCommitName>(text).outcome, expected);
        assert_eq!(decode::<DraftContent>(text).outcome, expected);
    }
    assert_eq!(
        round_trip(&NoteDraftOutcome::Created {
            path: path(&["n"]),
            field_error: Some("bad".into())
        }),
        json!({"kind":"created","path":["n"],"fieldError":"bad"})
    );
}

#[test]
fn rename_results_decode() {
    for (text, expected) in [
        (r#"{"outcome":{"kind":"none"}}"#, NameCommitOutcome::None),
        (
            r#"{"outcome":{"kind":"restore"}}"#,
            NameCommitOutcome::Restore,
        ),
        (
            r#"{"outcome":{"kind":"error","message":"exists"}}"#,
            NameCommitOutcome::Error {
                message: "exists".into(),
            },
        ),
        (
            r#"{"outcome":{"kind":"ok","path":["f","m"]}}"#,
            NameCommitOutcome::Ok {
                path: path(&["f", "m"]),
            },
        ),
    ] {
        assert_eq!(decode::<NoteRename>(text).outcome, expected);
    }
}

#[test]
fn early_draft_results_decode() {
    for (text, expected) in [
        (r#"{"outcome":{"kind":"none"}}"#, EarlyDraftOutcome::None),
        (
            r#"{"outcome":{"kind":"draft","name":"n","error":null}}"#,
            EarlyDraftOutcome::Draft {
                name: "n".into(),
                error: None,
            },
        ),
        (
            r#"{"outcome":{"kind":"draft","name":"n","error":"bad"}}"#,
            EarlyDraftOutcome::Draft {
                name: "n".into(),
                error: Some("bad".into()),
            },
        ),
        (
            r#"{"outcome":{"kind":"created","path":["n"],"fieldError":null}}"#,
            EarlyDraftOutcome::Created {
                path: path(&["n"]),
                field_error: None,
            },
        ),
        (
            r#"{"outcome":{"kind":"created","path":["n"],"fieldError":"bad"}}"#,
            EarlyDraftOutcome::Created {
                path: path(&["n"]),
                field_error: Some("bad".into()),
            },
        ),
    ] {
        assert_eq!(decode::<EarlyDraftHandOff>(text).outcome, expected);
    }
}

fn restore_target(label: &str, depth: u32, disabled: bool) -> MoveTargetView {
    MoveTargetView {
        path: path(&[label]),
        label: label.into(),
        depth,
        disabled,
    }
}

#[test]
fn structure_commands_have_their_wire_names() {
    for (name, wire) in [
        (FolderCreate::NAME, "folder.create"),
        (NodeRename::NAME, "node.rename"),
        (NodeMove::NAME, "node.move"),
        (NodePlace::NAME, "node.place"),
        (NodeMoveSibling::NAME, "node.moveSibling"),
        (NodeMoveTargets::NAME, "node.moveTargets"),
        (NodeTrashPreview::NAME, "node.trashPreview"),
        (NodeTrash::NAME, "node.trash"),
        (NodeSetColorTag::NAME, "node.setColorTag"),
        (TrashRestoreTargets::NAME, "trash.restoreTargets"),
        (TrashRestore::NAME, "trash.restore"),
        (TrashDelete::NAME, "trash.delete"),
        (TrashEmpty::NAME, "trash.empty"),
        (TagsSetFilter::NAME, "tags.setFilter"),
    ] {
        assert_eq!(name, wire);
    }
}

#[test]
fn structure_params_use_camel_case_wire_names() {
    assert_eq!(
        params_json::<FolderCreate>(&FolderCreateParams {
            parent: path(&["a"]),
            name: "n".into()
        }),
        json!({"parent":["a"],"name":"n"})
    );
    assert_eq!(
        params_json::<NodeRename>(&NodeRenameParams {
            path: path(&["a", "b"]),
            name: "n".into()
        }),
        json!({"path":["a","b"],"name":"n"})
    );
    assert_eq!(
        params_json::<NodeMove>(&NodeMoveParams {
            path: path(&["a"]),
            parent: vec![]
        }),
        json!({"path":["a"],"parent":[]})
    );
    assert_eq!(
        params_json::<NodePlace>(&NodePlaceParams {
            path: path(&["a"]),
            parent: path(&["f"]),
            before: None
        }),
        json!({"path":["a"],"parent":["f"],"before":null})
    );
    assert_eq!(
        params_json::<NodePlace>(&NodePlaceParams {
            path: path(&["a"]),
            parent: path(&["f"]),
            before: Some("b".into())
        }),
        json!({"path":["a"],"parent":["f"],"before":"b"})
    );
    for (direction, wire) in [(MoveDirection::Up, "up"), (MoveDirection::Down, "down")] {
        assert_eq!(
            params_json::<NodeMoveSibling>(&NodeMoveSiblingParams {
                path: path(&["a"]),
                direction
            }),
            json!({"path":["a"],"direction":wire})
        );
        assert_eq!(round_trip(&direction), json!(wire));
    }
    assert_eq!(
        params_json::<NodeMoveTargets>(&NodePathParams { path: path(&["a"]) }),
        json!({"path":["a"]})
    );
    assert_eq!(
        params_json::<NodeTrashPreview>(&NodePathParams { path: path(&["a"]) }),
        json!({"path":["a"]})
    );
    assert_eq!(
        params_json::<NodeTrash>(&NodeTrashParams {
            path: path(&["a"]),
            share_count: 2
        }),
        json!({"path":["a"],"shareCount":2})
    );
    assert_eq!(
        params_json::<TrashRestoreTargets>(&TrashRestoreTargetsParams {
            entry_id: "e1".into(),
            sub_path: path(&["x"])
        }),
        json!({"entryId":"e1","subPath":["x"]})
    );
    assert_eq!(
        params_json::<TrashRestore>(&TrashRestoreParams {
            entry_id: "e1".into(),
            sub_path: vec![],
            parent: path(&["f"])
        }),
        json!({"entryId":"e1","subPath":[],"parent":["f"]})
    );
    assert_eq!(
        params_json::<TrashDelete>(&TrashDeleteParams {
            entry_id: "e1".into()
        }),
        json!({"entryId":"e1"})
    );
    assert_eq!(params_json::<TrashEmpty>(&TrashEmptyParams {}), json!({}));
}

#[test]
fn color_tag_params_keep_a_null_tag_on_the_wire() {
    assert_eq!(
        params_json::<NodeSetColorTag>(&NodeSetColorTagParams {
            path: path(&["a"]),
            tag: None
        }),
        json!({"path":["a"],"tag":null})
    );
    assert_eq!(
        params_json::<NodeSetColorTag>(&NodeSetColorTagParams {
            path: path(&["a"]),
            tag: Some(ColorTag::Purple)
        }),
        json!({"path":["a"],"tag":"purple"})
    );
    assert_eq!(
        params_json::<TagsSetFilter>(&TagsSetFilterParams { tag: None }),
        json!({"tag":null})
    );
    assert_eq!(
        params_json::<TagsSetFilter>(&TagsSetFilterParams {
            tag: Some(ColorTag::Orange)
        }),
        json!({"tag":"orange"})
    );
}

#[test]
fn structure_outcomes_decode() {
    for (text, expected) in [
        (
            r#"{"outcome":{"kind":"ok","path":["f","n"]}}"#,
            StructureOutcome::Ok {
                path: path(&["f", "n"]),
            },
        ),
        (
            r#"{"outcome":{"kind":"error","message":"taken"}}"#,
            StructureOutcome::Error {
                message: "taken".into(),
            },
        ),
    ] {
        assert_eq!(decode::<NodeRename>(text).outcome, expected);
        assert_eq!(decode::<NodeMove>(text).outcome, expected);
        assert_eq!(decode::<NodePlace>(text).outcome, expected);
        assert_eq!(decode::<NodeSetColorTag>(text).outcome, expected);
        assert_eq!(decode::<TrashRestore>(text).outcome, expected);
        round_trip(&expected);
    }
    assert_eq!(
        round_trip(&StructureOutcome::Ok { path: path(&["n"]) }),
        json!({"kind":"ok","path":["n"]})
    );
}

#[test]
fn folder_create_outcomes_decode() {
    assert_eq!(
        decode::<FolderCreate>(r#"{"outcome":{"kind":"created","path":["f"]}}"#).outcome,
        FolderCreateOutcome::Created { path: path(&["f"]) }
    );
    assert_eq!(
        decode::<FolderCreate>(r#"{"outcome":{"kind":"error","message":"exists"}}"#).outcome,
        FolderCreateOutcome::Error {
            message: "exists".into()
        }
    );
}

#[test]
fn move_sibling_outcomes_decode() {
    for (text, expected) in [
        (
            r#"{"outcome":{"kind":"ok","path":["f","n"]}}"#,
            MoveSiblingOutcome::Ok {
                path: path(&["f", "n"]),
            },
        ),
        (
            r#"{"outcome":{"kind":"error","message":"m"}}"#,
            MoveSiblingOutcome::Error {
                message: "m".into(),
            },
        ),
        (r#"{"outcome":{"kind":"none"}}"#, MoveSiblingOutcome::None),
    ] {
        assert_eq!(decode::<NodeMoveSibling>(text).outcome, expected);
    }
    assert_eq!(
        round_trip(&MoveSiblingOutcome::None),
        json!({"kind":"none"})
    );
}

#[test]
fn move_target_results_decode() {
    let text = r#"{"targets":[
        {"path":[],"label":"All notes","depth":0,"disabled":false},
        {"path":["f"],"label":"f","depth":1,"disabled":true}]}"#;
    let expected = vec![
        MoveTargetView {
            path: vec![],
            label: "All notes".into(),
            depth: 0,
            disabled: false,
        },
        restore_target("f", 1, true),
    ];
    assert_eq!(decode::<NodeMoveTargets>(text).targets, expected);
    assert_eq!(decode::<TrashRestoreTargets>(text).targets, expected);
    assert_eq!(
        decode::<NodeMoveTargets>(r#"{"targets":[]}"#).targets,
        vec![]
    );
}

fn trash_preview() -> TrashPreview {
    TrashPreview {
        title: "Move to Trash?".into(),
        message: "m".into(),
        confirm_label: "Move to Trash".into(),
        item_count: 3,
        share_count: 1,
    }
}

const TRASH_PREVIEW_JSON: &str = r#"{"title":"Move to Trash?","message":"m","confirmLabel":"Move to Trash","itemCount":3,"shareCount":1}"#;

#[test]
fn trash_preview_uses_camel_case_wire_names() {
    assert_eq!(
        decode::<NodeTrashPreview>(&format!(r#"{{"preview":{TRASH_PREVIEW_JSON}}}"#)).preview,
        trash_preview()
    );
    assert_eq!(
        round_trip(&trash_preview()),
        json!({
            "title":"Move to Trash?","message":"m","confirmLabel":"Move to Trash",
            "itemCount":3,"shareCount":1
        })
    );
}

#[test]
fn trash_outcomes_decode() {
    for (text, expected) in [
        (
            r#"{"outcome":{"kind":"trashed","entryId":"e1"}}"#.to_owned(),
            TrashOutcome::Trashed {
                entry_id: "e1".into(),
            },
        ),
        (
            r#"{"outcome":{"kind":"deleted"}}"#.to_owned(),
            TrashOutcome::Deleted,
        ),
        (
            format!(r#"{{"outcome":{{"kind":"confirm","preview":{TRASH_PREVIEW_JSON}}}}}"#),
            TrashOutcome::Confirm {
                preview: trash_preview(),
            },
        ),
        (
            r#"{"outcome":{"kind":"error","message":"m"}}"#.to_owned(),
            TrashOutcome::Error {
                message: "m".into(),
            },
        ),
    ] {
        assert_eq!(decode::<NodeTrash>(&text).outcome, expected);
    }
    assert_eq!(
        round_trip(&TrashOutcome::Trashed {
            entry_id: "e1".into()
        }),
        json!({"kind":"trashed","entryId":"e1"})
    );
    assert_eq!(
        round_trip(&TrashOutcome::Deleted),
        json!({"kind":"deleted"})
    );
}

#[test]
fn empty_trash_results_decode() {
    decode::<TrashDelete>("{}");
    decode::<TrashEmpty>("{}");
    decode::<TagsSetFilter>("{}");
}

#[test]
fn trash_entries_round_trip_with_nested_items() {
    let entry = TrashEntryView {
        id: "e1".into(),
        kind: TrashItemKind::Folder,
        name: "Plans".into(),
        original_folder: "Work".into(),
        days_left: "29 days left".into(),
        color_tag: Some(ColorTag::Red),
        children: vec![TrashItemView {
            kind: TrashItemKind::Folder,
            name: "Q1".into(),
            sub_path: path(&["Q1"]),
            children: vec![TrashItemView {
                kind: TrashItemKind::Note,
                name: "Goals".into(),
                sub_path: path(&["Q1", "Goals"]),
                children: vec![],
            }],
        }],
    };
    assert_eq!(
        round_trip(&entry),
        json!({
            "id":"e1","kind":"folder","name":"Plans","originalFolder":"Work",
            "daysLeft":"29 days left","colorTag":"red",
            "children":[{"kind":"folder","name":"Q1","subPath":["Q1"],"children":[
                {"kind":"note","name":"Goals","subPath":["Q1","Goals"],"children":[]}]}]
        })
    );
    assert_eq!(
        round_trip(&TrashConfirmationText {
            title: "t".into(),
            message: "m".into()
        }),
        json!({"title":"t","message":"m"})
    );
}

fn search_row_json() -> Value {
    json!({
        "path":["Work","Plan"],"name":"Plan","folder":"Work",
        "nameRanges":[[0,2],[3,4]],
        "snippet":[{"text":"a ","match":false},{"text":"plan","match":true}],
        "colorTag":"blue"
    })
}

#[test]
fn search_row_round_trips_with_ranges_and_snippet() {
    let row = SearchRow {
        path: path(&["Work", "Plan"]),
        name: "Plan".into(),
        folder: Some("Work".into()),
        name_ranges: vec![(0, 2), (3, 4)],
        snippet: Some(vec![
            SnippetPart {
                text: "a ".into(),
                is_match: false,
            },
            SnippetPart {
                text: "plan".into(),
                is_match: true,
            },
        ]),
        color_tag: Some(ColorTag::Blue),
    };
    assert_eq!(round_trip(&row), search_row_json());
}

#[test]
fn search_row_with_null_folder_and_snippet_round_trips() {
    let row = SearchRow {
        path: path(&["Idea"]),
        name: "Idea".into(),
        folder: None,
        name_ranges: vec![],
        snippet: None,
        color_tag: None,
    };
    assert_eq!(
        round_trip(&row),
        json!({"path":["Idea"],"name":"Idea","folder":null,"nameRanges":[],"snippet":null,"colorTag":null})
    );
}

#[test]
fn search_query_decodes_results() {
    let text = json!({"results":{
        "recent":[],"names":[search_row_json()],"contents":[],
        "countText":"1 result","namesMore":"Show All","contentsMore":null,
        "copy":{"recentHeading":"Recent","namesHeading":"Names","contentsHeading":"Contents",
                "noMatches":"No matches","stillReading":"Still reading","hint":"Type to search"}
    }})
    .to_string();
    let results = decode::<SearchQuery>(&text).results;
    assert_eq!(results.names.len(), 1);
    assert_eq!(results.names[0].name_ranges, vec![(0, 2), (3, 4)]);
    assert_eq!(results.count_text.as_deref(), Some("1 result"));
    assert_eq!(results.names_more.as_deref(), Some("Show All"));
    assert_eq!(results.contents_more, None);
    assert_eq!(results.copy.still_reading, "Still reading");
    assert_eq!(
        params_json::<SearchQuery>(&SearchQueryParams { query: "pl".into() }),
        json!({"query":"pl"})
    );
}

#[test]
fn search_open_and_close_use_empty_shapes() {
    let empty = json!({});
    assert_eq!(params_json::<SearchOpen>(&SearchOpenParams {}), empty);
    assert_eq!(params_json::<SearchClose>(&SearchCloseParams {}), empty);
    decode::<SearchOpen>("{}");
    decode::<SearchClose>("{}");
}

#[test]
fn note_stats_decode_with_and_without_tasks() {
    let with_tasks = decode::<NoteStats>(
        r#"{"words":{"label":"Words","value":"12"},"tasks":{"label":"Tasks","value":"1 of 2"}}"#,
    );
    assert_eq!(
        with_tasks.tasks,
        Some(DetailItemText {
            label: "Tasks".into(),
            value: "1 of 2".into()
        })
    );
    let without = decode::<NoteStats>(r#"{"words":{"label":"Words","value":"0"},"tasks":null}"#);
    assert_eq!(without.tasks, None);
    assert_eq!(without.words.value, "0");
    assert_eq!(
        params_json::<NoteStats>(&NoteStatsParams { path: path(&["A"]) }),
        json!({"path":["A"]})
    );
}

#[test]
fn note_dates_decode_not_saved_with_nulls() {
    let dates = decode::<NoteDates>(r#"{"notSaved":true,"created":null,"updated":null}"#);
    assert!(dates.not_saved);
    assert_eq!(dates.created, None);
    assert_eq!(dates.updated, None);
    let saved = decode::<NoteDates>(
        r#"{"notSaved":false,"created":{"label":"Created","value":"Today"},"updated":{"label":"Updated","value":"Now"}}"#,
    );
    assert_eq!(saved.created.unwrap().label, "Created");
    assert_eq!(
        params_json::<NoteDates>(&NoteDatesParams { path: path(&["A"]) }),
        json!({"path":["A"]})
    );
}

#[test]
fn last_view_commands_encode_and_decode() {
    let state = LastViewState {
        note: Some(path(&["Work", "Plan"])),
        folders: vec![path(&["Work"]), path(&["Work", "Q1"])],
    };
    assert_eq!(
        params_json::<LastViewSave>(&state),
        json!({"note":["Work","Plan"],"folders":[["Work"],["Work","Q1"]]})
    );
    assert_eq!(
        params_json::<LastViewSetEnabled>(&LastViewSetEnabledParams {
            enabled: true,
            view: LastViewState {
                note: None,
                folders: vec![],
            },
        }),
        json!({"enabled":true,"view":{"note":null,"folders":[]}})
    );
    assert_eq!(
        params_json::<LastViewLoad>(&LastViewLoadParams {}),
        json!({})
    );
    assert_eq!(decode::<LastViewLoad>(r#"{"view":null}"#).view, None);
    let loaded = decode::<LastViewLoad>(r#"{"view":{"note":null,"folders":[["A"]]}}"#);
    assert_eq!(
        loaded.view,
        Some(LastViewState {
            note: None,
            folders: vec![path(&["A"])],
        })
    );
    decode::<LastViewSave>("{}");
    decode::<LastViewSetEnabled>("{}");
}

#[test]
fn image_read_decodes_an_image_or_null() {
    let webp = decode::<ImageRead>(r#"{"image":{"type":"image/webp","base64":"UklG"}}"#);
    assert_eq!(
        webp.image,
        Some(ReadImage {
            image_type: ReadImageType::Webp,
            base64: "UklG".into()
        })
    );
    let gif = decode::<ImageRead>(r#"{"image":{"type":"image/gif","base64":"R0lG"}}"#);
    assert_eq!(
        gif.image.map(|image| image.image_type),
        Some(ReadImageType::Gif)
    );
    assert_eq!(decode::<ImageRead>(r#"{"image":null}"#).image, None);
    assert_eq!(
        params_json::<ImageRead>(&ImageReadParams {
            image_id: "abc".into()
        }),
        json!({"imageId":"abc"})
    );
}

#[test]
fn image_read_rejects_unknown_types() {
    let value: Value =
        serde_json::from_str(r#"{"image":{"type":"image/png","base64":""}}"#).unwrap();
    assert!(crate::decode_result::<ImageRead>(value).is_err());
}

#[test]
fn image_insert_uses_camel_case_wire_names() {
    assert_eq!(
        params_json::<ImageInsert>(&ImageInsertParams {
            inputs: vec!["a".into(), "b".into()]
        }),
        json!({"inputs":["a","b"]})
    );
    let result = decode::<ImageInsert>(r#"{"references":["![](image:abc#640x480)"]}"#);
    assert_eq!(result.references, vec!["![](image:abc#640x480)".to_owned()]);
    assert!(
        decode::<ImageInsert>(r#"{"references":[]}"#)
            .references
            .is_empty()
    );
}

#[test]
fn image_clone_pasted_encodes_draft_and_saved_targets() {
    assert_eq!(
        params_json::<ImageClonePasted>(&ImageClonePastedParams {
            path: Some(path(&["A", "B"])),
            current: "c".into(),
            pasted: "p".into(),
        }),
        json!({"path":["A","B"],"current":"c","pasted":"p"})
    );
    assert_eq!(
        params_json::<ImageClonePasted>(&ImageClonePastedParams {
            path: None,
            current: "c".into(),
            pasted: "p".into(),
        }),
        json!({"path":null,"current":"c","pasted":"p"})
    );
    assert_eq!(decode::<ImageClonePasted>(r#"{"text":"x"}"#).text, "x");
}

fn version_json(sha: &str) -> Value {
    json!({
        "sha": sha,
        "time": "10:30",
        "dateTime": "Mon, 2 Mar 2026, 10:30",
        "current": false,
        "shared": true,
        "events": ["Edited", "Renamed"],
        "name": null
    })
}

fn version(sha: &str) -> HistoryVersionView {
    HistoryVersionView {
        sha: sha.into(),
        time: "10:30".into(),
        date_time: "Mon, 2 Mar 2026, 10:30".into(),
        current: false,
        shared: true,
        events: vec!["Edited".into(), "Renamed".into()],
        name: None,
    }
}

#[test]
fn history_params_use_camel_case_wire_names() {
    assert_eq!(
        params_json::<HistoryOpen>(&HistoryOpenParams {
            path: path(&["A", "B"])
        }),
        json!({"path":["A","B"]})
    );
    assert_eq!(
        params_json::<HistoryPreview>(&HistoryPreviewParams {
            sha: "abc".into(),
            restore_title: true
        }),
        json!({"sha":"abc","restoreTitle":true})
    );
    assert_eq!(
        params_json::<HistoryRestore>(&HistoryRestoreParams {
            sha: "abc".into(),
            restore_title: false
        }),
        json!({"sha":"abc","restoreTitle":false})
    );
    decode::<HistoryOpen>("{}");
    decode::<HistoryClose>("{}");
    decode::<HistoryLoadMore>("{}");
    decode::<HistoryRetry>("{}");
}

#[test]
fn history_view_round_trips_single_and_session_rows() {
    let view = HistoryView {
        path: path(&["A"]),
        phase: HistoryPhase::Ready,
        message: None,
        sections: vec![HistorySection {
            title: "Today".into(),
            rows: vec![
                HistoryRow::Single {
                    version: version("a1"),
                },
                HistoryRow::Session {
                    title: "3 edits".into(),
                    shared: false,
                    versions: vec![version("b1"), version("b2")],
                },
            ],
        }],
        loading: false,
        error: None,
        end: Some("That is all".into()),
        can_load_more: false,
    };
    let json = round_trip(&view);
    assert_eq!(json["phase"], "ready");
    assert_eq!(json["sections"][0]["rows"][0]["kind"], "single");
    assert_eq!(
        json["sections"][0]["rows"][0]["version"],
        version_json("a1")
    );
    assert_eq!(json["sections"][0]["rows"][1]["kind"], "session");
    assert_eq!(json["canLoadMore"], false);
}

#[test]
fn history_phases_use_their_wire_names() {
    for (phase, name) in [
        (HistoryPhase::Saving, "saving"),
        (HistoryPhase::Unsaved, "unsaved"),
        (HistoryPhase::Ready, "ready"),
    ] {
        assert_eq!(round_trip(&phase), json!(name));
    }
}

#[test]
fn version_preview_with_a_diff_round_trips() {
    let text = r#"{"preview":{"kind":"version","titleChange":"Old title","body":{"kind":"diff",
        "items":[
        {"kind":"line","line":{"kind":"same","text":"kept"}},
        {"kind":"line","line":{"kind":"added","segments":[
            {"text":"new ","changed":false},{"text":"word","changed":true}]}},
        {"kind":"line","line":{"kind":"removed","segments":[{"text":"gone","changed":true}]}},
        {"kind":"fold","label":"2 unchanged lines","lines":[
            {"kind":"same","text":"x"},{"kind":"same","text":"y"}]}],
        "finalNewline":"No newline at end of file"},
        "restoreTitle":"Also restore the title","restore":{"label":"Restore this version","enabled":true,"reason":null}}}"#;
    let preview = decode::<HistoryPreview>(text).preview;
    let VersionPreview::Version {
        title_change,
        body,
        restore_title,
        restore,
    } = preview
    else {
        panic!("expected a version preview");
    };
    assert_eq!(title_change.as_deref(), Some("Old title"));
    assert_eq!(restore_title.as_deref(), Some("Also restore the title"));
    assert_eq!(
        restore,
        RestoreAction {
            label: "Restore this version".into(),
            enabled: true,
            reason: None
        }
    );
    let PreviewBody::Diff {
        items,
        final_newline,
    } = body
    else {
        panic!("expected a diff");
    };
    assert_eq!(final_newline.as_deref(), Some("No newline at end of file"));
    assert_eq!(items.len(), 4);
    assert_eq!(
        items[0],
        DiffItemView::Line {
            line: DiffLineView::Same {
                text: "kept".into()
            }
        }
    );
    assert_eq!(
        items[1],
        DiffItemView::Line {
            line: DiffLineView::Added {
                segments: vec![
                    DiffSegment {
                        text: "new ".into(),
                        changed: false
                    },
                    DiffSegment {
                        text: "word".into(),
                        changed: true
                    },
                ]
            }
        }
    );
    assert!(matches!(
        &items[2],
        DiffItemView::Line {
            line: DiffLineView::Removed { .. }
        }
    ));
    assert_eq!(
        items[3],
        DiffItemView::Fold {
            label: "2 unchanged lines".into(),
            lines: vec![
                DiffLineView::Same { text: "x".into() },
                DiffLineView::Same { text: "y".into() },
            ]
        }
    );
}

#[test]
fn version_preview_without_titles_keeps_nulls_on_the_wire() {
    let preview = VersionPreview::Version {
        title_change: None,
        body: PreviewBody::Diff {
            items: vec![],
            final_newline: None,
        },
        restore_title: None,
        restore: RestoreAction {
            label: "Restore".into(),
            enabled: false,
            reason: Some("Unsaved changes".into()),
        },
    };
    let json = round_trip(&preview);
    assert_eq!(json["titleChange"], Value::Null);
    assert_eq!(json["restoreTitle"], Value::Null);
    assert_eq!(json["body"]["finalNewline"], Value::Null);
    assert_eq!(json["restore"]["reason"], "Unsaved changes");
}

#[test]
fn version_preview_failures_decode() {
    for (kind, expected) in [
        (
            "failed",
            VersionPreview::Failed {
                message: "m".into(),
            },
        ),
        (
            "undecryptable",
            VersionPreview::Undecryptable {
                message: "m".into(),
            },
        ),
        (
            "closed",
            VersionPreview::Closed {
                message: "m".into(),
            },
        ),
    ] {
        let text = format!(r#"{{"preview":{{"kind":"{kind}","message":"m"}}}}"#);
        assert_eq!(decode::<HistoryPreview>(&text).preview, expected);
        assert_eq!(round_trip(&expected)["kind"], kind);
    }
}

#[test]
fn preview_bodies_without_a_diff_decode() {
    let too_large = decode::<HistoryPreview>(
        r#"{"preview":{"kind":"version","titleChange":null,"body":{"kind":"tooLarge","message":"Too large"},
        "restoreTitle":null,"restore":{"label":"Restore","enabled":true,"reason":null}}}"#,
    );
    assert!(matches!(
        too_large.preview,
        VersionPreview::Version {
            body: PreviewBody::TooLarge { .. },
            ..
        }
    ));
    let unchanged = decode::<HistoryPreview>(
        r#"{"preview":{"kind":"version","titleChange":null,"body":{"kind":"unchanged","message":"Same"},
        "restoreTitle":null,"restore":{"label":"Restore","enabled":false,"reason":"Current"}}}"#,
    );
    assert!(matches!(
        unchanged.preview,
        VersionPreview::Version {
            body: PreviewBody::Unchanged { .. },
            ..
        }
    ));
}

#[test]
fn restore_outcomes_decode() {
    assert_eq!(
        decode::<HistoryRestore>(r#"{"outcome":{"kind":"restored"}}"#).outcome,
        RestoreVersionOutcome::Restored
    );
    assert_eq!(
        decode::<HistoryRestore>(r#"{"outcome":{"kind":"blocked","message":"b"}}"#).outcome,
        RestoreVersionOutcome::Blocked {
            message: "b".into()
        }
    );
    assert_eq!(
        decode::<HistoryRestore>(r#"{"outcome":{"kind":"error","message":"e"}}"#).outcome,
        RestoreVersionOutcome::Error {
            message: "e".into()
        }
    );
    assert_eq!(
        decode::<HistoryRestore>(r#"{"outcome":{"kind":"closed"}}"#).outcome,
        RestoreVersionOutcome::Closed
    );
}
