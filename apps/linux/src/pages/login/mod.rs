mod repository_list_page;
mod text;
mod token_page;
mod unusable_repository_page;

pub use repository_list_page::RepositoryListPage;
pub use token_page::TokenPage;
pub use unusable_repository_page::UnusableRepositoryPage;

use gtk4::{self as gtk, gio, glib, prelude::*};

fn open_uri(widget: &impl IsA<gtk::Widget>, uri: &str) {
    let window = widget.root().and_downcast::<gtk::Window>();
    gtk::UriLauncher::new(uri).launch(window.as_ref(), gio::Cancellable::NONE, |result| {
        if result.is_err() {
            glib::g_warning!("commitnote", "could not open a link");
        }
    });
}
