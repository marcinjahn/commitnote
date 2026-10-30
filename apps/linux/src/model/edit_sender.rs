use std::cell::RefCell;
use std::future::Future;
use std::rc::Rc;

use commitnote_core_api::commands::NoteDraftOutcome;
use futures_util::FutureExt;
use futures_util::future::LocalBoxFuture;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditDestination {
    Note(Vec<String>),
    Draft,
}

struct PendingEdit {
    destination: EditDestination,
    text: String,
}

#[derive(Default)]
struct State {
    pending: Option<PendingEdit>,
    sending: bool,
    waiters: Vec<async_channel::Sender<()>>,
}

type NoteAction = Box<dyn Fn(Vec<String>, String) -> LocalBoxFuture<'static, ()>>;
type DraftAction = Box<dyn Fn(String) -> LocalBoxFuture<'static, Option<NoteDraftOutcome>>>;

struct Shared {
    state: RefCell<State>,
    edit_note: NoteAction,
    draft_content: DraftAction,
}

/// Sends the latest text to the core, one request at a time.
#[derive(Clone)]
pub struct EditSender {
    shared: Rc<Shared>,
}

impl EditSender {
    pub fn new<N, NF, D, DF>(edit_note: N, draft_content: D) -> Self
    where
        N: Fn(Vec<String>, String) -> NF + 'static,
        NF: Future<Output = ()> + 'static,
        D: Fn(String) -> DF + 'static,
        DF: Future<Output = Option<NoteDraftOutcome>> + 'static,
    {
        Self {
            shared: Rc::new(Shared {
                state: RefCell::default(),
                edit_note: Box::new(move |path, text| edit_note(path, text).boxed_local()),
                draft_content: Box::new(move |text| draft_content(text).boxed_local()),
            }),
        }
    }

    pub fn is_idle(&self) -> bool {
        let state = self.shared.state.borrow();
        !state.sending && state.pending.is_none()
    }

    #[cfg(all(test, feature = "testing"))]
    pub fn has_pending(&self) -> bool {
        self.shared.state.borrow().pending.is_some()
    }

    pub fn submit(&self, text: String, destination: EditDestination) {
        let start = {
            let mut state = self.shared.state.borrow_mut();
            state.pending = Some(PendingEdit { destination, text });
            !std::mem::replace(&mut state.sending, true)
        };
        if start {
            glib::spawn_future_local(drain(self.shared.clone()));
        }
    }

    pub async fn flush(&self) {
        let receiver = {
            let mut state = self.shared.state.borrow_mut();
            if !state.sending && state.pending.is_none() {
                return;
            }
            let (sender, receiver) = async_channel::bounded(1);
            state.waiters.push(sender);
            receiver
        };
        let _ = receiver.recv().await;
    }
}

