use std::cell::Cell;
use std::rc::Rc;

use commitnote::editor::{MarkdownView, NoteEditor, TableWidget};
use commitnote_editor_text::apply;
use commitnote_markdown::{
    TableCellPiece, TableLayout, TableLayoutMetrics, insert_image_references,
};
use gtk4::{self as gtk, glib, graphene, prelude::*};

use super::{
    Placed, char_count, foreground_alpha, label_with, picture_in, place_caret, placed, rendered,
    table_line_offset, wait_placed, wait_placed_where, wait_revealed,
};
use crate::flows::{ensure, split_view};
use crate::p2::set_note_text;
use crate::p4::{
    GIF_PALETTE, Scratch, UNKNOWN_IMAGE, pick_and_insert, png_bytes, references, wait_images_ready,
    with_animated_gif,
};
use crate::support::{Harness, Theme, WIDE_LIGHT, Width, WindowPixels, restoring};

const PNG_SIZE: (i32, i32) = (320, 240);
const PNG_CELL: (usize, usize) = (1, 0);
const GIF_CELL: (usize, usize) = (2, 0);
const IMAGE_CELLS: [(usize, usize); 2] = [PNG_CELL, GIF_CELL];
const LOST_ALT: &str = "lost";
const NO_ALT_FALLBACK: &str = "Image";
const TEXT_ROW_LINE: i32 = 5;
const INSIDE_TEXT_CELL: i32 = 4;
const GIF_FRAMES_APART: u32 = 10;

fn note(png: &str, gif: &str) -> String {
    format!(
        "Paragraph before the table.\n\n\
         | Item | Qty | Note |\n| :-- | :-: | --: |\n\
         | {png} | 2 | picture |\n\
         | {gif} | 1 | moving |\n\
         | ![{LOST_ALT}](image:{UNKNOWN_IMAGE}) | 0 | ![](image:{UNKNOWN_IMAGE}) |\n\
         | tea | 3 | hot |\n\n\
         Paragraph after the table."
    )
}

pub(super) fn images(h: &mut Harness) -> Result<(), String> {
    with_animated_gif(h, |editor| {
        let scratch = Scratch::new("table")?;
        editor.place_caret(i32::MAX);
        pick_and_insert(
            editor,
            vec![scratch.write("table.png", &png_bytes(PNG_SIZE.0, PNG_SIZE.1, 90))?],
        )?;
        wait_images_ready(h, editor, 2)?;
        let [gif, png]: [String; 2] = references(&editor.text())
            .try_into()
            .map_err(|found| format!("the note holds the references {found:?}"))?;
        let view = editor.view();
        let note = note(&png, &gif);
        let first = show_images(h, editor, &view, &note)?;
        check_image_cells(&view, &first)?;
        check_unavailable(&placed(&view)?.shown.widget)?;
        check_gif_still(h, &view)?;
        h.session_screenshots("images", WIDE_LIGHT)?;
        h.show_variant(Width::Narrow, Theme::Dark)?;
        split_view(h)?.set_show_content(true);
        h.wait_shown("formatting-bar")?;
        wait_pictures(h, &view)?;
        h.capture_variant("images", Width::Narrow, Theme::Dark)?;
        h.show_variant(Width::Wide, Theme::Light)?;
        wait_pictures(h, &view)?;
        check_insertion(h, editor, &view, &scratch)
    })
}

/// The row heights of the table's first observed render, and whether it already showed every
/// image.
struct FirstRender {
    rows: Vec<f64>,
    images_ready: bool,
}

fn show_images(
    h: &Harness,
    editor: &NoteEditor,
    view: &MarkdownView,
    note: &str,
) -> Result<FirstRender, String> {
    let end = char_count(note);
    set_note_text(editor, note, end, end);
    let mut first = None;
    h.wait("the table to render", || {
        if editor.text() != note {
            return false;
        }
        let Ok(placed) = placed(view) else {
            return false;
        };
        first = Some(FirstRender {
            rows: row_heights(&placed),
            images_ready: shows_pictures(&placed.shown.widget),
        });
        true
    })?;
    wait_pictures(h, view)?;
    first.ok_or_else(|| "the table never rendered".to_owned())
}

fn shows_pictures(widget: &TableWidget) -> bool {
    IMAGE_CELLS
        .iter()
        .all(|&(row, column)| picture_in(widget, row, column).is_some())
}

fn wait_pictures(h: &Harness, view: &MarkdownView) -> Result<Placed, String> {
    wait_placed_where(h, view, "the table to show its images", |placed| {
        shows_pictures(&placed.shown.widget)
    })
}

fn row_heights(placed: &Placed) -> Vec<f64> {
    placed
        .shown
        .widget
        .geometry()
        .map(|geometry| geometry.row_heights.clone())
        .unwrap_or_default()
}

