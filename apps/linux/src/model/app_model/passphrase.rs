use std::rc::Rc;

use commitnote_core_api::commands::{
    PassphraseCancelChange, PassphraseCancelChangeParams, PassphraseChangeCopy,
    PassphraseChangeForm, PassphraseChangeFormParams, PassphraseChangeFormResult,
    PassphraseChangeOutcome, PassphraseChangeOutcomeResult, PassphraseCommitChange,
    PassphraseCommitChangeParams, PassphraseEnableAtomic, PassphraseEnableAtomicParams,
    PassphrasePrepareChange, PassphrasePrepareChangeParams, PassphraseSettle,
    PassphraseSettleParams,
};
use commitnote_core_api::events::PassphraseChangeProgress;
use commitnote_core_api::{Command, Secret};
use glib::prelude::*;

use super::organise::failed;
use super::{AppModel, UserError, warn};

const CHANGED_SIGNAL: &str = "passphrase-change-changed";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PassphraseStage {
    Form,
    Working {
        message: String,
        done: Option<u32>,
        total: Option<u32>,
    },
    Review {
        summary: String,
        carried_over: Vec<String>,
        history_warning: Option<String>,
    },
    Setup {
        can_configure: bool,
        message: String,
        action_label: String,
    },
    Unsettled {
        message: String,
    },
    Done,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PassphraseChangeState {
    pub copy: Rc<PassphraseChangeCopy>,
    pub can_remove_history: bool,
    pub repository_label: String,
    pub stage: PassphraseStage,
    pub error: Option<String>,
    pub clear_current_requested: bool,
    pub checking: bool,
}

/// What a submitted form leads to.
#[derive(Debug, PartialEq, Eq)]
enum Submission {
    Ignored,
    Rejected,
    Started,
}

impl PassphraseChangeState {
    fn new(form: PassphraseChangeFormResult) -> Self {
        Self {
            copy: Rc::new(form.copy),
            can_remove_history: form.can_remove_history,
            repository_label: form.repository_label,
            stage: PassphraseStage::Form,
            error: None,
            clear_current_requested: false,
            checking: false,
        }
    }

    pub fn is_working(&self) -> bool {
        matches!(self.stage, PassphraseStage::Working { .. })
    }

    /// False while the change may still be landing, so the dialog has to stay up.
    pub fn can_close(&self) -> bool {
        !matches!(
            self.stage,
            PassphraseStage::Working { .. } | PassphraseStage::Unsettled { .. }
        )
    }

    fn submit(&mut self, current: &Secret, next: &Secret, repeated: &Secret) -> Submission {
        if !matches!(
            self.stage,
            PassphraseStage::Form | PassphraseStage::Setup { .. }
        ) {
            return Submission::Ignored;
        }
        let rejection = if current.expose().is_empty() {
            Some(&self.copy.enter_current_passphrase)
        } else if next != repeated {
            Some(&self.copy.passphrases_differ)
        } else {
            None
        };
        if let Some(message) = rejection {
            self.error = Some(message.clone());
            self.stage = PassphraseStage::Form;
            return Submission::Rejected;
        }
        self.clear_current_requested = false;
        self.begin_work();
        Submission::Started
    }

    fn begin_work(&mut self) {
        self.error = None;
        self.stage = PassphraseStage::Working {
            message: self.copy.starting_label.clone(),
            done: None,
            total: None,
        };
    }

    /// Starts committing a reviewed change; returns the stage to go back to if the request fails.
    fn begin_commit(&mut self) -> Option<PassphraseStage> {
        if !matches!(self.stage, PassphraseStage::Review { .. }) {
            return None;
        }
        let previous = self.stage.clone();
        self.begin_work();
        Some(previous)
    }

    fn begin_settle(&mut self) -> Option<PassphraseStage> {
        if !matches!(self.stage, PassphraseStage::Unsettled { .. }) || self.checking {
            return None;
        }
        self.checking = true;
        Some(self.stage.clone())
    }

    fn finish_settle(&mut self) -> Option<()> {
        std::mem::take(&mut self.checking).then_some(())
    }

    fn begin_enable_atomic(&mut self) -> Option<()> {
        if !matches!(self.stage, PassphraseStage::Setup { .. }) {
            return None;
        }
        self.begin_work();
        Some(())
    }

    /// Returns whether atomic commits are enabled, so the form can be sent again.
    fn finish_enable_atomic(&mut self, failure: Option<String>) -> bool {
        self.stage = PassphraseStage::Form;
        let enabled = failure.is_none();
        self.error = failure;
        enabled
    }

    fn leave_review(&mut self) -> Option<()> {
        if !matches!(self.stage, PassphraseStage::Review { .. }) {
            return None;
        }
        self.stage = PassphraseStage::Form;
        self.error = None;
        Some(())
    }

    fn acknowledge_clear_current(&mut self) -> Option<()> {
        std::mem::take(&mut self.clear_current_requested).then_some(())
    }

    fn restore(&mut self, previous: PassphraseStage, message: String) {
        self.stage = previous;
        self.error = Some(message);
    }

    fn apply_outcome(&mut self, outcome: PassphraseChangeOutcome) {
        self.error = None;
        self.stage = match outcome {
            PassphraseChangeOutcome::Review {
                summary,
                carried_over,
                history_warning,
            } => PassphraseStage::Review {
                summary,
                carried_over,
                history_warning,
            },
            PassphraseChangeOutcome::Changed => PassphraseStage::Done,
            PassphraseChangeOutcome::Failed {
                message,
                clear_current,
            } => {
                self.error = Some(message);
                self.clear_current_requested = clear_current;
                PassphraseStage::Form
            }
            PassphraseChangeOutcome::NeedsSetup {
                can_configure,
                message,
                action_label,
            } => PassphraseStage::Setup {
                can_configure,
                message,
                action_label,
            },
            PassphraseChangeOutcome::Unsettled { message } => {
                PassphraseStage::Unsettled { message }
            }
        };
    }

    fn apply_progress(&mut self, progress: PassphraseChangeProgress) -> Option<()> {
        if !self.is_working() {
            return None;
        }
        self.stage = PassphraseStage::Working {
            message: progress.message,
            done: progress.done,
            total: progress.total,
        };
        Some(())
    }
}

impl AppModel {
    pub fn passphrase_change(&self) -> Option<PassphraseChangeState> {
        self.state().passphrase.clone()
    }

    pub fn connect_passphrase_change_changed<F: Fn(&Self) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_unit_signal(CHANGED_SIGNAL, f)
    }

    /// Loads the form, unless a change is already under way.
    pub async fn open_change_passphrase(&self) -> Result<(), UserError> {
        self.leave_draft().await;
        if self.passphrase_change_open() {
            return Ok(());
        }
        let Some(result) = self
            .request_in_session::<PassphraseChangeForm>(PassphraseChangeFormParams {})
            .await
        else {
            return Ok(());
        };
        let form = result.map_err(|error| failed("could not open the passphrase change", error))?;
        if !self.passphrase_change_open() {
            self.state_mut().passphrase = Some(PassphraseChangeState::new(form));
            self.emit_by_name::<()>(CHANGED_SIGNAL, &[]);
        }
        Ok(())
    }

    /// Checks the form and prepares the change; a rejected form never reaches the core.
    pub async fn prepare_passphrase_change(
        &self,
        current: Secret,
        next: Secret,
        repeated: Secret,
        remove_history: bool,
    ) {
        let (submission, remove_history) = {
            let mut state = self.state_mut();
            let Some(change) = state.passphrase.as_mut() else {
                return;
            };
            (
                change.submit(&current, &next, &repeated),
                remove_history && change.can_remove_history,
            )
        };
        drop(repeated);
        if submission == Submission::Ignored {
            return;
        }
        self.emit_by_name::<()>(CHANGED_SIGNAL, &[]);
        if submission == Submission::Rejected {
            return;
        }
        let params = PassphrasePrepareChangeParams {
            current,
            next,
            remove_history,
        };
        self.run_passphrase_outcome::<PassphrasePrepareChange>(PassphraseStage::Form, params)
            .await;
    }

    pub async fn commit_passphrase_change(&self) {
        let Some(previous) = self.update_passphrase(PassphraseChangeState::begin_commit) else {
            return;
        };
        self.run_passphrase_outcome::<PassphraseCommitChange>(
            previous,
            PassphraseCommitChangeParams {},
        )
        .await;
    }

    /// Looks again whether an unsettled change landed.
    pub async fn settle_passphrase_change(&self) {
        let Some(previous) = self.update_passphrase(PassphraseChangeState::begin_settle) else {
            return;
        };
        if self
            .run_passphrase_outcome::<PassphraseSettle>(previous, PassphraseSettleParams {})
            .await
        {
            self.update_passphrase(PassphraseChangeState::finish_settle);
        }
    }

    /// Returns whether atomic commits are now enabled; the form is shown again either way.
    pub async fn enable_passphrase_atomic(&self) -> bool {
        if self
            .update_passphrase(PassphraseChangeState::begin_enable_atomic)
            .is_none()
        {
            return false;
        }
        let Some(result) = self
            .request_in_session::<PassphraseEnableAtomic>(PassphraseEnableAtomicParams {})
            .await
        else {
            return false;
        };
        let failure = match result {
            Ok(result) => result.error,
            Err(error) => Some(failed("could not enable atomic commits", error).message),
        };
        self.update_passphrase(|change| Some(change.finish_enable_atomic(failure)))
            .unwrap_or(false)
    }

    /// Goes back from the review to the form and lets the core drop the prepared change.
    pub async fn cancel_passphrase_change(&self) {
        if self
            .update_passphrase(PassphraseChangeState::leave_review)
            .is_none()
        {
            return;
        }
        if let Err(error) = self
            .request::<PassphraseCancelChange>(PassphraseCancelChangeParams {})
            .await
        {
            warn("could not cancel the passphrase change", &error);
        }
    }

    /// Forgets the change unless it may still be landing; returns whether it was forgotten.
    pub fn dismiss_change_passphrase(&self) -> bool {
        let reviewed = {
            let mut state = self.state_mut();
            let Some(change) = state.passphrase.as_ref() else {
                return true;
            };
            if !change.can_close() {
                return false;
            }
            let reviewed = matches!(change.stage, PassphraseStage::Review { .. });
            state.passphrase = None;
            reviewed
        };
        if reviewed {
            let request = self.request::<PassphraseCancelChange>(PassphraseCancelChangeParams {});
            self.spawn(async move {
                if let Err(error) = request.await {
                    warn("could not cancel the passphrase change", &error);
                }
            });
        }
        self.emit_by_name::<()>(CHANGED_SIGNAL, &[]);
        true
    }

    /// Forgets the change whatever its stage, for leaving the session from the unsettled stage.
    pub fn reset_passphrase_change(&self) {
        if self.state_mut().passphrase.take().is_some() {
            self.emit_by_name::<()>(CHANGED_SIGNAL, &[]);
        }
    }

    pub fn acknowledge_clear_current_passphrase(&self) {
        self.update_passphrase(PassphraseChangeState::acknowledge_clear_current);
    }

    pub(super) fn passphrase_progress(&self, progress: PassphraseChangeProgress) {
        self.update_passphrase(|change| change.apply_progress(progress));
    }

    pub(super) fn emit_passphrase_change_cleared(&self) {
        self.emit_by_name::<()>(CHANGED_SIGNAL, &[]);
    }

    fn passphrase_change_open(&self) -> bool {
        self.state()
            .passphrase
            .as_ref()
            .is_some_and(|change| change.stage != PassphraseStage::Done)
    }

    /// Emits only when `change` reports that it changed something.
    fn update_passphrase<R>(
        &self,
        change: impl FnOnce(&mut PassphraseChangeState) -> Option<R>,
    ) -> Option<R> {
        let result = self.state_mut().passphrase.as_mut().and_then(change);
        if result.is_some() {
            self.emit_by_name::<()>(CHANGED_SIGNAL, &[]);
        }
        result
    }

    /// Returns false when the session ended before the core answered.
    async fn run_passphrase_outcome<C>(&self, previous: PassphraseStage, params: C::Params) -> bool
    where
        C: Command<Result = PassphraseChangeOutcomeResult>,
    {
        let Some(result) = self.request_in_session::<C>(params).await else {
            return false;
        };
        match result {
            Ok(result) => {
                let changed = result.outcome == PassphraseChangeOutcome::Changed;
                let applied = self
                    .update_passphrase(|change| {
                        change.apply_outcome(result.outcome);
                        Some(())
                    })
                    .is_some();
                if applied
                    && changed
                    && let Some(path) = self.editor_target().note_path().map(<[String]>::to_vec)
                {
                    self.open_note(Some(path));
                }
            }
            Err(error) => {
                let error = failed("could not change the passphrase", error);
                self.update_passphrase(|change| {
                    change.restore(previous, error.message);
                    Some(())
                });
            }
        }
        true
    }
}

