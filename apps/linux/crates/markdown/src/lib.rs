#![forbid(unsafe_code)]

mod block_structure;
mod commands;
mod image_reference;
mod insertion_rule;
mod live_preview;
mod parser;
mod rendered_table;
mod scanners;
mod syntax;
mod table;
mod table_entry;
mod table_layout;

pub use commands::{
    CommandResult, insert_link, link_url, openable_url, paste_link, toggle_bold, toggle_checkbox,
    toggle_italic, toggle_strikethrough, toggle_task,
};
pub use image_reference::{ImageReference, ImageTarget};
pub use insertion_rule::insert_image_references;
pub use live_preview::{Placement, PreviewStyle, RenderMode, RenderOutput, StyleRun, render};
pub use parser::parse;
pub use rendered_table::{
    RenderedTable, TableCellContent, TableCellPiece, TableTextStyle, rendered_table,
};
pub use syntax::{MarkdownDocument, SyntaxKind, SyntaxNode};
pub use table::{MarkdownTable, MarkdownTableCell, MarkdownTableLine, TableAlignment};
pub use table_entry::{LinePosition, VerticalDirection, table_entry_target, table_page_target};
pub use table_layout::{
    LayoutRect, TableGeometry, TableLayout, TableLayoutColumns, TableLayoutItem, TableLayoutMetrics,
};