/// Each image shows at its natural size scaled into its column and capped in height, and its
/// row grows to hold it.
fn check_image_cells(view: &MarkdownView, first: &FirstRender) -> Result<(), String> {
    let placed = placed(view)?;
    let widget = &placed.shown.widget;
    let geometry = widget.geometry().ok_or("the table has no geometry")?;
    let metrics = TableLayoutMetrics::default();
    let table = widget.table();
    let scale = f64::from(widget.scale_factor().max(1));
    for (row, column) in IMAGE_CELLS {
        let picture = picture_in(widget, row, column)
            .ok_or_else(|| format!("cell {row},{column} shows no picture"))?;
        let paintable = picture
            .paintable()
            .ok_or_else(|| format!("the picture in cell {row},{column} has no image"))?;
        let reference = table.rows[row][column]
            .pieces
            .iter()
            .find_map(|piece| match piece {
                TableCellPiece::Image { reference } => Some(reference),
                TableCellPiece::Text { .. } => None,
            })
            .ok_or_else(|| format!("cell {row},{column} holds no image reference"))?;
        let (width, height) = match (reference.width, reference.height) {
            (Some(width), Some(height)) => (f64::from(width), f64::from(height)),
            _ => (
                f64::from(paintable.intrinsic_width()),
                f64::from(paintable.intrinsic_height()),
            ),
        };
        let content = geometry.content_frames[row][column].width;
        let (display_width, display_height) =
            TableLayout::default().image_size(width / scale, height / scale, content);
        let near = |a: f64, b: f64| (a - b).abs() <= 1.0;
        ensure(
            near(f64::from(picture.width()), display_width)
                && near(f64::from(picture.height()), display_height),
            || {
                format!(
                    "the picture in cell {row},{column} is {}x{}, not {display_width}x\
                     {display_height}",
                    picture.width(),
                    picture.height()
                )
            },
        )?;
        let needed = display_height + 2.0 * metrics.cell_padding_y;
        ensure(geometry.row_heights[row] + 1.0 >= needed, || {
            format!(
                "row {row} is {} tall for a {display_height} tall image",
                geometry.row_heights[row]
            )
        })?;
        if !first.images_ready {
            ensure(geometry.row_heights[row] > first.rows[row], || {
                format!(
                    "row {row} stayed {} tall once its image loaded",
                    first.rows[row]
                )
            })?;
        }
    }
    Ok(())
}

fn check_unavailable(widget: &TableWidget) -> Result<(), String> {
    for text in [LOST_ALT, NO_ALT_FALLBACK] {
        let label = label_with(widget, text)?;
        ensure(
            foreground_alpha(&label).is_some_and(|alpha| alpha < i32::from(u16::MAX)),
            || format!("the unavailable image's {text:?} is not muted"),
        )?;
    }
    Ok(())
}

/// With animations on, the table's GIF keeps showing its first frame.
fn check_gif_still(h: &Harness, view: &MarkdownView) -> Result<(), String> {
    let settings = gtk::Settings::default().ok_or("there are no GTK settings")?;
    restoring(
        || settings.set_gtk_enable_animations(false),
        || {
            settings.set_gtk_enable_animations(true);
            let before = gif_centre(h, view)?;
            let window = h.window()?;
            let ticks = Rc::new(Cell::new(0_u32));
            let callback = window.add_tick_callback({
                let ticks = ticks.clone();
                move |_, _| {
                    ticks.set(ticks.get() + 1);
                    glib::ControlFlow::Continue
                }
            });
            let waited = h.wait("a few frames to pass", || ticks.get() >= GIF_FRAMES_APART);
            callback.remove();
            waited?;
            let after = gif_centre(h, view)?;
            let [red, green, blue] = GIF_PALETTE[0];
            for (when, pixel) in [("first", before), ("second", after)] {
                ensure(pixel[..3] == [red, green, blue], || {
                    format!("the GIF shows {pixel:?} in the {when} capture, not its first frame")
                })?;
            }
            ensure(!view.testing_animating(), || {
                "the view animates the table's GIF".to_owned()
            })
        },
    )
}

fn gif_centre(h: &Harness, view: &MarkdownView) -> Result<[u8; 4], String> {
    h.settle()?;
    let window = h.window()?;
    let picture = picture_in(&placed(view)?.shown.widget, GIF_CELL.0, GIF_CELL.1)
        .ok_or("the GIF cell shows no picture")?;
    let centre = picture
        .compute_point(
            &window,
            &graphene::Point::new(picture.width() as f32 / 2.0, picture.height() as f32 / 2.0),
        )
        .ok_or("the GIF is not inside the window")?;
    WindowPixels::new(&h.render_texture(None)?, &window)?.at(&centre)
}

/// Inserting an image with the caret in a revealed cell places the reference where the insertion
/// rule puts it, and the table still parses.
fn check_insertion(
    h: &Harness,
    editor: &NoteEditor,
    view: &MarkdownView,
    scratch: &Scratch,
) -> Result<(), String> {
    let caret = table_line_offset(view, TEXT_ROW_LINE)? + INSIDE_TEXT_CELL;
    place_caret(view, caret);
    wait_revealed(h, view)?;
    let before = editor.text();
    let known = references(&before);
    pick_and_insert(
        editor,
        vec![scratch.write("inserted.png", &png_bytes(48, 32, 30))?],
    )?;
    h.wait("the inserted reference", || {
        references(&editor.text()).len() > known.len()
    })?;
    let after = editor.text();
    let added: Vec<String> = references(&after)
        .into_iter()
        .filter(|reference| !known.contains(reference))
        .collect();
    let caret = usize::try_from(caret).map_err(|error| error.to_string())?;
    let expected = apply(
        &insert_image_references(&before, caret, &added).edits,
        &before,
    );
    ensure(after == expected, || {
        format!("inserting {added:?} in a cell gave\n{after}\nnot\n{expected}")
    })?;
    let table = rendered(&after)?;
    ensure(table.row_count() == rendered(&before)?.row_count(), || {
        format!(
            "the table has {} rows after the insertion",
            table.row_count()
        )
    })?;
    place_caret(view, char_count(&after));
    wait_placed(h, view).map(|_| ())
}
