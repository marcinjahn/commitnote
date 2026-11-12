use std::cell::Cell;
use std::rc::Rc;

use commitnote::editor::{EditorImage, ImageSource, OverlayStyle, TableWidget};
use commitnote_markdown::{RenderedTable, TableLayoutMetrics, parse, render, rendered_table};
use gtk4::{self as gtk, gdk, glib, graphene, pango, prelude::*};

use crate::support::{Case, Harness, assert_named, assert_relation, assert_role, descendants};

pub const CASES: &[Case] = &[("tables-widget", table_widget)];

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
    let document = parse(text);
    let runs = render(&document, &[]).runs;
    let table = document
        .tables()
        .into_iter()
        .next()
        .ok_or("the text has no table")?;
    rendered_table(&document, &table, &runs).ok_or_else(|| "the table does not render".to_owned())
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
