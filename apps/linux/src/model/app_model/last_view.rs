use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use commitnote_core_api::commands::{
    DetailItemText, LastViewLoad, LastViewLoadParams, LastViewSave, LastViewSetEnabled,
    LastViewSetEnabledParams, NoteDates, NoteDatesParams, NoteStats, NoteStatsParams,
};
use commitnote_core_api::shapes::{LastViewState, TreeNode};
use commitnote_core_runtime::RequestError;
use glib::prelude::*;
use glib::subclass::types::ObjectSubclassIsExt;

use super::organise::failed;
use super::{AppModel, EditorTarget, Route, State, UserError, warn};

const SAVE_DEBOUNCE: Duration = Duration::from_millis(500);
/// The core writes a save after its own debounce, which a stopping core drops.
const CORE_SAVE_DELAY: Duration = Duration::from_millis(500);
const EXIT_FLUSH_LIMIT: Duration = Duration::from_secs(2);
const EXIT_FLUSH_POLL: Duration = Duration::from_millis(20);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteDetails {
    pub words: DetailItemText,
    pub tasks: Option<DetailItemText>,
    pub not_saved: bool,
    pub created: Option<DetailItemText>,
    pub updated: Option<DetailItemText>,
    pub shared: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
enum Check {
    #[default]
    Pending,
    Loading,
    Done,
}

/// The last open note and expanded folders, restored once per session and saved as they change.
#[derive(Default)]
pub(super) struct LastViewTracker {
    check: Check,
    handed_off: bool,
    folders: Vec<Vec<String>>,
    restored: Option<Vec<Vec<String>>>,
    saved: Option<LastViewState>,
    pending: Option<LastViewState>,
    sent_at: Option<Instant>,
    ticket: u64,
    #[cfg(all(test, feature = "testing"))]
    sent: Vec<(bool, LastViewState)>,
}

impl AppModel {
    #[cfg(feature = "testing")]
    pub fn testing_last_view_checked(&self) -> bool {
        self.last_view_settled()
    }

    /// Whether the session's entry has settled: the last view was restored or skipped.
    pub(super) fn last_view_settled(&self) -> bool {
        self.state().last_view.check == Check::Done
    }

    pub fn connect_last_view_restored<F: Fn(&Self) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_unit_signal("last-view-restored", f)
    }

    /// Hands over the folders of the restored view once; later calls get nothing.
    pub fn take_restored_folders(&self) -> Vec<Vec<String>> {
        self.state_mut()
            .last_view
            .restored
            .take()
            .unwrap_or_default()
    }

    pub fn record_expanded_folders(&self, folders: Vec<Vec<String>>) {
        {
            let mut state = self.state_mut();
            if state.last_view.folders == folders {
                return;
            }
            state.last_view.folders = folders;
        }
        self.last_view_changed();
    }

    pub async fn set_reopen_last_view(&self, enabled: bool) -> Result<(), UserError> {
        let view = {
            let mut state = self.state_mut();
            let view = current_view(&state);
            let tracker = &mut state.last_view;
            tracker.pending = None;
            if tracker.check == Check::Done {
                tracker.saved = Some(view.clone());
            }
            view
        };
        self.request::<LastViewSetEnabled>(LastViewSetEnabledParams { enabled, view })
            .await
            .map(|_| ())
            .map_err(|error| failed("could not change reopening the last view", error))
    }

    pub async fn note_details(&self, path: Vec<String>) -> Result<NoteDetails, UserError> {
        self.flush_edits().await;
        let stats = self.request::<NoteStats>(NoteStatsParams { path: path.clone() });
        let dates = self.request::<NoteDates>(NoteDatesParams { path: path.clone() });
        let stats = stats
            .await
            .map_err(|error| failed("could not count the note's words", error))?;
        let dates = dates
            .await
            .map_err(|error| failed("could not read the note's dates", error))?;
        let shared = self
            .open_note_tag_and_sharing(&path)
            .is_some_and(|(_, shared)| shared);
        Ok(NoteDetails {
            words: stats.words,
            tasks: stats.tasks,
            not_saved: dates.not_saved,
            created: dates.created,
            updated: dates.updated,
            shared,
        })
    }

    pub(super) fn attach_last_view_triggers(&self) {
        self.connect_tree_changed(Self::check_last_view);
        self.connect_route_changed(Self::check_last_view);
        self.connect_open_note_changed(Self::last_view_changed);
    }

    pub(super) fn mark_early_draft_handed_off(&self) {
        self.state_mut().last_view.handed_off = true;
    }

    /// Sends a save still waiting for its debounce while the session can take it.
    pub(super) async fn flush_last_view(&self) {
        let view = self.state_mut().last_view.pending.take();
        if let Some(request) = view.and_then(|view| self.send_last_view(view)) {
            request.await;
        }
    }

    /// Writes the view to the core's storage before the model shuts down, waiting a bounded
    /// time, because the core would drop a save still held by its debounce.
    pub(super) fn flush_last_view_on_exit(&self) {
        let Some(context) = self.imp().context.get() else {
            return;
        };
        let Ok(_owner) = context.acquire() else {
            return;
        };
        let Some((view, read_back)) = self.exit_flush() else {
            return;
        };
        let done = Rc::new(Cell::new(false));
        let timed_out = Arc::new(AtomicBool::new(false));
        let limit = glib::timeout_source_new(EXIT_FLUSH_LIMIT, None, glib::Priority::DEFAULT, {
            let timed_out = timed_out.clone();
            move || {
                timed_out.store(true, Ordering::Release);
                glib::ControlFlow::Break
            }
        });
        limit.attach(Some(context));
        let model = self.clone();
        context.spawn_local({
            let done = done.clone();
            async move {
                model.store_last_view(view, &read_back).await;
                done.set(true);
            }
        });
        while !done.get() && !timed_out.load(Ordering::Acquire) {
            context.iteration(true);
        }
        limit.destroy();
    }

    /// A core that reopens nothing answers a load with no view, and must not be switched back
    /// on by the write.
    async fn store_last_view(&self, view: LastViewState, read_back: &ReadBack) {
        let reopening = self.request::<LastViewLoad>(LastViewLoadParams {}).await;
        if !reopening.is_ok_and(|reply| reply.view.is_some()) {
            return;
        }
        let params = LastViewSetEnabledParams {
            enabled: true,
            view,
        };
        if self.request::<LastViewSetEnabled>(params).await.is_err() {
            return;
        }
        let deadline = Instant::now() + EXIT_FLUSH_LIMIT;
        loop {
            let stored = self.request::<LastViewLoad>(LastViewLoadParams {}).await;
            if stored.is_ok_and(|reply| reply.view.is_some_and(|view| read_back.matches(&view)))
                || Instant::now() >= deadline
            {
                return;
            }
            glib::timeout_future(EXIT_FLUSH_POLL).await;
        }
    }

    /// The view to store and what the core reads back for it, unless nothing of it can be lost.
    fn exit_flush(&self) -> Option<(LastViewState, ReadBack)> {
        let mut state = self.state_mut();
        if state.shut_down || state.last_view.check != Check::Done {
            return None;
        }
        let in_flight = state
            .last_view
            .sent_at
            .is_some_and(|sent| sent.elapsed() < CORE_SAVE_DELAY);
        if state.last_view.pending.is_none() && !in_flight {
            return None;
        }
        state.last_view.pending = None;
        let view = current_view(&state);
        let read_back = ReadBack::new(view.clone(), state.tree.as_deref().unwrap_or_default());
        Some((view, read_back))
    }

    /// The tracker for the next session; nothing of the ended one carries over, as the core
    /// can no longer take a save.
    pub(super) fn end_last_view(&self) -> LastViewTracker {
        LastViewTracker {
            #[cfg(all(test, feature = "testing"))]
            sent: std::mem::take(&mut self.state_mut().last_view.sent),
            ..LastViewTracker::default()
        }
    }

    fn check_last_view(&self) {
        let skip = {
            let mut state = self.state_mut();
            if state.shut_down
                || state.last_view.check != Check::Pending
                || state.route != Route::Notes
                || state.tree.is_none()
            {
                return;
            }
            let skip = state.editor_target != EditorTarget::None
                || state.handing_off
                || state.last_view.handed_off;
            state.last_view.check = if skip { Check::Done } else { Check::Loading };
            skip
        };
        if skip {
            self.last_view_changed();
            self.sync_launch_attachment();
            return;
        }
        let generation = self.imp().generation.get();
        let request = self.request::<LastViewLoad>(LastViewLoadParams {});
        let model = self.downgrade();
        self.spawn(async move {
            let result = request.await;
            if let Some(model) = model.upgrade() {
                model.last_view_loaded(generation, result.map(|reply| reply.view));
            }
        });
    }

    fn last_view_loaded(
        &self,
        generation: u64,
        result: Result<Option<LastViewState>, RequestError>,
    ) {
        if self.imp().generation.get() != generation || self.state().shut_down {
            return;
        }
        let view = result.unwrap_or_else(|error| {
            warn("could not load the last view", &error);
            None
        });
        let open = {
            let mut state = self.state_mut();
            let untouched = state.editor_target == EditorTarget::None;
            let note = view
                .as_ref()
                .and_then(|view| view.note.clone())
                .filter(|note| {
                    untouched
                        && state
                            .tree
                            .as_deref()
                            .and_then(|tree| find_node(tree, note))
                            .is_some_and(|node| matches!(node, TreeNode::Note { .. }))
                });
            let tracker = &mut state.last_view;
            tracker.check = Check::Done;
            match view {
                Some(view) if untouched => {
                    tracker.folders = view.folders.clone();
                    tracker.restored = Some(view.folders.clone());
                    tracker.saved = Some(LastViewState {
                        note: note.clone(),
                        folders: view.folders,
                    });
                    Some(note)
                }
                _ => None,
            }
        };
        if let Some(note) = open {
            self.emit_by_name::<()>("last-view-restored", &[]);
            if note.is_some() {
                self.open_note(note);
            }
        }
        self.last_view_changed();
        self.sync_launch_attachment();
    }

    /// Restarts the save debounce on every change; a timer whose ticket is no longer the
    /// newest does nothing when it fires.
    fn last_view_changed(&self) {
        let ticket = {
            let mut state = self.state_mut();
            if state.shut_down || state.last_view.check != Check::Done {
                return;
            }
            let view = current_view(&state);
            let tracker = &mut state.last_view;
            if tracker.saved.as_ref() == Some(&view) {
                tracker.pending = None;
                return;
            }
            if tracker.pending.as_ref() == Some(&view) {
                return;
            }
            tracker.pending = Some(view);
            tracker.ticket += 1;
            tracker.ticket
        };
        let generation = self.imp().generation.get();
        let model = self.downgrade();
        self.spawn(async move {
            glib::timeout_future(SAVE_DEBOUNCE).await;
            if let Some(model) = model.upgrade()
                && model.imp().generation.get() == generation
            {
                model.last_view_debounced(ticket);
            }
        });
    }

    fn last_view_debounced(&self, ticket: u64) {
        let view = {
            let mut state = self.state_mut();
            if state.shut_down || state.last_view.ticket != ticket {
                return;
            }
            state.last_view.pending.take()
        };
        if let Some(request) = view.and_then(|view| self.send_last_view(view)) {
            self.spawn(request);
        }
    }

    fn send_last_view(&self, view: LastViewState) -> Option<impl Future<Output = ()> + use<>> {
        {
            let mut state = self.state_mut();
            let tracker = &mut state.last_view;
            #[cfg(all(test, feature = "testing"))]
            tracker
                .sent
                .push((tracker.check == Check::Done, view.clone()));
            if tracker.check != Check::Done {
                return None;
            }
            tracker.saved = Some(view.clone());
            tracker.sent_at = Some(Instant::now());
        }
        let request = self.request::<LastViewSave>(view);
        Some(async move {
            if let Err(error) = request.await {
                warn("could not save the last view", &error);
            }
        })
    }
}

