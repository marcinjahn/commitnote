use commitnote::editor::{MarkdownView, NoteEditor, ShownTable};
use gtk4::{self as gtk, graphene, prelude::*};

use super::{
    PAGE_COLUMN, caret_in, cell_bounds, char_count, focus_view, open_note, page_table, place_caret,
    press_in, show_note, table_line_offset, wait_caret, wait_placed, wait_revealed,
};
use crate::flows::ensure;
use crate::p2::set_note_text;
use crate::support::Harness;

const LINES_BESIDE_TABLE: usize = 40;
const TALL_TABLE_ROWS: usize = 32;
const PLAIN_LINES: usize = 120;
/// How far a page landing must stay from a row's edges for the row to be certain.
const ROW_SLACK: f32 = 3.0;

/// The body row of `shown` whose frame holds the buffer height `landing` well inside it.
pub(super) fn landing_row(shown: &ShownTable, landing: i32) -> Option<usize> {
    let local = (landing - shown.origin.1) as f32;
    (1..shown.table.source.lines.len().saturating_sub(1)).find(|&row| {
        cell_bounds(&shown.widget, row, 0).is_ok_and(|cell| {
            cell.y() + ROW_SLACK <= local && local <= cell.y() + cell.height() - ROW_SLACK
        })
    })
}

/// The height a page move of `count` pages from the caret at `caret` aims at, in buffer
/// coordinates, unless it reaches an end of the text.
pub(super) fn page_landing(
    view: &MarkdownView,
    caret: &gtk::TextIter,
    count: i32,
    page: &gtk::Adjustment,
) -> i32 {
    let (cursor, _) = view.cursor_locations(Some(caret));
    (f64::from(cursor.y() + cursor.height() / 2) + f64::from(count) * page.page_increment()) as i32
}

