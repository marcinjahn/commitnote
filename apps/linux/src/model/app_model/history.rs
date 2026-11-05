use commitnote_core_api::commands::{
    HistoryClose, HistoryCloseParams, HistoryLoadMore, HistoryLoadMoreParams, HistoryOpen,
    HistoryOpenParams, HistoryPreview, HistoryPreviewParams, HistoryRestore, HistoryRestoreParams,
    HistoryRetry, HistoryRetryParams, HistoryView, RestoreVersionOutcome, VersionPreview,
};
use commitnote_core_api::events::HistoryChanged;
use glib::prelude::*;
use glib::subclass::types::ObjectSubclassIsExt;

use super::organise::failed;
use super::{AppModel, UserError, warn};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RestoreResult {
    Done,
    Failed(String),
}

impl AppModel {
    pub fn history(&self) -> Option<HistoryView> {
        self.state().history.clone()
    }

    pub fn connect_history_changed<F: Fn(&Self) + 'static>(&self, f: F) -> glib::SignalHandlerId {
        self.connect_unit_signal("history-changed", f)
    }

    /// Saves pending edits first, so the history the core shows includes them.
    pub async fn open_history(&self, path: Vec<String>) -> Result<(), UserError> {
        self.flush_edits().await;
        self.request::<HistoryOpen>(HistoryOpenParams { path })
            .await
            .map(|_| ())
            .map_err(|error| failed("could not open history", error))
    }

    pub async fn close_history(&self) {
        if let Err(error) = self.request::<HistoryClose>(HistoryCloseParams {}).await {
            warn("could not close history", &error);
        }
    }

    pub async fn load_more_history(&self) {
        if let Err(error) = self
            .request::<HistoryLoadMore>(HistoryLoadMoreParams {})
            .await
        {
            self.report_error(&failed("could not load more history", error));
        }
    }

    pub async fn retry_history(&self) {
        if let Err(error) = self.request::<HistoryRetry>(HistoryRetryParams {}).await {
            self.report_error(&failed("could not retry loading history", error));
        }
    }

    pub async fn preview_version(
        &self,
        sha: String,
        restore_title: bool,
    ) -> Result<VersionPreview, UserError> {
        self.request::<HistoryPreview>(HistoryPreviewParams { sha, restore_title })
            .await
            .map(|result| result.preview)
            .map_err(|error| failed("could not preview a version", error))
    }

    /// Saves pending edits first, so none of them lands on top of the restored text.
    pub async fn restore_version(&self, sha: String, restore_title: bool) -> RestoreResult {
        let mut turn = self.imp().editor_lane.reserve(false);
        self.flush_edits().await;
        turn.begin().await;
        let result = self
            .request::<HistoryRestore>(HistoryRestoreParams { sha, restore_title })
            .await;
        match result {
            Ok(result) => match result.outcome {
                RestoreVersionOutcome::Restored | RestoreVersionOutcome::Closed => {
                    RestoreResult::Done
                }
                RestoreVersionOutcome::Blocked { message }
                | RestoreVersionOutcome::Error { message } => RestoreResult::Failed(message),
            },
            Err(error) => {
                RestoreResult::Failed(failed("could not restore a version", error).message)
            }
        }
    }
}

impl AppModel {
    pub(super) fn history_changed(&self, changed: HistoryChanged) {
        {
            let mut state = self.state_mut();
            if state.history == changed.history {
                return;
            }
            state.history = changed.history;
        }
        self.emit_by_name::<()>("history-changed", &[]);
    }
}

