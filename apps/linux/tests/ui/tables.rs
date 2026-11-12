use std::cell::Cell;
use std::rc::Rc;

use commitnote::editor::{
    EditorImage, ImageSource, MarkdownView, NoteEditor, OverlayKind, OverlayStyle, ShownTable,
    TableWidget,
};
use commitnote_markdown::{
    Placement, RenderMode, RenderedTable, TableLayoutMetrics, parse, render,
};
use gtk4::{self as gtk, gdk, glib, graphene, pango, prelude::*};

use crate::flows::{ensure, launch_and_log_in, split_view};
use crate::p2::{caret, set_note_text};
use crate::p4::{WELCOME, open_editor, view_shared_version};
use crate::support::{
    Case, Harness, NARROW_VARIANTS, WIDE_LIGHT, WIDE_VARIANTS, Width, assert_named,
    assert_relation, assert_role, descendants,
};

pub const CASES: &[Case] = &[
    ("tables-widget", table_widget),
    ("tables-editor-render", editor_render),
    ("tables-editor-reveal", editor_reveal),
    ("tables-editor-shared", editor_shared),
];

const IMAGE_ID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const TABLE: &str = "| Name | Qty | Note |\n| :- | :-: | -: |\n| **Tea** | 2 | [shop](https://e.x/s) |\n| `code` | | ![cat](image:aaaaaaaaaaaaaaaaaaaaaaaaaa) |\n| a | b |";
const LABELS: [[&str; 3]; 4] = [
    ["Name", "Qty", "Note"],
    ["Tea", "2", "shop"],
    ["code", "Empty", "cat"],
    ["a", "b", "Empty"],
];
const IMAGE_CELL: (usize, usize) = (2, 2);
const LINK: &str = "https://e.x/s";
const BAND: i32 = 600;
const NARROW_BAND: i32 = 200;
const WINDOW_WIDTH: i32 = 640;
const WINDOW_HEIGHT: i32 = 480;
const IMAGE_WIDTH: i32 = 64;
const IMAGE_HEIGHT: i32 = 32;

/// Answers `Loading` until switched to ready, then a still image.
struct SwitchableImages {
    ready: Cell<bool>,
    texture: gdk::Texture,
}

impl SwitchableImages {
    fn new() -> Self {
        let pixels = [40_u8, 120, 200, 255].repeat((IMAGE_WIDTH * IMAGE_HEIGHT) as usize);
        let texture = gdk::MemoryTexture::new(
            IMAGE_WIDTH,
            IMAGE_HEIGHT,
            gdk::MemoryFormat::R8g8b8a8,
            &glib::Bytes::from_owned(pixels),
            IMAGE_WIDTH as usize * 4,
        );
        Self {
            ready: Cell::new(false),
            texture: texture.upcast(),
        }
    }
}

impl ImageSource for SwitchableImages {
    fn image(&self, image_id: &str) -> EditorImage {
        if !self.ready.get() || image_id != IMAGE_ID {
            return EditorImage::Loading;
        }
        EditorImage::Ready {
            width: IMAGE_WIDTH as u32,
            height: IMAGE_HEIGHT as u32,
            frames: Rc::from([(self.texture.clone(), 0)]),
        }
    }
}

/// Destroys the window however the case ends.
struct Host(gtk::Window);

impl Drop for Host {
    fn drop(&mut self) {
        self.0.destroy();
    }
}

fn table_widget(harness: &mut Harness) -> Result<(), String> {
    let images = SwitchableImages::new();
    let source: &dyn ImageSource = &images;
    let table = TableWidget::new(rendered(TABLE)?, &style(), Some(source));
    table.set_band_width(BAND);
    table.set_halign(gtk::Align::Start);
    table.set_valign(gtk::Align::Start);
    let host = Host(
        gtk::Window::builder()
            .default_width(WINDOW_WIDTH)
            .default_height(WINDOW_HEIGHT)
            .child(&table)
            .build(),
    );
    host.0.present();
    harness.wait("the table to be allocated at the band width", || {
        allocated_at(&table, BAND)
    })?;

    check_width(&table)?;
    check_accessibility(&table)?;
    check_cell_hits(&table)?;
    check_links(&table)?;
    check_image(harness, &table, &images)?;
    check_narrow_band(harness, &table)?;
    check_not_focusable(&table)?;
    drop(host);
    Ok(())
}

