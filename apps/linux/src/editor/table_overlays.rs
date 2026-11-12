use std::cell::RefCell;
use std::rc::Rc;

use commitnote_editor_text::Utf16Index;
use commitnote_markdown::RenderedTable;
use gtk4::subclass::prelude::*;
use gtk4::{self as gtk, glib, graphene, gsk, prelude::*};

use super::image_source::ImageSource;
use super::overlay::{self, HitBehaviour, Overlay, OverlayKind, OverlayStyle, Painter, Reserve};
use super::table_widget::TableWidget;

/// A table widget with the table it shows now, whose ranges and caret offsets follow the text.
#[derive(Debug, Clone)]
pub struct ShownTable {
    pub widget: TableWidget,
    pub table: RenderedTable,
    /// The widget's top-left corner in buffer coordinates.
    pub origin: (i32, i32),
}

/// The horizontal span a table widget takes, in buffer coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TableBand {
    pub x: i32,
    pub width: i32,
}

/// The band inside an overlay rect starting at `left` with `room` pixels, after the list part
/// of the table's prefix, which is `prefix_width` pixels wide.
pub fn band(left: f32, room: f32, prefix_width: i32) -> TableBand {
    TableBand {
        x: left.round() as i32 + prefix_width,
        width: (room.round() as i32 - prefix_width).max(0),
    }
}

/// The room a table `height` pixels tall needs below its first line, which stays in the layout.
pub fn reserve_height(height: i32, line_height: f32) -> f32 {
    (height as f32 - line_height).max(0.0)
}

/// For each wanted table, the current table whose widget it keeps: the first one not yet kept
/// that shows the same content.
pub fn match_tables(current: &[RenderedTable], wanted: &[RenderedTable]) -> Vec<Option<usize>> {
    let mut kept = vec![false; current.len()];
    wanted
        .iter()
        .map(|table| {
            let found = current
                .iter()
                .enumerate()
                .position(|(index, candidate)| !kept[index] && candidate.same_content(table))?;
            kept[found] = true;
            Some(found)
        })
        .collect()
}

/// What a widget was measured for: its overlay, its band and its height at that band.
#[derive(Debug)]
struct Measured {
    overlay: Overlay,
    band: TableBand,
    height: i32,
}

/// Receives a table widget's click, with the release point in widget coordinates and whether
/// Control was held.
type ClickCallback = dyn Fn(&TableWidget, f64, f64, bool);

#[derive(Clone)]
struct ClickHandler(Rc<ClickCallback>);

impl std::fmt::Debug for ClickHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ClickHandler")
    }
}

#[derive(Debug)]
struct Entry {
    widget: TableWidget,
    table: RenderedTable,
    measured: Option<Measured>,
    origin: Option<(i32, i32)>,
}

/// The table widgets of one text view, kept in document order.
#[derive(Debug)]
pub struct TableOverlays {
    layer: TableLayer,
    entries: RefCell<Vec<Entry>>,
    on_click: ClickHandler,
}

