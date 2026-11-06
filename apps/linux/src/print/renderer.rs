use std::cell::RefCell;
use std::rc::Rc;

use gtk4::{self as gtk, gio, glib};
use webkit6::prelude::*;

const DOCUMENT_URI: &str = "about:blank";

/// Initializes WebKit on the calling thread, which must be the main thread and must run this
/// before the core runtime starts. WebKit aborts unless the main thread is the first thread its
/// runtime has seen, and the core's JavaScriptCore thread would otherwise come first.
pub fn initialize_web_engine() {
    drop(glib::Class::<glib::Object>::from_type(
        webkit6::NetworkSession::static_type(),
    ));
}

/// A document laid out in an offscreen web view that loads nothing but the document itself: no
/// scripts, no network, no navigation and no stored data.
pub struct PrintPage {
    view: webkit6::WebView,
}

impl PrintPage {
    /// Loads `document` and waits until it is laid out, its inline images and fonts included.
    pub async fn load(document: &str) -> Result<Self, glib::Error> {
        let view = webkit6::WebView::builder()
            .network_session(&webkit6::NetworkSession::new_ephemeral())
            .settings(&locked_down_settings())
            .build();
        let gate = Rc::new(RefCell::new(PolicyGate::default()));
        view.connect_decide_policy({
            let gate = gate.clone();
            move |_, decision, kind| {
                if gate.borrow_mut().allows(&policy_request(decision, kind)) {
                    decision.use_();
                } else {
                    decision.ignore();
                }
                true
            }
        });
        let (sender, receiver) = async_channel::bounded(1);
        let finished = view.connect_load_changed({
            let sender = sender.clone();
            move |_, event| {
                if event == webkit6::LoadEvent::Finished {
                    let _ = sender.try_send(Ok(()));
                }
            }
        });
        let failed = view.connect_load_failed(move |_, _, _, error| {
            let _ = sender.try_send(Err(error.clone()));
            true
        });
        #[cfg(feature = "testing")]
        testing::record_document(document);
        view.load_html(document, None);
        let outcome = receiver.recv().await.unwrap_or_else(|_| {
            Err(glib::Error::new(
                gio::IOErrorEnum::Cancelled,
                "the load ended without an outcome",
            ))
        });
        gate.borrow_mut().finish_load();
        view.disconnect(finished);
        view.disconnect(failed);
        outcome?;
        #[cfg(feature = "testing")]
        testing::record_load_finished();
        Ok(Self { view })
    }

    /// Prints the page with the settings and page setup chosen in the print dialog, without
    /// showing another dialog.
    pub async fn print(&self, setup: &gtk::PrintSetup) -> Result<(), glib::Error> {
        let operation = webkit6::PrintOperation::new(&self.view);
        operation.set_print_settings(&setup.print_settings());
        operation.set_page_setup(&setup.page_setup());
        let (sender, receiver) = async_channel::bounded(1);
        operation.connect_failed({
            let sender = sender.clone();
            move |_, error| {
                let _ = sender.try_send(Err(error.clone()));
            }
        });
        operation.connect_finished(move |_| {
            let _ = sender.try_send(Ok(()));
        });
        operation.print();
        receiver.recv().await.unwrap_or(Ok(()))
    }
}

fn locked_down_settings() -> webkit6::Settings {
    webkit6::Settings::builder()
        .enable_javascript(false)
        .enable_javascript_markup(false)
        .enable_developer_extras(false)
        .enable_html5_database(false)
        .enable_html5_local_storage(false)
        .enable_page_cache(false)
        .enable_media(false)
        .enable_webaudio(false)
        .enable_webgl(false)
        .enable_dns_prefetching(false)
        .build()
}

