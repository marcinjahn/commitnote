#![forbid(unsafe_code)]

mod commands;
mod image_reference;
mod live_preview;
mod parser;
mod scanners;
mod syntax;

pub use commands::{
    CommandResult, insert_link, link_url, openable_url, paste_link, toggle_bold, toggle_checkbox,
    toggle_italic, toggle_strikethrough, toggle_task,
};
pub use image_reference::{ImageReference, ImageTarget};
pub use live_preview::{Placement, PreviewStyle, RenderOutput, StyleRun, render};
pub use parser::parse;
pub use syntax::{MarkdownDocument, SyntaxKind, SyntaxNode};
