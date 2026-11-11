use std::ops::Range;
use std::rc::Rc;

use commitnote_markdown::{
    MarkdownDocument, MarkdownTable, TableGeometry, VerticalDirection, table_entry_target,
    table_page_target,
};
use gtk4::prelude::*;
use gtk4::subclass::prelude::*;

use super::paging::PageLanding;
use super::{MarkdownView, ParsedText};

/// Where the last of a run of vertical moves left the caret, and what the next move of the run
/// carries on from there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct VerticalRun {
    offset: i32,
    goal_column: usize,
}

/// The run a vertical move starting with the caret at buffer `offset` carries on, if any.
fn continued(kept: Option<VerticalRun>, offset: i32) -> Option<VerticalRun> {
    kept.filter(|run| run.offset == offset)
}

/// The UTF-16 column a vertical move aims for: the one its run started from, or the caret's own
/// `column` when the caret is not where the previous move left it.
fn goal_column(kept: Option<VerticalRun>, offset: i32, column: usize) -> usize {
    continued(kept, offset).map_or(column, |run| run.goal_column)
}

fn line_containing(document: &MarkdownDocument, offset: usize) -> usize {
    let offset = offset.min(document.length());
    document
        .lines
        .partition_point(|&start| start <= offset)
        .saturating_sub(1)
}

fn line_length(document: &MarkdownDocument, line: usize) -> usize {
    let start = document.lines[line];
    let end = document
        .lines
        .get(line + 1)
        .map_or(document.length(), |next| next - 1);
    end - start
}

fn table_lines(document: &MarkdownDocument, table: &MarkdownTable) -> Range<usize> {
    let first = line_containing(document, table.range.start);
    first..first + table.lines.len()
}

/// The caret of an editable view with no selection, among rendered tables.
struct VerticalStart {
    parsed: Rc<ParsedText>,
    line: usize,
    goal_column: usize,
}

/// Where a rendered table sits, in the document and on screen.
#[derive(Debug, Clone, PartialEq, Eq)]
struct TableSpan {
    lines: Range<usize>,
    /// The buffer heights its widget covers.
    extent: Range<i32>,
}

/// The table a page move ends on: the one whose widget covers the landing height `y`, else the
/// one whose source holds the line GTK left the caret on.
fn landed_table<'a>(
    spans: impl Iterator<Item = &'a TableSpan> + Clone,
    y: Option<i32>,
    caret_line: usize,
) -> Option<usize> {
    y.and_then(|y| spans.clone().position(|span| span.extent.contains(&y)))
        .or_else(|| {
            spans
                .clone()
                .position(|span| span.lines.contains(&caret_line))
        })
}

struct PagedTable {
    span: TableSpan,
    source: MarkdownTable,
    top: i32,
    geometry: Rc<TableGeometry>,
}

/// What correcting a page move needs from before the move.
pub(super) struct TablePaging {
    start: VerticalStart,
    tables: Vec<PagedTable>,
}

impl MarkdownView {
    /// Moves the caret `count` lines up or down onto a rendered table's source as the table entry
    /// rule places it, when the caret leaves its line through the edge display line in that
    /// direction and the move passes a rendered table; says whether it did. Changes nothing
    /// otherwise, and never while the view is read-only or has a selection.
    pub fn enter_table(&self, direction: VerticalDirection, count: usize) -> bool {
        let Some(start) = self.vertical_start() else {
            return false;
        };
        if !self.leaves_line(direction) {
            return false;
        }
        let document = &start.parsed.document;
        let rendered: Vec<Range<usize>> = self
            .shown_tables()
            .iter()
            .map(|shown| table_lines(document, &shown.table.source))
            .collect();
        let Some(target) = table_entry_target(
            document,
            start.line,
            start.goal_column,
            direction,
            count,
            &rendered,
        ) else {
            return false;
        };
        self.place_on_line(&start, target.line, target.column);
        true
    }

    /// Runs a display line move that GTK makes, keeping the goal column of its run.
    pub(super) fn move_display_lines(&self, gtk_move: impl FnOnce()) {
        let start = self.vertical_start();
        gtk_move();
        if let Some(start) = start {
            self.keep_run(start.goal_column);
        }
    }

    fn vertical_start(&self) -> Option<VerticalStart> {
        let buffer = self.buffer();
        if !self.is_editable() || buffer.has_selection() {
            return None;
        }
        if self.imp().render_source.borrow().is_some() {
            self.render_now();
        }
        let parsed = self.fresh_parsed()?;
        if self.table_overlays().is_empty() {
            return None;
        }
        let offset = buffer.iter_at_mark(&buffer.get_insert()).offset();
        let utf16 = parsed.index.char_to_utf16(offset.max(0) as usize);
        let line = line_containing(&parsed.document, utf16);
        let column = utf16 - parsed.document.lines[line];
        Some(VerticalStart {
            goal_column: goal_column(self.imp().vertical_run.get(), offset, column),
            parsed,
            line,
        })
    }

