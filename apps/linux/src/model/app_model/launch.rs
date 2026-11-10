use commitnote_core_api::Command;
use commitnote_core_api::commands::{
    LaunchAction, LaunchAttach, LaunchAttachParams, LaunchDeliver, LaunchDeliverParams,
    LaunchDetach, LaunchDetachParams,
};
use glib::prelude::*;

use super::{AppModel, Route, warn};

/// What the host asked the core to run on launch, and the attachment the core last heard of.
#[derive(Default)]
pub(super) struct LaunchState {
    inbox: Vec<LaunchAction>,
    /// `None` until the running core has been told; the inner `None` is a detach.
    sent: Option<Option<Vec<LaunchAction>>>,
    /// A new note the early draft took during start-up, owed to the notes if start-up ends
    /// elsewhere with the early draft still empty.
    early_new_note_taken: bool,
}

impl AppModel {
    /// Hands an action to the core, which runs it once the current screen can take it.
    pub fn deliver_launch_action(&self, action: LaunchAction) {
        if !self.launch_core_running() {
            self.state_mut().launch.inbox.push(action);
            return;
        }
        self.state_mut().launch.early_new_note_taken = false;
        self.send_launch_delivery(action);
    }

    pub fn connect_launch_action<F: Fn(&Self, LaunchAction) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_string_signal("launch-action", move |model, action| {
            if let Some(action) = LaunchAction::from_wire(action) {
                f(model, action);
            }
        })
    }

    pub(super) fn attach_launch_triggers(&self) {
        self.connect_route_changed(Self::sync_launch_attachment);
    }

    /// Brings a freshly started core up to date: it holds no attachment and none of the
    /// actions that arrived while no core was running.
    pub(super) fn launch_core_started(&self) {
        self.state_mut().launch.sent = None;
        self.sync_launch_attachment();
        let actions = {
            let mut state = self.state_mut();
            let actions = std::mem::take(&mut state.launch.inbox);
            if !actions.is_empty() {
                state.launch.early_new_note_taken = false;
            }
            actions
        };
        for action in actions {
            self.send_launch_delivery(action);
        }
    }

    pub(super) fn launch_action_received(&self, action: LaunchAction) {
        let route = self.state().route.clone();
        match route {
            Route::Starting | Route::Loading { failure: None } => {
                if action == LaunchAction::NewNote {
                    self.state_mut().launch.early_new_note_taken = true;
                }
            }
            Route::Notes => {}
            _ => {
                // The core ran it under an attachment whose detach was still on its way.
                if action == LaunchAction::NewNote {
                    self.state_mut().launch.early_new_note_taken = true;
                    self.redeliver_early_new_note();
                }
                return;
            }
        }
        self.emit_by_name::<()>("launch-action", &[&action.as_str()]);
    }

    pub(super) fn sync_launch_attachment(&self) {
        if !self.launch_core_running() {
            return;
        }
        let accepts = self.launch_accepts();
        {
            let mut state = self.state_mut();
            if state.route == Route::Notes {
                state.launch.early_new_note_taken = false;
            }
            if state.launch.sent.as_ref() == Some(&accepts) {
                return;
            }
            state.launch.sent = Some(accepts.clone());
        }
        match accepts {
            Some(accepts) => {
                self.send_launch_command::<LaunchAttach>(
                    LaunchAttachParams { accepts },
                    "could not attach launch actions",
                );
            }
            None => {
                self.send_launch_command::<LaunchDetach>(
                    LaunchDetachParams {},
                    "could not detach launch actions",
                );
                self.redeliver_early_new_note();
            }
        }
    }

    fn launch_accepts(&self) -> Option<Vec<LaunchAction>> {
        match self.state().route {
            Route::Starting | Route::Loading { failure: None } => Some(vec![LaunchAction::NewNote]),
            Route::Notes if self.last_view_settled() => {
                Some(vec![LaunchAction::NewNote, LaunchAction::Search])
            }
            _ => None,
        }
    }

    /// Sends the new note the early draft took back to the core once nothing is attached, so
    /// it waits there for the notes instead of running again at once.
    fn redeliver_early_new_note(&self) {
        {
            let mut state = self.state_mut();
            let detached = state.launch.sent == Some(None);
            if !state.launch.early_new_note_taken || !detached || state.route == Route::Notes {
                return;
            }
            state.launch.early_new_note_taken = false;
        }
        if !self.has_early_draft_text() {
            self.send_launch_delivery(LaunchAction::NewNote);
        }
    }

    fn launch_core_running(&self) -> bool {
        self.client().is_some_and(|client| client.is_running())
    }

    fn send_launch_delivery(&self, action: LaunchAction) {
        self.send_launch_command::<LaunchDeliver>(
            LaunchDeliverParams { action },
            "could not deliver a launch action",
        );
    }

    /// The request is dispatched before this returns, so launch commands reach the core in
    /// the order they are sent.
    fn send_launch_command<C: Command + 'static>(&self, params: C::Params, what: &'static str) {
        let request = self.request::<C>(params);
        self.spawn(async move {
            if let Err(error) = request.await {
                warn(what, &error);
            }
        });
    }
}

#[cfg(all(test, feature = "testing"))]
mod tests {
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

    use commitnote_core_api::Secret;
    use commitnote_core_api::commands::{ForgesList, ForgesListParams};

    use super::super::LogOutResult;
    use super::super::tests::{NOTES_URL, PASSPHRASE, Session, fake_bundle, run};
    use super::*;

    #[derive(Debug, PartialEq)]
    struct Fired {
        action: LaunchAction,
        route: Route,
        settled: bool,
    }