fn rendered(text: &str) -> Result<RenderedTable, String> {
    render(&parse(text), &[], RenderMode::Editable)
        .placements
        .into_iter()
        .find_map(|placement| match placement {
            Placement::Table { table } => Some(table),
            _ => None,
        })
        .ok_or_else(|| "the text renders no table".to_owned())
}

fn style() -> OverlayStyle {
    OverlayStyle {
        foreground: gdk::RGBA::new(0.1, 0.1, 0.1, 1.0),
        accent: gdk::RGBA::new(0.2, 0.4, 0.9, 1.0),
        line_height: 17.0,
        high_contrast: false,
    }
}

fn allocated_at(table: &TableWidget, band: i32) -> bool {
    let grid = table.grid_bounds();
    table.is_mapped() && table.width() == band && grid.width() > 0.0 && grid.width() <= band as f32
}

fn check_width(table: &TableWidget) -> Result<(), String> {
    let (minimum, natural, _, _) = table.measure(gtk::Orientation::Horizontal, -1);
    if (minimum, natural) != (BAND, BAND) {
        return Err(format!(
            "the table measures {minimum}..{natural} wide, not the band width {BAND}"
        ));
    }
    let grid = table.grid_bounds().width();
    if grid > BAND as f32 {
        return Err(format!(
            "the grid is {grid} wide, wider than the band {BAND}"
        ));
    }
    Ok(())
}

fn check_accessibility(table: &TableWidget) -> Result<(), String> {
    assert_role(table, gtk::AccessibleRole::Table)?;
    assert_named(table, "Table")?;
    assert_relation(
        table,
        gtk::ffi::GTK_ACCESSIBLE_RELATION_ROW_COUNT,
        LABELS.len() as i32,
    )?;
    assert_relation(
        table,
        gtk::ffi::GTK_ACCESSIBLE_RELATION_COL_COUNT,
        LABELS[0].len() as i32,
    )?;
    let rows = children(table);
    if rows.len() != LABELS.len() {
        return Err(format!(
            "the table has {} rows, not {}",
            rows.len(),
            LABELS.len()
        ));
    }
    for (row_index, (row, labels)) in rows.iter().zip(LABELS).enumerate() {
        let position = row_index as i32 + 1;
        assert_role(row, gtk::AccessibleRole::Row)?;
        assert_relation(row, gtk::ffi::GTK_ACCESSIBLE_RELATION_ROW_INDEX, position)?;
        let cells = children(row);
        if cells.len() != labels.len() {
            return Err(format!(
                "row {position} has {} cells, not {}",
                cells.len(),
                labels.len()
            ));
        }
        let role = if row_index == 0 {
            gtk::AccessibleRole::ColumnHeader
        } else {
            gtk::AccessibleRole::Cell
        };
        for (column_index, (cell, label)) in cells.iter().zip(labels).enumerate() {
            assert_role(cell, role)?;
            assert_relation(cell, gtk::ffi::GTK_ACCESSIBLE_RELATION_ROW_INDEX, position)?;
            assert_relation(
                cell,
                gtk::ffi::GTK_ACCESSIBLE_RELATION_COL_INDEX,
                column_index as i32 + 1,
            )?;
            assert_named(cell, label)?;
        }
    }
    Ok(())
}

