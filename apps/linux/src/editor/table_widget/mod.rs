mod cell;
mod layout;

use std::cell::{Cell, OnceCell, Ref, RefCell};
use std::sync::OnceLock;

use commitnote_markdown::{RenderedTable, TableAlignment, TableLayoutMetrics};
use glib::subclass::Signal;
use gtk4::subclass::prelude::*;
use gtk4::{self as gtk, glib, graphene, prelude::*};

use self::cell::{TableCell, TablePart, accessible_index};
use self::layout::{Hairline, TableLayoutManager, hairlines, pixel_rect};
use super::image_source::ImageSource;
use super::overlay::{OverlayStyle, RULE_ALPHA, dim};

const ACCESSIBLE_NAME: &str = "Table";

struct TableRow {
    part: TablePart,
    cells: Vec<TableCell>,
}

mod imp {
    use super::*;

    pub struct TableWidget {
        pub(super) table: OnceCell<RenderedTable>,
        pub(super) style: Cell<OverlayStyle>,
        pub(super) rows: RefCell<Vec<TableRow>>,
        pub(super) click: gtk::GestureClick,
        pub(super) pressed_at: Cell<Option<(f64, f64)>>,
    }

    impl Default for TableWidget {
        fn default() -> Self {
            Self {
                table: OnceCell::new(),
                style: Cell::new(OverlayStyle {
                    foreground: gtk::gdk::RGBA::BLACK,
                    accent: gtk::gdk::RGBA::BLACK,
                    line_height: 0.0,
                    high_contrast: false,
                }),
                rows: RefCell::default(),
                click: gtk::GestureClick::new(),
                pressed_at: Cell::new(None),
            }
        }
    }

    #[glib::object_subclass]
    impl ObjectSubclass for TableWidget {
        const NAME: &'static str = "CommitnoteTableWidget";
        type Type = super::TableWidget;
        type ParentType = gtk::Widget;

        fn class_init(klass: &mut Self::Class) {
            klass.set_css_name("rendered-table");
            klass.set_accessible_role(gtk::AccessibleRole::Table);
            klass.set_layout_manager_type::<TableLayoutManager>();
        }
    }

    impl ObjectImpl for TableWidget {
        fn signals() -> &'static [Signal] {
            static SIGNALS: OnceLock<Vec<Signal>> = OnceLock::new();
            SIGNALS.get_or_init(|| {
                vec![
                    Signal::builder("clicked")
                        .param_types([f64::static_type(), f64::static_type(), bool::static_type()])
                        .build(),
                ]
            })
        }

        fn constructed(&self) {
            self.parent_constructed();
            let widget = self.obj();
            widget.set_focusable(false);
            widget.connect_scale_factor_notify(|widget| widget.queue_resize());
            self.set_up_click();
        }

        fn dispose(&self) {
            self.rows.take();
            while let Some(child) = self.obj().first_child() {
                child.unparent();
            }
        }
    }

    impl TableWidget {
        fn set_up_click(&self) {
            let click = &self.click;
            click.set_button(gtk::gdk::BUTTON_PRIMARY);
            click.connect_pressed({
                let widget = self.obj().downgrade();
                move |gesture, _, x, y| {
                    if let Some(widget) = widget.upgrade() {
                        widget.imp().pressed_at.set(Some((x, y)));
                        gesture.set_state(gtk::EventSequenceState::Claimed);
                    }
                }
            });
            click.connect_released({
                let widget = self.obj().downgrade();
                move |gesture, _, x, y| {
                    let Some(widget) = widget.upgrade() else {
                        return;
                    };
                    let Some(pressed_at) = widget.imp().pressed_at.take() else {
                        return;
                    };
                    let threshold = widget.settings().gtk_dnd_drag_threshold();
                    if within_drag_threshold(pressed_at, (x, y), threshold) {
                        let control = gesture
                            .current_event_state()
                            .contains(gtk::gdk::ModifierType::CONTROL_MASK);
                        widget.emit_by_name::<()>("clicked", &[&x, &y, &control]);
                    }
                }
            });
            click.connect_cancel({
                let widget = self.obj().downgrade();
                move |_, _| {
                    if let Some(widget) = widget.upgrade() {
                        widget.imp().pressed_at.set(None);
                    }
                }
            });
            self.obj().add_controller(click.clone());
        }
    }

    impl WidgetImpl for TableWidget {
        fn snapshot(&self, snapshot: &gtk::Snapshot) {
            self.parent_snapshot(snapshot);
            let widget = self.obj();
            let Some(geometry) = widget.table_layout().geometry() else {
                return;
            };
            let style = self.style.get();
            let rule = dim(style.foreground, RULE_ALPHA.pick(style.high_contrast));
            for (rect, kind) in hairlines(&geometry) {
                let color = match kind {
                    Hairline::Rule => &rule,
                    Hairline::HeaderRule => &style.accent,
                };
                snapshot.append_color(color, &graphene_rect(&rect));
            }
        }
    }
}

