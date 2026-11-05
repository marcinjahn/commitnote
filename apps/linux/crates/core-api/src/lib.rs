#[macro_use]
mod macros;

pub mod commands;
pub mod envelope;
pub mod error;
pub mod events;
#[cfg(any(test, feature = "testing"))]
pub mod fake;
pub mod names;
pub mod secret;
pub mod settings;
pub mod shapes;

pub use commands::Command;
pub use envelope::{Incoming, ParseError, Request, decode_result, parse_incoming};
pub use error::{CoreError, CoreErrorKind};
pub use events::CoreEvent;
#[cfg(any(test, feature = "testing"))]
pub use names::FAKE_CORE_COMMAND_NAMES;
pub use names::{
    CORE_COMMAND_NAMES, CORE_EVENT_NAMES, NATIVE_CORE_API_VERSION, NATIVE_CORE_MARKER,
};
pub use secret::Secret;