fn check_cell_hits(table: &TableWidget) -> Result<(), String> {
    for (row, labels) in LABELS.iter().enumerate() {
        for column in 0..labels.len() {
            let centre = cell_bounds(table, row, column)?.center();
            let hit = table.cell_at_point(f64::from(centre.x()), f64::from(centre.y()));
            if hit != Some((row, column)) {
                return Err(format!("the centre of cell {row},{column} hits {hit:?}"));
            }
        }
    }
    let grid = table.grid_bounds();
    if grid.width() >= BAND as f32 {
        return Err(format!("the grid fills the band, {} wide", grid.width()));
    }
    let beside = (grid.width() + BAND as f32) / 2.0;
    let last_column = LABELS[0].len() - 1;
    for row in 0..LABELS.len() {
        let y = cell_bounds(table, row, 0)?.center().y();
        let hit = table.cell_at_point(f64::from(beside), f64::from(y));
        if hit != Some((row, last_column)) {
            return Err(format!(
                "a point beside the grid in row {row} hits {hit:?}, not the row's last cell"
            ));
        }
    }
    Ok(())
}

fn check_links(table: &TableWidget) -> Result<(), String> {
    let shop = glyph_centre(table, &label_with(table, "shop")?)?;
    let link = table.link_at_point(f64::from(shop.x()), f64::from(shop.y()));
    if link.as_deref() != Some(LINK) {
        return Err(format!("the shop label links to {link:?}, not {LINK}"));
    }
    let tea = glyph_centre(table, &label_with(table, "Tea")?)?;
    let link = table.link_at_point(f64::from(tea.x()), f64::from(tea.y()));
    if link.is_some() {
        return Err(format!("the Tea label links to {link:?}"));
    }
    Ok(())
}

fn check_image(
    harness: &Harness,
    table: &TableWidget,
    images: &SwitchableImages,
) -> Result<(), String> {
    let (row, column) = IMAGE_CELL;
    if !table.shows_image(IMAGE_ID) {
        return Err("the table does not show the image".to_owned());
    }
    let placeholder = children(&cell(table, row, column)?)
        .into_iter()
        .find_map(|item| item.downcast::<gtk::Label>().ok())
        .ok_or("the loading image shows no label")?;
    if placeholder.label() != "cat" {
        return Err(format!(
            "the loading image shows {:?}, not its alt text",
            placeholder.label()
        ));
    }
    let alpha = foreground_alpha(&placeholder).ok_or("the loading image label is not muted")?;
    if alpha >= i32::from(u16::MAX) {
        return Err(format!("the loading image label is opaque (alpha {alpha})"));
    }
    let loading_height = cell_bounds(table, row, column)?.height();

    images.ready.set(true);
    let source: &dyn ImageSource = images;
    table.refresh_images(Some(source));
    harness.wait("the image cell to show the picture and grow", || {
        let shown = picture_in(table, row, column).is_some_and(|picture| picture.height() > 0);
        let height = table
            .cell_bounds(row, column)
            .map_or(0.0, |bounds| bounds.height());
        shown && height > loading_height
    })?;
    let picture = picture_in(table, row, column).ok_or("the image cell lost its picture")?;
    if picture.alternative_text().as_deref() != Some("cat") {
        return Err(format!(
            "the picture's alternative text is {:?}",
            picture.alternative_text()
        ));
    }
    Ok(())
}

fn check_narrow_band(harness: &Harness, table: &TableWidget) -> Result<(), String> {
    table.set_band_width(NARROW_BAND);
    harness.wait("the table to be allocated at the narrow band width", || {
        allocated_at(table, NARROW_BAND)
    })?;
    let padding = TableLayoutMetrics::default().cell_padding_x as f32;
    for (row, part) in children(table).iter().enumerate() {
        for (column, cell) in children(part).iter().enumerate() {
            let content = cell_bounds(table, row, column)?.width() - 2.0 * padding;
            for label in children(cell)
                .into_iter()
                .filter_map(|item| item.downcast::<gtk::Label>().ok())
            {
                let widest = widest_word(&label);
                if widest as f32 > content {
                    continue;
                }
                if label.width() < widest {
                    return Err(format!(
                        "{:?} in cell {row},{column} is {} wide, narrower than its widest word ({widest})",
                        label.label(),
                        label.width()
                    ));
                }
                let (needed, _, _, _) = label.measure(gtk::Orientation::Vertical, label.width());
                if label.height() < needed {
                    return Err(format!(
                        "{:?} in cell {row},{column} is {} tall, shorter than its text ({needed})",
                        label.label(),
                        label.height()
                    ));
                }
            }
        }
    }
    Ok(())
}

