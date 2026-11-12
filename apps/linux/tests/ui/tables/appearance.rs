use std::cell::RefCell;
use std::collections::HashMap;

use commitnote::editor::{MarkdownView, TableWidget};
use commitnote_markdown::TableLayoutMetrics;
use gtk4::{self as gtk, gdk, graphene, prelude::*};

use super::rooms::text_right;
use super::{
    Placed, cell_bounds, char_count, describe, open_note, placed, wait_placed, wait_placed_where,
    widest_word,
};
use crate::flows::{ensure, split_view};
use crate::p2::{font_classes, wait_for_font};
use crate::p6::SCALED_XFT_DPI;
use crate::support::{Harness, SESSION_ACCENT, Theme, Width, WindowPixels, descendants, restoring};

const LONG_URL: &str = "https://example.com/a/very/long/path/that/keeps/going/without/any/break";
const EMPTY_CELL: (usize, usize) = (2, 1);
const FONT_CLASS_PREFIX: &str = "note-font-";
const FONT_SETTING: &str = "noteFont";

fn note() -> String {
    format!(
        "Paragraph before the table.\n\n\
         | Item | Qty | Note |\n| :-- | :-: | --: |\n\
         | `code` | 2 | [shop](https://e.x/s) |\n\
         | tea |  | {LONG_URL} |\n\
         | jam | 3 | sweet |\n\n\
         Paragraph after the table."
    )
}

#[derive(Debug, Clone, Copy)]
enum Accent {
    Session,
    /// The n-th accent the core offers besides the system and session ones.
    Other(usize),
}

#[derive(Debug, Clone, Copy)]
struct Variant {
    width: Width,
    theme: Theme,
    accent: Accent,
    high_contrast: bool,
}

const fn variant(width: Width, theme: Theme, accent: Accent, high_contrast: bool) -> Variant {
    Variant {
        width,
        theme,
        accent,
        high_contrast,
    }
}

const VARIANTS: &[Variant] = &[
    variant(Width::Wide, Theme::Light, Accent::Session, false),
    variant(Width::Wide, Theme::Dark, Accent::Session, false),
    variant(Width::Narrow, Theme::Light, Accent::Session, false),
    variant(Width::Narrow, Theme::Dark, Accent::Session, false),
    variant(Width::Wide, Theme::Light, Accent::Other(0), false),
    variant(Width::Narrow, Theme::Dark, Accent::Other(0), false),
    variant(Width::Wide, Theme::Light, Accent::Other(1), false),
    variant(Width::Narrow, Theme::Dark, Accent::Other(1), false),
    variant(Width::Narrow, Theme::Dark, Accent::Session, true),
    variant(Width::Narrow, Theme::Light, Accent::Session, true),
    variant(Width::Wide, Theme::Dark, Accent::Session, true),
    variant(Width::Wide, Theme::Light, Accent::Session, true),
];

pub(super) fn appearance(h: &mut Harness) -> Result<(), String> {
    let note = note();
    let (_, view) = open_note(h, &note, char_count(&note))?;
    wait_placed(h, &view)?;
    let accents = other_accents(h)?;
    let mut rule_contrast = HashMap::new();
    h.restoring_high_contrast(|h| {
        for variant in VARIANTS {
            let contrast = check_variant(h, &view, variant, &accents)?;
            if matches!(variant.accent, Accent::Session) {
                rule_contrast.insert(
                    (
                        variant.width.name(),
                        variant.theme.name(),
                        variant.high_contrast,
                    ),
                    contrast,
                );
            }
        }
        Ok(())
    })?;
    for width in [Width::Wide, Width::Narrow] {
        for theme in [Theme::Light, Theme::Dark] {
            let normal = rule_contrast[&(width.name(), theme.name(), false)];
            let high = rule_contrast[&(width.name(), theme.name(), true)];
            ensure(high > normal, || {
                format!(
                    "the grid lines differ from the background by {high} in high contrast and by \
                     {normal} without it, {} {}",
                    width.name(),
                    theme.name()
                )
            })?;
        }
    }
    remeasure(h, &view)?;
    h.show_appearance(Width::Wide, Theme::Light, SESSION_ACCENT)
}