fn beside_table(place: &str) -> String {
    (1..=LINES_BESIDE_TABLE)
        .map(|line| format!("Line {line} {place} the table."))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Pages through a note whose view grows to its text inside the note page's scroller: a table
/// taller than the visible page between two long paragraphs, then a note with no table.
pub(super) fn note_paging(h: &mut Harness) -> Result<(), String> {
    let note = format!(
        "{}\n\n{}\n\n{}",
        beside_table("above"),
        page_table(TALL_TABLE_ROWS),
        beside_table("below")
    );
    let (editor, view) = open_note(h, &note, 0)?;
    let placed = wait_placed(h, &view)?;
    let scroller = view
        .ancestor(gtk::ScrolledWindow::static_type())
        .and_downcast::<gtk::ScrolledWindow>()
        .ok_or("the note view is not in a scroller")?;
    let page = scroller.vadjustment();
    ensure(placed.rect.height() > page.page_size() as f32, || {
        format!(
            "the table is {} high, not taller than the visible page of {}",
            placed.rect.height(),
            page.page_size()
        )
    })?;
    focus_view(h, &view)?;

    let lines_above = 0..LINES_BESIDE_TABLE as i32;
    page_into_table(h, &view, &scroller, lines_above.rev(), 1)?;
    page_out_of_table(h, &view, &scroller)?;

    show_note(h, &editor, &view, &note, char_count(&note))?;
    let first_below = LINES_BESIDE_TABLE as i32 + TALL_TABLE_ROWS as i32 + 4;
    let lines_below = first_below..first_below + LINES_BESIDE_TABLE as i32;
    page_into_table(h, &view, &scroller, lines_below, -1)?;

    plain_paging(h, &editor, &view, &scroller)
}

/// Puts the caret on the first of `lines` from which `count` pages land well inside a body row
/// of the shown table, pages, and expects the caret on that row at the goal column.
fn page_into_table(
    h: &Harness,
    view: &MarkdownView,
    scroller: &gtk::ScrolledWindow,
    lines: impl Iterator<Item = i32>,
    count: i32,
) -> Result<(), String> {
    let shown = view
        .shown_tables()
        .into_iter()
        .next()
        .ok_or("no table is shown")?;
    let page = scroller.vadjustment();
    let buffer = view.buffer();
    let (caret, row) = lines
        .filter_map(|line| buffer.iter_at_line(line))
        .find_map(|mut caret| {
            caret.forward_chars(PAGE_COLUMN);
            let landing = page_landing(view, &caret, count, &page);
            landing_row(&shown, landing).map(|row| (caret.offset(), row))
        })
        .ok_or("no line pages into the middle of a body row")?;
    place_caret(view, caret);
    h.settle()?;
    let key = if count > 0 { "Page_Down" } else { "Page_Up" };
    press_in(h, view, key)?;
    let target = table_line_offset(view, row as i32 + 1)? + PAGE_COLUMN;
    wait_caret(
        h,
        view,
        &format!("{key} to put the caret on row {row} at the goal column"),
        target,
    )?;
    wait_revealed(h, view)?;
    wait_caret_shown(h, view, scroller, key)
}

fn page_out_of_table(
    h: &Harness,
    view: &MarkdownView,
    scroller: &gtk::ScrolledWindow,
) -> Result<(), String> {
    let below = table_line_offset(view, TALL_TABLE_ROWS as i32 + 2)?;
    press_in(h, view, "Page_Down")?;
    h.wait("a further Page_Down to leave the table", || {
        caret_in(view) >= below
    })
    .map_err(|error| format!("{error}: the caret is at {}", caret_in(view)))?;
    wait_caret_shown(h, view, scroller, "the further Page_Down")
}

/// Pages a note with no table down, back up and down again extending the selection, expecting
/// one page of the note scroller per move.
fn plain_paging(
    h: &Harness,
    editor: &NoteEditor,
    view: &MarkdownView,
    scroller: &gtk::ScrolledWindow,
) -> Result<(), String> {
    let text = (1..=PLAIN_LINES)
        .map(|line| format!("Line {line} of a note without a table."))
        .collect::<Vec<_>>()
        .join("\n");
    set_note_text(editor, &text, PAGE_COLUMN, PAGE_COLUMN);
    h.wait("the editor to hold the note without a table", || {
        editor.text() == text
    })?;
    let page = scroller.vadjustment();
    page.set_value(page.lower());
    h.settle()?;
    let top = page.value();
    let buffer = view.buffer();
    let start = buffer.iter_at_offset(PAGE_COLUMN);
    let landing = page_landing(view, &start, 1, &page);
    let (cursor, _) = view.cursor_locations(Some(&start));
    let landed = view
        .iter_at_location(cursor.x(), landing)
        .ok_or("no text lies at the landing height")?;
    ensure(landed.line() > 0 && !landed.is_end(), || {
        format!("one page down lands on line {}", landed.line())
    })?;
    let landed = landed.offset();

    let page_moved_to = |key: &str, value: f64| {
        h.wait(&format!("{key} to scroll the note to {value}"), || {
            (page.value() - value).abs() <= 1.0
        })
        .map_err(|error| format!("{error}: it is at {}", page.value()))
    };
    press_in(h, view, "Page_Down")?;
    wait_caret(h, view, "Page_Down to move the caret one page", landed)?;
    page_moved_to("Page_Down", top + page.page_increment())?;
    wait_caret_shown(h, view, scroller, "Page_Down")?;

    press_in(h, view, "Page_Up")?;
    wait_caret(h, view, "Page_Up to move the caret back", PAGE_COLUMN)?;
    page_moved_to("Page_Up", top)?;

    press_in(h, view, "<Shift>Page_Down")?;
    h.wait("Shift+Page_Down to select one page", || {
        buffer.selection_bounds().is_some_and(|(from, to)| {
            from.offset() == PAGE_COLUMN && to.offset() == landed && caret_in(view) == landed
        })
    })?;
    page_moved_to("Shift+Page_Down", top + page.page_increment())?;
    wait_caret_shown(h, view, scroller, "Shift+Page_Down")
}

pub(super) fn wait_caret_shown(
    h: &Harness,
    view: &MarkdownView,
    scroller: &gtk::ScrolledWindow,
    after: &str,
) -> Result<(), String> {
    h.wait(
        &format!("the caret to show in the page after {after}"),
        || caret_shown(view, scroller),
    )
}

fn caret_shown(view: &MarkdownView, scroller: &gtk::ScrolledWindow) -> bool {
    let (caret, _) = view.cursor_locations(None);
    let (x, y) = view.buffer_to_window_coords(gtk::TextWindowType::Widget, caret.x(), caret.y());
    view.compute_point(scroller, &graphene::Point::new(x as f32, y as f32))
        .is_some_and(|top| {
            top.y() >= 0.0 && top.y() + caret.height() as f32 <= scroller.height() as f32
        })
}