fn check_not_focusable(table: &TableWidget) -> Result<(), String> {
    let focusable = std::iter::once(table.clone().upcast::<gtk::Widget>())
        .chain(descendants(table.upcast_ref()))
        .find(|widget| widget.is_focusable());
    match focusable {
        Some(widget) => Err(format!("{} is focusable", widget.type_().name())),
        None => Ok(()),
    }
}

fn children(widget: &impl IsA<gtk::Widget>) -> Vec<gtk::Widget> {
    std::iter::successors(widget.first_child(), |child| child.next_sibling()).collect()
}

fn cell(table: &TableWidget, row: usize, column: usize) -> Result<gtk::Widget, String> {
    children(table)
        .get(row)
        .and_then(|part| children(part).get(column).cloned())
        .ok_or_else(|| format!("the table has no cell {row},{column}"))
}

fn cell_bounds(table: &TableWidget, row: usize, column: usize) -> Result<graphene::Rect, String> {
    table
        .cell_bounds(row, column)
        .ok_or_else(|| format!("cell {row},{column} has no bounds"))
}

fn picture_in(table: &TableWidget, row: usize, column: usize) -> Option<gtk::Picture> {
    children(&cell(table, row, column).ok()?)
        .into_iter()
        .find_map(|item| item.downcast::<gtk::Picture>().ok())
}

fn label_with(table: &TableWidget, text: &str) -> Result<gtk::Label, String> {
    descendants(table.upcast_ref())
        .into_iter()
        .filter_map(|widget| widget.downcast::<gtk::Label>().ok())
        .find(|label| label.label() == text)
        .ok_or_else(|| format!("the table shows no label {text:?}"))
}

/// The centre of the label's second glyph, in the table's coordinates.
fn glyph_centre(table: &TableWidget, label: &gtk::Label) -> Result<graphene::Point, String> {
    let (left, top) = label.layout_offsets();
    let glyph = label.layout().index_to_pos(1);
    let scale = pango::SCALE as f32;
    let point = graphene::Point::new(
        left as f32 + (glyph.x() as f32 + glyph.width() as f32 / 2.0) / scale,
        top as f32 + (glyph.y() as f32 + glyph.height() as f32 / 2.0) / scale,
    );
    label
        .compute_point(table, &point)
        .ok_or_else(|| format!("{:?} is not inside the table", label.label()))
}

fn foreground_alpha(label: &gtk::Label) -> Option<i32> {
    label
        .attributes()?
        .attributes()
        .iter()
        .filter(|attribute| attribute.type_() == pango::AttrType::ForegroundAlpha)
        .find_map(|attribute| {
            attribute
                .downcast_ref::<pango::AttrInt>()
                .map(pango::AttrInt::value)
        })
}

fn widest_word(label: &gtk::Label) -> i32 {
    let layout = label.layout().copy();
    layout.set_wrap(pango::WrapMode::Word);
    layout.set_width(1);
    layout.pixel_size().0
}

const NOTE: &str = "Intro paragraph above the table.\n\n| Item | Qty | Note |\n| :-- | :-: | --: |\n| **Tea** | 2 | a \\| b |\n| `code` | | *soft* |\n| short |\n\nClosing paragraph below the table.";
const HEADER: &str = "| Item | Qty | Note |";
const QTY: &str = "| 2 |";
const NEW_QTY: &str = "7";
const ESCAPED_PIPE_CELL: &str = "a | b";
const TYPED_ABOVE: &str = "A line typed above.\n";
const TABLE_SOURCE_TAG: &str = "preview-table-source-line";
const SHARED_VERSION_TEXT: &str = "shared-version-text";

