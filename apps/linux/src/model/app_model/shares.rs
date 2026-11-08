use commitnote_core_api::Secret;
use commitnote_core_api::commands::{
    ShareCopy, ShareCreate, ShareCreateOutcome, ShareCreateParams, ShareForm, ShareFormParams,
    ShareRename, ShareRenameOutcome, ShareRenameParams, ShareRevoke, ShareRevokeParams,
    ShareRowView, ShareSharedVersion, ShareSharedVersionParams, ShareUpdate, ShareUpdateParams,
    SharedVersionOutcome,
};
use commitnote_core_api::events::SharesChanged;
use glib::prelude::*;

use super::organise::failed;
use super::{AppModel, UserError};

impl AppModel {
    pub fn shares_view(&self) -> Option<SharesChanged> {
        self.state().shares.clone()
    }

    pub fn connect_shares_changed<F: Fn(&Self) + 'static>(&self, f: F) -> glib::SignalHandlerId {
        self.connect_unit_signal("shares-changed", f)
    }

    pub fn share_copy(&self) -> Option<ShareCopy> {
        self.state()
            .shares
            .as_ref()
            .map(|shares| (*shares.copy).clone())
    }

    pub fn shares_for(&self, path: &[String]) -> Vec<ShareRowView> {
        self.state()
            .shares
            .as_ref()
            .map(|shares| {
                shares
                    .shares
                    .iter()
                    .filter(|share| share.note_path.as_deref() == Some(path))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    pub async fn share_title(&self, path: Vec<String>) -> Result<String, UserError> {
        self.request::<ShareForm>(ShareFormParams { path })
            .await
            .map(|result| result.title)
            .map_err(|error| failed("could not open the share form", error))
    }

    /// Saves pending edits first, so the share holds what the user sees.
    pub async fn create_share(
        &self,
        path: Vec<String>,
        password: Secret,
        label: String,
    ) -> Result<ShareCreateOutcome, UserError> {
        self.flush_edits().await;
        self.request::<ShareCreate>(ShareCreateParams {
            path,
            password,
            label,
        })
        .await
        .map(|result| result.outcome)
        .map_err(|error| failed("could not create a share", error))
    }

    pub async fn update_share(&self, id: String) {
        if let Err(error) = self.request::<ShareUpdate>(ShareUpdateParams { id }).await {
            self.report_error(&failed("could not update a share", error));
        }
    }

    pub async fn revoke_share(&self, id: String) {
        if let Err(error) = self.request::<ShareRevoke>(ShareRevokeParams { id }).await {
            self.report_error(&failed("could not revoke a share", error));
        }
    }

    pub async fn rename_share(&self, id: String, label: String) -> Result<(), String> {
        match self
            .request::<ShareRename>(ShareRenameParams { id, label })
            .await
        {
            Ok(result) => match result.outcome {
                ShareRenameOutcome::Ok => Ok(()),
                ShareRenameOutcome::Error { message } => Err(message),
            },
            Err(error) => Err(failed("could not rename a share", error).message),
        }
    }

    pub async fn shared_version(&self, id: String) -> Result<SharedVersionOutcome, UserError> {
        self.request::<ShareSharedVersion>(ShareSharedVersionParams { id })
            .await
            .map(|result| result.outcome)
            .map_err(|error| failed("could not read a shared version", error))
    }
}

impl AppModel {
    pub(super) fn shares_changed(&self, changed: SharesChanged) {
        {
            let mut state = self.state_mut();
            if state.shares.as_ref() == Some(&changed) {
                return;
            }
            state.shares = Some(changed);
        }
        self.emit_by_name::<()>("shares-changed", &[]);
    }
}

#[cfg(all(test, feature = "testing"))]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use commitnote_core_api::Command;
    use commitnote_core_api::fake::{FakeSaveNote, FakeSaveNoteParams};
    use commitnote_core_api::shapes::TreeNode;

    use super::super::tests::{Session, fake_bundle, open_and_read, run};
    use super::super::{LogOutResult, NoticeView};
    use super::*;

    const PASSWORD: &str = "hunter2";
    const LABEL: &str = "For Sam";

    fn welcome() -> Vec<String> {
        vec!["Welcome".to_owned()]
    }

    fn note_is_shared(nodes: &[TreeNode], path: &[String]) -> bool {
        nodes.iter().any(|node| match node {
            TreeNode::Note {
                path: at, shared, ..
            } => at == path && *shared,
            TreeNode::Folder { children, .. } => note_is_shared(children, path),
        })
    }

    fn welcome_is_shared(model: &AppModel) -> bool {
        note_is_shared(&model.tree().unwrap_or_default(), &welcome())
    }

    async fn ready_session() -> Session {
        let session = Session::start(fake_bundle());
        session.log_in().await;
        session
            .wait_until("the shares", |model| model.shares_view().is_some())
            .await;
        session
    }

    async fn share_welcome(model: &AppModel) -> ShareRowView {
        let outcome = model
            .create_share(welcome(), Secret::new(PASSWORD), LABEL.to_owned())
            .await
            .expect("the share command is answered");
        assert!(matches!(outcome, ShareCreateOutcome::Created { .. }));
        first_row(model)
    }

    fn first_row(model: &AppModel) -> ShareRowView {
        model
            .shares_view()
            .and_then(|view| view.shares.into_iter().next())
            .expect("a share row")
    }

    fn record_notices(model: &AppModel) -> Rc<RefCell<Vec<NoticeView>>> {
        let notices = Rc::new(RefCell::new(Vec::new()));
        model.connect_notice({
            let notices = notices.clone();
            move |_, notice| notices.borrow_mut().push(notice.clone())
        });
        notices
    }

    #[test]
    fn a_new_session_has_no_shares_and_the_dialog_copy() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;

            let view = model.shares_view().expect("the shares arrived");
            assert!(view.shares.is_empty());
            assert_eq!(view.unreadable, None);
            assert_eq!(view.updating_id, None);
            let copy = model.share_copy().expect("the copy arrived");
            assert_eq!(copy.shared_links_title, "Shared links");
            assert!(!copy.explanation.is_empty());
            assert!(model.shares_for(&welcome()).is_empty());
        });
    }

    #[test]
    fn the_form_title_comes_from_the_core_and_only_for_a_note() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;

            let title = model
                .share_title(welcome())
                .await
                .expect("the note has a share form");
            assert!(title.contains("Welcome"));
            assert!(
                model
                    .share_title(vec!["Projects".to_owned()])
                    .await
                    .is_err()
            );
            assert!(model.share_title(Vec::new()).await.is_err());
        });
    }

    #[test]
    fn creating_a_share_returns_its_link_and_adds_a_row_for_the_note() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let changes = Rc::new(RefCell::new(0));
            model.connect_shares_changed({
                let changes = changes.clone();
                move |_| *changes.borrow_mut() += 1
            });

            let outcome = model
                .create_share(welcome(), Secret::new(PASSWORD), LABEL.to_owned())
                .await
                .expect("the share command is answered");

            let ShareCreateOutcome::Created { link, password } = outcome else {
                panic!("the share is created");
            };
            assert!(!link.is_empty());
            assert_eq!(password.as_ref().map(Secret::expose), Some(PASSWORD));
            session
                .wait_until("the share row", |model| {
                    !model.shares_for(&welcome()).is_empty()
                })
                .await;
            assert!(*changes.borrow() >= 1);
            let rows = model.shares_for(&welcome());
            let [row] = rows.as_slice() else {
                panic!("one row for the note");
            };
            assert!(row.password_protected);
            assert_eq!(row.label.as_deref(), Some(LABEL));
            assert_eq!(row.link, link);
            assert_eq!(row.password.as_ref().map(Secret::expose), Some(PASSWORD));
            assert_eq!(row.note_path, Some(welcome()));
            assert!(model.shares_for(&["Other".to_owned()]).is_empty());
            session
                .wait_until("the shared mark in the tree", welcome_is_shared)
                .await;
        });
    }

    #[test]
    fn a_share_without_a_password_has_none_to_copy() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;

            let outcome = model
                .create_share(welcome(), Secret::new(""), String::new())
                .await
                .expect("the share command is answered");

            assert!(matches!(
                outcome,
                ShareCreateOutcome::Created { password: None, .. }
            ));
            session
                .wait_until("the share row", |model| {
                    !model.shares_for(&welcome()).is_empty()
                })
                .await;
            let row = first_row(model);
            assert!(!row.password_protected);
            assert_eq!(row.password, None);
            assert_eq!(row.label, None);
        });
    }

    #[test]
    fn creating_a_share_saves_a_pending_edit_first() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let content = open_and_read(&session, &welcome()).await;
            session
                .wait_until("the open to settle", |model| !model.opens_pending())
                .await;
            let typed_line = "Typed just before sharing";

            model.edit(format!("{content}{typed_line}\n"));
            assert!(model.edit_sender().has_pending());
            let row = share_welcome(model).await;

            let outcome = model
                .shared_version(row.id.clone())
                .await
                .expect("the shared version is answered");
            let SharedVersionOutcome::Readable { content, .. } = outcome else {
                panic!("the shared version is readable, got {outcome:?}");
            };
            assert!(content.contains(typed_line));
        });
    }

    #[test]
    fn the_shared_version_of_a_gone_share_is_a_message() {
        run(|| async {
            let session = ready_session().await;

            let outcome = session
                .model
                .shared_version("missing".to_owned())
                .await
                .expect("the shared version is answered");

            assert!(matches!(outcome, SharedVersionOutcome::Message { .. }));
        });
    }

    #[test]
    fn renaming_a_share_changes_its_label_and_a_long_label_is_refused() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let row = share_welcome(model).await;

            assert_eq!(
                model.rename_share(row.id.clone(), "Team".to_owned()).await,
                Ok(())
            );
            session
                .wait_until("the new label", |model| {
                    model.shares_view().is_some_and(|view| {
                        view.shares
                            .first()
                            .is_some_and(|row| row.label.as_deref() == Some("Team"))
                    })
                })
                .await;

            let message = model
                .rename_share(row.id.clone(), "x".repeat(101))
                .await
                .expect_err("a label over the limit is refused");
            assert!(!message.is_empty());
            assert_eq!(first_row(model).label.as_deref(), Some("Team"));

            assert_eq!(model.rename_share(row.id, String::new()).await, Ok(()));
            session
                .wait_until("the cleared label", |model| {
                    model.shares_view().is_some_and(|view| {
                        view.shares.first().is_some_and(|row| row.label.is_none())
                    })
                })
                .await;
        });
    }

    #[test]
    fn updating_a_share_marks_it_updating_while_it_runs() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let row = share_welcome(model).await;
            let params = serde_json::to_value(FakeSaveNoteParams {
                path: welcome(),
                text: "Edited after sharing\n".to_owned(),
            })
            .expect("the params serialise");
            model
                .testing_send(FakeSaveNote::NAME, params)
                .await
                .expect("the fake forge saves the note");
            let notices = record_notices(model);
            let seen = Rc::new(RefCell::new(Vec::new()));
            model.connect_shares_changed({
                let seen = seen.clone();
                move |model| {
                    if let Some(view) = model.shares_view() {
                        seen.borrow_mut().push(view.updating_id);
                    }
                }
            });

            model.update_share(row.id.clone()).await;

            session
                .wait_until("the update to finish", |_| {
                    let seen = seen.borrow();
                    seen.iter()
                        .position(|id| id.as_deref() == Some(row.id.as_str()))
                        .is_some_and(|at| seen[at..].iter().any(Option::is_none))
                })
                .await;
            assert_eq!(model.shares_view().and_then(|view| view.updating_id), None);
            assert!(
                notices
                    .borrow()
                    .iter()
                    .any(|notice| !notice.message.is_empty())
            );
        });
    }

    #[test]
    fn revoking_a_share_removes_its_row_and_shows_the_core_notice() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let row = share_welcome(model).await;
            session
                .wait_until("the shared mark in the tree", welcome_is_shared)
                .await;
            let notices = record_notices(model);

            model.revoke_share(row.id).await;

            session
                .wait_until("the removed row", |model| {
                    model.shares_for(&welcome()).is_empty()
                })
                .await;
            session
                .wait_until("the revoke notice", |_| {
                    notices
                        .borrow()
                        .iter()
                        .any(|notice| notice.message == "Link revoked")
                })
                .await;
            session
                .wait_until("the shared mark gone", |model| !welcome_is_shared(model))
                .await;
        });
    }

    #[test]
    fn logging_out_clears_the_shares() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            share_welcome(model).await;
            let changes = Rc::new(RefCell::new(0));
            model.connect_shares_changed({
                let changes = changes.clone();
                move |_| *changes.borrow_mut() += 1
            });

            assert_eq!(model.log_out().await, Ok(LogOutResult::LoggedOut));

            session
                .wait_until("the cleared shares", |model| model.shares_view().is_none())
                .await;
            assert!(model.share_copy().is_none());
            assert!(model.shares_for(&welcome()).is_empty());
            assert!(*changes.borrow() >= 1);
        });
    }
}
