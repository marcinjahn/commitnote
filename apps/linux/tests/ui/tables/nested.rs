use commitnote::editor::{MarkdownView, TableWidget};
use gtk4::{self as gtk, prelude::*};

use super::rooms::text_right;
use super::{
    Placed, char_count, check_accessibility, check_not_focusable, open_note, place_caret,
    placements, prefix_width, table_line_offset,
};
use crate::flows::{ensure, split_view};
use crate::support::{Harness, Theme, WIDE_LIGHT, Width};

const NOTE: &str = "Plain line before the tables.\n\n\
> | Item | Qty | Note |\n> | :-- | :-: | --: |\n> | tea | 2 | hot |\n\n\
> > | Deep | Qty |\n> > | :-- | --: |\n> > | milk | 1 |\n\n\
- A list item\n\n  | Listed | Qty |\n  | :-- | --: |\n  | bread | 4 |\n\n\
Closing line after the tables.";
const QUOTED_LABELS: [[&str; 3]; 2] = [["Item", "Qty", "Note"], ["tea", "2", "hot"]];
const TABLES: usize = 3;
/// How far a quote of any depth indents its text.
const QUOTE_INDENT: f32 = 12.0;

pub(super) fn nested(h: &mut Harness) -> Result<(), String> {
    let (_, view) = open_note(h, NOTE, char_count(NOTE))?;
    let placed = wait_placements(h, &view, TABLES)?;
    check_bands(&view, &placed)?;
    h.session_screenshots("nested", WIDE_LIGHT)?;
    h.show_variant(Width::Narrow, Theme::Dark)?;
    split_view(h)?.set_show_content(true);
    h.wait_shown("formatting-bar")?;
    check_bands(&view, &wait_placements(h, &view, TABLES)?)?;
    h.capture_variant("nested", Width::Narrow, Theme::Dark)?;
    h.show_variant(Width::Wide, Theme::Light)?;

    let quoted = wait_placements(h, &view, TABLES)?[0].shown.widget.clone();
    check_quoted_accessibility(&quoted)?;
    place_caret(&view, table_line_offset(&view, 1)? + 4);
    wait_placements(h, &view, TABLES - 1)?;
    place_caret(&view, char_count(NOTE));
    let again = wait_placements(h, &view, TABLES)?[0].shown.widget.clone();
    ensure(again != quoted, || {
        "the quoted table kept its widget across a reveal".to_owned()
    })?;
    check_quoted_accessibility(&again)
}

fn wait_placements(h: &Harness, view: &MarkdownView, count: usize) -> Result<Vec<Placed>, String> {
    let mut last = String::new();
    h.wait(
        &format!("{count} tables on their overlays"),
        || match placements(view) {
            Ok(placed) if placed.len() == count => true,
            Ok(placed) => {
                last = format!("{} tables are shown", placed.len());
                false
            }
            Err(error) => {
                last = error;
                false
            }
        },
    )
    .map_err(|error| format!("{error}: {last}"))?;
    h.settle()?;
    let placed = placements(view)?;
    ensure(placed.len() == count, || {
        format!("{} tables are shown once the window settled", placed.len())
    })?;
    Ok(placed)
}

/// Each table starts where its container's text starts: one quote indent for any quote depth,
/// plus the list item's prefix; and it ends where the text does.
fn check_bands(view: &MarkdownView, placed: &[Placed]) -> Result<(), String> {
    let text_left = text_left(view);
    let right = text_right(view);
    for table in placed {
        let rendered = &table.shown.table;
        let bounds = table
            .shown
            .widget
            .compute_bounds(view)
            .ok_or("a table widget has no bounds in the view")?;
        let quote = if rendered.quote_level > 0 {
            QUOTE_INDENT
        } else {
            0.0
        };
        let expected = text_left + quote + prefix_width(view, rendered) as f32;
        let end = bounds.x() + bounds.width();
        ensure(
            (bounds.x() - expected).abs() <= 1.0 && (end - right).abs() <= 1.0,
            || {
                format!(
                    "the table at quote level {} with the prefix {:?} spans {}..{end}, not \
                     {expected}..{right}",
                    rendered.quote_level,
                    rendered.container_prefix(),
                    bounds.x()
                )
            },
        )?;
    }
    Ok(())
}

/// Where the first, unindented line's text starts, in view coordinates.
fn text_left(view: &MarkdownView) -> f32 {
    let location = view.iter_location(&view.buffer().start_iter());
    let (x, _) =
        view.buffer_to_window_coords(gtk::TextWindowType::Widget, location.x(), location.y());
    x as f32
}

fn check_quoted_accessibility(widget: &TableWidget) -> Result<(), String> {
    check_accessibility(widget, &QUOTED_LABELS)?;
    check_not_focusable(widget)
}