#[cfg(test)]
mod state_tests {
    use serde_json::json;

    use super::*;

    fn form() -> PassphraseChangeFormResult {
        let labels = [
            "title",
            "intro",
            "currentLabel",
            "newLabel",
            "repeatLabel",
            "newHint",
            "removeHistoryLabel",
            "removeHistoryDescription",
            "historyWarning",
            "otherDevicesWarning",
            "versionHistoryNotice",
            "continueLabel",
            "confirmLabel",
            "cancelLabel",
            "checkAgainLabel",
            "checkingLabel",
            "logOutLabel",
            "startingLabel",
            "enableAtomicLabel",
            "passphrasesDiffer",
            "enterCurrentPassphrase",
        ];
        let copy: serde_json::Map<_, _> = labels
            .iter()
            .map(|label| ((*label).to_owned(), json!(label)))
            .collect();
        serde_json::from_value(json!({
            "copy": copy,
            "canRemoveHistory": true,
            "repositoryLabel": "sample/notes",
        }))
        .expect("the form decodes")
    }

    fn outcome(value: serde_json::Value) -> PassphraseChangeOutcome {
        serde_json::from_value::<PassphraseChangeOutcomeResult>(json!({ "outcome": value }))
            .expect("the outcome decodes")
            .outcome
    }