async fn drain(shared: Rc<Shared>) {
    loop {
        let edit = {
            let mut state = shared.state.borrow_mut();
            match state.pending.take() {
                Some(edit) => edit,
                None => {
                    state.sending = false;
                    let waiters = std::mem::take(&mut state.waiters);
                    drop(state);
                    for waiter in waiters {
                        let _ = waiter.try_send(());
                    }
                    return;
                }
            }
        };
        match edit.destination {
            EditDestination::Note(path) => (shared.edit_note)(path, edit.text).await,
            EditDestination::Draft => {
                if let Some(NoteDraftOutcome::Created { path, .. }) =
                    (shared.draft_content)(edit.text).await
                    && let Some(pending) = shared.state.borrow_mut().pending.as_mut()
                    && pending.destination == EditDestination::Draft
                {
                    pending.destination = EditDestination::Note(path);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};
    use std::collections::VecDeque;
    use std::time::{Duration, Instant};

    use super::*;

    #[derive(Debug, Clone, PartialEq, Eq)]
    enum Sent {
        Note(Vec<String>, String),
        Draft(String),
    }

    struct Probe {
        sent: RefCell<Vec<Sent>>,
        in_flight: Cell<u32>,
        max_in_flight: Cell<u32>,
        outcomes: RefCell<VecDeque<Option<NoteDraftOutcome>>>,
        release: async_channel::Sender<()>,
        gate: async_channel::Receiver<()>,
    }

    impl Probe {
        fn new() -> Rc<Self> {
            let (release, gate) = async_channel::unbounded();
            Rc::new(Self {
                sent: RefCell::default(),
                in_flight: Cell::new(0),
                max_in_flight: Cell::new(0),
                outcomes: RefCell::default(),
                release,
                gate,
            })
        }

        fn sender(self: &Rc<Self>) -> EditSender {
            let notes = self.clone();
            let drafts = self.clone();
            EditSender::new(
                move |path, text| {
                    let probe = notes.clone();
                    async move {
                        probe.send(Sent::Note(path, text)).await;
                    }
                },
                move |text| {
                    let probe = drafts.clone();
                    async move {
                        probe.send(Sent::Draft(text)).await;
                        probe.outcomes.borrow_mut().pop_front().flatten()
                    }
                },
            )
        }

        async fn send(&self, sent: Sent) {
            self.sent.borrow_mut().push(sent);
            self.in_flight.set(self.in_flight.get() + 1);
            self.max_in_flight
                .set(self.max_in_flight.get().max(self.in_flight.get()));
            let _ = self.gate.recv().await;
            self.in_flight.set(self.in_flight.get() - 1);
        }

        fn release(&self) {
            self.release.try_send(()).expect("the gate is open");
        }

        fn sent(&self) -> Vec<Sent> {
            self.sent.borrow().clone()
        }
    }

    fn run<F: Future<Output = ()>>(test: impl FnOnce() -> F) {
        glib::MainContext::new().block_on(test());
    }

    async fn wait_until(what: &str, done: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !done() {
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            glib::timeout_future(Duration::from_millis(2)).await;
        }
    }

    fn note(name: &str) -> Vec<String> {
        vec![name.to_owned()]
    }

    #[test]
    fn the_latest_text_wins_while_a_send_is_in_flight() {
        run(|| async {
            let probe = Probe::new();
            let sender = probe.sender();
            sender.submit("a".to_owned(), EditDestination::Note(note("n")));
            wait_until("the first send", || probe.sent().len() == 1).await;
            sender.submit("b".to_owned(), EditDestination::Note(note("n")));
            sender.submit("c".to_owned(), EditDestination::Note(note("n")));
            probe.release();
            probe.release();
            sender.flush().await;
            assert_eq!(
                probe.sent(),
                vec![
                    Sent::Note(note("n"), "a".to_owned()),
                    Sent::Note(note("n"), "c".to_owned()),
                ]
            );
            assert!(sender.is_idle());
        });
    }

    #[test]
    fn only_one_send_is_in_flight() {
        run(|| async {
            let probe = Probe::new();
            let sender = probe.sender();
            sender.submit("a".to_owned(), EditDestination::Note(note("n")));
            wait_until("the first send", || probe.in_flight.get() == 1).await;
            sender.submit("b".to_owned(), EditDestination::Note(note("n")));
            glib::timeout_future(Duration::from_millis(20)).await;
            assert_eq!(probe.sent().len(), 1);
            assert_eq!(probe.in_flight.get(), 1);

            probe.release();
            wait_until("the second send", || probe.sent().len() == 2).await;
            sender.submit("c".to_owned(), EditDestination::Note(note("n")));
            probe.release();
            probe.release();
            sender.flush().await;
            assert_eq!(probe.sent().len(), 3);
            assert_eq!(probe.max_in_flight.get(), 1);
        });
    }

    #[test]
    fn flush_waits_for_the_in_flight_and_the_pending_send() {
        run(|| async {
            let probe = Probe::new();
            let sender = probe.sender();
            assert!(sender.is_idle());
            sender.flush().await;

            sender.submit("a".to_owned(), EditDestination::Note(note("n")));
            wait_until("the first send", || probe.sent().len() == 1).await;
            sender.submit("b".to_owned(), EditDestination::Note(note("n")));
            assert!(!sender.is_idle());

            let flushed = Rc::new(Cell::new(false));
            let waiting = glib::spawn_future_local({
                let sender = sender.clone();
                let flushed = flushed.clone();
                async move {
                    sender.flush().await;
                    flushed.set(true);
                }
            });
            glib::timeout_future(Duration::from_millis(20)).await;
            assert!(!flushed.get());

            probe.release();
            wait_until("the pending send", || probe.sent().len() == 2).await;
            glib::timeout_future(Duration::from_millis(20)).await;
            assert!(!flushed.get());

            probe.release();
            waiting.await.expect("the flush completes");
            assert!(flushed.get());
            assert!(sender.is_idle());
        });
    }

    #[test]
    fn a_draft_promotion_redirects_the_pending_text() {
        run(|| async {
            let probe = Probe::new();
            probe
                .outcomes
                .borrow_mut()
                .push_back(Some(NoteDraftOutcome::Created {
                    path: note("created"),
                    field_error: None,
                }));
            let sender = probe.sender();
            sender.submit("one".to_owned(), EditDestination::Draft);
            wait_until("the draft send", || probe.sent().len() == 1).await;
            sender.submit("two".to_owned(), EditDestination::Draft);
            probe.release();
            wait_until("the redirected send", || probe.sent().len() == 2).await;
            probe.release();
            sender.flush().await;
            assert_eq!(
                probe.sent(),
                vec![
                    Sent::Draft("one".to_owned()),
                    Sent::Note(note("created"), "two".to_owned()),
                ]
            );
        });
    }

    #[test]
    fn pending_text_stays_a_draft_until_the_note_is_created() {
        run(|| async {
            let probe = Probe::new();
            probe
                .outcomes
                .borrow_mut()
                .push_back(Some(NoteDraftOutcome::None));
            let sender = probe.sender();
            sender.submit("one".to_owned(), EditDestination::Draft);
            wait_until("the draft send", || probe.sent().len() == 1).await;
            sender.submit("two".to_owned(), EditDestination::Draft);
            probe.release();
            probe.release();
            sender.flush().await;
            assert_eq!(
                probe.sent(),
                vec![Sent::Draft("one".to_owned()), Sent::Draft("two".to_owned())]
            );
        });
    }

    #[test]
    fn a_failed_send_does_not_wedge_the_sender() {
        run(|| async {
            let probe = Probe::new();
            probe.outcomes.borrow_mut().push_back(None);
            let sender = probe.sender();
            sender.submit("one".to_owned(), EditDestination::Draft);
            wait_until("the failing send", || probe.sent().len() == 1).await;
            sender.submit("two".to_owned(), EditDestination::Draft);
            probe.release();
            wait_until("the next send", || probe.sent().len() == 2).await;
            probe.release();
            sender.flush().await;
            assert!(sender.is_idle());

            sender.submit("three".to_owned(), EditDestination::Note(note("n")));
            wait_until("a send after the failure", || probe.sent().len() == 3).await;
            probe.release();
            sender.flush().await;
            assert_eq!(
                probe.sent().last(),
                Some(&Sent::Note(note("n"), "three".to_owned()))
            );
        });
    }
}