    /// Whether the caret is on the last display line of its line for `Down`, or the first for
    /// `Up`.
    fn leaves_line(&self, direction: VerticalDirection) -> bool {
        let buffer = self.buffer();
        let caret = buffer.iter_at_mark(&buffer.get_insert());
        let mut iter = caret;
        match direction {
            VerticalDirection::Down => {
                !self.forward_display_line(&mut iter) || iter.line() != caret.line()
            }
            VerticalDirection::Up => {
                self.backward_display_line_start(&mut iter);
                iter.starts_line()
            }
        }
    }

    fn place_on_line(&self, start: &VerticalStart, line: usize, column: usize) {
        let document = &start.parsed.document;
        let utf16 = document.lines[line] + column.min(line_length(document, line));
        let offset = i32::try_from(start.parsed.index.utf16_to_char(utf16)).unwrap_or(i32::MAX);
        let buffer = self.buffer();
        buffer.place_cursor(&buffer.iter_at_offset(offset));
        self.scroll_mark_onscreen(&buffer.get_insert());
        self.keep_run(start.goal_column);
    }

    fn keep_run(&self, goal_column: usize) {
        let buffer = self.buffer();
        let offset = buffer.iter_at_mark(&buffer.get_insert()).offset();
        self.imp().vertical_run.set(Some(VerticalRun {
            offset,
            goal_column,
        }));
    }

    /// The rendered tables a page move about to start may end on, with the caret it starts from.
    pub(super) fn table_paging(&self) -> Option<TablePaging> {
        let start = self.vertical_start()?;
        let tables = self
            .shown_tables()
            .into_iter()
            .filter(|shown| shown.widget.is_visible())
            .filter_map(|shown| {
                let geometry = shown.widget.geometry()?;
                let top = shown.origin.1;
                Some(PagedTable {
                    span: TableSpan {
                        lines: table_lines(&start.parsed.document, &shown.table.source),
                        extent: top..top + geometry.height.ceil() as i32,
                    },
                    geometry,
                    top,
                    source: shown.table.source,
                })
            })
            .collect();
        Some(TablePaging { start, tables })
    }

    /// Moves the caret onto the row at the landing height of a page move when that height lies
    /// on a rendered table, or the move left the caret on one.
    pub(super) fn finish_paging(&self, paging: TablePaging, landing: PageLanding) {
        let TablePaging { start, tables } = paging;
        let buffer = self.buffer();
        let offset = buffer.iter_at_mark(&buffer.get_insert()).offset();
        let document = &start.parsed.document;
        let line = line_containing(
            document,
            start.parsed.index.char_to_utf16(offset.max(0) as usize),
        );
        let page_y = match landing {
            PageLanding::At(y) => Some(y),
            PageLanding::Start | PageLanding::End => None,
        };
        let spans = tables.iter().map(|table| &table.span);
        let Some(table) = landed_table(spans, page_y, line).map(|index| &tables[index]) else {
            self.keep_run(start.goal_column);
            return;
        };
        let y = match landing {
            PageLanding::Start => 0,
            PageLanding::End => {
                let (top, height) = self.line_yrange(&buffer.end_iter());
                top + height
            }
            PageLanding::At(y) => y,
        };
        self.place_on_table_row(&start, table, y);
    }

    /// Places the caret on the row of `table` at the buffer height `y`, at the goal column.
    fn place_on_table_row(&self, start: &VerticalStart, table: &PagedTable, y: i32) {
        let target = table_page_target(
            &start.parsed.document,
            &table.source,
            &table.geometry,
            f64::from(y - table.top),
        );
        self.place_on_line(start, target, start.goal_column);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(offset: i32, goal_column: usize) -> Option<VerticalRun> {
        Some(VerticalRun {
            offset,
            goal_column,
        })
    }

    #[test]
    fn the_goal_column_is_the_caret_column_without_a_run() {
        assert_eq!(goal_column(None, 7, 3), 3);
    }

    #[test]
    fn a_move_from_where_the_last_one_left_the_caret_keeps_the_goal_column() {
        assert_eq!(goal_column(run(20, 9), 20, 2), 9);
    }

    #[test]
    fn a_caret_moved_elsewhere_drops_the_goal_column() {
        assert_eq!(goal_column(run(20, 9), 21, 2), 2);
        assert_eq!(goal_column(run(20, 9), 19, 0), 0);
    }

    fn span(lines: Range<usize>, extent: Range<i32>) -> TableSpan {
        TableSpan { lines, extent }
    }

    #[test]
    fn a_page_move_ends_on_the_table_its_landing_height_lies_on() {
        let spans = [span(2..6, 40..160), span(10..13, 300..380)];
        assert_eq!(landed_table(spans.iter(), Some(120), 7), Some(0));
        assert_eq!(landed_table(spans.iter(), Some(300), 2), Some(1));
    }

    #[test]
    fn a_landing_beside_every_table_ends_on_the_table_holding_the_caret() {
        let spans = [span(2..6, 40..160), span(10..13, 300..380)];
        assert_eq!(landed_table(spans.iter(), Some(160), 11), Some(1));
        assert_eq!(landed_table(spans.iter(), None, 2), Some(0));
        assert_eq!(landed_table(spans.iter(), Some(200), 7), None);
    }
}
