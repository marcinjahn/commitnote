use std::ops::Range;
use std::rc::Rc;

use commitnote_markdown::{
    MarkdownDocument, MarkdownTable, TableGeometry, VerticalDirection, table_entry_target,
    table_page_target,
};
use gtk4::subclass::prelude::*;
use gtk4::{self as gtk, prelude::*};

use super::{MarkdownView, ParsedText};

/// Where the last of a run of vertical moves left the caret, and what the next move of the run
/// carries on from there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct VerticalRun {
    offset: i32,
    goal_column: usize,
    /// GTK's virtual cursor height after a page move it made, in buffer coordinates.
    page_y: Option<i32>,
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

#[derive(Debug, Clone, Copy, PartialEq)]
struct PageScroll {
    value: f64,
    lower: f64,
    upper: f64,
    page_size: f64,
    page_increment: f64,
}

impl From<&gtk::Adjustment> for PageScroll {
    fn from(adjustment: &gtk::Adjustment) -> Self {
        Self {
            value: adjustment.value(),
            lower: adjustment.lower(),
            upper: adjustment.upper(),
            page_size: adjustment.page_size(),
            page_increment: adjustment.page_increment(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PageLanding {
    Start,
    End,
    /// A height in buffer coordinates, which the layout clamps to the text.
    At(i32),
}

/// Where a page move of `count` pages from the caret height `caret_y` lands, as
/// `gtk_text_view_scroll_pages` in GTK 4.20 decides it (gtk/gtktextview.c, lines 6975-7000): a
/// move up from the top of the scroll range goes to the buffer start and one down from its bottom
/// to the buffer end; any other move shifts the height by `count` page increments, truncated to
/// whole pixels, without clamping it to the scroll range.
fn page_landing(caret_y: i32, count: i32, scroll: PageScroll) -> PageLanding {
    if count < 0 && scroll.value <= scroll.lower + 1e-12 {
        PageLanding::Start
    } else if count > 0 && scroll.value >= scroll.upper - scroll.page_size - 1e-12 {
        PageLanding::End
    } else {
        PageLanding::At((f64::from(caret_y) + f64::from(count) * scroll.page_increment) as i32)
    }
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
    offset: i32,
    line: usize,
    goal_column: usize,
}

struct PagedTable {
    lines: Range<usize>,
    /// The buffer heights of the display line the table's room hangs below, the room included.
    band: Range<i32>,
    source: MarkdownTable,
    top: i32,
    geometry: Rc<TableGeometry>,
}

/// What a page move needs from before GTK moved the caret.
struct Paging {
    start: VerticalStart,
    caret_y: i32,
    scroll: PageScroll,
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
            self.keep_run(start.goal_column, None);
        }
    }

    /// Runs a page move of `count` pages that GTK makes, then moves the caret onto the row at
    /// the landing height when GTK left it on a rendered table. A landing height inside a
    /// table's band is never handed to GTK: for a height in the room below a line holding
    /// invisible text, `gtk_text_layout_get_iter_at_position` (GTK 4.20, gtk/gtktextlayout.c)
    /// passes the line's whole byte count to `gtk_text_iter_set_visible_line_index`, which runs
    /// past the line end and aborts. The view scrolls by the pages itself instead.
    pub(super) fn move_pages(&self, count: i32, gtk_move: impl FnOnce()) {
        let Some(paging) = self.paging() else {
            gtk_move();
            return;
        };
        let landing = page_landing(paging.caret_y, count, paging.scroll);
        let banded = match landing {
            PageLanding::At(y) => paging
                .tables
                .iter()
                .find(|table| table.band.contains(&y))
                .map(|table| (table, y)),
            PageLanding::Start | PageLanding::End => None,
        };
        if let Some((table, y)) = banded {
            if let Some(adjustment) = self.vadjustment() {
                adjustment.set_value(
                    paging.scroll.value + f64::from(count) * paging.scroll.page_increment,
                );
            }
            self.place_on_table_row(&paging.start, table, y);
            return;
        }
        gtk_move();
        self.finish_paging(paging, landing);
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
            offset,
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
        self.keep_run(start.goal_column, None);
    }

    fn keep_run(&self, goal_column: usize, page_y: Option<i32>) {
        let buffer = self.buffer();
        let offset = buffer.iter_at_mark(&buffer.get_insert()).offset();
        self.imp().vertical_run.set(Some(VerticalRun {
            offset,
            goal_column,
            page_y,
        }));
    }

    fn paging(&self) -> Option<Paging> {
        let start = self.vertical_start()?;
        let buffer = self.buffer();
        self.scroll_mark_onscreen(&buffer.get_insert());
        let scroll = PageScroll::from(&self.vadjustment()?);
        let caret_y = continued(self.imp().vertical_run.get(), start.offset)
            .and_then(|run| run.page_y)
            .unwrap_or_else(|| {
                let (caret, _) = self.cursor_locations(None);
                caret.y() + caret.height() / 2
            });
        let tables = self
            .shown_tables()
            .into_iter()
            .filter(|shown| shown.widget.is_visible())
            .filter_map(|shown| {
                let header = start
                    .parsed
                    .index
                    .utf16_to_char(shown.table.source.range.start);
                let header = buffer.iter_at_offset(i32::try_from(header).unwrap_or(i32::MAX));
                let (band_top, band_height) = self.line_yrange(&header);
                Some(PagedTable {
                    lines: table_lines(&start.parsed.document, &shown.table.source),
                    band: band_top..band_top + band_height,
                    geometry: shown.widget.geometry()?,
                    top: shown.origin.1,
                    source: shown.table.source,
                })
            })
            .collect();
        Some(Paging {
            start,
            caret_y,
            scroll,
            tables,
        })
    }

    fn finish_paging(&self, paging: Paging, landing: PageLanding) {
        let Paging { start, tables, .. } = paging;
        let buffer = self.buffer();
        let offset = buffer.iter_at_mark(&buffer.get_insert()).offset();
        let document = &start.parsed.document;
        let line = line_containing(
            document,
            start.parsed.index.char_to_utf16(offset.max(0) as usize),
        );
        let Some(table) = tables.iter().find(|table| table.lines.contains(&line)) else {
            let page_y = match landing {
                PageLanding::At(y) => Some(y),
                PageLanding::Start | PageLanding::End => None,
            };
            self.keep_run(start.goal_column, page_y);
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

    const SCROLL: PageScroll = PageScroll {
        value: 400.0,
        lower: 0.0,
        upper: 2000.0,
        page_size: 500.0,
        page_increment: 450.0,
    };

    fn run(offset: i32, goal_column: usize) -> Option<VerticalRun> {
        Some(VerticalRun {
            offset,
            goal_column,
            page_y: None,
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

    #[test]
    fn a_page_move_shifts_the_caret_height_by_page_increments() {
        assert_eq!(page_landing(300, 1, SCROLL), PageLanding::At(750));
        assert_eq!(page_landing(800, -1, SCROLL), PageLanding::At(350));
        assert_eq!(page_landing(300, 2, SCROLL), PageLanding::At(1200));
    }

    #[test]
    fn the_landing_height_is_truncated_to_whole_pixels() {
        let scroll = PageScroll {
            page_increment: 450.9,
            ..SCROLL
        };
        assert_eq!(page_landing(300, 1, scroll), PageLanding::At(750));
        assert_eq!(page_landing(800, -1, scroll), PageLanding::At(349));
    }

    #[test]
    fn the_landing_height_is_not_clamped_to_the_scroll_range() {
        let near_top = PageScroll {
            value: 100.0,
            ..SCROLL
        };
        assert_eq!(page_landing(120, -1, near_top), PageLanding::At(-330));
        let near_bottom = PageScroll {
            value: 1400.0,
            ..SCROLL
        };
        assert_eq!(page_landing(1800, 1, near_bottom), PageLanding::At(2250));
    }

    #[test]
    fn paging_up_from_the_top_lands_on_the_document_start() {
        let top = PageScroll {
            value: 0.0,
            ..SCROLL
        };
        assert_eq!(page_landing(120, -1, top), PageLanding::Start);
        assert_eq!(page_landing(120, 1, top), PageLanding::At(570));
    }

    #[test]
    fn paging_down_from_the_bottom_lands_on_the_document_end() {
        let bottom = PageScroll {
            value: 1500.0,
            ..SCROLL
        };
        assert_eq!(page_landing(1800, 1, bottom), PageLanding::End);
        assert_eq!(page_landing(1800, -1, bottom), PageLanding::At(1350));
    }

    #[test]
    fn a_page_shorter_than_its_view_pages_to_both_ends() {
        let short = PageScroll {
            value: 0.0,
            upper: 500.0,
            ..SCROLL
        };
        assert_eq!(page_landing(40, 1, short), PageLanding::End);
        assert_eq!(page_landing(40, -1, short), PageLanding::Start);
    }
}