fn other_accents(h: &Harness) -> Result<Vec<String>, String> {
    let others: Vec<String> = h
        .accent_ids()?
        .into_iter()
        .filter(|id| id != "system" && id != SESSION_ACCENT)
        .take(2)
        .collect();
    ensure(others.len() == 2, || {
        format!("the core offers {others:?} besides the system and session accents")
    })?;
    Ok(others)
}

/// Shows the note in the variant, checks how the table is painted and returns how far a grid
/// line's colour is from the background.
fn check_variant(
    h: &Harness,
    view: &MarkdownView,
    variant: &Variant,
    accents: &[String],
) -> Result<u32, String> {
    let accent_id = match variant.accent {
        Accent::Session => SESSION_ACCENT,
        Accent::Other(index) => accents[index].as_str(),
    };
    let what = format!(
        "{} {} in the {accent_id} accent{}",
        variant.width.name(),
        variant.theme.name(),
        if variant.high_contrast {
            " with high contrast"
        } else {
            ""
        }
    );
    h.set_high_contrast(variant.high_contrast)?;
    h.wait(&format!("the view's palette for {what}"), || {
        view.testing_high_contrast() == variant.high_contrast
    })?;
    h.show_appearance(variant.width, variant.theme, accent_id)?;
    if variant.width == Width::Narrow {
        split_view(h)?.set_show_content(true);
        h.wait_shown("formatting-bar")?;
    }
    wait_placed(h, view)?;
    let accent = accent_color(h, accent_id, variant.theme)?;
    let window: gtk::Widget = h.window()?.upcast();
    h.wait(&format!("the header rule in the accent, {what}"), || {
        h.render_texture(None)
            .ok()
            .zip(placed(view).ok())
            .and_then(|(texture, placed)| {
                header_rule(
                    &WindowPixels::new(&texture, &window).ok()?,
                    &window,
                    &placed,
                )
                .ok()
            })
            .is_some_and(|pixel| same_color(pixel, accent))
    })?;
    let view_name = if variant.high_contrast {
        "appearance-high-contrast"
    } else {
        "appearance"
    };
    let texture = h.capture_in_accent(view_name, variant.width, variant.theme, accent_id)?;
    let placed = placed(view)?;
    let pixels = WindowPixels::new(&texture, &window)?;
    let rule = header_rule(&pixels, &window, &placed)?;
    ensure(same_color(rule, accent), || {
        format!("the header rule is {rule:?}, not the accent {accent:?}, {what}")
    })?;
    check_band(view, &placed, &what)?;
    let background = pixels.dominant(&to_window(
        view.upcast_ref(),
        &window,
        &graphene::Rect::new(
            2.0,
            placed.rect.y() + 2.0,
            placed.rect.x() - 4.0,
            placed.rect.height() - 4.0,
        ),
    )?)?;
    check_no_surface(&pixels, &window, &placed.shown.widget, background, &what)?;
    if variant.width == Width::Narrow {
        check_words(&placed.shown.widget, &what)?;
    }
    let line = pixels.at(&vertical_rule(&window, &placed.shown.widget)?)?;
    Ok(distance(line, background))
}

fn accent_color(h: &Harness, id: &str, theme: Theme) -> Result<gdk::RGBA, String> {
    let accent = h
        .accent(id)?
        .ok_or_else(|| format!("the {id} accent has no colours"))?;
    let hex = match theme {
        Theme::Light => accent.light,
        Theme::Dark => accent.dark,
    }
    .ok_or_else(|| format!("the {id} accent has no {} colour", theme.name()))?;
    gdk::RGBA::parse(hex.as_str())
        .map_err(|error| format!("cannot parse the accent {hex}: {error}"))
}

fn same_color(pixel: [u8; 4], color: gdk::RGBA) -> bool {
    let channels = [color.red(), color.green(), color.blue()];
    pixel
        .iter()
        .zip(channels)
        .all(|(&drawn, wanted)| (f32::from(drawn) - wanted * 255.0).abs() <= 1.0)
}

fn distance(a: [u8; 4], b: [u8; 4]) -> u32 {
    a.iter()
        .zip(b)
        .take(3)
        .map(|(&a, b)| u32::from(a.abs_diff(b)))
        .sum()
}