/// What the core reads back once it has stored a view. The core keeps what exists in the whole
/// tree, but the model only sees the tree a tag filter leaves: the open note and every expanded
/// folder the filter shows must come back, while an expanded folder the filter hides may not.
#[derive(Debug)]
struct ReadBack {
    view: LastViewState,
    visible: Vec<bool>,
}

impl ReadBack {
    fn new(view: LastViewState, tree: &[TreeNode]) -> Self {
        let visible = view
            .folders
            .iter()
            .map(|folder| matches!(find_node(tree, folder), Some(TreeNode::Folder { .. })))
            .collect();
        Self { view, visible }
    }

    /// The core writes an empty view before the real one, so an empty read-back counts only
    /// for an empty view.
    fn matches(&self, stored: &LastViewState) -> bool {
        if stored.note != self.view.note || (is_empty(stored) && !is_empty(&self.view)) {
            return false;
        }
        let mut kept = stored.folders.iter().peekable();
        for (folder, visible) in self.view.folders.iter().zip(&self.visible) {
            if kept.next_if_eq(&folder).is_none() && *visible {
                return false;
            }
        }
        kept.next().is_none()
    }
}

fn is_empty(view: &LastViewState) -> bool {
    view.note.is_none() && view.folders.is_empty()
}

fn current_view(state: &State) -> LastViewState {
    LastViewState {
        note: state.editor_target.note_path().map(<[String]>::to_vec),
        folders: state.last_view.folders.clone(),
    }
}

