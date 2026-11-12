use std::cell::{Cell, RefCell};
use std::rc::Rc;

use commitnote_markdown::{LayoutRect, TableGeometry, TableLayout, TableLayoutItem};
use gtk4::subclass::prelude::*;
use gtk4::{self as gtk, gdk, glib, prelude::*};

use super::TableWidget;
use super::cell::place;

mod imp {
    use super::*;

    #[derive(Default)]
    pub struct TableLayoutManager {
        pub(super) band_width: Cell<Option<i32>>,
        pub(super) geometry: RefCell<Option<Rc<TableGeometry>>>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for TableLayoutManager {
        const NAME: &'static str = "CommitnoteTableLayoutManager";
        type Type = super::TableLayoutManager;
        type ParentType = gtk::LayoutManager;
    }

    impl ObjectImpl for TableLayoutManager {}

    impl LayoutManagerImpl for TableLayoutManager {
        fn request_mode(&self, _widget: &gtk::Widget) -> gtk::SizeRequestMode {
            gtk::SizeRequestMode::HeightForWidth
        }

        fn measure(
            &self,
            widget: &gtk::Widget,
            orientation: gtk::Orientation,
            for_size: i32,
        ) -> (i32, i32, i32, i32) {
            let Some(table) = widget.downcast_ref::<TableWidget>() else {
                return (0, 0, -1, -1);
            };
            let measured = TableMeasure::new(table);
            match orientation {
                gtk::Orientation::Horizontal => {
                    let (minimum, natural) = match self.band_width.get() {
                        Some(band) => (band, band),
                        None => (measured.width_at(0.0), measured.width_at(f64::INFINITY)),
                    };
                    (minimum, natural, -1, -1)
                }
                _ => {
                    let width = if for_size >= 0 {
                        for_size
                    } else {
                        self.band_width
                            .get()
                            .unwrap_or_else(|| measured.width_at(0.0))
                    };
                    let height = pixels_up(measured.geometry(f64::from(width)).height);
                    (height, height, -1, -1)
                }
            }
        }

        fn allocate(&self, widget: &gtk::Widget, width: i32, _height: i32, _baseline: i32) {
            let Some(table) = widget.downcast_ref::<TableWidget>() else {
                return;
            };
            let geometry = Rc::new(TableMeasure::new(table).geometry(f64::from(width)));
            self.geometry.replace(Some(geometry.clone()));
            for (index, row) in table.rows().iter().enumerate() {
                let Some(row_box) = row_frame(&geometry, index).map(|frame| pixel_rect(&frame))
                else {
                    continue;
                };
                let mut cell_boxes = Vec::with_capacity(row.cells.len());
                for (column, cell) in row.cells.iter().enumerate() {
                    let cell_box = pixel_rect(&geometry.cell_frames[index][column]);
                    cell.set_item_frames(
                        geometry.item_frames[index][column]
                            .iter()
                            .map(|frame| relative(&pixel_rect(frame), &cell_box))
                            .collect(),
                    );
                    cell_boxes.push(relative(&cell_box, &row_box));
                }
                row.part.set_frames(cell_boxes);
                place(row.part.upcast_ref(), &row_box);
            }
        }
    }
}

glib::wrapper! {
    /// Measures a `TableWidget` with `TableLayout` and places its rows, cells and items.
    pub struct TableLayoutManager(ObjectSubclass<imp::TableLayoutManager>)
        @extends gtk::LayoutManager;
}

impl TableLayoutManager {
    /// True when the width changed.
    pub(super) fn set_band_width(&self, width: i32) -> bool {
        self.imp().band_width.replace(Some(width)) != Some(width)
    }

    /// The geometry of the last allocation.
    pub(super) fn geometry(&self) -> Option<Rc<TableGeometry>> {
        self.imp().geometry.borrow().clone()
    }
}

/// The table's layout items, read once for one measure or allocation.
struct TableMeasure<'a> {
    table: &'a TableWidget,
    layout: TableLayout,
    items: Vec<Vec<Vec<TableLayoutItem>>>,
}

impl<'a> TableMeasure<'a> {
    fn new(table: &'a TableWidget) -> Self {
        let scale = f64::from(table.scale_factor().max(1));
        let items = table
            .rows()
            .iter()
            .map(|row| {
                row.cells
                    .iter()
                    .map(|cell| cell.layout_items(scale))
                    .collect()
            })
            .collect();
        Self {
            table,
            layout: TableLayout::new(table.metrics()),
            items,
        }
    }

    fn width_at(&self, available: f64) -> i32 {
        let columns = self.layout.columns(&self.items, available);
        pixels_up(self.layout.geometry(&self.items, &columns, &[], &[]).width)
    }

    fn geometry(&self, available: f64) -> TableGeometry {
        let rows = self.table.rows();
        let alignments = self.table.alignments();
        self.layout.layout(
            &self.items,
            available,
            &alignments,
            |row, column, item, width| {
                rows[row].cells[column].text_height(item, width.floor() as i32)
            },
        )
    }
}

fn pixels_up(length: f64) -> i32 {
    length.ceil() as i32
}

/// A row's band across the whole grid, in table coordinates.
fn row_frame(geometry: &TableGeometry, row: usize) -> Option<LayoutRect> {
    let first = geometry.cell_frames.get(row)?.first()?;
    Some(LayoutRect {
        x: 0.0,
        y: first.y,
        width: geometry.width,
        height: first.height,
    })
}

/// The rectangle between the rounded edges, so neighbouring rectangles never overlap or leave
/// a gap.
pub(super) fn pixel_rect(rect: &LayoutRect) -> gdk::Rectangle {
    let left = rect.x.round() as i32;
    let top = rect.y.round() as i32;
    gdk::Rectangle::new(
        left,
        top,
        rect.max_x().round() as i32 - left,
        rect.max_y().round() as i32 - top,
    )
}

