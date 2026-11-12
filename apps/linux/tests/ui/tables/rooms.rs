use std::cell::Cell;
use std::ops::RangeInclusive;
use std::rc::Rc;

use commitnote::editor::{MarkdownView, OverlayKind};
use gtk4::{self as gtk, gdk, graphene, prelude::*};
use libadwaita as adw;

use super::paging::{landing_row, page_landing};
use super::{
    HEADER, Host, IMAGE_ID, PAGE_COLUMN, SwitchableImages, WINDOW_WIDTH, focus_view, offset_in,
    page_table, press_in, table_chars, wait_caret,
};
use crate::flows::ensure;
use crate::support::{Harness, WindowPixels, restoring};

const SCROLLER_HEIGHT: i32 = 300;
const ROOM_TABLES: [&str; 5] = [
    "the top-level table",
    "the table in a quote",
    "the table in a list item",
    "the table right before a heading",
    "the table that ends the note",
];
const IMAGE_LINE: &str = "![cat](image:";
const IMAGE_COLOR: [u8; 4] = [40, 120, 200, 255];
const ROOM_FRACTIONS: [f64; 4] = [0.0, 0.25, 0.5, 0.75];
const LINES_ABOVE_PAGED_TABLE: usize = 8;
const PAGED_TABLE_ROWS: usize = 20;

/// An image line with a long line under it, then one table at the top level, in a quote, in a list
/// item, right before a heading and at the very end with no line break after it.
fn rooms_note() -> String {
    format!(
        "Intro line above the tables.\n\n\
         {IMAGE_LINE}{IMAGE_ID}) caption\n\
         A line of more than sixty visible characters right below the image line.\n\n\
         | Top | Qty |\n| --- | --- |\n| tea | 2 |\n| jam | 3 |\n\n\
         > | Quoted | Qty |\n> | --- | --- |\n> | milk | 1 |\n\n\
         - Item holding a table:\n\n  | Listed | Qty |\n  | --- | --- |\n  | bread | 4 |\n\n\
         | Before | Heading |\n| --- | --- |\n| salt | 5 |\n\
         ## Heading right after a table\n\n\
         | End | Qty |\n| --- | --- |\n| rice | 6 |\n| oats | 7 |"
    )
}

/// The space a table widget takes, or an image below its line's text, in buffer coordinates, and
/// the buffer lines a hit test inside it may answer.
struct Room {
    what: &'static str,
    top: i32,
    bottom: i32,
    lines: RangeInclusive<i32>,
}

/// A read-only view that scrolls itself, as the shared version page holds one.
fn self_scrolling(text: &str, images: Option<Rc<SwitchableImages>>) -> (Host, MarkdownView) {
    let view = MarkdownView::new();
    if let Some(images) = images {
        view.set_image_source(Some(images));
    }
    let buffer = view.buffer();
    buffer.set_text(text);
    buffer.place_cursor(&buffer.start_iter());
    let scroller = gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Never)
        .child(&view)
        .build();
    let host = Host(
        gtk::Window::builder()
            .default_width(WINDOW_WIDTH)
            .default_height(SCROLLER_HEIGHT)
            .child(&scroller)
            .build(),
    );
    host.0.present();
    (host, view)
}

/// Hit tests every room of a self-scrolling view at several heights, through GTK and through the
/// view's own pointer handling, then scrolls each visible edge into each room and draws.
pub(super) fn room_hits(h: &mut Harness) -> Result<(), String> {
    let images = Rc::new(SwitchableImages::new());
    images.ready.set(true);
    let (host, view) = self_scrolling(&rooms_note(), Some(images));
    let mut last = String::new();
    h.wait(
        "every table and the image to take their room",
        || match rooms(&view) {
            Ok(_) => true,
            Err(error) => {
                last = error;
                false
            }
        },
    )
    .map_err(|error| format!("{error}: {last}"))?;
    let rooms = rooms(&view)?;
    for room in &rooms {
        hit_room(&view, room)?;
    }
    let image = rooms
        .iter()
        .find(|room| room.what == "the image")
        .ok_or("the note has no image room")?;
    let centre = to_widget(&view, image_x(&view)?, (image.top + image.bottom) / 2);
    ensure(
        view.testing_overlay_at(centre.0, centre.1) == Some(OverlayKind::Image),
        || "a press on the image's middle does not hit the image".to_owned(),
    )?;
    for room in &rooms {
        let mut drawn = false;
        for edge in [Edge::Top, Edge::Bottom] {
            drawn |= draw_with_edge_in(h, &host, &view, room, edge)?;
        }
        ensure(drawn, || {
            format!(
                "no visible edge can be scrolled into the room of {}",
                room.what
            )
        })?;
    }
    image_painted_below_top_edge(h, &host, &view)?;
    drop(host);
    Ok(())
}