/// The header rule's pixel under the middle of the first column.
fn header_rule(
    pixels: &WindowPixels,
    window: &gtk::Widget,
    placed: &Placed,
) -> Result<[u8; 4], String> {
    let widget = &placed.shown.widget;
    let cell = cell_bounds(widget, 0, 0)?;
    let point = graphene::Point::new(cell.center().x(), cell.y() + cell.height() + 0.5);
    pixels.at(&to_window_point(widget.upcast_ref(), window, &point)?)
}

/// A point on the vertical line between the first two columns, in the first body row.
fn vertical_rule(window: &gtk::Widget, widget: &TableWidget) -> Result<graphene::Point, String> {
    let cell = cell_bounds(widget, 1, 0)?;
    let point = graphene::Point::new(cell.x() + cell.width() + 0.5, cell.center().y());
    to_window_point(widget.upcast_ref(), window, &point)
}

fn check_band(view: &MarkdownView, placed: &Placed, what: &str) -> Result<(), String> {
    let widget = &placed.shown.widget;
    let grid = widget.grid_bounds();
    ensure(grid.width() <= widget.width() as f32, || {
        format!(
            "the grid is {} wide, wider than its {} wide widget, {what}",
            grid.width(),
            widget.width()
        )
    })?;
    let right = placed.rect.x() + placed.rect.width();
    let band = text_right(view);
    ensure((right - band).abs() <= 1.0, || {
        format!("the table ends at {right}, not at the band's end {band}, {what}")
    })
}

/// Every cell's left padding and the empty cell show the editor background: the table paints no
/// surface of its own.
fn check_no_surface(
    pixels: &WindowPixels,
    window: &gtk::Widget,
    widget: &TableWidget,
    background: [u8; 4],
    what: &str,
) -> Result<(), String> {
    let padding = TableLayoutMetrics::default().cell_padding_x as f32;
    let table = widget.table();
    for row in 0..table.row_count() {
        for column in 0..table.column_count() {
            let cell = cell_bounds(widget, row, column)?;
            let strip = if (row, column) == EMPTY_CELL {
                cell.inset_r(2.0, 2.0)
            } else {
                graphene::Rect::new(
                    cell.x() + 2.0,
                    cell.y() + 2.0,
                    padding - 4.0,
                    cell.height() - 4.0,
                )
            };
            let drawn = pixels.dominant(&to_window(widget.upcast_ref(), window, &strip)?)?;
            ensure(drawn == background, || {
                format!(
                    "cell {row},{column} shows {drawn:?} at {}, not the background {background:?}, \
                     {what}",
                    describe(&strip)
                )
            })?;
        }
    }
    Ok(())
}

/// No cell breaks a word apart, except the long URL, which has to wrap.
fn check_words(widget: &TableWidget, what: &str) -> Result<(), String> {
    let mut url_seen = false;
    for label in descendants(widget.upcast_ref())
        .into_iter()
        .filter_map(|item| item.downcast::<gtk::Label>().ok())
    {
        if label.label() == LONG_URL {
            url_seen = true;
            ensure(label.layout().line_count() > 1, || {
                format!("the long URL does not wrap, {what}")
            })?;
            continue;
        }
        let widest = widest_word(&label);
        ensure(label.width() >= widest, || {
            format!(
                "{:?} is {} wide, narrower than its widest word ({widest}), {what}",
                label.label(),
                label.width()
            )
        })?;
    }
    ensure(url_seen, || format!("the table shows no long URL, {what}"))
}

fn to_window_point(
    widget: &gtk::Widget,
    window: &gtk::Widget,
    point: &graphene::Point,
) -> Result<graphene::Point, String> {
    widget
        .compute_point(window, point)
        .ok_or_else(|| format!("{} is not inside the window", widget.type_().name()))
}

fn to_window(
    widget: &gtk::Widget,
    window: &gtk::Widget,
    rect: &graphene::Rect,
) -> Result<graphene::Rect, String> {
    let origin = to_window_point(widget, window, &graphene::Point::new(rect.x(), rect.y()))?;
    Ok(graphene::Rect::new(
        origin.x(),
        origin.y(),
        rect.width(),
        rect.height(),
    ))
}