fn policy_request(
    decision: &webkit6::PolicyDecision,
    kind: webkit6::PolicyDecisionType,
) -> PolicyRequest {
    match kind {
        webkit6::PolicyDecisionType::NavigationAction => PolicyRequest::Navigation {
            uri: decision
                .downcast_ref::<webkit6::NavigationPolicyDecision>()
                .and_then(webkit6::NavigationPolicyDecision::navigation_action)
                .and_then(|action| action.request())
                .and_then(|request| request.uri())
                .map(String::from),
        },
        webkit6::PolicyDecisionType::Response => PolicyRequest::Response {
            main_resource: decision
                .downcast_ref::<webkit6::ResponsePolicyDecision>()
                .is_some_and(webkit6::ResponsePolicyDecision::is_main_frame_main_resource),
        },
        _ => PolicyRequest::Other,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PolicyRequest {
    Navigation { uri: Option<String> },
    Response { main_resource: bool },
    Other,
}

/// Lets through the one navigation that loads the document and its own response while it
/// loads; everything else, new windows included, is refused.
#[derive(Debug, Default)]
struct PolicyGate {
    navigated: bool,
    loaded: bool,
}

impl PolicyGate {
    fn allows(&mut self, request: &PolicyRequest) -> bool {
        match request {
            PolicyRequest::Navigation { uri } => {
                let initial = !self.navigated && uri.as_deref() == Some(DOCUMENT_URI);
                self.navigated = true;
                initial
            }
            PolicyRequest::Response { main_resource } => {
                self.navigated && !self.loaded && *main_resource
            }
            PolicyRequest::Other => false,
        }
    }

    fn finish_load(&mut self) {
        self.loaded = true;
    }
}

#[cfg(feature = "testing")]
pub use testing::{testing_last_document, testing_load_finished};

#[cfg(feature = "testing")]
mod testing {
    use std::cell::{Cell, RefCell};

    thread_local! {
        static LAST_DOCUMENT: RefCell<Option<String>> = const { RefCell::new(None) };
        static LOAD_FINISHED: Cell<bool> = const { Cell::new(false) };
    }

    pub(super) fn record_document(document: &str) {
        LAST_DOCUMENT.set(Some(document.to_owned()));
        LOAD_FINISHED.set(false);
    }

    pub(super) fn record_load_finished() {
        LOAD_FINISHED.set(true);
    }

    /// The last document handed to the web view.
    pub fn testing_last_document() -> Option<String> {
        LAST_DOCUMENT.with_borrow(Clone::clone)
    }

    /// Whether the last document finished loading.
    pub fn testing_load_finished() -> bool {
        LOAD_FINISHED.get()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn navigation(uri: &str) -> PolicyRequest {
        PolicyRequest::Navigation {
            uri: Some(uri.to_owned()),
        }
    }

    const MAIN_RESPONSE: PolicyRequest = PolicyRequest::Response {
        main_resource: true,
    };

    #[test]
    fn only_the_initial_document_load_is_allowed() {
        let mut gate = PolicyGate::default();

        assert!(gate.allows(&navigation(DOCUMENT_URI)));
        assert!(gate.allows(&MAIN_RESPONSE));
        assert!(!gate.allows(&PolicyRequest::Response {
            main_resource: false
        }));
        assert!(!gate.allows(&navigation(DOCUMENT_URI)));
        assert!(!gate.allows(&navigation("https://example.com/")));
    }

    #[test]
    fn a_first_navigation_elsewhere_is_refused_and_ends_the_chance() {
        let mut gate = PolicyGate::default();

        assert!(!gate.allows(&navigation("https://example.com/")));
        assert!(!gate.allows(&PolicyRequest::Navigation { uri: None }));
        assert!(!gate.allows(&navigation(DOCUMENT_URI)));
    }

    #[test]
    fn no_response_is_allowed_before_the_navigation_or_after_the_load() {
        let mut gate = PolicyGate::default();
        assert!(!gate.allows(&MAIN_RESPONSE));

        assert!(gate.allows(&navigation(DOCUMENT_URI)));
        gate.finish_load();

        assert!(!gate.allows(&MAIN_RESPONSE));
    }

    #[test]
    fn new_windows_are_never_allowed() {
        let mut gate = PolicyGate::default();

        assert!(!gate.allows(&PolicyRequest::Other));
        assert!(gate.allows(&navigation(DOCUMENT_URI)));
        assert!(!gate.allows(&PolicyRequest::Other));
    }
}
