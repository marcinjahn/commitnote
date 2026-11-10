use serde::Serialize;
use serde::de::DeserializeOwned;

mod app;
mod data;
mod details;
mod editing;
mod history;
mod images;
mod launch;
mod login;
mod notes;
mod passphrase;
mod print;
mod search;
mod session;
mod settings;
mod shares;
mod structure;

pub use app::*;
pub use data::*;
pub use details::*;
pub use editing::*;
pub use history::*;
pub use images::*;
pub use launch::*;
pub use login::*;
pub use notes::*;
pub use passphrase::*;
pub use print::*;
pub use search::*;
pub use session::*;
pub use settings::*;
pub use shares::*;
pub use structure::*;

#[cfg(test)]
mod tests;

pub trait Command {
    const NAME: &'static str;
    type Params: Serialize;
    type Result: DeserializeOwned;
}