#[cfg(all(test, feature = "testing"))]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use commitnote_core_api::Command;
    use commitnote_core_api::commands::{
        DiffItemView, DiffLineView, HistoryPhase, HistoryRow, HistoryVersionView, PreviewBody,
    };
    use commitnote_core_api::fake::{FakeSaveNote, FakeSaveNoteParams};

    use super::super::tests::{Session, all_notes, fake_bundle, open_and_read, run, tree_has};
    use super::super::{EditorTarget, LogOutResult, NoticeView};
    use super::*;

    const FIRST_TEXT: &str = "The first saved version\n";
    const SECOND_TEXT: &str = "The second saved version\n";

    fn welcome() -> Vec<String> {
        vec!["Welcome".to_owned()]
    }

    async fn save(session: &Session, path: &[String], text: &str) {
        let params = serde_json::to_value(FakeSaveNoteParams {
            path: path.to_vec(),
            text: text.to_owned(),
        })
        .expect("the params serialise");
        session
            .model
            .testing_send(FakeSaveNote::NAME, params)
            .await
            .expect("the fake forge saves the note");
    }

    fn versions(view: &HistoryView) -> Vec<HistoryVersionView> {
        view.sections
            .iter()
            .flat_map(|section| &section.rows)
            .flat_map(|row| match row {
                HistoryRow::Single { version } => std::slice::from_ref(version),
                HistoryRow::Session { versions, .. } => versions.as_slice(),
            })
            .cloned()
            .collect()
    }

    async fn ready_history(session: &Session) -> HistoryView {
        session
            .wait_until("the loaded history", |model| {
                model.history().is_some_and(|view| {
                    view.phase == HistoryPhase::Ready && !view.loading && view.error.is_none()
                })
            })
            .await;
        session.model.history().expect("the history is open")
    }

    async fn preview(session: &Session, version: &HistoryVersionView) -> VersionPreview {
        session
            .model
            .preview_version(version.sha.clone(), false)
            .await
            .expect("the version previews")
    }

    fn changed_lines(preview: &VersionPreview) -> Vec<(bool, String)> {
        let VersionPreview::Version {
            body: PreviewBody::Diff { items, .. },
            ..
        } = preview
        else {
            return Vec::new();
        };
        items
            .iter()
            .filter_map(|item| match item {
                DiffItemView::Line { line } => Some(line),
                DiffItemView::Fold { .. } => None,
            })
            .filter_map(|line| match line {
                DiffLineView::Added { segments } => Some((true, segments)),
                DiffLineView::Removed { segments } => Some((false, segments)),
                DiffLineView::Same { .. } => None,
            })
            .map(|(added, segments)| {
                (
                    added,
                    segments
                        .iter()
                        .map(|segment| segment.text.as_str())
                        .collect(),
                )
            })
            .collect()
    }

    fn record_notices(model: &AppModel) -> Rc<RefCell<Vec<NoticeView>>> {
        let notices = Rc::new(RefCell::new(Vec::new()));
        model.connect_notice({
            let notices = notices.clone();
            move |_, notice| notices.borrow_mut().push(notice.clone())
        });
        notices
    }

    async fn with_two_versions() -> Session {
        let session = Session::start(fake_bundle());
        session.log_in().await;
        save(&session, &welcome(), FIRST_TEXT).await;
        save(&session, &welcome(), SECOND_TEXT).await;
        assert_eq!(open_and_read(&session, &welcome()).await, SECOND_TEXT);
        session
    }

    #[test]
    fn history_lists_versions_newest_first_and_previews_an_older_one() {
        run(|| async {
            let session = with_two_versions().await;
            let model = &session.model;
            let phases = Rc::new(RefCell::new(Vec::new()));
            model.connect_history_changed({
                let phases = phases.clone();
                move |model| {
                    if let Some(view) = model.history() {
                        phases.borrow_mut().push(view.phase);
                    }
                }
            });

            model
                .open_history(welcome())
                .await
                .expect("the open note's history opens");
            let view = ready_history(&session).await;

            let phases = phases.borrow().clone();
            assert!(
                phases
                    .iter()
                    .all(|phase| matches!(phase, HistoryPhase::Saving | HistoryPhase::Ready)),
                "{phases:?}"
            );
            let first_ready = phases
                .iter()
                .position(|phase| *phase == HistoryPhase::Ready)
                .expect("the history became ready");
            assert!(
                phases[first_ready..]
                    .iter()
                    .all(|phase| *phase == HistoryPhase::Ready)
            );
            assert_eq!(view.path, welcome());
            let versions = versions(&view);
            assert_eq!(versions.len(), 3);
            assert!(versions[0].current);
            assert!(versions[1..].iter().all(|version| !version.current));

            assert!(matches!(
                preview(&session, &versions[0]).await,
                VersionPreview::Version {
                    body: PreviewBody::Unchanged { .. },
                    ..
                }
            ));
            let older = preview(&session, &versions[1]).await;
            let VersionPreview::Version { restore, .. } = &older else {
                panic!("the older version previews as a version");
            };
            assert!(restore.enabled);
            assert_eq!(
                changed_lines(&older),
                [
                    (false, SECOND_TEXT.trim_end().to_owned()),
                    (true, FIRST_TEXT.trim_end().to_owned()),
                ]
            );
        });
    }

    #[test]
    fn restoring_an_older_version_closes_history_and_can_be_undone() {
        run(|| async {
            let session = with_two_versions().await;
            let model = &session.model;
            let notices = record_notices(model);
            model
                .open_history(welcome())
                .await
                .expect("the open note's history opens");
            let older = versions(&ready_history(&session).await)[1].clone();

            let result = model.restore_version(older.sha, false).await;

            assert_eq!(result, RestoreResult::Done);
            session
                .wait_until("the closed history and the restored text", |model| {
                    model.history().is_none()
                        && model
                            .note_update()
                            .is_some_and(|update| update.content == FIRST_TEXT)
                })
                .await;
            session
                .wait_until("the undo notice", |_| {
                    notices
                        .borrow()
                        .iter()
                        .any(|notice| notice.action_label.is_some())
                })
                .await;
            let undo = notices
                .borrow()
                .iter()
                .find(|notice| notice.action_label.is_some())
                .map(|notice| notice.id.clone())
                .expect("the undo notice arrived");

            assert_eq!(model.perform_notice_action(&undo).await, Ok(()));
            session
                .wait_until("the newer text back", |model| {
                    model
                        .note_update()
                        .is_some_and(|update| update.content == SECOND_TEXT)
                })
                .await;
            assert_eq!(model.editor_target(), EditorTarget::Note(welcome()));
        });
    }

    #[test]
    fn restoring_a_version_from_before_a_rename_can_restore_the_title() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let model = &session.model;
            save(&session, &welcome(), FIRST_TEXT).await;
            open_and_read(&session, &welcome()).await;
            let renamed = model
                .rename_node(welcome(), "Greeting".to_owned())
                .await
                .expect("the open note is renamed");
            save(&session, &renamed, SECOND_TEXT).await;
            session
                .wait_until("the editor on the renamed note", |model| {
                    model.editor_target() == EditorTarget::Note(renamed.clone())
                })
                .await;

            model
                .open_history(renamed.clone())
                .await
                .expect("the open note's history opens");
            let older = versions(&ready_history(&session).await)
                .into_iter()
                .find(|version| version.name.as_deref() == Some("Welcome"))
                .expect("a version from before the rename");
            let VersionPreview::Version { restore_title, .. } = preview(&session, &older).await
            else {
                panic!("the older version previews as a version");
            };
            assert!(restore_title.is_some());

            let result = model.restore_version(older.sha, true).await;

            assert_eq!(result, RestoreResult::Done);
            session
                .wait_until("the note back under its old name", |model| {
                    model.editor_target() == EditorTarget::Note(welcome())
                        && tree_has(model, &welcome())
                        && !tree_has(model, &renamed)
                        && model
                            .note_update()
                            .is_some_and(|update| update.content == FIRST_TEXT)
                })
                .await;
        });
    }

    #[test]
    fn opening_history_saves_a_pending_edit_first() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let model = &session.model;
            let content = open_and_read(&session, &welcome()).await;
            session
                .wait_until("the open to settle", |model| !model.opens_pending())
                .await;
            let typed_line = "Typed just before opening history";

            model.edit(format!("{content}{typed_line}\n"));
            assert!(model.edit_sender().has_pending());
            model
                .open_history(welcome())
                .await
                .expect("the open note's history opens");

            let versions = versions(&ready_history(&session).await);
            assert_eq!(versions.len(), 2);
            assert!(versions[0].current);
            assert!(matches!(
                preview(&session, &versions[0]).await,
                VersionPreview::Version {
                    body: PreviewBody::Unchanged { .. },
                    ..
                }
            ));
            assert!(
                changed_lines(&preview(&session, &versions[1]).await)
                    .contains(&(false, typed_line.to_owned()))
            );
        });
    }

    #[test]
    fn history_is_refused_for_another_note_and_cleared_by_logging_out() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let model = &session.model;
            open_and_read(&session, &welcome()).await;
            let other = all_notes(&model.tree().unwrap_or_default())
                .into_iter()
                .find(|note| *note != welcome())
                .expect("the sample tree has another note");

            assert!(model.open_history(other).await.is_err());
            assert_eq!(model.history(), None);

            model
                .open_history(welcome())
                .await
                .expect("the open note's history opens");
            ready_history(&session).await;
            assert_eq!(model.log_out().await, Ok(LogOutResult::LoggedOut));
            session
                .wait_until("the cleared history", |model| model.history().is_none())
                .await;
        });
    }
}
