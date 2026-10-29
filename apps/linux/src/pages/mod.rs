pub mod login;
pub mod notes;
mod secret_text;
mod startup_error_page;
pub mod unlock;

pub(crate) use secret_text::{secret_text, set_secret_text};
pub use startup_error_page::StartupErrorPage;