glib::wrapper! {
    /// One rendered table: a hairline grid of wrapping labels and pictures.
    pub struct TableWidget(ObjectSubclass<imp::TableWidget>)
        @extends gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl TableWidget {
    pub fn new(
        table: RenderedTable,
        style: &OverlayStyle,
        source: Option<&dyn ImageSource>,
    ) -> Self {
        let widget: Self = glib::Object::new();
        let imp = widget.imp();
        imp.style.set(*style);
        let alignments = table.alignments();
        let rows: Vec<TableRow> = table
            .rows
            .iter()
            .enumerate()
            .map(|(row, contents)| {
                let part = TablePart::new(gtk::AccessibleRole::Row);
                part.update_relation(&[gtk::accessible::Relation::RowIndex(accessible_index(row))]);
                part.set_parent(&widget);
                let cells = contents
                    .iter()
                    .enumerate()
                    .map(|(column, content)| {
                        let alignment = alignments.get(column).copied().unwrap_or_default();
                        let cell = TableCell::new(content, (row, column), alignment, style, source);
                        cell.part.set_parent(&part);
                        cell
                    })
                    .collect();
                TableRow { part, cells }
            })
            .collect();
        widget.update_property(&[gtk::accessible::Property::Label(ACCESSIBLE_NAME)]);
        widget.update_relation(&[
            gtk::accessible::Relation::RowCount(count(table.row_count())),
            gtk::accessible::Relation::ColCount(count(table.column_count())),
        ]);
        imp.rows.replace(rows);
        imp.table
            .set(table)
            .expect("a new table widget has no table yet");
        widget
    }

    pub fn table(&self) -> RenderedTable {
        self.imp()
            .table
            .get()
            .cloned()
            .expect("a table widget is built with its table")
    }

    /// The width of the band the table spans, reported as both its minimum and natural width.
    pub fn set_band_width(&self, width: i32) {
        if self.table_layout().set_band_width(width) {
            self.queue_resize();
        }
    }

    pub fn set_style(&self, style: &OverlayStyle) {
        let previous = self.imp().style.replace(*style);
        if previous == *style {
            return;
        }
        if (previous.foreground, previous.accent, previous.high_contrast)
            != (style.foreground, style.accent, style.high_contrast)
        {
            for row in self.rows().iter() {
                for cell in &row.cells {
                    cell.apply_style(style);
                }
            }
        }
        if previous.line_height == style.line_height {
            self.queue_draw();
        } else {
            self.queue_resize();
        }
    }

    /// Reads every image's state again and replaces the items of those that changed.
    pub fn refresh_images(&self, source: Option<&dyn ImageSource>) {
        let style = self.imp().style.get();
        let mut changed = false;
        for row in self.imp().rows.borrow_mut().iter_mut() {
            for cell in &mut row.cells {
                changed |= cell.refresh_images(source, &style);
            }
        }
        if changed {
            self.queue_resize();
        }
    }

    pub fn shows_image(&self, image_id: &str) -> bool {
        self.rows()
            .iter()
            .any(|row| row.cells.iter().any(|cell| cell.shows_image(image_id)))
    }

    /// `(row, column)` of the cell under a point in widget coordinates, clamped to the nearest
    /// cell; `None` before the first allocation.
    pub fn cell_at_point(&self, x: f64, y: f64) -> Option<(usize, usize)> {
        self.table_layout().geometry()?.cell_at(x, y)
    }

    /// The link of the text under a point in widget coordinates; `None` off a glyph.
    pub fn link_at_point(&self, x: f64, y: f64) -> Option<String> {
        let (row, column) = self.cell_at_point(x, y)?;
        self.rows()
            .get(row)?
            .cells
            .get(column)?
            .link_at(self.upcast_ref(), x, y)
    }

    /// Runs after a primary click that did not turn into a drag, with the release point in widget
    /// coordinates and whether Control was held.
    pub fn connect_clicked<F: Fn(&Self, f64, f64, bool) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_local("clicked", false, move |args| {
            let widget = args[0].get::<Self>().ok()?;
            let x = args[1].get::<f64>().ok()?;
            let y = args[2].get::<f64>().ok()?;
            let control = args[3].get::<bool>().ok()?;
            f(&widget, x, y, control);
            None
        })
    }

    pub fn cell_bounds(&self, row: usize, column: usize) -> Option<graphene::Rect> {
        let geometry = self.table_layout().geometry()?;
        let frame = geometry.cell_frames.get(row)?.get(column)?;
        Some(graphene_rect(&pixel_rect(frame)))
    }

    /// The grid with its outer border; empty before the first allocation.
    pub fn grid_bounds(&self) -> graphene::Rect {
        self.table_layout()
            .geometry()
            .map_or_else(graphene::Rect::zero, |geometry| {
                graphene::Rect::new(
                    0.0,
                    0.0,
                    geometry.width.round() as f32,
                    geometry.height.round() as f32,
                )
            })
    }

    fn table_layout(&self) -> TableLayoutManager {
        self.layout_manager()
            .and_downcast()
            .expect("a table widget is laid out by its table layout manager")
    }

    fn rows(&self) -> Ref<'_, Vec<TableRow>> {
        self.imp().rows.borrow()
    }

    fn alignments(&self) -> Vec<TableAlignment> {
        self.imp()
            .table
            .get()
            .map(|table| table.alignments().to_vec())
            .unwrap_or_default()
    }

    fn metrics(&self) -> TableLayoutMetrics {
        TableLayoutMetrics {
            empty_line_height: f64::from(self.imp().style.get().line_height),
            ..TableLayoutMetrics::default()
        }
    }
}

