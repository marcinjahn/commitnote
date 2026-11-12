mod cell;
mod layout;
mod press;

use std::cell::{Cell, OnceCell, Ref, RefCell};
use std::rc::Rc;
use std::sync::OnceLock;

use commitnote_markdown::{
    RenderedTable, TableAlignment, TableCellPosition, TableGeometry, TableLayoutMetrics,
    TableSelection,
};
use glib::subclass::Signal;
use gtk4::subclass::prelude::*;
use gtk4::{self as gtk, glib, graphene, prelude::*};

use self::cell::{TableCell, TablePart, accessible_index};
use self::layout::{Hairline, TableLayoutManager, hairlines, pixel_rect, selection_rects};
use self::press::{PressOutcome, PressSequence};
use super::image_source::ImageSource;
use super::overlay::{OverlayStyle, RULE_ALPHA, SELECTION_ALPHA, dim};

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
        pub(super) selection: Cell<Option<TableSelection>>,
        pub(super) drag: gtk::GestureDrag,
        pub(super) long_press: gtk::GestureLongPress,
        pub(super) secondary: gtk::GestureClick,
        pub(super) middle: gtk::GestureClick,
        pub(super) press: RefCell<PressSequence>,
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
                selection: Cell::new(None),
                drag: gtk::GestureDrag::new(),
                long_press: gtk::GestureLongPress::new(),
                secondary: gtk::GestureClick::new(),
                middle: gtk::GestureClick::new(),
                press: RefCell::default(),
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
                    Signal::builder("cells-dragged")
                        .param_types([f64::static_type(); 4])
                        .build(),
                    Signal::builder("long-pressed")
                        .param_types([f64::static_type(); 2])
                        .build(),
                    Signal::builder("context-menu-requested")
                        .param_types([f64::static_type(); 2])
                        .build(),
                ]
            })
        }

        fn constructed(&self) {
            self.parent_constructed();
            let widget = self.obj();
            widget.set_focusable(false);
            widget.connect_scale_factor_notify(|widget| widget.queue_resize());
            self.set_up_drag();
            self.set_up_long_press();
            self.set_up_secondary();
            self.set_up_middle();
        }

        fn dispose(&self) {
            self.rows.take();
            while let Some(child) = self.obj().first_child() {
                child.unparent();
            }
        }
    }

    impl TableWidget {
        fn set_up_drag(&self) {
            let drag = &self.drag;
            drag.set_button(gtk::gdk::BUTTON_PRIMARY);
            drag.connect_drag_begin({
                let widget = self.obj().downgrade();
                move |gesture, x, y| {
                    if let Some(widget) = widget.upgrade() {
                        gesture.set_state(gtk::EventSequenceState::Claimed);
                        widget.imp().press.borrow_mut().begin(x, y);
                    }
                }
            });
            drag.connect_drag_update({
                let widget = self.obj().downgrade();
                move |gesture, dx, dy| {
                    if let Some(widget) = widget.upgrade() {
                        let threshold = widget.settings().gtk_dnd_drag_threshold();
                        let outcome = widget.imp().press.borrow_mut().update(dx, dy, threshold);
                        widget.emit_press_outcome(gesture, outcome);
                    }
                }
            });
            drag.connect_drag_end({
                let widget = self.obj().downgrade();
                move |gesture, dx, dy| {
                    if let Some(widget) = widget.upgrade() {
                        let threshold = widget.settings().gtk_dnd_drag_threshold();
                        let outcome = widget.imp().press.borrow_mut().end(dx, dy, threshold);
                        widget.emit_press_outcome(gesture, outcome);
                    }
                }
            });
            drag.connect_cancel({
                let widget = self.obj().downgrade();
                move |_, _| {
                    if let Some(widget) = widget.upgrade() {
                        widget.imp().press.borrow_mut().cancel();
                    }
                }
            });
            self.obj().add_controller(drag.clone());
        }

        fn set_up_long_press(&self) {
            let long_press = &self.long_press;
            long_press.set_touch_only(true);
            long_press.group_with(&self.drag);
            long_press.connect_pressed({
                let widget = self.obj().downgrade();
                move |gesture, x, y| {
                    if let Some(widget) = widget.upgrade() {
                        gesture.set_state(gtk::EventSequenceState::Claimed);
                        let outcome = widget.imp().press.borrow_mut().long_press(x, y);
                        widget.emit_press_outcome(gesture, outcome);
                    }
                }
            });
            self.obj().add_controller(long_press.clone());
        }

        fn set_up_secondary(&self) {
            let secondary = &self.secondary;
            secondary.set_button(gtk::gdk::BUTTON_SECONDARY);
            secondary.connect_pressed({
                let widget = self.obj().downgrade();
                move |gesture, _, x, y| {
                    if let Some(widget) = widget.upgrade() {
                        gesture.set_state(gtk::EventSequenceState::Claimed);
                        widget.emit_by_name::<()>("context-menu-requested", &[&x, &y]);
                    }
                }
            });
            self.obj().add_controller(secondary.clone());
        }

        /// Claims middle presses so that neither the view's middle-click paste nor its hit test of
        /// the table's room runs.
        fn set_up_middle(&self) {
            let middle = &self.middle;
            middle.set_button(gtk::gdk::BUTTON_MIDDLE);
            middle.connect_pressed(|gesture, _, _, _| {
                gesture.set_state(gtk::EventSequenceState::Claimed);
            });
            self.obj().add_controller(middle.clone());
        }
    }

    impl WidgetImpl for TableWidget {
        fn snapshot(&self, snapshot: &gtk::Snapshot) {
            let geometry = self.obj().table_layout().geometry();
            let style = self.style.get();
            if let Some(geometry) = &geometry {
                let tint = dim(style.accent, SELECTION_ALPHA.pick(style.high_contrast));
                for rect in selection_rects(geometry, self.selection.get()) {
                    snapshot.append_color(&tint, &graphene_rect(&rect));
                }
            }
            self.parent_snapshot(snapshot);
            let Some(geometry) = geometry else {
                return;
            };
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

    pub fn selection(&self) -> Option<TableSelection> {
        self.imp().selection.get()
    }

    /// Tints the selected cells and marks them selected for assistive technology. The positions
    /// must lie inside the table.
    pub fn set_selection(&self, selection: Option<TableSelection>) {
        if self.imp().selection.replace(selection) == selection {
            return;
        }
        for (row, contents) in self.rows().iter().enumerate() {
            for (column, cell) in contents.cells.iter().enumerate() {
                let position = TableCellPosition { row, column };
                cell.set_selected(selection.is_some_and(|selection| selection.contains(position)));
            }
        }
        self.queue_draw();
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

    /// Runs for each move of a primary press past the drag threshold, and for its release, with the
    /// press and the current point in widget coordinates.
    pub fn connect_cells_dragged<F: Fn(&Self, (f64, f64), (f64, f64)) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_local("cells-dragged", false, move |args| {
            let widget = args[0].get::<Self>().ok()?;
            let from = (args[1].get::<f64>().ok()?, args[2].get::<f64>().ok()?);
            let to = (args[3].get::<f64>().ok()?, args[4].get::<f64>().ok()?);
            f(&widget, from, to);
            None
        })
    }

    /// Runs when a touch is held on the table before it moves, with its point in widget
    /// coordinates.
    pub fn connect_long_pressed<F: Fn(&Self, f64, f64) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_point_signal("long-pressed", f)
    }

    /// Runs on a secondary press, with its point in widget coordinates.
    pub fn connect_context_menu_requested<F: Fn(&Self, f64, f64) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_point_signal("context-menu-requested", f)
    }

    fn connect_point_signal<F: Fn(&Self, f64, f64) + 'static>(
        &self,
        name: &str,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_local(name, false, move |args| {
            let widget = args[0].get::<Self>().ok()?;
            let x = args[1].get::<f64>().ok()?;
            let y = args[2].get::<f64>().ok()?;
            f(&widget, x, y);
            None
        })
    }

    fn emit_press_outcome(
        &self,
        gesture: &impl IsA<gtk::EventController>,
        outcome: Option<PressOutcome>,
    ) {
        match outcome {
            Some(PressOutcome::Click { x, y }) => {
                let control = gesture
                    .current_event_state()
                    .contains(gtk::gdk::ModifierType::CONTROL_MASK);
                self.emit_by_name::<()>("clicked", &[&x, &y, &control]);
            }
            Some(PressOutcome::Drag { from, to }) => {
                self.emit_by_name::<()>("cells-dragged", &[&from.0, &from.1, &to.0, &to.1]);
            }
            Some(PressOutcome::LongPress { x, y }) => {
                self.emit_by_name::<()>("long-pressed", &[&x, &y]);
            }
            None => {}
        }
    }

    /// The layout of the last allocation, in the widget's coordinates.
    pub fn geometry(&self) -> Option<Rc<TableGeometry>> {
        self.table_layout().geometry()
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
