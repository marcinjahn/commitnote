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
fn open_note_keeps_the_conflict_payload_verbatim() {
    let conflict = json!({
        "otherDevice":"Other","heading":"h","text":"t","keepThisLabel":"k1",
        "keepOtherLabel":"k2","editMergedLabel":"Edit merged","editHint":"hint",
        "merged":"<<<<<<<","editing":false
    });
    let note = OpenNote::Loaded {
        path: path(&["a"]),
        content: "x".into(),
        conflict: Some(conflict.clone()),
        color_tag: Some(ColorTag::Red),
        shared: true,
    };
    let encoded = round_trip(&note);
    assert_eq!(encoded["conflict"], conflict);
    assert_eq!(encoded["colorTag"], "red");
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
