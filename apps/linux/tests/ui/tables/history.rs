use commitnote::editor::MarkdownView;
use gtk4::prelude::*;

use super::{
    KEYS_TABLE, caret_in, char_count, focus_view, label_with, open_note, place_caret, press_in,
    table_line_offset, view_text, wait_placed, wait_placed_where, wait_revealed,
};
use crate::flows::ensure;
use crate::support::Harness;

const CELL_LINE: i32 = 2;
const AFTER_CELL_TEXT: i32 = 15;
const CELL_TEXT: &str = "hot";
const TYPED: &str = " brew";

fn note() -> String {
    format!("Paragraph above the table.\n\n{KEYS_TABLE}\n\nParagraph below the table.")
}

pub(super) fn history(h: &mut Harness) -> Result<(), String> {
    let note = note();
    let (_, view) = open_note(h, &note, char_count(&note))?;
    wait_placed(h, &view)?;
    place_caret(
        &view,
        table_line_offset(&view, CELL_LINE)? + AFTER_CELL_TEXT,
    );
    wait_revealed(h, &view)?;
    focus_view(h, &view)?;
    h.type_keys(TYPED)?;
    let edited = format!("{CELL_TEXT}{TYPED}");
    let typed = note.replacen(&format!("| {CELL_TEXT} |"), &format!("| {edited} |"), 1);
    wait_text(h, &view, "the typed word in the note", &typed)?;
    press_in(h, &view, "<Control>End")?;
    wait_shows(h, &view, &edited)?;

    let undos = step_until(h, &view, "<Control>z", &note, char_count(TYPED))?;
    wait_as_caret_implies(h, &view, CELL_TEXT)?;

    step_until(h, &view, "<Control><Shift>z", &typed, undos)?;
    wait_as_caret_implies(h, &view, &edited)
}

fn wait_text(
    h: &Harness,
    view: &MarkdownView,
    description: &str,
    text: &str,
) -> Result<(), String> {
    h.wait(description, || view_text(view) == text)
        .map_err(|error| format!("{error}: the note reads\n{}", view_text(view)))
}

/// Presses `accelerator` until the note reads `text`, each press changing it, at most `limit`
/// times, since the editor groups typing into undo steps by time; returns the presses.
fn step_until(
    h: &Harness,
    view: &MarkdownView,
    accelerator: &str,
    text: &str,
    limit: i32,
) -> Result<i32, String> {
    let mut presses = 0;
    while view_text(view) != text {
        ensure(presses < limit, || {
            format!(
                "{presses} presses of {accelerator} left the note reading\n{}",
                view_text(view)
            )
        })?;
        let before = view_text(view);
        press_in(h, view, accelerator)?;
        h.wait(&format!("{accelerator} to change the note"), || {
            view_text(view) != before
        })?;
        presses += 1;
    }
    Ok(presses)
}

fn wait_shows(h: &Harness, view: &MarkdownView, cell: &str) -> Result<(), String> {
    wait_placed_where(h, view, &format!("the table to show {cell:?}"), |placed| {
        label_with(&placed.shown.widget, cell).is_ok()
    })
    .map(|_| ())
}

/// The table is revealed while the caret sits on one of its lines, and rendered with `cell`
/// otherwise.
fn wait_as_caret_implies(h: &Harness, view: &MarkdownView, cell: &str) -> Result<(), String> {
    h.settle()?;
    let buffer = view.buffer();
    let caret_line = buffer.iter_at_offset(caret_in(view)).line();
    let first = buffer.iter_at_offset(table_line_offset(view, 0)?).line();
    let rows = i32::try_from(KEYS_TABLE.lines().count()).map_err(|error| error.to_string())?;
    if (first..first + rows).contains(&caret_line) {
        wait_revealed(h, view)
    } else {
        wait_shows(h, view, cell)
    }
}