    fn working() -> PassphraseChangeState {
        let mut state = PassphraseChangeState::new(form());
        let secret = Secret::new("one two three");
        assert_eq!(state.submit(&secret, &secret, &secret), Submission::Started);
        state
    }

    #[test]
    fn needs_setup_shows_the_setup_stage_and_enabling_returns_to_the_form() {
        let mut state = working();
        state.apply_outcome(outcome(json!({
            "kind": "needsSetup",
            "canConfigure": true,
            "message": "Turn on atomic commits.",
            "actionLabel": "Enable",
        })));
        assert_eq!(
            state.stage,
            PassphraseStage::Setup {
                can_configure: true,
                message: "Turn on atomic commits.".to_owned(),
                action_label: "Enable".to_owned(),
            }
        );
        assert!(state.can_close());

        assert_eq!(state.begin_enable_atomic(), Some(()));
        assert!(state.is_working());
        assert!(state.finish_enable_atomic(None));
        assert_eq!(state.stage, PassphraseStage::Form);
        assert_eq!(state.error, None);
    }

    #[test]
    fn a_failed_enable_returns_to_the_form_with_its_message() {
        let mut state = working();
        state.apply_outcome(outcome(json!({
            "kind": "needsSetup",
            "canConfigure": false,
            "message": "Ask an owner.",
            "actionLabel": "Enable",
        })));
        state.begin_enable_atomic();
        assert!(!state.finish_enable_atomic(Some("Could not enable.".to_owned())));
        assert_eq!(state.stage, PassphraseStage::Form);
        assert_eq!(state.error.as_deref(), Some("Could not enable."));
    }

