use std::time::Duration;

use commitnote_core_api::commands::{
    SearchClose, SearchCloseParams, SearchOpen, SearchOpenParams, SearchQuery, SearchQueryParams,
    SearchQueryResult, SearchResults,
};
use commitnote_core_api::events::SearchStatusChanged;
use commitnote_core_runtime::RequestError;
use glib::prelude::*;
use glib::subclass::types::ObjectSubclassIsExt;

use super::{AppModel, warn};

const SEARCH_DEBOUNCE: Duration = Duration::from_millis(150);

#[derive(Debug, Clone, PartialEq)]
pub struct SearchStatus {
    pub status: Option<String>,
    pub progress: Option<f64>,
    pub partial: bool,
}

#[derive(Default)]
pub(super) struct SearchState {
    open: bool,
    query: String,
    results: Option<SearchResults>,
    status: Option<SearchStatus>,
    ticket: u64,
    pending: bool,
    in_flight: bool,
    dirty: bool,
    #[cfg(all(test, feature = "testing"))]
    sent: Vec<String>,
}

impl AppModel {
    pub fn search_open(&self) -> bool {
        self.state().search.open
    }

    pub fn search_query(&self) -> String {
        self.state().search.query.clone()
    }

    pub fn search_results(&self) -> Option<SearchResults> {
        self.state().search.results.clone()
    }

    pub fn search_status(&self) -> Option<SearchStatus> {
        self.state().search.status.clone()
    }

    pub fn connect_search_changed<F: Fn(&Self) + 'static>(&self, f: F) -> glib::SignalHandlerId {
        self.connect_unit_signal("search-changed", f)
    }

    pub fn open_search(&self) {
        {
            let mut state = self.state_mut();
            if state.search.open {
                return;
            }
            state.search.open = true;
        }
        let request = self.request::<SearchOpen>(SearchOpenParams {});
        let model = self.downgrade();
        self.spawn(async move {
            if let Err(error) = request.await {
                warn("could not open search", &error);
            }
            if let Some(model) = model.upgrade() {
                model.run_search();
            }
        });
    }

    pub fn close_search(&self) {
        {
            let mut state = self.state_mut();
            let search = &mut state.search;
            if !search.open {
                return;
            }
            search.open = false;
            search.dirty = false;
            search.query.clear();
            search.results = None;
            search.status = None;
            search.pending = false;
            search.ticket += 1;
        }
        let request = self.request::<SearchClose>(SearchCloseParams {});
        self.spawn(async move {
            if let Err(error) = request.await {
                warn("could not close search", &error);
            }
        });
        self.emit_by_name::<()>("search-changed", &[]);
    }

    pub fn set_search_query(&self, text: String) {
        let ticket = {
            let mut state = self.state_mut();
            let search = &mut state.search;
            if search.query == text && !search.pending {
                return;
            }
            search.query = text;
            search.pending = true;
            search.ticket += 1;
            search.ticket
        };
        let generation = self.imp().generation.get();
        let model = self.downgrade();
        self.spawn(async move {
            glib::timeout_future(SEARCH_DEBOUNCE).await;
            if let Some(model) = model.upgrade()
                && model.imp().generation.get() == generation
            {
                model.search_debounced(ticket);
            }
        });
    }

    /// A timer whose ticket is no longer the newest, or whose search was closed, does nothing.
    fn search_debounced(&self, ticket: u64) {
        {
            let mut state = self.state_mut();
            let search = &mut state.search;
            if search.ticket != ticket || !search.pending {
                return;
            }
            search.pending = false;
        }
        self.run_search();
    }

    pub(super) fn attach_search_triggers(&self) {
        self.connect_tree_changed(Self::run_search);
        self.connect_open_note_changed(Self::run_search);
    }

    pub(super) fn search_status_changed(&self, changed: SearchStatusChanged) {
        let status = SearchStatus {
            status: changed.status,
            progress: changed.progress,
            partial: changed.partial,
        };
        let changed = {
            let mut state = self.state_mut();
            let search = &mut state.search;
            if !search.open {
                return;
            }
            let changed = search.status.as_ref() != Some(&status);
            search.status = Some(status);
            changed
        };
        if changed {
            self.emit_by_name::<()>("search-changed", &[]);
        }
        self.run_search();
    }

    /// Clears search at session end, when the core no longer holds a search to close.
    pub(super) fn end_search(&self) -> bool {
        let mut state = self.state_mut();
        let ticket = state.search.ticket + 1;
        let previous = std::mem::take(&mut state.search);
        state.search.ticket = ticket;
        previous.open
    }

    /// Keeps at most one query in flight; a run asked for meanwhile follows it with the
    /// newest text.
    fn run_search(&self) {
        let query = {
            let mut state = self.state_mut();
            if state.shut_down || !state.search.open {
                return;
            }
            let search = &mut state.search;
            if search.in_flight {
                search.dirty = true;
                return;
            }
            search.in_flight = true;
            #[cfg(all(test, feature = "testing"))]
            search.sent.push(search.query.clone());
            search.query.clone()
        };
        let generation = self.imp().generation.get();
        let request = self.request::<SearchQuery>(SearchQueryParams {
            query: query.clone(),
        });
        let model = self.downgrade();
        self.spawn(async move {
            let result = request.await;
            if let Some(model) = model.upgrade() {
                model.search_answered(generation, &query, result);
            }
        });
    }

    fn search_answered(
        &self,
        generation: u64,
        query: &str,
        result: Result<SearchQueryResult, RequestError>,
    ) {
        if self.imp().generation.get() != generation {
            return;
        }
        let (changed, rerun) = {
            let mut state = self.state_mut();
            let search = &mut state.search;
            search.in_flight = false;
            let rerun = std::mem::take(&mut search.dirty) && search.open;
            let changed = match &result {
                Ok(reply)
                    if search.open
                        && search.query == query
                        && search.results.as_ref() != Some(&reply.results) =>
                {
                    search.results = Some(reply.results.clone());
                    true
                }
                Ok(_) | Err(_) => false,
            };
            (changed, rerun)
        };
        if let Err(error) = &result {
            warn("could not search notes", error);
        }
        if changed {
            self.emit_by_name::<()>("search-changed", &[]);
        }
        if rerun {
            self.run_search();
        }
    }
}