/// The table's rows follow a note font change, a larger text size and a narrower window, and
/// come back once each is undone.
fn remeasure(h: &Harness, view: &MarkdownView) -> Result<(), String> {
    h.set_high_contrast(false)?;
    h.show_appearance(Width::Wide, Theme::Light, SESSION_ACCENT)?;
    let baseline = row_heights(&wait_placed(h, view)?);

    let original = current_font(view)?;
    let other = if original == "lora" { "inter" } else { "lora" };
    // The two fonts' rows differ by a single pixel, inside the geometry tolerance, so the font
    // checks compare rows exactly.
    restoring(
        || {
            let _ = h.change_setting(FONT_SETTING, &original);
        },
        || {
            h.change_setting(FONT_SETTING, other)?;
            wait_for_font(h, view, other)?;
            wait_rows(
                h,
                view,
                &format!("the rows to follow the {other} font"),
                |rows| rows.len() == baseline.len() && rows != baseline.as_slice(),
            )
            .map_err(|error| format!("{error}, from {baseline:?}"))
            .map(|_| ())
        },
    )?;
    wait_for_font(h, view, &original)?;
    wait_rows(
        h,
        view,
        "the rows to come back with the note font",
        |rows| rows == baseline.as_slice(),
    )?;

    let settings = gtk::Settings::default().ok_or("there are no GTK settings")?;
    let dpi = settings.gtk_xft_dpi();
    restoring(
        || settings.set_gtk_xft_dpi(dpi),
        || {
            settings.set_gtk_xft_dpi(SCALED_XFT_DPI);
            wait_rows(h, view, "the rows to grow with the text size", |rows| {
                taller(rows, &baseline)
            })
            .map(|_| ())
        },
    )?;
    wait_rows(
        h,
        view,
        "the rows to shrink back with the text size",
        |rows| same_rows(rows, &baseline),
    )?;

    h.resize(Width::Narrow)?;
    split_view(h)?.set_show_content(true);
    h.wait_shown("formatting-bar")?;
    wait_rows(h, view, "the rows to grow in the narrow window", |rows| {
        rows.len() == baseline.len() && rows.iter().sum::<f64>() > baseline.iter().sum::<f64>()
    })?;
    h.resize(Width::Wide)?;
    wait_rows(
        h,
        view,
        "the rows to shrink back in the wide window",
        |rows| same_rows(rows, &baseline),
    )
    .map(|_| ())
}

fn current_font(view: &MarkdownView) -> Result<String, String> {
    match font_classes(view).as_slice() {
        [class] => class
            .strip_prefix(FONT_CLASS_PREFIX)
            .map(str::to_owned)
            .ok_or_else(|| format!("{class} is not a note font class")),
        classes => Err(format!("the view has the font classes {classes:?}")),
    }
}

/// Waits until the placed table's rows satisfy `wanted` and its overlay is as tall as its grid.
fn wait_rows(
    h: &Harness,
    view: &MarkdownView,
    description: &str,
    wanted: impl Fn(&[f64]) -> bool,
) -> Result<Placed, String> {
    let last = RefCell::new(Vec::new());
    let placed = wait_placed_where(h, view, description, |placed| {
        let rows = row_heights(placed);
        let matches = wanted(&rows);
        last.replace(rows);
        matches
    })
    .map_err(|error| format!("{error}; the rows are {:?}", last.borrow()))?;
    let grid = placed.shown.widget.grid_bounds().height();
    ensure((placed.rect.height() - grid).abs() <= 1.0, || {
        format!(
            "the overlay is {} tall for a {grid} tall grid once {description}",
            placed.rect.height()
        )
    })?;
    Ok(placed)
}

fn row_heights(placed: &Placed) -> Vec<f64> {
    placed
        .shown
        .widget
        .geometry()
        .map(|geometry| geometry.row_heights.clone())
        .unwrap_or_default()
}

fn same_rows(rows: &[f64], baseline: &[f64]) -> bool {
    rows.len() == baseline.len()
        && rows
            .iter()
            .zip(baseline)
            .all(|(row, base)| (row - base).abs() <= 1.0)
}

fn taller(rows: &[f64], baseline: &[f64]) -> bool {
    rows.len() == baseline.len() && rows.iter().zip(baseline).all(|(row, base)| row > base)
}
