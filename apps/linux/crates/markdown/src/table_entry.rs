use std::ops::Range;

use crate::{MarkdownDocument, MarkdownTable, TableGeometry};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerticalDirection {
    Up,
    Down,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LinePosition {
    /// 0-based document line.
    pub line: usize,
    /// UTF-16 code units from the line start, the container prefix included.
    pub column: usize,
}

/// Where a vertical motion of `count` lines from `line` lands when a rendered table lies in the
/// lines it passes; `None` leaves the default motion. `rendered_tables` holds half-open ranges of
/// document lines. The caller owns the wrapped-line, selection and reveal checks.
pub fn table_entry_target(
    document: &MarkdownDocument,
    line: usize,
    goal_column: usize,
    direction: VerticalDirection,
    count: usize,
    rendered_tables: &[Range<usize>],
) -> Option<LinePosition> {
    if count == 0 || line >= document.lines.len() {
        return None;
    }
    let (target, passed) = match direction {
        VerticalDirection::Down => {
            let target = line.saturating_add(count).min(document.lines.len() - 1);
            (target, line + 1..target + 1)
        }
        VerticalDirection::Up => {
            let target = line.saturating_sub(count);
            (target, target..line)
        }
    };
    if target == line || !rendered_tables.iter().any(|table| overlaps(table, &passed)) {
        return None;
    }
    let target_length = document.line_range(target).len();
    Some(LinePosition {
        line: target,
        column: goal_column.min(target_length),
    })
}

/// The document line to place the caret on for a landing height `y`, relative to the table's top edge.
pub fn table_page_target(
    document: &MarkdownDocument,
    table: &MarkdownTable,
    geometry: &TableGeometry,
    y: f64,
) -> usize {
    let first = document.line_index_containing(table.range.start);
    first
        + geometry
            .row_at_height(y)
            .map_or(0, |row| table.line_for_row(row))
}

fn overlaps(table: &Range<usize>, passed: &Range<usize>) -> bool {
    !table.is_empty() && table.start < passed.end && passed.start < table.end
}