impl TableOverlays {
    pub fn new(
        view: &gtk::TextView,
        on_click: impl Fn(&TableWidget, f64, f64, bool) + 'static,
    ) -> Self {
        let layer = TableLayer::default();
        view.add_overlay(&layer, 0, 0);
        Self {
            layer,
            entries: RefCell::default(),
            on_click: ClickHandler(Rc::new(on_click)),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.entries.borrow().is_empty()
    }

    pub fn shown(&self) -> Vec<ShownTable> {
        self.entries
            .borrow()
            .iter()
            .map(|entry| ShownTable {
                widget: entry.widget.clone(),
                table: entry.table.clone(),
                origin: entry.origin.unwrap_or_default(),
            })
            .collect()
    }

    /// Keeps a widget for every wanted table that shows the same content as a current one,
    /// creates the others and removes the rest; says whether any widget was created or removed.
    pub fn update(
        &self,
        wanted: Vec<RenderedTable>,
        style: &OverlayStyle,
        source: Option<&dyn ImageSource>,
    ) -> bool {
        let current: Vec<RenderedTable> = self
            .entries
            .borrow()
            .iter()
            .map(|entry| entry.table.clone())
            .collect();
        let matches = match_tables(&current, &wanted);
        let mut previous: Vec<Option<Entry>> = self.entries.take().into_iter().map(Some).collect();
        let mut changed = false;
        let mut entries = Vec::with_capacity(wanted.len());
        for (table, found) in wanted.into_iter().zip(matches) {
            match found.and_then(|index| previous[index].take()) {
                Some(entry) => {
                    entry.widget.set_style(style);
                    entries.push(Entry { table, ..entry });
                }
                None => {
                    let widget = TableWidget::new(table.clone(), style, source);
                    let ClickHandler(on_click) = self.on_click.clone();
                    widget.connect_clicked(move |widget, x, y, control| {
                        on_click(widget, x, y, control);
                    });
                    self.layer.put(&widget);
                    changed = true;
                    entries.push(Entry {
                        widget,
                        table,
                        measured: None,
                        origin: None,
                    });
                }
            }
        }
        for entry in previous.into_iter().flatten() {
            self.layer.remove(&entry.widget);
            changed = true;
        }
        self.entries.replace(entries);
        changed
    }

    /// Gives every widget its band, hiding those without room, and returns the overlays that
    /// reserve room for them.
    pub fn overlays(
        &self,
        view: &gtk::TextView,
        index: &Utf16Index,
        style: &OverlayStyle,
    ) -> Vec<Overlay> {
        let painter: Painter = Rc::new(|_, _, _| {});
        let mut entries = self.entries.borrow_mut();
        entries
            .iter_mut()
            .map(|entry| {
                let range = entry.table.range();
                let mut overlay = Overlay {
                    kind: OverlayKind::Table,
                    range: index.utf16_to_char(range.start)..index.utf16_to_char(range.end),
                    reserve: Reserve::Block { height: 0.0 },
                    slot: None,
                    painter: painter.clone(),
                    hit: HitBehaviour::Inert,
                };
                let (band, _) = wanted_geometry(view, &entry.table, &overlay);
                let fits = band.width > 0;
                entry.widget.set_visible(fits);
                if fits {
                    entry.widget.set_band_width(band.width);
                }
                let height = measured_height(&entry.widget, band.width);
                overlay.reserve = Reserve::Block {
                    height: reserve_height(height, style.line_height),
                };
                entry.measured = Some(Measured {
                    overlay: overlay.clone(),
                    band,
                    height,
                });
                overlay
            })
            .collect()
    }

    /// Moves every widget to its overlay's place in the current layout.
    pub fn place(&self, view: &gtk::TextView) {
        for entry in self.entries.borrow_mut().iter_mut() {
            let Some(measured) = &entry.measured else {
                continue;
            };
            let (band, y) = wanted_geometry(view, &entry.table, &measured.overlay);
            entry.origin = Some((band.x, y));
            self.layer.move_to(&entry.widget, (band.x, y));
        }
    }

    /// Whether a widget's height at its band, or the place its overlay wants, differs from what
    /// it was given; only reads the layout, so it is safe during allocation.
    pub fn needs_rebuild(&self, view: &gtk::TextView) -> bool {
        self.entries.borrow().iter().any(|entry| {
            let Some(measured) = &entry.measured else {
                return false;
            };
            let (band, y) = wanted_geometry(view, &entry.table, &measured.overlay);
            measured_height(&entry.widget, measured.band.width) != measured.height
                || band != measured.band
                || entry.origin != Some((band.x, y))
        })
    }

    pub fn set_style(&self, style: &OverlayStyle) {
        for entry in self.entries.borrow().iter() {
            entry.widget.set_style(style);
        }
    }

    /// Lets every widget showing `image_id`, or every widget when `None`, read its images again.
    pub fn refresh_images(&self, image_id: Option<&str>, source: Option<&dyn ImageSource>) {
        for entry in self.entries.borrow().iter() {
            if image_id.is_none_or(|image_id| entry.widget.shows_image(image_id)) {
                entry.widget.refresh_images(source);
            }
        }
    }

    /// Whether a point in `view`'s widget coordinates lies on a table widget.
    pub fn contains(&self, view: &gtk::TextView, x: f64, y: f64) -> bool {
        self.widget_at(view, x, y).is_some()
    }

    /// The shown table widget under a point in `view`'s widget coordinates, with the point in
    /// the widget's coordinates.
    pub fn widget_at(
        &self,
        view: &gtk::TextView,
        x: f64,
        y: f64,
    ) -> Option<(TableWidget, graphene::Point)> {
        let point = graphene::Point::new(x as f32, y as f32);
        self.entries.borrow().iter().find_map(|entry| {
            let widget = &entry.widget;
            if !widget.is_drawable() {
                return None;
            }
            let bounds = widget.compute_bounds(view)?;
            if !bounds.contains_point(&point) {
                return None;
            }
            let inside = view.compute_point(widget, &point)?;
            Some((widget.clone(), inside))
        })
    }

    /// The table a widget shows now; `None` once the widget has been removed.
    pub fn table_of(&self, widget: &TableWidget) -> Option<RenderedTable> {
        self.entries
            .borrow()
            .iter()
            .find(|entry| entry.widget == *widget)
            .map(|entry| entry.table.clone())
    }

    pub fn clear(&self) {
        for entry in self.entries.take() {
            self.layer.remove(&entry.widget);
        }
    }
}

fn wanted_geometry(
    view: &gtk::TextView,
    table: &RenderedTable,
    overlay: &Overlay,
) -> (TableBand, i32) {
    let rect = overlay::overlay_rect(view, overlay);
    let prefix = table.list_prefix();
    let prefix_width = if prefix.is_empty() {
        0
    } else {
        view.create_pango_layout(Some(prefix)).pixel_size().0
    };
    (
        band(rect.x(), rect.width(), prefix_width),
        rect.y().round() as i32,
    )
}

fn measured_height(widget: &TableWidget, width: i32) -> i32 {
    if width > 0 {
        widget.measure(gtk::Orientation::Vertical, width).0
    } else {
        0
    }
}

mod imp {
    use super::*;

