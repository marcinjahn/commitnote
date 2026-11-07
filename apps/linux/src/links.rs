use commitnote_markdown::openable_url;
use gtk4::prelude::*;
use gtk4::{self as gtk};

#[cfg(feature = "testing")]
thread_local! {
    static OPENED: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Hands an http, https or mailto link to the system. Anything else is ignored.
pub fn open_uri(widget: &impl IsA<gtk::Widget>, uri: &str) {
    let Some(uri) = openable_url(uri) else {
        return;
    };
    launch(widget.upcast_ref(), &uri);
}

#[cfg(not(feature = "testing"))]
fn launch(widget: &gtk::Widget, uri: &str) {
    let window = widget.root().and_downcast::<gtk::Window>();
    gtk::UriLauncher::new(uri).launch(window.as_ref(), gtk4::gio::Cancellable::NONE, |_| {});
}

#[cfg(feature = "testing")]
fn launch(_widget: &gtk::Widget, uri: &str) {
    OPENED.with(|opened| opened.borrow_mut().push(uri.to_owned()));
}

#[cfg(feature = "testing")]
pub fn testing_opened_uris() -> Vec<String> {
    OPENED.with(|opened| opened.borrow().clone())
}

#[cfg(feature = "testing")]
pub fn testing_clear_opened_uris() {
    OPENED.with(|opened| opened.borrow_mut().clear());
}