/// Counts the view's `tables-changed` emissions while it lives.
struct TableChanges {
    view: MarkdownView,
    count: Rc<Cell<u32>>,
    handler: Option<glib::SignalHandlerId>,
}

impl TableChanges {
    fn new(view: &MarkdownView) -> Self {
        let count = Rc::new(Cell::new(0));
        let handler = view.connect_tables_changed({
            let count = count.clone();
            move |_| count.set(count.get() + 1)
        });
        Self {
            view: view.clone(),
            count,
            handler: Some(handler),
        }
    }

    fn expect(&self, total: u32, what: &str) -> Result<(), String> {
        let count = self.count.get();
        ensure(count == total, || {
            format!("after {what}, tables-changed was emitted {count} times in all, not {total}")
        })
    }
}

impl Drop for TableChanges {
    fn drop(&mut self) {
        if let Some(handler) = self.handler.take() {
            self.view.disconnect(handler);
        }
    }
}

/// The shown table and its overlay rect, once the widget sits on that rect.
struct Placed {
    shown: ShownTable,
    rect: graphene::Rect,
}

fn editor_render(h: &mut Harness) -> Result<(), String> {
    let (editor, view) = open_note(h, offset_in(NOTE, QTY)?)?;
    wait_revealed(h, &view)?;
    let above = lines_above_table(&view)?;

    place_caret(&view, char_count(NOTE));
    let wide = wait_placed(h, &view)?;
    ensure(lines_above_table(&view)? == above, || {
        "rendering the table moved the lines above it".to_owned()
    })?;
    label_with(&wide.shown.widget, ESCAPED_PIPE_CELL)?;
    ensure(editor.text() == NOTE, || {
        format!(
            "rendering the table changed the text to {:?}",
            editor.text()
        )
    })?;
    h.session_screenshots("editor", WIDE_VARIANTS)?;

    h.resize(Width::Narrow)?;
    split_view(h)?.set_show_content(true);
    h.wait_shown("formatting-bar")?;
    let narrow = wait_placed(h, &view)?;
    ensure(narrow.rect.width() < wide.rect.width(), || {
        format!(
            "the table overlay is {} wide in the narrow window and {} in the wide one",
            narrow.rect.width(),
            wide.rect.width()
        )
    })?;
    h.session_screenshots("editor", NARROW_VARIANTS)?;
    ensure(editor.text() == NOTE, || {
        format!("showing the table changed the text to {:?}", editor.text())
    })?;
    h.resize(Width::Wide)
}

fn editor_reveal(h: &mut Harness) -> Result<(), String> {
    let (editor, view) = open_note(h, char_count(NOTE))?;
    let shown = wait_placed(h, &view)?;
    let changes = TableChanges::new(&view);

    place_caret(&view, table_line_offset(&view, 1)?);
    wait_revealed(h, &view)?;
    changes.expect(1, "putting the caret on the second table line")?;

    place_caret(&view, char_count(&editor.text()));
    let back = wait_placed(h, &view)?;
    ensure(same_rect(&back.rect, &shown.rect), || {
        format!(
            "the table came back at {} instead of {}",
            describe(&back.rect),
            describe(&shown.rect)
        )
    })?;
    changes.expect(2, "moving the caret below the table")?;

    let buffer = view.buffer();
    let into_first_line = table_line_offset(&view, 0)? + 2;
    buffer.select_range(
        &buffer.iter_at_offset(into_first_line),
        &buffer.iter_at_offset(0),
    );
    wait_revealed(h, &view)?;
    changes.expect(3, "selecting from above into the first table line")?;

    place_caret(&view, char_count(&editor.text()));
    let before = wait_placed(h, &view)?;
    changes.expect(4, "moving the caret below the table again")?;

    edit(&view, 0, 0, TYPED_ABOVE);
    let moved = wait_placed_where(h, &view, "the table widget to move down", |placed| {
        placed.shown.origin.1 > before.shown.origin.1
    })?;
    ensure(moved.shown.widget == before.shown.widget, || {
        "typing above the table built a new table widget".to_owned()
    })?;
    ensure(moved.rect.y() > before.rect.y(), || {
        "typing above the table did not move its overlay down".to_owned()
    })?;
    changes.expect(4, "typing above the table")?;

    let caret_before = caret(&editor);
    let qty = offset_in(&editor.text(), QTY)? + 2;
    edit(&view, qty, qty + 1, NEW_QTY);
    let rebuilt = wait_placed_where(h, &view, "a new table widget", |placed| {
        placed.shown.widget != before.shown.widget
    })?;
    label_with(&rebuilt.shown.widget, NEW_QTY)?;
    changes.expect(5, "changing a cell with the caret below the table")?;
    ensure(caret(&editor) == caret_before, || {
        "changing a cell moved the caret".to_owned()
    })?;

    place_caret(&view, table_line_offset(&view, 1)?);
    wait_revealed(h, &view)?;
    changes.expect(6, "putting the caret on the table again")?;
    view.set_editable(false);
    wait_placed(h, &view)?;
    changes.expect(7, "making the view read-only")?;
    view.set_editable(true);
    wait_revealed(h, &view)?;
    drop(changes);

    check_dispose(h)
}

