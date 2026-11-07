#![forbid(unsafe_code)]

mod history;
mod sync;
mod text_edits;
mod utf16_index;

pub use history::{EditorHistory, HistoryStep};
pub use sync::EditorTextSync;
pub use text_edits::{Assoc, TextEdit, TextSelection, apply, diff, map_position, map_selection};
pub use utf16_index::Utf16Index;