    #[test]
    fn the_form_can_be_sent_again_from_the_setup_stage() {
        let mut state = working();
        state.apply_outcome(outcome(json!({
            "kind": "needsSetup",
            "canConfigure": true,
            "message": "m",
            "actionLabel": "a",
        })));
        let secret = Secret::new("one two three");
        assert_eq!(state.submit(&secret, &secret, &secret), Submission::Started);
    }

    #[test]
    fn unsettled_locks_the_change_and_settling_runs_once_at_a_time() {
        let mut state = working();
        state.apply_outcome(outcome(
            json!({ "kind": "unsettled", "message": "Unknown." }),
        ));
        assert!(!state.can_close());
        assert!(!state.is_working());
        let previous = state.begin_settle().expect("settling starts");
        assert_eq!(state.begin_settle(), None);
        assert_eq!(
            previous,
            PassphraseStage::Unsettled {
                message: "Unknown.".to_owned()
            }
        );
        assert_eq!(state.finish_settle(), Some(()));
        assert_eq!(state.finish_settle(), None);
    }

    #[test]
    fn a_failed_request_restores_the_previous_stage_with_the_message() {
        let mut state = working();
        state.restore(PassphraseStage::Form, "Offline.".to_owned());
        assert_eq!(state.stage, PassphraseStage::Form);
        assert_eq!(state.error.as_deref(), Some("Offline."));
    }

    #[test]
    fn progress_applies_only_while_working() {
        let progress = PassphraseChangeProgress {
            message: "Encrypting".to_owned(),
            done: Some(2),
            total: Some(5),
        };
        let mut state = PassphraseChangeState::new(form());
        assert_eq!(state.apply_progress(progress.clone()), None);
        assert_eq!(state.stage, PassphraseStage::Form);

        let mut state = working();
        assert_eq!(state.apply_progress(progress), Some(()));
        assert_eq!(
            state.stage,
            PassphraseStage::Working {
                message: "Encrypting".to_owned(),
                done: Some(2),
                total: Some(5),
            }
        );
    }
}