fn editor_shared(h: &mut Harness) -> Result<(), String> {
    open_note(h, char_count(NOTE))?;
    view_shared_version(h)?;
    let view = h.widget_as::<MarkdownView>(SHARED_VERSION_TEXT)?;
    h.wait("the shared version to hold the note", || {
        view_text(&view).contains(NOTE)
    })?;
    ensure(!view.is_editable(), || {
        "the shared version is editable".to_owned()
    })?;
    let shown = wait_placed(h, &view)?;
    let changes = TableChanges::new(&view);

    let line = table_line_offset(&view, 2)?;
    after_render(h, &view, || place_caret(&view, line))?;
    let on_line = wait_placed(h, &view)?;
    ensure(on_line.shown.widget == shown.shown.widget, || {
        "the caret on a table line rebuilt the shared table".to_owned()
    })?;

    let table = table_chars(&view, &on_line.shown)?;
    after_render(h, &view, || {
        let buffer = view.buffer();
        buffer.select_range(
            &buffer.iter_at_offset(table.start),
            &buffer.iter_at_offset(table.end),
        );
    })?;
    let selected = wait_placed(h, &view)?;
    ensure(selected.shown.widget == shown.shown.widget, || {
        "selecting the whole table rebuilt the shared table".to_owned()
    })?;
    changes.expect(0, "moving the caret and selecting in the shared version")?;
    drop(changes);

    h.session_screenshots("shared", WIDE_LIGHT)
}

/// Opens the welcome note, replaces its text with [`NOTE`] and puts the caret at `caret_at`.
fn open_note(h: &Harness, caret_at: i32) -> Result<(NoteEditor, MarkdownView), String> {
    launch_and_log_in(h, false)?;
    let editor = open_editor(h, WELCOME)?;
    set_note_text(&editor, NOTE, caret_at, caret_at);
    h.wait("the editor to hold the note", || editor.text() == NOTE)?;
    let view = editor.view();
    Ok((editor, view))
}

/// Builds a table in a view of its own, then checks the widget has no parent once the view is
/// gone.
fn check_dispose(h: &Harness) -> Result<(), String> {
    let view = MarkdownView::new();
    let buffer = view.buffer();
    buffer.set_text(NOTE);
    buffer.place_cursor(&buffer.end_iter());
    let host = Host(
        gtk::Window::builder()
            .default_width(WINDOW_WIDTH)
            .default_height(WINDOW_HEIGHT)
            .child(&view)
            .build(),
    );
    host.0.present();
    h.wait("the standalone view to show its table", || {
        view.shown_tables()
            .first()
            .is_some_and(|shown| shown.widget.is_mapped())
    })?;
    let widget = table_widgets(&view)
        .pop()
        .ok_or("the standalone view holds no table widget")?;
    let disposed = view.downgrade();
    drop(view);
    drop(host);
    h.wait("the standalone view to be disposed", || {
        disposed.upgrade().is_none()
    })?;
    ensure(widget.parent().is_none(), || {
        "the table widget kept its parent after the view was disposed".to_owned()
    })
}

