use commitnote_core_api::events::SyncStateChanged;
use commitnote_core_api::shapes::{OpenNote, OpenNoteConflict, OutOfSyncReason, SyncState};

pub const OFFLINE_ICON: &str = "network-offline-symbolic";
pub const SYNCED_ICON: &str = "object-select-symbolic";
pub const SYNCING_ICON: &str = "emblem-synchronizing-symbolic";
pub const PENDING_ICON: &str = "preferences-system-time-symbolic";
pub const FAILED_ICON: &str = "dialog-warning-symbolic";
pub const CONFLICT_ICON: &str = "dialog-error-symbolic";

const RETRY_ID: &str = "retry";
const RESOLVE_LABEL: &str = "_Resolve…";
const RETRY_NOW_LABEL: &str = "_Retry Now";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncMenuAction {
    Retry,
    Open(Vec<String>),
    Inert,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncMenuEntry {
    pub id: String,
    pub label: String,
    pub action: SyncMenuAction,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncStatusView {
    pub icon: &'static str,
    pub text: String,
    pub entries: Vec<SyncMenuEntry>,
}

pub fn sync_status_view(sync: &SyncStateChanged) -> SyncStatusView {
    let icon = if sync.online {
        match sync.state {
            SyncState::Synced => SYNCED_ICON,
            SyncState::Syncing => SYNCING_ICON,
            SyncState::OutOfSync {
                reason: OutOfSyncReason::Pending,
            } => PENDING_ICON,
            SyncState::OutOfSync {
                reason: OutOfSyncReason::Failed,
            } => FAILED_ICON,
            SyncState::OutOfSync {
                reason: OutOfSyncReason::Conflict,
            } => CONFLICT_ICON,
        }
    } else {
        OFFLINE_ICON
    };
    let entries = sync
        .unsaved_menu
        .iter()
        .map(|item| SyncMenuEntry {
            id: item.id.clone(),
            label: item.label.clone(),
            action: match &item.path {
                _ if item.id == RETRY_ID => SyncMenuAction::Retry,
                Some(path) => SyncMenuAction::Open(path.clone()),
                None => SyncMenuAction::Inert,
            },
        })
        .collect();
    SyncStatusView {
        icon,
        text: status_text(sync).to_owned(),
        entries,
    }
}

fn status_text(sync: &SyncStateChanged) -> &str {
    sync.status.as_deref().unwrap_or(&sync.label)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BannerAction {
    Resolve,
    Retry,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteBanner {
    pub title: String,
    pub button: Option<(&'static str, BannerAction)>,
}

pub fn open_conflict<'a>(
    open_path: Option<&[String]>,
    state: Option<&'a OpenNote>,
) -> Option<&'a OpenNoteConflict> {
    match state? {
        OpenNote::Loaded {
            path,
            conflict: Some(conflict),
            ..
        } if Some(path.as_slice()) == open_path => Some(conflict),
        _ => None,
    }
}

pub fn conflict_locks_note(open_path: Option<&[String]>, state: Option<&OpenNote>) -> bool {
    open_conflict(open_path, state).is_some_and(|conflict| !conflict.editing)
}

pub fn note_banner(
    open_path: Option<&[String]>,
    state: Option<&OpenNote>,
    sync: Option<&SyncStateChanged>,
) -> Option<NoteBanner> {
    if let Some(conflict) = open_conflict(open_path, state) {
        return Some(if conflict.editing {
            NoteBanner {
                title: conflict.edit_hint.clone(),
                button: None,
            }
        } else {
            NoteBanner {
                title: conflict.heading.clone(),
                button: Some((RESOLVE_LABEL, BannerAction::Resolve)),
            }
        });
    }
    let sync = sync?;
    let failed = sync.state
        == SyncState::OutOfSync {
            reason: OutOfSyncReason::Failed,
        };
    if failed {
        return Some(NoteBanner {
            title: status_text(sync).to_owned(),
            button: Some((RETRY_NOW_LABEL, BannerAction::Retry)),
        });
    }
    (!sync.online).then(|| NoteBanner {
        title: status_text(sync).to_owned(),
        button: None,
    })
}

pub fn is_conflict_marker(line: &str) -> bool {
    ["<<<<<<<", "=======", ">>>>>>>"]
        .iter()
        .any(|marker| line.starts_with(marker))
}

#[cfg(test)]
mod tests {
    use commitnote_core_api::shapes::SyncStatusMenuItem;

    use super::*;

    fn sync(state: SyncState) -> SyncStateChanged {
        SyncStateChanged {
            online: true,
            refreshing: false,
            tree_loaded: true,
            last_refresh_error: None,
            state,
            label: "label".to_owned(),
            status: None,
            unsaved_count: 0,
            can_retry: false,
            unsaved_menu: Vec::new(),
        }
    }

    fn out_of_sync(reason: OutOfSyncReason) -> SyncState {
        SyncState::OutOfSync { reason }
    }

    fn path(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    fn conflict(editing: bool) -> OpenNoteConflict {
        OpenNoteConflict {
            other_device: Some("Phone".to_owned()),
            heading: "heading".to_owned(),
            text: "text".to_owned(),
            keep_this_label: "this".to_owned(),
            keep_other_label: "other".to_owned(),
            edit_merged_label: "merged".to_owned(),
            edit_hint: "hint".to_owned(),
            merged: "merged text".to_owned(),
            editing,
        }
    }

    fn loaded(parts: &[&str], conflict: Option<OpenNoteConflict>) -> OpenNote {
        OpenNote::Loaded {
            path: path(parts),
            content: "content".to_owned(),
            conflict,
            color_tag: None,
            shared: false,
        }
    }

    #[test]
    fn each_state_has_its_icon() {
        for (state, icon) in [
            (SyncState::Synced, SYNCED_ICON),
            (SyncState::Syncing, SYNCING_ICON),
            (out_of_sync(OutOfSyncReason::Pending), PENDING_ICON),
            (out_of_sync(OutOfSyncReason::Failed), FAILED_ICON),
            (out_of_sync(OutOfSyncReason::Conflict), CONFLICT_ICON),
        ] {
            assert_eq!(sync_status_view(&sync(state)).icon, icon);
        }
    }

    #[test]
    fn offline_wins_over_every_state() {
        for state in [
            SyncState::Synced,
            SyncState::Syncing,
            out_of_sync(OutOfSyncReason::Failed),
            out_of_sync(OutOfSyncReason::Conflict),
        ] {
            let offline = SyncStateChanged {
                online: false,
                ..sync(state)
            };
            assert_eq!(sync_status_view(&offline).icon, OFFLINE_ICON);
        }
    }

    #[test]
    fn the_text_is_the_status_or_else_the_label() {
        assert_eq!(sync_status_view(&sync(SyncState::Synced)).text, "label");
        let with_status = SyncStateChanged {
            status: Some("status".to_owned()),
            ..sync(SyncState::Synced)
        };
        assert_eq!(sync_status_view(&with_status).text, "status");
    }

    #[test]
    fn menu_items_retry_open_or_do_nothing() {
        let item = |id: &str, path: Option<Vec<String>>| SyncStatusMenuItem {
            id: id.to_owned(),
            label: format!("{id} label"),
            path,
        };
        let state = SyncStateChanged {
            unsaved_menu: vec![
                item("note-0", Some(path(&["f", "a"]))),
                item("more", None),
                item("retry", None),
            ],
            ..sync(out_of_sync(OutOfSyncReason::Failed))
        };
        let actions: Vec<_> = sync_status_view(&state)
            .entries
            .into_iter()
            .map(|entry| (entry.id, entry.label, entry.action))
            .collect();
        assert_eq!(
            actions,
            vec![
                (
                    "note-0".to_owned(),
                    "note-0 label".to_owned(),
                    SyncMenuAction::Open(path(&["f", "a"]))
                ),
                (
                    "more".to_owned(),
                    "more label".to_owned(),
                    SyncMenuAction::Inert
                ),
                (
                    "retry".to_owned(),
                    "retry label".to_owned(),
                    SyncMenuAction::Retry
                ),
            ]
        );
    }

    #[test]
    fn an_unedited_conflict_asks_to_resolve_and_locks_the_note() {
        let open = path(&["a"]);
        let note = loaded(&["a"], Some(conflict(false)));
        let failed = sync(out_of_sync(OutOfSyncReason::Failed));
        assert_eq!(
            note_banner(Some(&open), Some(&note), Some(&failed)),
            Some(NoteBanner {
                title: "heading".to_owned(),
                button: Some((RESOLVE_LABEL, BannerAction::Resolve)),
            })
        );
        assert!(conflict_locks_note(Some(&open), Some(&note)));
    }

    #[test]
    fn a_conflict_being_edited_shows_the_hint_and_stays_editable() {
        let open = path(&["a"]);
        let note = loaded(&["a"], Some(conflict(true)));
        assert_eq!(
            note_banner(Some(&open), Some(&note), None),
            Some(NoteBanner {
                title: "hint".to_owned(),
                button: None,
            })
        );
        assert!(!conflict_locks_note(Some(&open), Some(&note)));
    }

    #[test]
    fn a_conflict_on_another_note_is_ignored() {
        let open = path(&["b"]);
        let note = loaded(&["a"], Some(conflict(false)));
        assert_eq!(note_banner(Some(&open), Some(&note), None), None);
        assert!(!conflict_locks_note(Some(&open), Some(&note)));
    }

    #[test]
    fn a_failed_save_offers_retry_before_offline() {
        let failed = SyncStateChanged {
            online: false,
            status: Some("failed".to_owned()),
            ..sync(out_of_sync(OutOfSyncReason::Failed))
        };
        assert_eq!(
            note_banner(None, None, Some(&failed)),
            Some(NoteBanner {
                title: "failed".to_owned(),
                button: Some((RETRY_NOW_LABEL, BannerAction::Retry)),
            })
        );
    }

    #[test]
    fn offline_shows_the_status_without_a_button() {
        let offline = SyncStateChanged {
            online: false,
            status: Some("offline".to_owned()),
            ..sync(out_of_sync(OutOfSyncReason::Pending))
        };
        assert_eq!(
            note_banner(None, None, Some(&offline)),
            Some(NoteBanner {
                title: "offline".to_owned(),
                button: None,
            })
        );
    }

    #[test]
    fn nothing_to_report_hides_the_banner() {
        let open = path(&["a"]);
        let note = loaded(&["a"], None);
        for state in [
            SyncState::Synced,
            SyncState::Syncing,
            out_of_sync(OutOfSyncReason::Pending),
            out_of_sync(OutOfSyncReason::Conflict),
        ] {
            assert_eq!(
                note_banner(Some(&open), Some(&note), Some(&sync(state))),
                None
            );
        }
        assert_eq!(note_banner(None, None, None), None);
    }

    #[test]
    fn conflict_markers_are_recognised() {
        assert!(is_conflict_marker("<<<<<<< This device"));
        assert!(is_conflict_marker("======="));
        assert!(is_conflict_marker(">>>>>>> Phone"));
        assert!(!is_conflict_marker("text <<<<<<<"));
        assert!(!is_conflict_marker("== heading"));
    }
}