    #[derive(Debug, Default)]
    pub struct TableLayer {
        pub(super) origins: RefCell<Vec<(TableWidget, (i32, i32))>>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for TableLayer {
        const NAME: &'static str = "CommitnoteTableLayer";
        type Type = super::TableLayer;
        type ParentType = gtk::Widget;
    }

    impl ObjectImpl for TableLayer {
        fn dispose(&self) {
            for (widget, _) in self.origins.take() {
                widget.unparent();
            }
        }
    }

    impl WidgetImpl for TableLayer {
        fn measure(&self, _orientation: gtk::Orientation, _for_size: i32) -> (i32, i32, i32, i32) {
            (0, 0, -1, -1)
        }

        fn size_allocate(&self, _width: i32, _height: i32, _baseline: i32) {
            for (widget, (x, y)) in self.origins.borrow().iter() {
                if !widget.should_layout() {
                    continue;
                }
                let (size, _) = widget.preferred_size();
                let origin = graphene::Point::new(*x as f32, *y as f32);
                widget.allocate(
                    size.width(),
                    size.height(),
                    -1,
                    Some(gsk::Transform::new().translate(&origin)),
                );
            }
        }
    }
}

glib::wrapper! {
    /// Holds the table widgets as a single text view overlay at the buffer origin, because
    /// `GtkTextView` cannot remove one overlay child on its own. It asks for no room, so the
    /// widgets it places never widen the view whose width they follow.
    pub struct TableLayer(ObjectSubclass<imp::TableLayer>)
        @extends gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl Default for TableLayer {
    fn default() -> Self {
        glib::Object::new()
    }
}

impl TableLayer {
    fn put(&self, widget: &TableWidget) {
        widget.set_parent(self);
        self.imp()
            .origins
            .borrow_mut()
            .push((widget.clone(), (0, 0)));
    }

    fn move_to(&self, widget: &TableWidget, origin: (i32, i32)) {
        let mut origins = self.imp().origins.borrow_mut();
        if let Some(entry) = origins.iter_mut().find(|(child, _)| child == widget)
            && entry.1 != origin
        {
            entry.1 = origin;
            drop(origins);
            self.queue_allocate();
        }
    }

    fn remove(&self, widget: &TableWidget) {
        self.imp()
            .origins
            .borrow_mut()
            .retain(|(child, _)| child != widget);
        widget.unparent();
    }
}

#[cfg(test)]
mod tests {
    use commitnote_markdown::{Placement, RenderMode, parse, render};

    use super::*;

    fn tables(text: &str) -> Vec<RenderedTable> {
        render(&parse(text), &[], RenderMode::Editable)
            .placements
            .into_iter()
            .filter_map(|placement| match placement {
                Placement::Table { table } => Some(table),
                _ => None,
            })
            .collect()
    }

    const FIRST: &str = "| a | b |\n| - | - |\n| 1 | 2 |";
    const SECOND: &str = "| c |\n| - |\n| 3 |";

    #[test]
    fn moved_tables_keep_their_widgets() {
        let current = tables(&format!("{FIRST}\n\n{SECOND}"));
        let wanted = tables(&format!("typed above\n\n{FIRST}\n\ntext\n\n{SECOND}"));
        assert_ne!(current[0].range(), wanted[0].range());
        assert_eq!(match_tables(&current, &wanted), vec![Some(0), Some(1)]);
    }

    #[test]
    fn a_changed_table_gets_a_new_widget_and_the_others_keep_theirs() {
        let current = tables(&format!("{FIRST}\n\n{SECOND}"));
        let wanted = tables(&format!("| a | b |\n| - | - |\n| 1 | 9 |\n\n{SECOND}"));
        assert_eq!(match_tables(&current, &wanted), vec![None, Some(1)]);
    }

    #[test]
    fn a_removed_table_leaves_its_entry_unmatched() {
        let current = tables(&format!("{FIRST}\n\n{SECOND}"));
        let wanted = tables(SECOND);
        assert_eq!(match_tables(&current, &wanted), vec![Some(1)]);
        assert_eq!(match_tables(&current, &[]), Vec::<Option<usize>>::new());
    }

    #[test]
    fn identical_tables_are_kept_in_document_order() {
        let current = tables(&format!("{FIRST}\n\n{FIRST}"));
        let wanted = tables(&format!("{FIRST}\n\n{FIRST}\n\n{FIRST}"));
        assert_eq!(
            match_tables(&current, &wanted),
            vec![Some(0), Some(1), None]
        );
    }

    #[test]
    fn swapped_tables_keep_their_widgets() {
        let current = tables(&format!("{FIRST}\n\n{SECOND}"));
        let wanted = tables(&format!("{SECOND}\n\n{FIRST}"));
        assert_eq!(match_tables(&current, &wanted), vec![Some(1), Some(0)]);
    }

    #[test]
    fn the_band_starts_after_the_list_prefix() {
        assert_eq!(band(12.0, 600.0, 0), TableBand { x: 12, width: 600 });
        assert_eq!(band(24.0, 600.0, 18), TableBand { x: 42, width: 582 });
    }

    #[test]
    fn the_band_never_gets_a_negative_width() {
        assert_eq!(band(12.0, 10.0, 18), TableBand { x: 30, width: 0 });
        assert_eq!(band(12.0, 0.0, 0), TableBand { x: 12, width: 0 });
    }

    #[test]
    fn the_first_line_counts_towards_the_table_height() {
        assert_eq!(reserve_height(100, 19.5), 80.5);
        assert_eq!(reserve_height(10, 19.5), 0.0);
    }
}