fn wait_placed(h: &Harness, view: &MarkdownView) -> Result<Placed, String> {
    wait_placed_where(h, view, "the table widget on its overlay", |_| true)
}

/// Waits until one table widget sits on its overlay and satisfies `wanted`, then until the
/// window settles, and checks the placement again.
fn wait_placed_where(
    h: &Harness,
    view: &MarkdownView,
    description: &str,
    wanted: impl Fn(&Placed) -> bool,
) -> Result<Placed, String> {
    let mut last = String::new();
    h.wait(description, || match placed(view) {
        Ok(placed) if wanted(&placed) => true,
        Ok(_) => {
            last = "the placement does not match yet".to_owned();
            false
        }
        Err(error) => {
            last = error;
            false
        }
    })
    .map_err(|error| format!("{error}: {last}"))?;
    h.settle()?;
    let placed = placed(view)?;
    ensure(wanted(&placed), || {
        format!("{description} no longer holds once the window settled")
    })?;
    Ok(placed)
}

fn placed(view: &MarkdownView) -> Result<Placed, String> {
    let [shown]: [ShownTable; 1] = view
        .shown_tables()
        .try_into()
        .map_err(|tables: Vec<ShownTable>| format!("{} tables are shown", tables.len()))?;
    let widgets = table_widgets(view);
    ensure(widgets.len() == 1 && widgets[0] == shown.widget, || {
        format!(
            "the view holds {} table widgets, not just the shown one",
            widgets.len()
        )
    })?;
    let [rect]: [graphene::Rect; 1] = view
        .overlay_rects()
        .into_iter()
        .filter(|(kind, _)| *kind == OverlayKind::Table)
        .map(|(_, rect)| rect)
        .collect::<Vec<_>>()
        .try_into()
        .map_err(|rects: Vec<graphene::Rect>| format!("{} table overlays", rects.len()))?;
    ensure(shown.widget.is_mapped() && rect.height() > 0.0, || {
        "the table widget is not shown yet".to_owned()
    })?;
    let bounds = shown
        .widget
        .compute_bounds(view)
        .ok_or("the table widget has no bounds in the view")?;
    let near = |a: f32, b: f32| (a - b).abs() <= 1.0;
    ensure(
        near(bounds.x(), rect.x())
            && near(bounds.y(), rect.y())
            && near(bounds.width(), rect.width())
            && near(bounds.height(), rect.height()),
        || {
            format!(
                "the table widget is at {}, its overlay at {}",
                describe(&bounds),
                describe(&rect)
            )
        },
    )?;
    let table = table_chars(view, &shown)?;
    let mut next = view.buffer().iter_at_offset(table.end);
    ensure(next.forward_line(), || {
        "no line follows the table".to_owned()
    })?;
    let next_top = line_top(view, &next).0;
    let bottom = rect.y() + rect.height();
    ensure(near(next_top as f32, bottom), || {
        format!("the line after the table starts at {next_top}, not at the overlay bottom {bottom}")
    })?;
    Ok(Placed { shown, rect })
}

fn wait_revealed(h: &Harness, view: &MarkdownView) -> Result<(), String> {
    h.wait("the table source to show", || revealed(view))?;
    h.settle()?;
    ensure(revealed(view), || {
        "the table source did not stay shown once the window settled".to_owned()
    })
}