fn relative(child: &gdk::Rectangle, parent: &gdk::Rectangle) -> gtk::Allocation {
    gtk::Allocation::new(
        child.x() - parent.x(),
        child.y() - parent.y(),
        child.width(),
        child.height(),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Hairline {
    Rule,
    /// The rule under the header row.
    HeaderRule,
}

/// The lines around and between the cells, filling the gaps the cells' pixel rectangles leave.
/// Horizontal lines span the grid; vertical ones run between them, so no two lines overlap.
pub(super) fn hairlines(geometry: &TableGeometry) -> Vec<(gdk::Rectangle, Hairline)> {
    let Some(first_row) = geometry.cell_frames.first().filter(|row| !row.is_empty()) else {
        return Vec::new();
    };
    let width = geometry.width.round() as i32;
    let height = geometry.height.round() as i32;
    let rows: Vec<gdk::Rectangle> = geometry
        .cell_frames
        .iter()
        .filter_map(|row| row.first().map(pixel_rect))
        .collect();
    let row_spans: Vec<(i32, i32)> = rows
        .iter()
        .map(|row| (row.y(), row.y() + row.height()))
        .collect();
    let column_spans: Vec<(i32, i32)> = first_row
        .iter()
        .map(pixel_rect)
        .map(|cell| (cell.x(), cell.x() + cell.width()))
        .collect();
    let horizontal = gaps(&row_spans, height);
    let vertical = gaps(&column_spans, width);
    let mut lines = Vec::with_capacity(horizontal.len() + rows.len() * vertical.len());
    for (index, &(y, thickness)) in horizontal.iter().enumerate() {
        let kind = if index == 1 {
            Hairline::HeaderRule
        } else {
            Hairline::Rule
        };
        lines.push((gdk::Rectangle::new(0, y, width, thickness), kind));
    }
    for row in &rows {
        for &(x, thickness) in &vertical {
            lines.push((
                gdk::Rectangle::new(x, row.y(), thickness, row.height()),
                Hairline::Rule,
            ));
        }
    }
    lines.retain(|(rect, _)| rect.width() > 0 && rect.height() > 0);
    lines
}

/// The gaps before, between and after the sorted `(start, end)` spans within `0..end`, as
/// `(start, length)`.
fn gaps(spans: &[(i32, i32)], end: i32) -> Vec<(i32, i32)> {
    (0..=spans.len())
        .map(|index| {
            let from = index.checked_sub(1).map_or(0, |before| spans[before].1);
            let to = spans.get(index).map_or(end, |span| span.0);
            (from, to - from)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use commitnote_markdown::{TableAlignment, TableLayoutMetrics};

    use super::*;

    fn text(min_width: f64, max_width: f64) -> TableLayoutItem {
        TableLayoutItem::Text {
            min_width,
            max_width,
        }
    }

    fn geometry(available: f64) -> TableGeometry {
        let cells = vec![
            vec![vec![text(20.0, 30.5)], vec![text(10.0, 10.0)]],
            vec![vec![], vec![text(5.0, 12.25)]],
        ];
        TableLayout::new(TableLayoutMetrics::default()).layout(
            &cells,
            available,
            &[TableAlignment::Left, TableAlignment::Right],
            |_, _, _, _| 17.5,
        )
    }

    #[test]
    fn pixel_rectangles_of_neighbours_share_their_rounded_edge() {
        let left = pixel_rect(&LayoutRect {
            x: 1.0,
            y: 0.4,
            width: 10.6,
            height: 2.0,
        });
        let right = pixel_rect(&LayoutRect {
            x: 11.6,
            y: 0.4,
            width: 3.0,
            height: 2.0,
        });

        assert_eq!(left, gdk::Rectangle::new(1, 0, 11, 2));
        assert_eq!(left.x() + left.width(), right.x());
    }

    #[test]
    fn hairlines_fill_every_gap_around_the_cells_once() {
        let geometry = geometry(f64::INFINITY);
        let width = geometry.width.round() as i32;
        let height = geometry.height.round() as i32;
        let lines = hairlines(&geometry);

        let mut covered = vec![0; (width * height) as usize];
        for (rect, _) in &lines {
            for y in rect.y()..rect.y() + rect.height() {
                for x in rect.x()..rect.x() + rect.width() {
                    covered[(y * width + x) as usize] += 1;
                }
            }
        }
        for row in &geometry.cell_frames {
            for cell in row {
                let cell = pixel_rect(cell);
                for y in cell.y()..cell.y() + cell.height() {
                    for x in cell.x()..cell.x() + cell.width() {
                        covered[(y * width + x) as usize] += 1;
                    }
                }
            }
        }

        assert!(covered.iter().all(|&count| count == 1));
    }

    #[test]
    fn only_the_rule_under_the_header_is_the_header_rule() {
        let geometry = geometry(f64::INFINITY);
        let header_bottom = pixel_rect(&geometry.cell_frames[0][0]);

        let headers: Vec<gdk::Rectangle> = hairlines(&geometry)
            .into_iter()
            .filter(|(_, kind)| *kind == Hairline::HeaderRule)
            .map(|(rect, _)| rect)
            .collect();

        assert_eq!(
            headers,
            [gdk::Rectangle::new(
                0,
                header_bottom.y() + header_bottom.height(),
                geometry.width.round() as i32,
                1,
            )]
        );
    }

    #[test]
    fn a_table_without_columns_draws_nothing() {
        let geometry = TableLayout::new(TableLayoutMetrics::default()).layout(
            &[],
            100.0,
            &[],
            |_, _, _, _| 0.0,
        );

        assert!(hairlines(&geometry).is_empty());
    }
}
