use commitnote_core_api::commands::*;
use commitnote_core_api::{
    CORE_COMMAND_NAMES, CORE_EVENT_NAMES, Command, NATIVE_CORE_API_VERSION, NATIVE_CORE_MARKER,
};

#[path = "support/ts_names.rs"]
mod ts_names;

fn owned(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

#[test]
fn api_version_matches_typescript() {
    let source = ts_names::api_source();
    assert_eq!(ts_names::api_version(&source), NATIVE_CORE_API_VERSION);
}

#[test]
fn marker_matches_typescript() {
    let source = ts_names::api_source();
    assert_eq!(ts_names::marker(&source), NATIVE_CORE_MARKER);
}

#[test]
fn command_names_match_typescript() {
    let source = ts_names::api_source();
    let names = ts_names::names_in(&source, "CORE_COMMAND_NAMES");
    assert!(!names.is_empty());
    assert_eq!(owned(CORE_COMMAND_NAMES), names);
}

#[test]
fn event_names_match_typescript() {
    let source = ts_names::api_source();
    let names = ts_names::names_in(&source, "CORE_EVENT_NAMES");
    assert!(!names.is_empty());
    assert_eq!(owned(CORE_EVENT_NAMES), names);
}

#[test]
fn typed_commands_are_declared_in_typescript() {
    let source = ts_names::api_source();
    let declared = ts_names::names_in(&source, "CORE_COMMAND_NAMES");
    let typed = [
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
    ];
    for name in typed {
        assert!(declared.iter().any(|d| d == name), "{name}");
    }
    let mut unique = typed.to_vec();
    unique.sort_unstable();
    unique.dedup();
    assert_eq!(unique.len(), typed.len());
}

#[cfg(feature = "testing")]
#[test]
fn fake_names_and_typed_fake_commands_match_typescript() {
    use commitnote_core_api::FAKE_CORE_COMMAND_NAMES;
    use commitnote_core_api::fake::*;

    let source = ts_names::api_source();
    let names = ts_names::names_in(&source, "FAKE_CORE_COMMAND_NAMES");
    assert!(!names.is_empty());
    assert_eq!(owned(FAKE_CORE_COMMAND_NAMES), names);
    for name in [
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
    ] {
        assert!(names.iter().any(|d| d == name), "{name}");
    }
}