#[cfg(all(test, feature = "testing"))]
mod tests {
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

    use super::super::tests::{Session, fake_bundle, open_and_read, run};
    use super::*;

    const SEARCH_URL: &str = "https://github.com/sample/search";

    fn path(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    fn names(rows: &[commitnote_core_api::commands::SearchRow]) -> Vec<&str> {
        rows.iter().map(|row| row.name.as_str()).collect()
    }

    fn count_changes(model: &AppModel) -> Rc<Cell<u32>> {
        let count = Rc::new(Cell::new(0_u32));
        model.connect_search_changed({
            let count = count.clone();
            move |_| count.set(count.get() + 1)
        });
        count
    }

    async fn opened() -> Session {
        let session = Session::start(fake_bundle());
        session.log_in_to(SEARCH_URL).await;
        session
    }

    #[test]
    fn an_empty_query_lists_recent_notes_with_the_copy() {
        run(|| async {
            let session = opened().await;
            let model = &session.model;
            let welcome = path(&["Welcome"]);
            open_and_read(&session, &welcome).await;
            open_and_read(&session, &path(&["Recipes", "Pierogi"])).await;
            let changes = count_changes(model);

            model.open_search();
            assert!(model.search_open());
            assert_eq!(model.search_query(), "");
            session
                .wait_until("recent notes", |model| {
                    model
                        .search_results()
                        .is_some_and(|results| !results.recent.is_empty())
                })
                .await;

            let results = model.search_results().expect("the results arrived");
            assert_eq!(
                results
                    .recent
                    .iter()
                    .map(|row| &row.path)
                    .collect::<Vec<_>>(),
                [&welcome]
            );
            assert!(results.names.is_empty() && results.contents.is_empty());
            assert_eq!(results.copy.recent_heading, "Recent");
            assert_eq!(results.copy.names_heading, "Titles");
            assert!(!results.copy.contents_heading.is_empty());
            assert!(changes.get() > 0);
        });
    }

    #[test]
    fn quick_typing_queries_only_the_last_text_and_matches_names_and_contents() {
        run(|| async {
            let session = opened().await;
            let model = &session.model;
            model.open_search();
            session
                .wait_until("the first results", |model| {
                    model.search_results().is_some()
                })
                .await;

            for text in ["l", "li", "lisb"] {
                model.set_search_query(text.to_owned());
            }
            assert_eq!(model.search_query(), "lisb");
            session
                .wait_until("the name match", |model| {
                    model
                        .search_results()
                        .is_some_and(|results| names(&results.names).contains(&"Lisbon"))
                })
                .await;
            let results = model.search_results().expect("the results arrived");
            let lisbon = results
                .names
                .iter()
                .find(|row| row.name == "Lisbon")
                .expect("the note matches");
            assert!(!lisbon.name_ranges.is_empty());
            assert!(results.recent.is_empty());
            let sent = model.state().search.sent.clone();
            assert!(sent.contains(&"lisb".to_owned()));
            assert!(sent.iter().all(|query| query.is_empty() || query == "lisb"));

            model.set_search_query("lighthouse".to_owned());
            session
                .wait_until("the content match", |model| {
                    model
                        .search_results()
                        .is_some_and(|results| names(&results.contents).contains(&"Lisbon"))
                })
                .await;
            let results = model.search_results().expect("the results arrived");
            let lisbon = results
                .contents
                .iter()
                .find(|row| row.name == "Lisbon")
                .expect("the note matches");
            assert!(
                lisbon
                    .snippet
                    .as_ref()
                    .is_some_and(|parts| parts.iter().any(|part| part.is_match))
            );
        });
    }

    async fn opened_search() -> (Session, usize) {
        let session = opened().await;
        session.model.open_search();
        session
            .wait_until("the finished index", |model| {
                model.search_status().is_some_and(|status| !status.partial)
                    && model.search_results().is_some()
                    && !model.state().search.in_flight
            })
            .await;
        let before = sent(&session.model).len();
        (session, before)
    }

    fn sent(model: &AppModel) -> Vec<String> {
        model.state().search.sent.clone()
    }

    fn sent_since(model: &AppModel, before: usize) -> Vec<String> {
        sent(model).split_off(before)
    }

    async fn past_the_debounce() {
        glib::timeout_future(SEARCH_DEBOUNCE * 3).await;
    }

    #[test]
    fn a_burst_of_queries_sends_one_search_with_the_last_text() {
        run(|| async {
            let (session, before) = opened_search().await;
            let model = &session.model;
            for text in ["l", "li", "lis", "lisb"] {
                model.set_search_query(text.to_owned());
            }
            assert!(sent_since(model, before).is_empty());

            session
                .wait_until("the debounced search", |model| sent(model).len() > before)
                .await;
            session
                .wait_until("the name match", |model| {
                    model
                        .search_results()
                        .is_some_and(|results| names(&results.names).contains(&"Lisbon"))
                })
                .await;
            past_the_debounce().await;
            assert_eq!(sent_since(model, before), ["lisb"]);
        });
    }

    #[test]
    fn a_query_set_again_restarts_the_wait() {
        run(|| async {
            let (session, before) = opened_search().await;
            let model = &session.model;

            model.set_search_query("road".to_owned());
            glib::timeout_future(SEARCH_DEBOUNCE / 2).await;
            model.set_search_query("lisb".to_owned());
            glib::timeout_future(SEARCH_DEBOUNCE * 3 / 4).await;
            assert!(sent_since(model, before).is_empty());

            session
                .wait_until("the debounced search", |model| sent(model).len() > before)
                .await;
            past_the_debounce().await;
            assert_eq!(sent_since(model, before), ["lisb"]);
        });
    }

    #[test]
    fn clearing_the_query_cancels_the_pending_text() {
        run(|| async {
            let (session, before) = opened_search().await;
            let model = &session.model;

            model.set_search_query("lisb".to_owned());
            model.set_search_query(String::new());
            session
                .wait_until("the debounced search", |model| sent(model).len() > before)
                .await;
            past_the_debounce().await;
            assert_eq!(sent_since(model, before), [""]);
            assert_eq!(model.search_query(), "");
        });
    }

    #[test]
    fn closing_search_cancels_the_pending_search() {
        run(|| async {
            let (session, before) = opened_search().await;
            let model = &session.model;

            model.set_search_query("lisb".to_owned());
            model.close_search();
            past_the_debounce().await;
            assert!(sent_since(model, before).is_empty());
            assert_eq!(model.search_results(), None);
            assert_eq!(model.search_query(), "");
        });
    }

    #[test]
    fn a_pending_search_does_not_outlive_a_reopened_search() {
        run(|| async {
            let (session, before) = opened_search().await;
            let model = &session.model;

            model.set_search_query("lisb".to_owned());
            model.close_search();
            model.open_search();
            session
                .wait_until("the reopened results", |model| {
                    model.search_results().is_some() && !model.state().search.in_flight
                })
                .await;
            past_the_debounce().await;
            let sent = sent_since(model, before);
            assert!(!sent.is_empty() && sent.iter().all(String::is_empty));
        });
    }

    #[test]
    fn a_reply_to_an_older_query_never_replaces_newer_results() {
        run(|| async {
            let (session, _) = opened_search().await;
            let model = &session.model;
            let seen = Rc::new(RefCell::new(Vec::<Vec<String>>::new()));
            model.connect_search_changed({
                let seen = seen.clone();
                move |model| {
                    if let Some(results) = model.search_results() {
                        seen.borrow_mut()
                            .push(results.names.iter().map(|row| row.name.clone()).collect());
                    }
                }
            });

            model.state_mut().search.query = "road".to_owned();
            model.run_search();
            assert!(model.state().search.in_flight);
            model.set_search_query("lisb".to_owned());
            session
                .wait_until("the newer results", |model| {
                    model
                        .search_results()
                        .is_some_and(|results| names(&results.names).contains(&"Lisbon"))
                        && !model.state().search.in_flight
                })
                .await;
            past_the_debounce().await;

            assert_eq!(sent(model).last().map(String::as_str), Some("lisb"));
            assert!(
                seen.borrow()
                    .iter()
                    .all(|names| !names.contains(&"Roadmap".to_owned()))
            );
            let results = model.search_results().expect("the results arrived");
            assert!(!names(&results.names).contains(&"Roadmap"));
        });
    }

    #[test]
    fn status_arrives_while_open_and_close_discards_a_late_reply() {
        run(|| async {
            let session = opened().await;
            let model = &session.model;
            let changes = count_changes(model);

            model.open_search();
            session
                .wait_until("the finished index", |model| {
                    model.search_status().is_some_and(|status| !status.partial)
                        && model.search_results().is_some()
                })
                .await;
            assert!(changes.get() > 0);

            model.state_mut().search.query = "lisb".to_owned();
            model.run_search();
            assert!(model.state().search.in_flight);
            model.close_search();
            assert!(!model.search_open());
            assert_eq!(model.search_results(), None);
            assert_eq!(model.search_status(), None);
            assert_eq!(model.search_query(), "");
            session
                .wait_until("the late reply", |model| !model.state().search.in_flight)
                .await;
            assert_eq!(model.search_results(), None);

            let before = changes.get();
            model.search_status_changed(SearchStatusChanged {
                status: Some("Reading notes".to_owned()),
                progress: Some(0.5),
                partial: true,
            });
            assert_eq!(model.search_status(), None);
            assert_eq!(changes.get(), before);
        });
    }
}