#[cfg(all(test, feature = "testing"))]
mod tests {
    use std::cell::RefCell;

    use commitnote_core_api::CoreEvent;
    use commitnote_core_api::shapes::OpenNote;
    use serde_json::json;

    use super::super::tests::{PASSPHRASE, Session, fake_bundle, run};
    use super::super::{Route, first_note};
    use super::*;

    const NEW_PASSPHRASE: &str = "violet harbour lantern seventeen";

    fn record_stages(model: &AppModel) -> Rc<RefCell<Vec<Option<PassphraseChangeState>>>> {
        let stages = Rc::new(RefCell::new(Vec::new()));
        model.connect_passphrase_change_changed({
            let stages = stages.clone();
            move |model| stages.borrow_mut().push(model.passphrase_change())
        });
        stages
    }

    fn stage(model: &AppModel) -> PassphraseStage {
        model.passphrase_change().expect("a change is open").stage
    }

    async fn open(session: &Session) -> PassphraseChangeState {
        session
            .model
            .open_change_passphrase()
            .await
            .expect("the form opens");
        let change = session.model.passphrase_change().expect("a change is open");
        assert_eq!(change.stage, PassphraseStage::Form);
        change
    }

    async fn prepare(session: &Session, current: &str, next: &str) {
        session
            .model
            .prepare_passphrase_change(
                Secret::new(current),
                Secret::new(next),
                Secret::new(next),
                false,
            )
            .await;
    }

    #[test]
    fn changes_the_passphrase_and_only_the_new_one_opens_the_repository_afterwards() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let path = first_note(&session.model.tree().unwrap_or_default())
                .expect("the sample repository has a note");
            session.model.open_note(Some(path.clone()));
            session
                .wait_until("the open note", |model| {
                    matches!(model.open_note_state(), Some(OpenNote::Loaded { .. }))
                })
                .await;
            open(&session).await;
            let stages = record_stages(&session.model);

            prepare(&session, PASSPHRASE, NEW_PASSPHRASE).await;
            let PassphraseStage::Review { summary, .. } = stage(&session.model) else {
                panic!("expected the review, got {:?}", stage(&session.model));
            };
            assert!(!summary.is_empty());
            assert!(stages.borrow().iter().any(|change| {
                let change = change.as_ref().expect("the change stays open");
                matches!(&change.stage, PassphraseStage::Working { message, .. }
                    if *message != change.copy.starting_label)
            }));

            session.model.commit_passphrase_change().await;
            assert_eq!(stage(&session.model), PassphraseStage::Done);
            assert_eq!(session.model.route(), Route::Notes);
            assert_eq!(session.model.editor_target().note_path(), Some(&path[..]));
            assert!(session.model.dismiss_change_passphrase());
            assert!(session.model.passphrase_change().is_none());
            session
                .wait_until("the reopened note", |model| {
                    matches!(model.open_note_state(), Some(OpenNote::Loaded { .. }))
                })
                .await;

            open(&session).await;
            prepare(&session, PASSPHRASE, "another new passphrase").await;
            let change = session.model.passphrase_change().expect("a change is open");
            assert_eq!(change.stage, PassphraseStage::Form);
            assert!(change.clear_current_requested);

