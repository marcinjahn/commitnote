use serde::Serialize;
use serde::de::DeserializeOwned;

mod app;
mod login;
mod notes;
mod session;
mod settings;

pub use app::*;
pub use login::*;
pub use notes::*;
pub use session::*;
pub use settings::*;

#[cfg(test)]
mod tests;

pub trait Command {
    const NAME: &'static str;
    type Params: Serialize;
    type Result: DeserializeOwned;
}