/// Whether a release `threshold` pixels or less from its press on both axes is still a click.
fn within_drag_threshold(pressed: (f64, f64), released: (f64, f64), threshold: i32) -> bool {
    let threshold = f64::from(threshold);
    (released.0 - pressed.0).abs() <= threshold && (released.1 - pressed.1).abs() <= threshold
}

fn count(value: usize) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
}

fn graphene_rect(rect: &gtk::gdk::Rectangle) -> graphene::Rect {
    graphene::Rect::new(
        rect.x() as f32,
        rect.y() as f32,
        rect.width() as f32,
        rect.height() as f32,
    )
}

#[cfg(test)]
mod tests {
    use super::within_drag_threshold;

    #[test]
    fn a_release_at_the_press_is_a_click() {
        assert!(within_drag_threshold((10.0, 20.0), (10.0, 20.0), 8));
    }

    #[test]
    fn a_release_up_to_the_threshold_away_on_both_axes_is_a_click() {
        assert!(within_drag_threshold((10.0, 20.0), (18.0, 12.0), 8));
        assert!(within_drag_threshold((10.0, 20.0), (2.0, 28.0), 8));
    }

    #[test]
    fn a_release_past_the_threshold_on_either_axis_is_a_drag() {
        assert!(!within_drag_threshold((10.0, 20.0), (18.5, 20.0), 8));
        assert!(!within_drag_threshold((10.0, 20.0), (10.0, 11.5), 8));
        assert!(!within_drag_threshold((10.0, 20.0), (40.0, 50.0), 8));
    }
}