    type Record = Rc<RefCell<Vec<Fired>>>;

    fn record(model: &AppModel) -> Record {
        let fired = Record::default();
        let sink = fired.clone();
        model.connect_launch_action(move |model, action| {
            sink.borrow_mut().push(Fired {
                action,
                route: model.route(),
                settled: model.last_view_settled(),
            });
        });
        fired
    }

    fn on_settled_notes(action: LaunchAction) -> Fired {
        Fired {
            action,
            route: Route::Notes,
            settled: true,
        }
    }

    fn actions(fired: &Record) -> Vec<LaunchAction> {
        fired.borrow().iter().map(|fired| fired.action).collect()
    }

    async fn wait_fired(session: &Session, fired: &Record, count: usize) {
        let fired = fired.clone();
        session
            .wait_until("the launch actions", move |_| fired.borrow().len() >= count)
            .await;
    }

    /// The core emits an accepted action while handling its command, so once a later
    /// request is answered, anything the core ran has reached the model.
    async fn core_round_trip(session: &Session) {
        session
            .model
            .request::<ForgesList>(ForgesListParams {})
            .await
            .expect("the core answers");
    }

    async fn wait_settled(session: &Session) {
        session
            .wait_until("the settled notes", |model| {
                model.route() == Route::Notes && model.last_view_settled()
            })
            .await;
    }

    #[test]
    fn an_action_from_before_the_core_starts_waits_for_the_settled_notes() {
        run(|| async {
            let session = Session::start(fake_bundle());
            let fired = record(&session.model);
            session.model.deliver_launch_action(LaunchAction::Search);
            session.log_in().await;
            wait_settled(&session).await;
            wait_fired(&session, &fired, 1).await;

            session.model.deliver_launch_action(LaunchAction::NewNote);
            wait_fired(&session, &fired, 2).await;
            core_round_trip(&session).await;
            assert_eq!(
                *fired.borrow(),
                [
                    on_settled_notes(LaunchAction::Search),
                    on_settled_notes(LaunchAction::NewNote),
                ]
            );
        });
    }

    #[test]
    fn a_search_on_the_token_page_waits_for_the_notes() {
        run(|| async {
            let session = Session::start(fake_bundle());
            let fired = record(&session.model);
            session
                .wait_until("the token page", |model| model.route() == Route::Token)
                .await;
            session.model.deliver_launch_action(LaunchAction::Search);
            core_round_trip(&session).await;
            assert!(fired.borrow().is_empty());

            session.log_in().await;
            wait_fired(&session, &fired, 1).await;
            core_round_trip(&session).await;
            assert_eq!(*fired.borrow(), [on_settled_notes(LaunchAction::Search)]);
        });
    }

    #[test]
    fn loading_takes_a_new_note_and_holds_a_search_for_the_notes() {
        run(|| async {
            let session = Session::start(fake_bundle());
            let fired = record(&session.model);
            session.choose(NOTES_URL).await;
            let delivered = Rc::new(Cell::new(false));
            let once = delivered.clone();
            session.model.connect_route_changed(move |model| {
                if model.route() == (Route::Loading { failure: None }) && !once.replace(true) {
                    model.deliver_launch_action(LaunchAction::NewNote);
                    model.deliver_launch_action(LaunchAction::Search);
                }
            });
            session
                .model
                .unlock(Secret::new(PASSPHRASE), false)
                .await
                .expect("the sample passphrase unlocks");
            wait_settled(&session).await;
            wait_fired(&session, &fired, 2).await;
            core_round_trip(&session).await;
            assert!(delivered.get());
            assert_eq!(
                *fired.borrow(),
                [
                    Fired {
                        action: LaunchAction::NewNote,
                        route: Route::Loading { failure: None },
                        settled: false,
                    },
                    on_settled_notes(LaunchAction::Search),
                ]
            );
        });
    }

    #[test]
    fn the_core_started_after_logging_out_holds_an_action_for_the_next_session() {
        run(|| async {
            let session = Session::start(fake_bundle());
            let fired = record(&session.model);
            session.log_in().await;
            wait_settled(&session).await;
            assert_eq!(
                session.model.log_out().await.expect("logging out succeeds"),
                LogOutResult::LoggedOut
            );
            session
                .wait_until("the token page after logging out", |model| {
                    model.route() == Route::Token
                })
                .await;
            session.model.deliver_launch_action(LaunchAction::Search);
            core_round_trip(&session).await;
            assert!(fired.borrow().is_empty());

            session.log_in().await;
            wait_fired(&session, &fired, 1).await;
            core_round_trip(&session).await;
            assert_eq!(*fired.borrow(), [on_settled_notes(LaunchAction::Search)]);
        });
    }

    #[test]
    fn a_new_note_the_start_up_took_runs_again_when_it_ends_without_the_notes() {
        run(|| async {
            let session = Session::start(fake_bundle());
            let fired = record(&session.model);
            session.model.deliver_launch_action(LaunchAction::NewNote);
            session
                .wait_until("the token page", |model| model.route() == Route::Token)
                .await;
            assert_eq!(actions(&fired), [LaunchAction::NewNote]);
            assert!(matches!(
                fired.borrow()[0].route,
                Route::Starting | Route::Loading { failure: None }
            ));
            assert!(!session.model.has_early_draft_text());

            session.log_in().await;
            wait_settled(&session).await;
            core_round_trip(&session).await;
            assert_eq!(
                actions(&fired),
                [LaunchAction::NewNote, LaunchAction::NewNote]
            );
            assert!(matches!(
                fired.borrow()[1].route,
                Route::Loading { failure: None } | Route::Notes
            ));
        });
    }
}