            prepare(&session, NEW_PASSPHRASE, "another new passphrase").await;
            assert!(matches!(
                stage(&session.model),
                PassphraseStage::Review { .. }
            ));
            session.model.cancel_passphrase_change().await;
        });
    }

    #[test]
    fn rejects_an_empty_current_or_different_repeat_without_asking_the_core() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let change = open(&session).await;
            let stages = record_stages(&session.model);

            session
                .model
                .prepare_passphrase_change(
                    Secret::new(""),
                    Secret::new(NEW_PASSPHRASE),
                    Secret::new(NEW_PASSPHRASE),
                    false,
                )
                .await;
            let rejected = session.model.passphrase_change().expect("a change is open");
            assert_eq!(rejected.stage, PassphraseStage::Form);
            assert_eq!(
                rejected.error.as_deref(),
                Some(change.copy.enter_current_passphrase.as_str())
            );

            session
                .model
                .prepare_passphrase_change(
                    Secret::new(PASSPHRASE),
                    Secret::new(NEW_PASSPHRASE),
                    Secret::new("something else"),
                    false,
                )
                .await;
            let rejected = session.model.passphrase_change().expect("a change is open");
            assert_eq!(rejected.stage, PassphraseStage::Form);
            assert_eq!(
                rejected.error.as_deref(),
                Some(change.copy.passphrases_differ.as_str())
            );
            assert!(
                stages
                    .borrow()
                    .iter()
                    .all(|change| { change.as_ref().is_some_and(|change| !change.is_working()) })
            );
        });
    }

    #[test]
    fn a_wrong_current_passphrase_asks_to_clear_it() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            open(&session).await;

            prepare(&session, "not the passphrase", NEW_PASSPHRASE).await;
            let change = session.model.passphrase_change().expect("a change is open");
            assert_eq!(change.stage, PassphraseStage::Form);
            assert!(change.clear_current_requested);
            assert!(
                change
                    .error
                    .as_deref()
                    .is_some_and(|error| !error.is_empty())
            );

            session.model.acknowledge_clear_current_passphrase();
            assert!(
                !session
                    .model
                    .passphrase_change()
                    .expect("a change is open")
                    .clear_current_requested
            );
        });
    }

    #[test]
    fn cancelling_the_review_returns_to_the_form_and_drops_the_prepared_change() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            open(&session).await;
            prepare(&session, PASSPHRASE, NEW_PASSPHRASE).await;
            assert!(matches!(
                stage(&session.model),
                PassphraseStage::Review { .. }
            ));

            session.model.cancel_passphrase_change().await;
            let change = session.model.passphrase_change().expect("a change is open");
            assert_eq!(change.stage, PassphraseStage::Form);
            assert_eq!(change.error, None);
            assert!(
                session
                    .model
                    .testing_send("passphrase.commitChange", json!({}))
                    .await
                    .is_err(),
                "the core no longer holds a prepared change"
            );
        });
    }

    #[test]
    fn dismissing_is_refused_while_working_and_progress_lands_only_then() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            open(&session).await;
            let progress = PassphraseChangeProgress {
                message: "Encrypting".to_owned(),
                done: Some(1),
                total: Some(3),
            };

            session
                .model
                .handle_event(CoreEvent::PassphraseChangeProgress(progress.clone()));
            assert_eq!(stage(&session.model), PassphraseStage::Form);

            let model = session.model.clone();
            futures_util::future::join(prepare(&session, PASSPHRASE, NEW_PASSPHRASE), async {
                assert!(
                    model
                        .passphrase_change()
                        .is_some_and(|change| change.is_working())
                );
                assert!(!model.dismiss_change_passphrase());
                model.handle_event(CoreEvent::PassphraseChangeProgress(progress));
                assert!(matches!(
                    stage(&model),
                    PassphraseStage::Working {
                        done: Some(1),
                        total: Some(3),
                        ..
                    }
                ));
            })
            .await;

            assert!(matches!(
                stage(&session.model),
                PassphraseStage::Review { .. }
            ));
            assert!(session.model.dismiss_change_passphrase());
            assert!(session.model.passphrase_change().is_none());
            assert!(
                session
                    .model
                    .testing_send("passphrase.commitChange", json!({}))
                    .await
                    .is_err(),
                "dismissing the review cancels it in the core"
            );
        });
    }

    #[test]
    fn a_commit_with_an_unknown_outcome_stays_unsettled_until_the_session_ends() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            open(&session).await;
            prepare(&session, PASSPHRASE, NEW_PASSPHRASE).await;
            let repo = session
                .model
                .testing_repo_key()
                .expect("a repository is open");
            for (operation, count) in [("commit", 1), ("getHead", 2)] {
                session
                    .model
                    .testing_send(
                        "fake.failNext",
                        json!({ "repo": repo, "operation": operation, "kind": "Network", "count": count }),
                    )
                    .await
                    .expect("the fake forge queues the failure");
            }

            session.model.commit_passphrase_change().await;
            assert!(matches!(
                stage(&session.model),
                PassphraseStage::Unsettled { .. }
            ));
            assert!(!session.model.dismiss_change_passphrase());

            let stages = record_stages(&session.model);
            session.model.settle_passphrase_change().await;
            let change = session.model.passphrase_change().expect("a change is open");
            assert!(matches!(change.stage, PassphraseStage::Unsettled { .. }));
            assert!(!change.checking);
            assert!(
                stages
                    .borrow()
                    .iter()
                    .any(|change| change.as_ref().is_some_and(|change| change.checking))
            );

            session.model.log_out().await.expect("logging out succeeds");
            session
                .wait_until("the token page", |model| model.route() == Route::Token)
                .await;
            assert!(session.model.passphrase_change().is_none());
        });
    }
}
