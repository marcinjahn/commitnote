use serde::Serialize;
use serde::de::DeserializeOwned;

mod app;
mod details;
mod editing;
mod images;
mod login;
mod notes;
mod search;
mod session;
mod settings;
mod structure;

pub use app::*;
pub use details::*;
pub use editing::*;
pub use images::*;
pub use login::*;
pub use notes::*;
pub use search::*;
pub use session::*;
pub use settings::*;
pub use structure::*;

#[cfg(test)]
mod tests;

pub trait Command {
    const NAME: &'static str;
    type Params: Serialize;
    type Result: DeserializeOwned;
}