/// Every table's and the image's room, once each table widget sits on its overlay.
fn rooms(view: &MarkdownView) -> Result<Vec<Room>, String> {
    let shown = view.shown_tables();
    ensure(shown.len() == ROOM_TABLES.len(), || {
        format!("{} of {} tables are shown", shown.len(), ROOM_TABLES.len())
    })?;
    let buffer = view.buffer();
    let last_line = buffer.end_iter().line();
    let table_rects: Vec<graphene::Rect> = view
        .overlay_rects()
        .into_iter()
        .filter(|(kind, _)| *kind == OverlayKind::Table)
        .map(|(_, rect)| rect)
        .collect();
    let mut rooms = Vec::with_capacity(ROOM_TABLES.len() + 1);
    for ((what, table), rect) in ROOM_TABLES.into_iter().zip(&shown).zip(&table_rects) {
        ensure(
            table.widget.is_mapped() && table.widget.geometry().is_some(),
            || format!("{what} is not shown yet"),
        )?;
        let bounds = table
            .widget
            .compute_bounds(view)
            .ok_or_else(|| format!("{what} has no bounds in the view"))?;
        ensure((bounds.y() - rect.y()).abs() <= 1.0, || {
            format!("{what} is not on its overlay yet")
        })?;
        let chars = table_chars(view, table)?;
        let header = buffer.iter_at_offset(chars.start).line();
        let end_line = buffer.iter_at_offset(chars.end).line();
        let (_, top) = to_buffer(view, 0.0, bounds.y());
        let (_, bottom) = to_buffer(view, 0.0, bounds.y() + bounds.height());
        rooms.push(Room {
            what,
            top,
            bottom,
            lines: header..=(end_line + 1).min(last_line),
        });
    }
    let [image]: [graphene::Rect; 1] = view
        .overlay_rects()
        .into_iter()
        .filter(|(kind, _)| *kind == OverlayKind::Image)
        .map(|(_, rect)| rect)
        .collect::<Vec<_>>()
        .try_into()
        .map_err(|rects: Vec<graphene::Rect>| format!("{} image overlays", rects.len()))?;
    ensure(image.height() > 0.0, || {
        "the image has no room yet".to_owned()
    })?;
    let image_line = buffer.iter_at_offset(offset_in(&super::view_text(view), IMAGE_LINE)?);
    let (_, bottom) = to_buffer(view, 0.0, image.y() + image.height());
    rooms.push(room_below(
        view,
        "the image",
        &image_line,
        bottom,
        image_line.line() + 1,
    )?);
    Ok(rooms)
}

/// The room from the bottom of `line`'s first display line down to the buffer height `bottom`.
fn room_below(
    view: &MarkdownView,
    what: &'static str,
    line: &gtk::TextIter,
    bottom: i32,
    last_answer: i32,
) -> Result<Room, String> {
    let location = view.iter_location(line);
    let top = location.y() + location.height();
    ensure(bottom > top + 2, || {
        format!("{what} has no room below its first line: {top}..{bottom}")
    })?;
    Ok(Room {
        what,
        top,
        bottom,
        lines: line.line()..=last_answer,
    })
}