fn revealed(view: &MarkdownView) -> bool {
    let Ok(second_line) = table_line_offset(view, 1) else {
        return false;
    };
    let source_shown = view
        .buffer()
        .iter_at_offset(second_line)
        .tags()
        .iter()
        .any(|tag| tag.name().as_deref() == Some(TABLE_SOURCE_TAG));
    view.shown_tables().is_empty() && table_widgets(view).is_empty() && source_shown
}

/// Makes a change and waits until the view has rendered since, so a check that nothing changed
/// sees the render that followed.
fn after_render(h: &Harness, view: &MarkdownView, change: impl FnOnce()) -> Result<(), String> {
    let before = view.placements();
    change();
    h.wait("the view to render again", || {
        !Rc::ptr_eq(&before, &view.placements())
    })
}

fn table_widgets(view: &MarkdownView) -> Vec<TableWidget> {
    descendants(view.upcast_ref())
        .into_iter()
        .filter_map(|widget| widget.downcast::<TableWidget>().ok())
        .collect()
}

/// The shown table's text range in buffer characters.
fn table_chars(view: &MarkdownView, shown: &ShownTable) -> Result<std::ops::Range<i32>, String> {
    let parsed = view.parsed().ok_or("the view has not rendered")?;
    let range = shown.table.range();
    Ok(
        parsed.index.utf16_to_char(range.start) as i32
            ..parsed.index.utf16_to_char(range.end) as i32,
    )
}

/// The character offset where the table's line `line` starts in the view's current text.
fn table_line_offset(view: &MarkdownView, line: i32) -> Result<i32, String> {
    let header = offset_in(&view_text(view), HEADER)?;
    let buffer = view.buffer();
    let first = buffer.iter_at_offset(header).line();
    buffer
        .iter_at_line(first + line)
        .map(|iter| iter.offset())
        .ok_or_else(|| format!("the table has no line {line}"))
}

/// The top and height of every line above the table, in widget coordinates.
fn lines_above_table(view: &MarkdownView) -> Result<Vec<(i32, i32)>, String> {
    let buffer = view.buffer();
    let header = buffer.iter_at_offset(table_line_offset(view, 0)?).line();
    (0..header)
        .map(|line| {
            buffer
                .iter_at_line(line)
                .map(|iter| line_top(view, &iter))
                .ok_or_else(|| format!("the note has no line {line}"))
        })
        .collect()
}

fn line_top(view: &MarkdownView, iter: &gtk::TextIter) -> (i32, i32) {
    let (y, height) = view.line_yrange(iter);
    let (_, top) = view.buffer_to_window_coords(gtk::TextWindowType::Widget, 0, y);
    (top, height)
}

fn place_caret(view: &MarkdownView, offset: i32) {
    let buffer = view.buffer();
    buffer.place_cursor(&buffer.iter_at_offset(offset));
}

/// Replaces the characters `from..to` with `text` as one user action.
fn edit(view: &MarkdownView, from: i32, to: i32, text: &str) {
    let buffer = view.buffer();
    buffer.begin_user_action();
    let mut start = buffer.iter_at_offset(from);
    let mut end = buffer.iter_at_offset(to);
    buffer.delete(&mut start, &mut end);
    buffer.insert(&mut start, text);
    buffer.end_user_action();
}

fn view_text(view: &MarkdownView) -> String {
    let buffer = view.buffer();
    let (start, end) = buffer.bounds();
    buffer.text(&start, &end, true).to_string()
}

fn offset_in(text: &str, needle: &str) -> Result<i32, String> {
    text.find(needle)
        .map(|found| char_count(&text[..found]))
        .ok_or_else(|| format!("the text has no {needle:?}"))
}

fn char_count(text: &str) -> i32 {
    text.chars().count() as i32
}

fn same_rect(a: &graphene::Rect, b: &graphene::Rect) -> bool {
    (a.x(), a.y(), a.width(), a.height()) == (b.x(), b.y(), b.width(), b.height())
}

fn describe(rect: &graphene::Rect) -> String {
    format!(
        "{}x{} at {},{}",
        rect.width(),
        rect.height(),
        rect.x(),
        rect.y()
    )
}