fn find_node<'a>(nodes: &'a [TreeNode], path: &[String]) -> Option<&'a TreeNode> {
    nodes.iter().find_map(|node| match node {
        TreeNode::Note { path: own, .. } => (own.as_slice() == path).then_some(node),
        TreeNode::Folder {
            path: own,
            children,
            ..
        } => {
            if own.as_slice() == path {
                Some(node)
            } else if path.starts_with(own) {
                find_node(children, path)
            } else {
                None
            }
        }
    })
}

#[cfg(all(test, feature = "testing"))]
mod tests {
    use std::cell::Cell;
    use std::rc::Rc;
    use std::time::Instant;

    use commitnote_core_api::commands::LastViewLoadResult;
    use commitnote_core_api::shapes::ColorTag;

    use super::super::tests::{Session, fake_bundle, open_and_read, run};
    use super::*;

    fn path(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    fn ideas() -> Vec<String> {
        path(&["Projects", "commitnote", "Ideas"])
    }

    fn expanded() -> Vec<Vec<String>> {
        vec![path(&["Projects"]), path(&["Projects", "commitnote"])]
    }

    fn count_restores(model: &AppModel) -> Rc<Cell<u32>> {
        let count = Rc::new(Cell::new(0_u32));
        model.connect_last_view_restored({
            let count = count.clone();
            move |_| count.set(count.get() + 1)
        });
        count
    }

    async fn checked(session: &Session) {
        session
            .wait_until("the last-view check", |model| {
                model.state().last_view.check == Check::Done
            })
            .await;
    }

    async fn stored_view(session: &Session) -> Option<LastViewState> {
        let reply = session
            .model
            .testing_send("lastView.load", serde_json::json!({}))
            .await
            .expect("the core loads the last view");
        serde_json::from_value::<LastViewLoadResult>(reply)
            .expect("the reply is a last view")
            .view
    }

    /// Waits past the model's and the core's debounces until the view is on disk.
    async fn wait_until_stored(session: &Session, expected: &LastViewState) {
        let deadline = Instant::now() + Duration::from_secs(30);
        while stored_view(session).await.as_ref() != Some(expected) {
            assert!(Instant::now() < deadline, "timed out waiting for the save");
            glib::timeout_future(Duration::from_millis(50)).await;
        }
    }

    async fn remember_ideas(session: &Session) {
        session.log_in_remembered().await;
        checked(session).await;
        open_and_read(session, &ideas()).await;
        session.model.record_expanded_folders(expanded());
        wait_until_stored(
            session,
            &LastViewState {
                note: Some(ideas()),
                folders: expanded(),
            },
        )
        .await;
    }

    fn assert_sent_only_after_the_check(model: &AppModel) {
        assert!(model.state().last_view.sent.iter().all(|(done, _)| *done));
    }

    #[test]
    fn a_new_session_reopens_the_last_note_and_folders() {
        run(|| async {
            let mut session = Session::start(fake_bundle());
            remember_ideas(&session).await;
            assert_sent_only_after_the_check(&session.model);

            session.restart();
            let restores = count_restores(&session.model);
            session.log_in_remembered().await;
            session
                .wait_until("the restored note", |model| {
                    model.editor_target() == EditorTarget::Note(ideas())
                })
                .await;

            assert_eq!(restores.get(), 1);
            assert_eq!(session.model.take_restored_folders(), expanded());
            assert!(session.model.take_restored_folders().is_empty());
            open_and_read(&session, &ideas()).await;
            let state = session.model.state();
            assert!(state.last_view.pending.is_none());
            assert!(state.last_view.sent.is_empty());
        });
    }

    #[test]
    fn turning_reopening_off_restores_nothing_next_time() {
        run(|| async {
            let mut session = Session::start(fake_bundle());
            remember_ideas(&session).await;
            session
                .model
                .set_reopen_last_view(false)
                .await
                .expect("the setting changes");
            assert_eq!(stored_view(&session).await, None);

            session.restart();
            let restores = count_restores(&session.model);
            session.log_in_remembered().await;
            checked(&session).await;

            assert_eq!(session.model.editor_target(), EditorTarget::None);
            assert_eq!(restores.get(), 0);
            assert!(session.model.take_restored_folders().is_empty());
        });
    }

    /// Runs `before`, shuts the model down outside any polled future, as the application does,
    /// and runs `after` on the relaunched one. Returns how long the shutdown took.
    fn across_a_shutdown(
        before: impl AsyncFnOnce(&Session),
        after: impl AsyncFnOnce(&Session),
    ) -> Duration {
        let context = glib::MainContext::new();
        let mut session = context.block_on(async {
            let session = Session::start(fake_bundle());
            before(&session).await;
            session
        });
        let started = Instant::now();
        context
            .with_thread_default(|| session.restart_with_flush())
            .expect("the test owns the context");
        let shutdown = started.elapsed();
        context.block_on(after(&session));
        shutdown
    }

    fn welcome() -> Vec<String> {
        path(&["Welcome"])
    }

    fn shown(model: &AppModel, path: &[String]) -> bool {
        model
            .tree()
            .is_some_and(|tree| find_node(&tree, path).is_some())
    }

    /// Opens the untagged Welcome note and filters the tree by blue, which hides that note.
    async fn welcome_under_the_blue_filter(session: &Session) {
        remember_ideas(session).await;
        open_and_read(session, &welcome()).await;
        session
            .model
            .set_tag_filter(Some(ColorTag::Blue))
            .await
            .expect("the filter is set");
        session
            .wait_until("the blue filter", |model| {
                model.tag_filter() == Some(ColorTag::Blue) && !shown(model, &welcome())
            })
            .await;
        assert_eq!(session.model.editor_target(), EditorTarget::Note(welcome()));
    }

    async fn reopened(session: &Session, expected: &LastViewState) {
        session.log_in_remembered().await;
        checked(session).await;
        assert_eq!(stored_view(session).await.as_ref(), Some(expected));
        session
            .wait_until("the restored note", |model| {
                Some(model.editor_target()) == expected.note.clone().map(EditorTarget::Note)
            })
            .await;
        assert_eq!(session.model.take_restored_folders(), expected.folders);
    }

    #[test]
    fn quitting_under_a_tag_filter_keeps_a_hidden_note_and_a_shown_folder_without_waiting() {
        let expected = LastViewState {
            note: Some(welcome()),
            folders: vec![path(&["Projects"])],
        };
        let shutdown = across_a_shutdown(
            async |session| {
                welcome_under_the_blue_filter(session).await;
                assert!(shown(&session.model, &expected.folders[0]));
                session
                    .model
                    .record_expanded_folders(expected.folders.clone());
                assert!(session.model.state().last_view.pending.is_some());
            },
            async |session| reopened(session, &expected).await,
        );
        assert!(
            shutdown < Duration::from_secs(1),
            "the shutdown took {shutdown:?}"
        );
    }

    #[test]
    fn quitting_with_the_whole_view_hidden_by_a_tag_filter_keeps_it() {
        let expected = LastViewState {
            note: Some(welcome()),
            folders: vec![path(&["Journal"])],
        };
        across_a_shutdown(
            async |session| {
                welcome_under_the_blue_filter(session).await;
                assert!(!shown(&session.model, &expected.folders[0]));
                session
                    .model
                    .record_expanded_folders(expected.folders.clone());
                assert!(session.model.state().last_view.pending.is_some());
            },
            async |session| reopened(session, &expected).await,
        );
    }

    struct DefaultContextOwner {
        release: Option<std::sync::mpsc::Sender<()>>,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl DefaultContextOwner {
        fn take() -> Self {
            let (acquired_tx, acquired_rx) = std::sync::mpsc::channel();
            let (release, release_rx) = std::sync::mpsc::channel::<()>();
            let thread = std::thread::spawn(move || {
                let default = glib::MainContext::default();
                let deadline = Instant::now() + Duration::from_secs(30);
                let owner = loop {
                    if let Ok(owner) = default.acquire() {
                        break owner;
                    }
                    assert!(Instant::now() < deadline, "the default context stayed busy");
                    std::thread::yield_now();
                };
                acquired_tx.send(()).expect("the test waits for the owner");
                let _ = release_rx.recv();
                drop(owner);
            });
            acquired_rx
                .recv()
                .expect("the helper thread owns the default context");
            Self {
                release: Some(release),
                thread: Some(thread),
            }
        }
    }

    impl Drop for DefaultContextOwner {
        fn drop(&mut self) {
            drop(self.release.take());
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    #[test]
    fn quitting_while_another_thread_owns_the_default_context_stays_within_the_limit() {
        let expected = LastViewState {
            note: Some(welcome()),
            folders: vec![path(&["Journal"])],
        };
        let _owner = DefaultContextOwner::take();
        let shutdown = across_a_shutdown(
            async |session| {
                welcome_under_the_blue_filter(session).await;
                session
                    .model
                    .record_expanded_folders(expected.folders.clone());
                assert!(session.model.state().last_view.pending.is_some());
            },
            async |session| reopened(session, &expected).await,
        );
        assert!(
            shutdown < EXIT_FLUSH_LIMIT,
            "the shutdown took {shutdown:?}"
        );
    }

    fn folder_node(own: Vec<String>, children: Vec<TreeNode>) -> TreeNode {
        TreeNode::Folder {
            name: own.last().cloned().unwrap_or_default(),
            path: own,
            note_count: 1,
            children,
        }
    }

    fn note_node(own: Vec<String>) -> TreeNode {
        TreeNode::Note {
            name: own.last().cloned().unwrap_or_default(),
            path: own,
            color_tag: Some(ColorTag::Blue),
            shared: false,
        }
    }

    /// A filtered tree that shows "A" and "A/B" but hides "C", "D" and the note "Hidden".
    fn read_back(note: Option<&[&str]>, folders: &[&[&str]]) -> ReadBack {
        let tree = [folder_node(
            path(&["A"]),
            vec![folder_node(
                path(&["A", "B"]),
                vec![note_node(path(&["A", "B", "N"]))],
            )],
        )];
        ReadBack::new(view(note, folders), &tree)
    }

    fn view(note: Option<&[&str]>, folders: &[&[&str]]) -> LastViewState {
        LastViewState {
            note: note.map(path),
            folders: folders.iter().map(|folder| path(folder)).collect(),
        }
    }

    #[test]
    fn the_read_back_needs_the_open_note_even_when_the_filter_hides_it() {
        let expected = read_back(Some(&["Hidden"]), &[&["A"]]);

        assert!(expected.matches(&view(Some(&["Hidden"]), &[&["A"]])));
        assert!(!expected.matches(&view(None, &[&["A"]])));
        assert!(!expected.matches(&view(Some(&["A", "B", "N"]), &[&["A"]])));
        assert!(!expected.matches(&view(None, &[])));
    }

    #[test]
    fn the_read_back_needs_every_shown_folder_and_may_drop_hidden_ones() {
        let expected = read_back(None, &[&["C"], &["A"], &["D"], &["A", "B"]]);

        assert!(expected.matches(&view(None, &[&["C"], &["A"], &["D"], &["A", "B"]])));
        assert!(expected.matches(&view(None, &[&["A"], &["A", "B"]])));
        assert!(expected.matches(&view(None, &[&["A"], &["D"], &["A", "B"]])));
        assert!(!expected.matches(&view(None, &[&["C"], &["D"], &["A", "B"]])));
        assert!(!expected.matches(&view(None, &[&["A", "B"], &["A"]])));
        assert!(!expected.matches(&view(None, &[&["A"], &["A", "B"], &["E"]])));
    }

    #[test]
    fn the_read_back_takes_the_interim_empty_view_only_for_an_empty_view() {
        assert!(!read_back(None, &[&["C"], &["D"]]).matches(&view(None, &[])));
        assert!(read_back(None, &[&["C"], &["D"]]).matches(&view(None, &[&["D"]])));
        assert!(read_back(None, &[]).matches(&view(None, &[])));
        assert!(!read_back(None, &[]).matches(&view(None, &[&["A"]])));
    }

    #[test]
    fn turning_reopening_off_survives_a_pending_save_at_shutdown() {
        across_a_shutdown(
            async |session| {
                remember_ideas(session).await;
                session
                    .model
                    .set_reopen_last_view(false)
                    .await
                    .expect("the setting changes");
                session
                    .model
                    .record_expanded_folders(vec![path(&["Journal"])]);
                assert!(session.model.state().last_view.pending.is_some());
            },
            async |session| {
                session.log_in_remembered().await;
                checked(session).await;

                assert_eq!(stored_view(session).await, None);
                assert_eq!(session.model.editor_target(), EditorTarget::None);
            },
        );
    }

    #[test]
    fn the_pending_save_is_written_when_the_model_shuts_down() {
        across_a_shutdown(
            async |session| {
                remember_ideas(session).await;
                session
                    .model
                    .record_expanded_folders(vec![path(&["Journal"])]);
                assert!(session.model.state().last_view.pending.is_some());
            },
            async |session| {
                session.log_in_remembered().await;
                checked(session).await;

                assert_eq!(
                    stored_view(session).await,
                    Some(LastViewState {
                        note: Some(ideas()),
                        folders: vec![path(&["Journal"])],
                    })
                );
            },
        );
    }

    #[test]
    fn an_early_draft_hand_off_takes_the_place_of_the_last_view() {
        run(|| async {
            let mut session = Session::start(fake_bundle());
            remember_ideas(&session).await;

            session.restart();
            let restores = count_restores(&session.model);
            session
                .model
                .set_early_draft_body("Quick thought".to_owned());
            session.log_in_remembered().await;
            checked(&session).await;

            assert!(matches!(
                session.model.editor_target(),
                EditorTarget::Note(created) if created != ideas()
            ));
            assert_eq!(restores.get(), 0);
            assert!(session.model.take_restored_folders().is_empty());
        });
    }

    #[test]
    fn a_missing_last_note_stays_closed_but_its_folders_open() {
        run(|| async {
            let mut session = Session::start(fake_bundle());
            remember_ideas(&session).await;
            session
                .model
                .testing_send(
                    "lastView.save",
                    serde_json::json!({ "note": ["Missing"], "folders": expanded() }),
                )
                .await
                .expect("the core takes the view");
            wait_until_stored(
                &session,
                &LastViewState {
                    note: None,
                    folders: expanded(),
                },
            )
            .await;

            session.restart();
            let restores = count_restores(&session.model);
            session.log_in_remembered().await;
            checked(&session).await;

            assert_eq!(restores.get(), 1);
            assert_eq!(session.model.editor_target(), EditorTarget::None);
            assert_eq!(session.model.take_restored_folders(), expanded());
        });
    }

    #[test]
    fn nothing_is_saved_before_the_check_and_log_out_sends_the_pending_save() {
        run(|| async {
            let session = Session::start(fake_bundle());
            let model = &session.model;
            model.record_expanded_folders(expanded());
            {
                let state = model.state();
                assert!(state.last_view.pending.is_none());
                assert!(state.last_view.sent.is_empty());
            }

            session.log_in_remembered().await;
            checked(&session).await;
            assert_sent_only_after_the_check(model);

            let expected = LastViewState {
                note: None,
                folders: vec![path(&["Journal"])],
            };
            model.record_expanded_folders(expected.folders.clone());
            assert_eq!(model.state().last_view.pending.as_ref(), Some(&expected));
            model.log_out().await.expect("logging out succeeds");
            session
                .wait_until("the token page", |model| model.route() == Route::Token)
                .await;
            let state = model.state();
            assert!(state.last_view.pending.is_none());
            assert_eq!(
                state.last_view.sent.last(),
                Some(&(true, expected)),
                "the pending save went out before the session ended"
            );
        });
    }

    #[test]
    fn details_count_words_and_tell_the_dates() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            open_and_read(&session, &path(&["Welcome"])).await;

            let details = session
                .model
                .note_details(path(&["Welcome"]))
                .await
                .expect("the details load");

            assert!(!details.words.label.is_empty());
            assert!(!details.words.value.is_empty());
            assert!(details.not_saved || (details.created.is_some() && details.updated.is_some()));
            assert!(!details.shared);
        });
    }

    #[test]
    fn details_tell_a_shared_note_a_tag_filter_hides() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let roadmap = path(&["Projects", "commitnote", "Roadmap"]);
            let created = session
                .model
                .testing_send(
                    "share.create",
                    serde_json::json!({ "path": roadmap, "password": "", "label": "" }),
                )
                .await
                .expect("the share is created");
            assert_eq!(
                created
                    .pointer("/outcome/kind")
                    .and_then(|kind| kind.as_str()),
                Some("created")
            );
            open_and_read(&session, &roadmap).await;
            session
                .model
                .set_color_tag(welcome(), Some(ColorTag::Green))
                .await
                .expect("Welcome is tagged");
            session
                .model
                .set_tag_filter(Some(ColorTag::Green))
                .await
                .expect("the filter is set");
            session
                .wait_until("Roadmap to leave the filtered tree", |model| {
                    model.tag_filter() == Some(ColorTag::Green) && !shown(model, &roadmap)
                })
                .await;

            let details = session
                .model
                .note_details(roadmap)
                .await
                .expect("the details load");

            assert!(details.shared);
        });
    }
}