fn hit_room(view: &MarkdownView, room: &Room) -> Result<(), String> {
    let visible = view.visible_rect();
    let left = view.iter_location(&view.buffer().start_iter()).x();
    let xs = [
        left + 1,
        visible.x() + visible.width() / 2,
        visible.x() + visible.width() - 2,
    ];
    let height = f64::from(room.bottom - room.top);
    let ys = ROOM_FRACTIONS
        .iter()
        .map(|fraction| room.top + (height * fraction) as i32)
        .chain([room.bottom - 1]);
    for y in ys {
        for x in xs {
            let answers = [
                (
                    "iter_at_location",
                    view.iter_at_location(x, y).map(|at| at.line()),
                ),
                (
                    "iter_at_position",
                    view.iter_at_position(x, y).map(|(at, _)| at.line()),
                ),
                ("line_at_y", Some(view.line_at_y(y).0.line())),
            ];
            for (call, line) in answers {
                ensure(line.is_none_or(|line| room.lines.contains(&line)), || {
                    format!(
                        "{call} at {x},{y} in the room of {} answered line {line:?}, not one of \
                         {:?}",
                        room.what, room.lines
                    )
                })?;
            }
            let (wx, wy) = to_widget(view, x, y);
            ensure(!view.handle_primary_press(wx, wy, true), || {
                format!(
                    "Ctrl+click at {x},{y} in the room of {} opened a link",
                    room.what
                )
            })?;
            ensure(view.toggle_at_point(wx, wy).is_none(), || {
                format!(
                    "a click at {x},{y} in the room of {} ran a command",
                    room.what
                )
            })?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
enum Edge {
    Top,
    Bottom,
}

/// Scrolls so the visible area's `edge` lies in the middle of the room, then waits for the view
/// to draw twice and draws the window once more by hand. Says whether the scroll range lets the
/// edge reach the room.
fn draw_with_edge_in(
    h: &Harness,
    host: &Host,
    view: &MarkdownView,
    room: &Room,
    edge: Edge,
) -> Result<bool, String> {
    let middle = (room.top + room.bottom) / 2;
    let top = match edge {
        Edge::Top => middle,
        Edge::Bottom => middle - view.visible_rect().height(),
    };
    let scrolled = scroll_to(h, host, view, top)
        .map_err(|error| format!("scrolling the {edge:?} edge into {}: {error}", room.what))?;
    if scrolled {
        render(&host.0)?;
    }
    Ok(scrolled)
}

/// Scrolls the visible area's top to the buffer height `top` and waits for two painted frames;
/// says whether the scroll range reaches that height.
fn scroll_to(h: &Harness, host: &Host, view: &MarkdownView, top: i32) -> Result<bool, String> {
    let adjustment = view
        .vadjustment()
        .ok_or("the view has no vertical adjustment")?;
    let offset = adjustment.value() - f64::from(view.visible_rect().y());
    let target = f64::from(top) + offset;
    if target < adjustment.lower() || target > adjustment.upper() - adjustment.page_size() {
        return Ok(false);
    }
    adjustment.set_value(target);
    ensure(view.visible_rect().y() == top, || {
        format!(
            "the visible area starts at {}, not {top}",
            view.visible_rect().y()
        )
    })?;
    let clock = host
        .0
        .frame_clock()
        .ok_or("the window has no frame clock")?;
    let painted = Rc::new(Cell::new(0_u32));
    let handler = clock.connect_after_paint({
        let painted = painted.clone();
        move |_| painted.set(painted.get() + 1)
    });
    let result = h.wait("the view to draw twice", || {
        if painted.get() < 2 {
            view.queue_draw();
        }
        painted.get() >= 2
    });
    clock.disconnect(handler);
    result.map(|()| true)
}

/// With the visible top inside the image, the image's visible part is still painted.
fn image_painted_below_top_edge(
    h: &Harness,
    host: &Host,
    view: &MarkdownView,
) -> Result<(), String> {
    let image = image_rect(view)?;
    let (_, top) = to_buffer(view, 0.0, image.y());
    let height = image.height() as i32;
    ensure(scroll_to(h, host, view, top + height / 4)?, || {
        "the visible top cannot reach the image".to_owned()
    })?;
    let texture = render(&host.0)?;
    let pixels = WindowPixels::new(&texture, &host.0)?;
    let image = image_rect(view)?;
    let point = view
        .compute_point(
            &host.0,
            &graphene::Point::new(
                image.x() + image.width() / 2.0,
                image.y() + image.height() * 3.0 / 4.0,
            ),
        )
        .ok_or("the view is not inside its window")?;
    let color = pixels.at(&point)?;
    ensure(color == IMAGE_COLOR, || {
        format!(
            "with the visible top inside the image, its lower part shows {color:?}, not the image"
        )
    })
}

/// Where the image is painted, in widget coordinates.
fn image_rect(view: &MarkdownView) -> Result<graphene::Rect, String> {
    view.overlay_rects()
        .into_iter()
        .find(|(kind, _)| *kind == OverlayKind::Image)
        .map(|(_, rect)| rect)
        .ok_or_else(|| "the note has no image overlay".to_owned())
}

/// The buffer x of the image's middle.
fn image_x(view: &MarkdownView) -> Result<i32, String> {
    let image = image_rect(view)?;
    Ok(to_buffer(view, image.x() + image.width() / 2.0, 0.0).0)
}

fn to_buffer(view: &MarkdownView, x: f32, y: f32) -> (i32, i32) {
    view.window_to_buffer_coords(gtk::TextWindowType::Widget, x as i32, y as i32)
}

fn to_widget(view: &MarkdownView, x: i32, y: i32) -> (f64, f64) {
    let (x, y) = view.buffer_to_window_coords(gtk::TextWindowType::Widget, x, y);
    (f64::from(x), f64::from(y))
}

/// Draws the window through its own renderer, outside the frame cycle.
fn render(window: &gtk::Window) -> Result<gdk::Texture, String> {
    let (width, height) = (window.width(), window.height());
    let snapshot = gtk::Snapshot::new();
    gtk::WidgetPaintable::new(Some(window)).snapshot(
        &snapshot,
        f64::from(width),
        f64::from(height),
    );
    let node = snapshot.to_node().ok_or("the window drew nothing")?;
    let renderer = window.renderer().ok_or("the window has no renderer")?;
    let viewport = graphene::Rect::new(0.0, 0.0, width as f32, height as f32);
    Ok(renderer.render_texture(&node, Some(&viewport)))
}

fn page_paragraph() -> String {
    (1..=4)
        .map(|line| format!("Line {line} of the paragraph beside the table."))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Pages down from a paragraph line in an editable view that scrolls itself, landing inside a
/// table's room, and expects the caret on the row at the landing height.
pub(super) fn room_paging(h: &mut Harness) -> Result<(), String> {
    let above: String = (1..=LINES_ABOVE_PAGED_TABLE)
        .map(|line| format!("Line {line} above the table.\n"))
        .collect();
    let note = format!(
        "{above}\n{}\n\n{}",
        page_table(PAGED_TABLE_ROWS),
        page_paragraph()
    );
    let (host, view) = self_scrolling(&note, None);
    view.set_editable(true);
    view.set_cursor_visible(true);
    h.wait("the paged table to show", || {
        view.shown_tables()
            .first()
            .is_some_and(|shown| shown.widget.is_mapped() && shown.widget.geometry().is_some())
    })?;
    let (caret, row) = page_start(&view)?;
    super::place_caret(&view, caret);
    focus_view(h, &view)?;
    press_in(h, &view, "Page_Down")?;
    let header = offset_in(&note, HEADER)?;
    let buffer = view.buffer();
    let header_line = buffer.iter_at_offset(header).line();
    let line = header_line + if row == 0 { 0 } else { row as i32 + 1 };
    let target = buffer
        .iter_at_line(line)
        .ok_or_else(|| format!("the table has no line {line}"))?
        .offset()
        + PAGE_COLUMN;
    wait_caret(
        h,
        &view,
        &format!("Page_Down to put the caret on row {row} at the goal column"),
        target,
    )?;
    drop(host);
    Ok(())
}

/// A caret offset on a line above the table from which a page down lands well inside a body
/// row's cell, and that row, with the view scrolled to its top.
fn page_start(view: &MarkdownView) -> Result<(i32, usize), String> {
    let adjustment = view
        .vadjustment()
        .ok_or("the view has no vertical adjustment")?;
    adjustment.set_value(adjustment.lower());
    let shown = view
        .shown_tables()
        .into_iter()
        .next()
        .ok_or("no table is shown")?;
    let buffer = view.buffer();
    for line in 0..LINES_ABOVE_PAGED_TABLE as i32 {
        let Some(start) = buffer.iter_at_line(line) else {
            continue;
        };
        let mut caret = start;
        caret.forward_chars(PAGE_COLUMN);
        if let Some(row) = landing_row(&shown, page_landing(view, &caret, 1, &adjustment)) {
            return Ok((caret.offset(), row));
        }
    }
    Err("no line above the table pages down into the middle of a body row".to_owned())
}

const PAINT_INTRO: &str = "Intro line above the table.";
const PAINT_TABLE: &str = "| Paint | Qty |\n| --- | --- |\n| tea | 2 |\n| jam | 3 |";
const FENCE_AFTER: &str = "```text\ncode\n```";
const HEADING_AFTER: &str = "## After";
/// How far the sampled strips stay from the table widget, the text edge and the room's edges.
const PAINT_INSET: f32 = 6.0;
const PAINT_STRIPS: usize = 6;
const PAINT_STRIP_HEIGHT: f32 = 3.0;
const DARK_LUMINANCE: f32 = 0.35;

/// Behind a transparent table widget the line right after the table paints nothing: neither a
/// code fence's background nor a selection that starts on that line, in the light and the dark
/// scheme.
pub(super) fn room_paint(h: &mut Harness) -> Result<(), String> {
    let style_manager = adw::StyleManager::default();
    let original = style_manager.color_scheme();
    restoring(
        || style_manager.set_color_scheme(original),
        || {
            for (scheme, dark) in [
                (adw::ColorScheme::ForceLight, false),
                (adw::ColorScheme::ForceDark, true),
            ] {
                style_manager.set_color_scheme(scheme);
                h.wait(&format!("the {scheme:?} scheme"), || {
                    style_manager.is_dark() == dark
                })?;
                room_clear_after(h, dark, FENCE_AFTER, false)?;
                room_clear_after(h, dark, HEADING_AFTER, true)?;
            }
            Ok(())
        },
    )
}

/// Shows a table followed directly by `after`, selecting `after`'s first line from its start
/// when `select` is set, and expects the room beside the grid to show the view's background
/// while that line itself shows its code background or selection.
fn room_clear_after(h: &Harness, dark: bool, after: &str, select: bool) -> Result<(), String> {
    let note = format!("{PAINT_INTRO}\n\n{PAINT_TABLE}\n{after}\nClosing line.");
    let what = format!(
        "the table followed by {after:?}{} in the {} scheme",
        if select { ", selected" } else { "" },
        if dark { "dark" } else { "light" }
    );
    let (host, view) = self_scrolling(&note, None);
    view.set_cursor_visible(false);
    h.activate(&host.0)?;
    focus_view(h, &view)?;
    let buffer = view.buffer();
    let next = buffer.iter_at_offset(offset_in(&note, after)?);
    if select {
        let mut end = next;
        end.forward_line();
        buffer.select_range(&end, &next);
    }
    h.wait(&format!("{what} to be placed"), || {
        table_on_overlay(&view).is_some()
    })?;
    let intro = line_strip(&view, &buffer.start_iter())?;
    let line = line_strip(&view, &next)?;
    let mut drawn = None;
    let mut last = String::new();
    h.wait(&format!("{what} to be drawn"), || {
        match drawn_colors(&host, &view, &intro, &line) {
            Ok((background, painted))
                if painted != background
                    && is_dark(background) == dark
                    && buffer.has_selection() == select =>
            {
                drawn = Some(background);
                true
            }
            Ok(colors) => {
                let selected = buffer
                    .selection_bounds()
                    .map(|(start, end)| start.offset()..end.offset());
                last = format!(
                    "background and the line after: {colors:?}, selection {selected:?}, \
                     focused {}",
                    view.has_focus()
                );
                false
            }
            Err(error) => {
                last = error;
                false
            }
        }
    })
    .map_err(|error| format!("{error}: {last}"))?;
    let background = drawn.ok_or("nothing was drawn")?;
    let (widget, grid) = table_on_overlay(&view).ok_or("the table left its overlay")?;
    let pixels = WindowPixels::new(&render(&host.0)?, &host.0)?;
    let left = widget.x() + grid.width() + PAINT_INSET;
    let right = text_right(&view) - PAINT_INSET;
    ensure(right - left > PAINT_INSET, || {
        format!("{what} leaves no room beside its grid")
    })?;
    let span = widget.height() - 2.0 * PAINT_INSET - PAINT_STRIP_HEIGHT;
    for strip in 0..PAINT_STRIPS {
        let y = widget.y() + PAINT_INSET + span * strip as f32 / (PAINT_STRIPS - 1) as f32;
        let area = in_window(
            &host,
            &view,
            graphene::Rect::new(left, y, right - left, PAINT_STRIP_HEIGHT),
        )?;
        let color = pixels.dominant(&area)?;
        ensure(color == background, || {
            format!(
                "beside {what}, {:.0} px below the widget's top, the room shows {color:?}, not \
                 the background {background:?}",
                y - widget.y()
            )
        })?;
    }
    drop(host);
    Ok(())
}

/// The table widget's bounds in view coordinates and its grid's bounds in its own, once it sits
/// on its overlay.
fn table_on_overlay(view: &MarkdownView) -> Option<(graphene::Rect, graphene::Rect)> {
    let shown = view.shown_tables();
    let [table] = shown.as_slice() else {
        return None;
    };
    let overlay = view
        .overlay_rects()
        .into_iter()
        .find(|(kind, _)| *kind == OverlayKind::Table)?
        .1;
    let bounds = table.widget.compute_bounds(view)?;
    (table.widget.is_mapped() && (bounds.y() - overlay.y()).abs() <= 1.0)
        .then(|| (bounds, table.widget.grid_bounds()))
}

/// A strip of `line`'s text height at the right of the text area, in view coordinates.
fn line_strip(view: &MarkdownView, line: &gtk::TextIter) -> Result<graphene::Rect, String> {
    let location = view.iter_location(line);
    let (x, y) = to_widget(view, 0, location.y());
    let right = text_right(view);
    let left = right - 4.0 * PAINT_INSET;
    ensure(left > x as f32, || "the view is too narrow".to_owned())?;
    Ok(graphene::Rect::new(
        left,
        y as f32 + 1.0,
        right - PAINT_INSET - left,
        location.height() as f32 - 2.0,
    ))
}

/// The right edge of the text area, in view coordinates.
pub(super) fn text_right(view: &MarkdownView) -> f32 {
    let visible = view.visible_rect();
    let (x, _) = to_widget(view, visible.x() + visible.width() - view.right_margin(), 0);
    x as f32
}

fn in_window(
    host: &Host,
    view: &MarkdownView,
    area: graphene::Rect,
) -> Result<graphene::Rect, String> {
    view.compute_bounds(&host.0)
        .map(|bounds| area.offset_r(bounds.x(), bounds.y()))
        .ok_or_else(|| "the view is not inside its window".to_owned())
}

/// The intro line's background and the dominant color of the line right after the table.
fn drawn_colors(
    host: &Host,
    view: &MarkdownView,
    intro: &graphene::Rect,
    line: &graphene::Rect,
) -> Result<([u8; 4], [u8; 4]), String> {
    let pixels = WindowPixels::new(&render(&host.0)?, &host.0)?;
    Ok((
        pixels.dominant(&in_window(host, view, *intro)?)?,
        pixels.dominant(&in_window(host, view, *line)?)?,
    ))
}

fn is_dark([red, green, blue, _]: [u8; 4]) -> bool {
    let luminance =
        (0.2126 * f32::from(red) + 0.7152 * f32::from(green) + 0.0722 * f32::from(blue)) / 255.0;
    luminance < DARK_LUMINANCE
}
