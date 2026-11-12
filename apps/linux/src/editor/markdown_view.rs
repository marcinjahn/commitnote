use std::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;
use std::sync::OnceLock;

use commitnote_editor_text::{TextSelection, Utf16Index};
use commitnote_markdown::{
    CommandResult, MarkdownDocument, Placement, RenderMode, TableSelection, VerticalDirection,
    link_url, parse, render,
};
use glib::subclass::Signal;
use gtk4::subclass::prelude::*;
use gtk4::{self as gtk, glib, graphene};
use libadwaita as adw;
use sourceview5::prelude::*;
use sourceview5::subclass::prelude::*;

use super::image_source::ImageSource;
use super::inline_image::{
    self, ICON_SIZE, ImageLayout, InlineImage, NARROW_WIDTH, UNAVAILABLE_ICON, UNAVAILABLE_TEXT,
    UnavailableArt,
};
use super::overlay::{
    self, HIT_SLOP_Y, HitBehaviour, Overlay, OverlayKind, OverlayStyle, OverlayTags, Reserved,
};
use super::spans::{self, Spans};
use super::table_overlays::{ShownTable, TableGesture, TableOverlays};
use super::table_widget::TableWidget;
use super::tags::{Palette, PreviewTags};
use crate::fonts::NoteFont;
use crate::{accent, links};

mod paging;
mod table_keys;
mod table_selection;

const MARGIN: i32 = 12;

/// A parsed text version together with the offset index that maps its UTF-16 ranges to
/// buffer characters.
#[derive(Debug)]
pub struct ParsedText {
    pub document: MarkdownDocument,
    pub index: Utf16Index,
}

#[derive(Clone)]
pub(super) struct CommandHandler(Rc<dyn Fn(CommandResult)>);

impl std::fmt::Debug for CommandHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CommandHandler")
    }
}

#[derive(Clone)]
pub(super) struct SourceHandle(Rc<dyn ImageSource>);

impl std::fmt::Debug for SourceHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ImageSource")
    }
}

fn animations_enabled() -> bool {
    gtk::Settings::default().is_none_or(|settings| settings.is_gtk_enable_animations())
}

mod imp {
    use super::*;

    #[derive(Debug, Default)]
    pub struct MarkdownView {
        pub(super) tags: OnceCell<PreviewTags>,
        pub(super) accent_probe: OnceCell<gtk::Label>,
        pub(super) parsed: RefCell<Option<Rc<ParsedText>>>,
        pub(super) placements: RefCell<Rc<Vec<Placement>>>,
        pub(super) applied: RefCell<Spans>,
        pub(super) text_changed: Cell<bool>,
        pub(super) render_source: RefCell<Option<glib::SourceId>>,
        pub(super) palette: Cell<Option<Palette>>,
        pub(super) palette_source: RefCell<Option<glib::SourceId>>,
        pub(super) style_handlers: RefCell<Vec<glib::SignalHandlerId>>,
        pub(super) overlay_tags: OnceCell<OverlayTags>,
        pub(super) overlays: RefCell<Rc<Vec<Overlay>>>,
        pub(super) reserved: RefCell<Reserved>,
        pub(super) overlay_style: Cell<Option<OverlayStyle>>,
        pub(super) overlay_source: RefCell<Option<glib::SourceId>>,
        pub(super) table_overlays: OnceCell<TableOverlays>,
        pub(super) table_selection: RefCell<Option<(TableWidget, TableSelection)>>,
        pub(super) command_handler: RefCell<Option<CommandHandler>>,
        pub(super) pressed_overlay: Cell<Option<usize>>,
        pub(super) image_source: RefCell<Option<SourceHandle>>,
        pub(super) images: RefCell<Rc<Vec<InlineImage>>>,
        pub(super) unavailable_art: RefCell<Option<Rc<UnavailableArt>>>,
        pub(super) layout_width: Cell<i32>,
        pub(super) elapsed: Rc<Cell<u64>>,
        pub(super) epoch: Cell<Option<i64>>,
        pub(super) tick: RefCell<Option<gtk::TickCallbackId>>,
        pub(super) animations_handler: RefCell<Option<glib::SignalHandlerId>>,
        pub(super) text_scale_handler: RefCell<Option<glib::SignalHandlerId>>,
        pub(super) vertical_run: Cell<Option<table_keys::VerticalRun>>,
        pub(super) page_aim: Cell<Option<paging::PageAim>>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for MarkdownView {
        const NAME: &'static str = "CommitnoteMarkdownView";
        type Type = super::MarkdownView;
        type ParentType = sourceview5::View;
    }

    impl ObjectImpl for MarkdownView {
        fn signals() -> &'static [Signal] {
            static SIGNALS: OnceLock<Vec<Signal>> = OnceLock::new();
            SIGNALS.get_or_init(|| {
                vec![
                    Signal::builder("image-activated")
                        .param_types([String::static_type()])
                        .build(),
                    Signal::builder("tables-changed").build(),
                ]
            })
        }

        fn constructed(&self) {
            self.parent_constructed();
            let view = self.obj();
            view.set_widget_name("note-editor-view");
            view.update_property(&[gtk::accessible::Property::Label("Note")]);
            view.set_editable(false);
            view.set_cursor_visible(false);
            view.set_wrap_mode(gtk::WrapMode::WordChar);
            view.set_left_margin(MARGIN);
            view.set_right_margin(MARGIN);
            view.set_top_margin(MARGIN);
            view.set_bottom_margin(MARGIN);
            view.set_show_line_numbers(false);
            view.set_highlight_current_line(false);
            view.add_css_class("inline");

            let buffer = sourceview5::Buffer::new(None);
            // A new buffer starts with a default scheme that paints its own background and text color.
            buffer.set_style_scheme(None);
            buffer.set_enable_undo(false);
            buffer.set_highlight_syntax(false);
            buffer.set_highlight_matching_brackets(false);
            view.set_buffer(Some(&buffer));
            let _ = self.tags.set(PreviewTags::new(buffer.upcast_ref()));
            let _ = self.overlay_tags.set(OverlayTags::new(buffer.upcast_ref()));
            *self.applied.borrow_mut() = spans::empty();
            self.text_changed.set(true);

            buffer.connect_changed({
                let view = view.downgrade();
                move |_| {
                    if let Some(view) = view.upgrade() {
                        view.imp().text_changed.set(true);
                        view.clear_table_selection();
                        view.queue_render();
                    }
                }
            });
            buffer.connect_mark_set({
                let view = view.downgrade();
                move |buffer, _, mark| {
                    if let Some(view) = view.upgrade()
                        && (*mark == buffer.get_insert() || *mark == buffer.selection_bound())
                    {
                        view.queue_render();
                    }
                }
            });

            let probe = accent::probe();
            view.add_overlay(&probe, 0, 0);
            let _ = self.accent_probe.set(probe);
            let on_gesture = {
                let view = view.downgrade();
                move |widget: &TableWidget, gesture: TableGesture| {
                    if let Some(view) = view.upgrade() {
                        view.on_table_gesture(widget, gesture);
                    }
                }
            };
            let _ = self
                .table_overlays
                .set(TableOverlays::new(view.upcast_ref(), on_gesture));
            view.connect_buffer_notify(|view| view.clear_table_selection());
            view.connect_editable_notify(|view| view.queue_render());

            let style_manager = adw::StyleManager::default();
            let dark = style_manager.connect_dark_notify({
                let view = view.downgrade();
                move |_| {
                    if let Some(view) = view.upgrade() {
                        view.queue_palette();
                    }
                }
            });
            let accent = style_manager.connect_accent_color_rgba_notify({
                let view = view.downgrade();
                move |_| {
                    if let Some(view) = view.upgrade() {
                        view.queue_palette();
                    }
                }
            });
            let high_contrast = style_manager.connect_high_contrast_notify({
                let view = view.downgrade();
                move |_| {
                    if let Some(view) = view.upgrade() {
                        view.queue_palette();
                    }
                }
            });
            self.style_handlers
                .replace(vec![dark, accent, high_contrast]);

            let click = gtk::GestureClick::new();
            click.set_button(gtk::gdk::BUTTON_PRIMARY);
            click.set_propagation_phase(gtk::PropagationPhase::Capture);
            click.connect_pressed({
                let view = view.downgrade();
                move |gesture, _, x, y| {
                    let Some(view) = view.upgrade() else {
                        return;
                    };
                    let hit = view.hit_overlay_at(x, y);
                    view.imp().pressed_overlay.set(hit);
                    gesture.set_state(if hit.is_some() {
                        gtk::EventSequenceState::Claimed
                    } else {
                        gtk::EventSequenceState::Denied
                    });
                }
            });
            click.connect_released({
                let view = view.downgrade();
                move |_, _, x, y| {
                    let Some(view) = view.upgrade() else {
                        return;
                    };
                    let Some(pressed) = view.imp().pressed_overlay.take() else {
                        return;
                    };
                    if view.hit_overlay_at(x, y) != Some(pressed) {
                        return;
                    }
                    let hit = view.overlays()[pressed].hit.clone();
                    match hit {
                        HitBehaviour::Command(_) => {
                            if let Some(result) = view.toggle_at_point(x, y) {
                                view.run_command(result);
                            }
                        }
                        HitBehaviour::Activate(image_id) => view.emit_image_activated(&image_id),
                        HitBehaviour::Inert => {}
                    }
                }
            });
            click.connect_cancel({
                let view = view.downgrade();
                move |_, _| {
                    if let Some(view) = view.upgrade() {
                        view.imp().pressed_overlay.set(None);
                    }
                }
            });
            view.add_controller(click);

            let link_click = gtk::GestureClick::new();
            link_click.set_button(gtk::gdk::BUTTON_PRIMARY);
            link_click.set_propagation_phase(gtk::PropagationPhase::Capture);
            link_click.connect_pressed({
                let view = view.downgrade();
                move |gesture, _, x, y| {
                    let control = gesture
                        .current_event_state()
                        .contains(gtk::gdk::ModifierType::CONTROL_MASK);
                    let opened = view
                        .upgrade()
                        .is_some_and(|view| view.handle_primary_press(x, y, control));
                    gesture.set_state(if opened {
                        gtk::EventSequenceState::Claimed
                    } else {
                        gtk::EventSequenceState::Denied
                    });
                }
            });
            view.add_controller(link_click);

            let any_press = gtk::GestureClick::new();
            any_press.set_button(0);
            any_press.set_propagation_phase(gtk::PropagationPhase::Capture);
            any_press.connect_pressed({
                let view = view.downgrade();
                move |gesture, _, x, y| {
                    if let Some(view) = view.upgrade() {
                        view.table_press_at(x, y, gesture.current_button());
                    }
                    gesture.set_state(gtk::EventSequenceState::Denied);
                }
            });
            view.add_controller(any_press);

            let long_press = gtk::GestureLongPress::new();
            long_press.set_touch_only(true);
            long_press.connect_pressed({
                let view = view.downgrade();
                move |gesture, x, y| {
                    if let Some(view) = view.upgrade() {
                        gesture.set_state(gtk::EventSequenceState::Claimed);
                        view.open_context_menu_at(x, y);
                    }
                }
            });
            view.add_controller(long_press);

            let keys = gtk::EventControllerKey::new();
            keys.set_propagation_phase(gtk::PropagationPhase::Capture);
            keys.connect_key_pressed({
                let view = view.downgrade();
                move |_, keyval, _, state| match view.upgrade() {
                    Some(view) if view.table_selection_key(keyval, state) => {
                        glib::Propagation::Stop
                    }
                    _ => glib::Propagation::Proceed,
                }
            });
            view.add_controller(keys);

            view.connect_scale_factor_notify(|view| {
                view.imp().unavailable_art.replace(None);
                view.queue_render();
            });
            if let Some(settings) = gtk::Settings::default() {
                let handler = settings.connect_gtk_enable_animations_notify({
                    let view = view.downgrade();
                    move |_| {
                        if let Some(view) = view.upgrade() {
                            view.animations_changed();
                        }
                    }
                });
                self.animations_handler.replace(Some(handler));
                let handler = settings.connect_gtk_xft_dpi_notify({
                    let view = view.downgrade();
                    move |_| {
                        if let Some(view) = view.upgrade() {
                            view.queue_palette();
                        }
                    }
                });
                self.text_scale_handler.replace(Some(handler));
            }
        }

        fn dispose(&self) {
            let style_manager = adw::StyleManager::default();
            for handler in self.style_handlers.take() {
                style_manager.disconnect(handler);
            }
            if let Some(settings) = gtk::Settings::default() {
                for handler in [
                    self.animations_handler.take(),
                    self.text_scale_handler.take(),
                ]
                .into_iter()
                .flatten()
                {
                    settings.disconnect(handler);
                }
            }
            for source in [
                self.render_source.take(),
                self.palette_source.take(),
                self.overlay_source.take(),
            ]
            .into_iter()
            .flatten()
            {
                source.remove();
            }
            self.table_selection.take();
            if let Some(tables) = self.table_overlays.get() {
                tables.clear();
            }
        }
    }

    impl WidgetImpl for MarkdownView {
        fn map(&self) {
            self.parent_map();
            self.obj().refresh_palette();
        }

        fn unmap(&self) {
            self.obj().stop_animation();
            self.parent_unmap();
        }

        fn size_allocate(&self, width: i32, height: i32, baseline: i32) {
            self.parent_size_allocate(width, height, baseline);
            let view = self.obj();
            let tables = view.table_overlays();
            let resized = self.layout_width.replace(width) != width;
            if resized && (!self.images.borrow().is_empty() || !tables.is_empty()) {
                view.queue_render();
            } else if tables.needs_rebuild(view.upcast_ref()) {
                view.queue_overlay_rebuild();
            }
        }

        fn snapshot(&self, snapshot: &gtk::Snapshot) {
            let view = self.obj();
            if self.palette.get() != Some(view.current_palette()) || view.line_height_changed() {
                view.queue_palette();
            }
            self.parent_snapshot(snapshot);
        }
    }

    impl TextViewImpl for MarkdownView {
        fn snapshot_layer(&self, layer: gtk::TextViewLayer, snapshot: gtk::Snapshot) {
            self.parent_snapshot_layer(layer, snapshot.clone());
            if layer == gtk::TextViewLayer::AboveText {
                self.obj().paint_overlays(&snapshot);
            }
        }

        fn move_cursor(&self, step: gtk::MovementStep, count: i32, extend: bool) {
            let view = self.obj();
            let gtk_move = || self.parent_move_cursor(step, count, extend);
            match step {
                gtk::MovementStep::DisplayLines if !extend && count != 0 => {
                    let direction = if count < 0 {
                        VerticalDirection::Up
                    } else {
                        VerticalDirection::Down
                    };
                    if !view.enter_table(direction, 1) {
                        view.move_display_lines(gtk_move);
                    }
                }
                gtk::MovementStep::Pages => view.move_pages(count, extend, gtk_move),
                _ => gtk_move(),
            }
        }

        fn copy_clipboard(&self) {
            if !self.obj().copy_table_selection() {
                self.parent_copy_clipboard();
            }
        }
    }
    impl ViewImpl for MarkdownView {}
}

glib::wrapper! {
    pub struct MarkdownView(ObjectSubclass<imp::MarkdownView>)
        @extends sourceview5::View, gtk::TextView, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget, gtk::Scrollable;
}

impl MarkdownView {
    pub fn new() -> Self {
        glib::Object::new()
    }

    /// Shows the text in a note font. Code stays monospace. The overlays are measured again once
    /// the new font has been applied to the view.
    pub fn set_note_font(&self, font: NoteFont) {
        font.apply_to(self);
        self.queue_draw();
    }

    pub fn source_buffer(&self) -> sourceview5::Buffer {
        self.buffer()
            .downcast()
            .expect("the view is built over a source buffer")
    }

    /// The text version the last preview was rendered from.
    pub fn parsed(&self) -> Option<Rc<ParsedText>> {
        self.imp().parsed.borrow().clone()
    }

    pub fn placements(&self) -> Rc<Vec<Placement>> {
        self.imp().placements.borrow().clone()
    }

    pub fn overlays(&self) -> Rc<Vec<Overlay>> {
        self.imp().overlays.borrow().clone()
    }

    /// Where each overlay is painted, in widget coordinates.
    pub fn overlay_rects(&self) -> Vec<(OverlayKind, graphene::Rect)> {
        let (dx, dy) = self.buffer_to_window_coords(gtk::TextWindowType::Widget, 0, 0);
        self.overlays()
            .iter()
            .map(|overlay| {
                let rect = overlay::overlay_rect(self.upcast_ref(), overlay);
                (overlay.kind, rect.offset_r(dx as f32, dy as f32))
            })
            .collect()
    }

    /// The command of the overlay under a point in widget coordinates, run over the current
    /// text.
    pub fn toggle_at_point(&self, x: f64, y: f64) -> Option<CommandResult> {
        let found = self.overlay_at(x, y, false)?;
        let overlays = self.overlays();
        let HitBehaviour::Command(command) = &overlays[found].hit else {
            return None;
        };
        let buffer = self.buffer();
        let (start, end) = buffer.bounds();
        Some(command(&buffer.text(&start, &end, true)))
    }

    /// The link whose text covers a UTF-16 offset of the current text, if it can be opened.
    pub fn link_url_at(&self, offset: usize) -> Option<String> {
        let parsed = self.fresh_parsed()?;
        link_url(&parsed.document, offset)
    }

    /// Opens the context menu for a touch at a point in widget coordinates, moving the caret
    /// there first unless the point is inside the current selection.
    fn open_context_menu_at(&self, x: f64, y: f64) {
        let (bx, by) =
            self.window_to_buffer_coords(gtk::TextWindowType::Widget, x as i32, y as i32);
        if let Some((iter, _)) = self.iter_at_position(bx, by) {
            let buffer = self.buffer();
            let selected = buffer
                .selection_bounds()
                .is_some_and(|(start, end)| iter >= start && iter < end);
            if !selected {
                buffer.place_cursor(&iter);
            }
        }
        let _ = self.activate_action("menu.popup", None);
    }

    /// Opens the link under a point in widget coordinates when Control is held, and says
    /// whether it did. A table widget's text is never a link here.
    pub fn handle_primary_press(&self, x: f64, y: f64, control: bool) -> bool {
        if !control || self.table_overlays().contains(self.upcast_ref(), x, y) {
            return false;
        }
        let (bx, by) =
            self.window_to_buffer_coords(gtk::TextWindowType::Widget, x as i32, y as i32);
        let Some((iter, _)) = self.iter_at_position(bx, by) else {
            return false;
        };
        let Some(parsed) = self.fresh_parsed() else {
            return false;
        };
        let offset = parsed.index.char_to_utf16(iter.offset().max(0) as usize);
        let Some(url) = link_url(&parsed.document, offset) else {
            return false;
        };
        links::open_uri(self, &url);
        true
    }

    fn on_table_gesture(&self, widget: &TableWidget, gesture: TableGesture) {
        let in_view = |(x, y): (f64, f64)| {
            let point = widget.compute_point(self, &graphene::Point::new(x as f32, y as f32))?;
            Some((f64::from(point.x()), f64::from(point.y())))
        };
        match gesture {
            TableGesture::Click { x, y, control } => {
                if let Some((x, y)) = in_view((x, y)) {
                    self.click_table_at(x, y, control);
                }
            }
            TableGesture::Drag { from, to } => {
                if let (Some(from), Some(to)) = (in_view(from), in_view(to)) {
                    self.drag_table_cells(from.0, from.1, to.0, to.1);
                }
            }
            TableGesture::LongPress { x, y } => {
                if let Some((x, y)) = in_view((x, y)) {
                    self.long_press_table_at(x, y);
                }
            }
            TableGesture::ContextMenu { x, y } => {
                if let Some((x, y)) = in_view((x, y)) {
                    self.secondary_press_table_at(x, y);
                }
            }
        }
    }

    /// Acts on a click at a point in widget coordinates over a rendered table, and says whether
    /// it did. With Control held over a link it opens the link; otherwise, while the text is
    /// editable, it puts the caret at the end of the clicked cell's content and focuses the view.
    pub fn click_table_at(&self, x: f64, y: f64, control: bool) -> bool {
        let tables = self.table_overlays();
        let Some((widget, point)) = tables.widget_at(self.upcast_ref(), x, y) else {
            return false;
        };
        let (x, y) = (f64::from(point.x()), f64::from(point.y()));
        if control && let Some(url) = widget.link_at_point(x, y) {
            links::open_uri(self, &url);
            return true;
        }
        if !self.is_editable() {
            return false;
        }
        let Some((row, column)) = widget.cell_at_point(x, y) else {
            return false;
        };
        let Some(parsed) = self.fresh_parsed() else {
            return false;
        };
        let Some(offset) = tables.table_of(&widget).and_then(|table| {
            table
                .rows
                .get(row)
                .and_then(|cells| cells.get(column))
                .map(|cell| cell.caret_offset)
        }) else {
            return false;
        };
        let buffer = self.buffer();
        let caret = i32::try_from(parsed.index.utf16_to_char(offset)).unwrap_or(i32::MAX);
        buffer.place_cursor(&buffer.iter_at_offset(caret));
        self.grab_focus();
        true
    }

    fn fresh_parsed(&self) -> Option<Rc<ParsedText>> {
        let imp = self.imp();
        if imp.text_changed.get() || imp.parsed.borrow().is_none() {
            self.render_now();
        }
        self.parsed()
    }

    /// Receives the result of a clicked overlay's command.
    pub fn connect_command(&self, handler: impl Fn(CommandResult) + 'static) {
        self.imp()
            .command_handler
            .replace(Some(CommandHandler(Rc::new(handler))));
    }

    fn run_command(&self, result: CommandResult) {
        let handler = self.imp().command_handler.borrow().clone();
        if let Some(CommandHandler(handler)) = handler {
            handler(result);
        }
    }

    /// The overlay a primary press at a point in widget coordinates acts on: a command only
    /// while the text is editable, an image in any view, and none over a table widget.
    fn hit_overlay_at(&self, x: f64, y: f64) -> Option<usize> {
        if self.table_overlays().contains(self.upcast_ref(), x, y) {
            return None;
        }
        self.overlay_at(x, y, !self.is_editable())
    }

    fn overlay_at(&self, x: f64, y: f64, images_only: bool) -> Option<usize> {
        if self.imp().render_source.borrow().is_some() {
            self.render_now();
        }
        let (bx, by) =
            self.window_to_buffer_coords(gtk::TextWindowType::Widget, x as i32, y as i32);
        let point = graphene::Point::new(bx as f32, by as f32);
        let slop = HIT_SLOP_Y.ceil() as i32;
        let lines = overlay::lines_between(self.upcast_ref(), by - slop, by + slop);
        self.overlays().iter().position(|overlay| {
            if overlay.range.start >= lines.end || overlay.range.end < lines.start {
                return false;
            }
            let rect = overlay::overlay_rect(self.upcast_ref(), overlay);
            match overlay.hit {
                HitBehaviour::Command(_) if !images_only => {
                    overlay::hit_area(&rect).contains_point(&point)
                }
                HitBehaviour::Activate(_) => rect.contains_point(&point),
                _ => false,
            }
        })
    }

    pub fn connect_image_activated<F: Fn(&Self, &str) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_local("image-activated", false, move |args| {
            let view = args[0].get::<Self>().ok()?;
            let image_id = args[1].get::<&str>().ok()?;
            f(&view, image_id);
            None
        })
    }

    fn emit_image_activated(&self, image_id: &str) {
        self.emit_by_name::<()>("image-activated", &[&image_id]);
    }

    /// Runs after a render that removed a table widget or built one, but not after one that
    /// only moved widgets.
    pub fn connect_tables_changed<F: Fn(&Self) + 'static>(&self, f: F) -> glib::SignalHandlerId {
        self.connect_local("tables-changed", false, move |args| {
            let view = args[0].get::<Self>().ok()?;
            f(&view);
            None
        })
    }

    /// The rendered tables in document order, each with its widget.
    pub fn shown_tables(&self) -> Vec<ShownTable> {
        self.table_overlays().shown()
    }

    fn table_overlays(&self) -> &TableOverlays {
        self.imp()
            .table_overlays
            .get()
            .expect("the view is constructed with its table overlays")
    }

    /// Where images come from; without a source every image reference shows as unavailable.
    pub fn set_image_source(&self, source: Option<Rc<dyn ImageSource>>) {
        self.imp().image_source.replace(source.map(SourceHandle));
        self.table_overlays()
            .refresh_images(None, self.image_source().as_deref());
        self.queue_render();
    }

    fn image_source(&self) -> Option<Rc<dyn ImageSource>> {
        self.imp()
            .image_source
            .borrow()
            .clone()
            .map(|SourceHandle(source)| source)
    }

    /// Repaints the references to an image whose state changed in the source.
    pub fn image_changed(&self, image_id: &str) {
        let shown = self
            .imp()
            .images
            .borrow()
            .iter()
            .any(|image| image.image_id == image_id);
        if shown {
            self.queue_render();
        }
        self.table_overlays()
            .refresh_images(Some(image_id), self.image_source().as_deref());
    }

    #[cfg(feature = "testing")]
    pub fn testing_images(&self) -> Vec<(String, &'static str, usize)> {
        let elapsed = self.imp().elapsed.get();
        self.imp()
            .images
            .borrow()
            .iter()
            .map(|image| {
                (
                    image.image_id.clone(),
                    image.state_name(),
                    image.frame(elapsed),
                )
            })
            .collect()
    }

    #[cfg(feature = "testing")]
    pub fn testing_activate_image(&self, index: usize) {
        let image_id = self
            .imp()
            .images
            .borrow()
            .get(index)
            .map(|image| image.image_id.clone());
        if let Some(image_id) = image_id {
            self.emit_image_activated(&image_id);
        }
    }

    /// The kind of overlay a primary press at a point in widget coordinates acts on.
    #[cfg(feature = "testing")]
    pub fn testing_overlay_at(&self, x: f64, y: f64) -> Option<OverlayKind> {
        let index = self.hit_overlay_at(x, y)?;
        Some(self.overlays()[index].kind)
    }

    #[cfg(feature = "testing")]
    pub fn testing_line_metrics(&self) -> (Option<f32>, f32) {
        let measured = self
            .imp()
            .overlay_style
            .get()
            .map(|style| style.line_height);
        (measured, self.line_height())
    }

    #[cfg(feature = "testing")]
    pub fn testing_high_contrast(&self) -> bool {
        self.imp()
            .palette
            .get()
            .is_some_and(|palette| palette.high_contrast)
    }

    #[cfg(feature = "testing")]
    pub fn testing_dim_alpha(&self) -> Option<f32> {
        let slot = super::tags::slot(commitnote_markdown::PreviewStyle::MutedMarker);
        let tag = self.imp().tags.get()?.by_slot().get(slot)?;
        Some(tag.foreground_rgba()?.alpha())
    }

    #[cfg(feature = "testing")]
    pub fn testing_animating(&self) -> bool {
        self.imp().tick.borrow().is_some()
    }

    fn image_layout(&self) -> ImageLayout {
        let width = self.width();
        ImageLayout {
            available: (width - self.left_margin() - self.right_margin()).max(0) as f32,
            narrow: (width as f32) < NARROW_WIDTH,
            pixel_ratio: self.scale_factor().max(1) as f32,
        }
    }

    fn unavailable_art(&self) -> Rc<UnavailableArt> {
        if let Some(art) = self.imp().unavailable_art.borrow().clone() {
            return art;
        }
        let icon = gtk::IconTheme::for_display(&self.display()).lookup_icon(
            UNAVAILABLE_ICON,
            &[],
            ICON_SIZE,
            self.scale_factor(),
            self.direction(),
            gtk::IconLookupFlags::empty(),
        );
        let art = Rc::new(UnavailableArt {
            text: self.create_pango_layout(Some(UNAVAILABLE_TEXT)),
            icon: Some(icon),
        });
        self.imp().unavailable_art.replace(Some(art.clone()));
        art
    }

    /// Whether an animated image shows in the visible rect, in buffer coordinates.
    fn animated_image_visible(&self, visible: &graphene::Rect) -> bool {
        let overlays = self.overlays();
        self.imp().images.borrow().iter().any(|image| {
            image.animated()
                && overlays.get(image.overlay).is_some_and(|overlay| {
                    overlay::overlay_rect(self.upcast_ref(), overlay)
                        .intersection(visible)
                        .is_some()
                })
        })
    }

    fn visible_buffer_rect(&self) -> graphene::Rect {
        let visible = self.visible_rect();
        graphene::Rect::new(
            visible.x() as f32,
            visible.y() as f32,
            visible.width() as f32,
            visible.height() as f32,
        )
    }

    fn start_animation(&self) {
        let imp = self.imp();
        if imp.tick.borrow().is_some() || !animations_enabled() || !self.is_mapped() {
            return;
        }
        imp.epoch.set(None);
        let tick = self.add_tick_callback(|view, clock| view.advance_frames(clock));
        imp.tick.replace(Some(tick));
    }

    fn advance_frames(&self, clock: &gtk::gdk::FrameClock) -> glib::ControlFlow {
        let imp = self.imp();
        if !animations_enabled()
            || !self.is_mapped()
            || !self.animated_image_visible(&self.visible_buffer_rect())
        {
            imp.tick.take();
            imp.epoch.set(None);
            return glib::ControlFlow::Break;
        }
        let now = clock.frame_time();
        let epoch = imp.epoch.get().unwrap_or_else(|| {
            let resumed = i64::try_from(imp.elapsed.get()).unwrap_or(0);
            now.saturating_sub(resumed.saturating_mul(1000))
        });
        imp.epoch.set(Some(epoch));
        let elapsed = u64::try_from(now.saturating_sub(epoch) / 1000).unwrap_or(0);
        let previous = imp.elapsed.replace(elapsed);
        let changed = imp
            .images
            .borrow()
            .iter()
            .any(|image| image.animated() && image.frame(previous) != image.frame(elapsed));
        if changed {
            self.queue_draw();
        }
        glib::ControlFlow::Continue
    }

    fn stop_animation(&self) {
        let imp = self.imp();
        if let Some(tick) = imp.tick.take() {
            tick.remove();
        }
        imp.epoch.set(None);
    }

    fn animations_changed(&self) {
        if !animations_enabled() {
            self.stop_animation();
            self.imp().elapsed.set(0);
        }
        self.queue_draw();
    }

    fn paint_overlays(&self, snapshot: &gtk::Snapshot) {
        let overlays = self.overlays();
        if overlays.is_empty() {
            return;
        }
        let style = self.overlay_style();
        let visible = self.visible_buffer_rect();
        let shown = overlay::lines_between(
            self.upcast_ref(),
            visible.y() as i32,
            (visible.y() + visible.height()) as i32,
        );
        for overlay in overlays.iter() {
            if overlay.kind == OverlayKind::Table
                || overlay.range.end < shown.start
                || overlay.range.start >= shown.end
            {
                continue;
            }
            let rect = overlay::overlay_rect(self.upcast_ref(), overlay);
            if rect.intersection(&visible).is_some() {
                (overlay.painter)(snapshot, &rect, &style);
            }
        }
        if self.imp().tick.borrow().is_none()
            && animations_enabled()
            && self.animated_image_visible(&visible)
        {
            self.start_animation();
        }
    }

    /// Drops everything derived from the previous text and renders the current one at once.
    pub fn reset(&self) {
        let imp = self.imp();
        imp.parsed.replace(None);
        imp.text_changed.set(true);
        self.render_now();
    }

    fn queue_overlay_rebuild(&self) {
        let imp = self.imp();
        if imp.overlay_source.borrow().is_some() || imp.render_source.borrow().is_some() {
            return;
        }
        let source = glib::idle_add_local_once({
            let view = self.downgrade();
            move || {
                if let Some(view) = view.upgrade() {
                    view.imp().overlay_source.take();
                    view.rebuild_overlays(false);
                }
            }
        });
        imp.overlay_source.replace(Some(source));
    }

    fn queue_render(&self) {
        let imp = self.imp();
        if imp.render_source.borrow().is_some() {
            return;
        }
        let source = glib::idle_add_local_once({
            let view = self.downgrade();
            move || {
                if let Some(view) = view.upgrade() {
                    view.imp().render_source.take();
                    view.render_now();
                }
            }
        });
        imp.render_source.replace(Some(source));
    }

    pub fn render_now(&self) {
        let imp = self.imp();
        if let Some(source) = imp.render_source.take() {
            source.remove();
        }
        let Some(tags) = imp.tags.get() else {
            return;
        };
        let buffer = self.buffer();
        let (start, end) = buffer.bounds();
        let text_changed = imp.text_changed.replace(false);
        let parsed = match imp.parsed.borrow().clone() {
            Some(parsed) if !text_changed => parsed,
            _ => {
                let text = buffer.text(&start, &end, true);
                Rc::new(ParsedText {
                    index: Utf16Index::new(&text),
                    document: parse(&text),
                })
            }
        };
        let selection = buffer_selection(&buffer, &parsed.index);
        let mode = if self.is_editable() {
            RenderMode::Editable
        } else {
            RenderMode::ReadOnly
        };
        let output = render(&parsed.document, &[selection], mode);
        let spans = spans::from_runs(&output.runs, &parsed.index);

        let previous = imp.applied.replace(Spans::new());
        for (slot, tag) in tags.by_slot().iter().enumerate() {
            let wanted = &spans[slot];
            if text_changed {
                buffer.remove_tag(tag, &start, &end);
                apply(&buffer, tag, wanted);
            } else {
                let had = &previous[slot];
                for range in spans::subtract(had, wanted) {
                    let (from, to) = iters(&buffer, &range);
                    buffer.remove_tag(tag, &from, &to);
                }
                apply(&buffer, tag, &spans::subtract(wanted, had));
            }
        }
        imp.applied.replace(spans);
        imp.placements.replace(Rc::new(output.placements));
        imp.parsed.replace(Some(parsed));
        self.rebuild_overlays(text_changed);
    }

    fn rebuild_overlays(&self, full: bool) {
        let imp = self.imp();
        let Some(tags) = imp.overlay_tags.get() else {
            return;
        };
        let Some(parsed) = imp.parsed.borrow().clone() else {
            return;
        };
        if let Some(source) = imp.overlay_source.take() {
            source.remove();
        }
        let style = self.overlay_style();
        let placements = imp.placements.borrow().clone();
        let mut overlays = overlay::overlays(&placements, &parsed.index, &style);
        let has_images = placements
            .iter()
            .any(|placement| matches!(placement, Placement::Image { .. }));
        let mut images = Vec::new();
        if has_images {
            let source = self.image_source();
            let art = self.unavailable_art();
            let found = inline_image::overlays(
                &placements,
                &parsed.index,
                source.as_deref(),
                &self.image_layout(),
                &imp.elapsed,
                Some(&art),
                overlays.len(),
            );
            for (overlay, image) in found {
                overlays.push(overlay);
                images.push(image);
            }
        }
        let tables = self.table_overlays();
        let wanted_tables = placements
            .iter()
            .filter_map(|placement| match placement {
                Placement::Table { table } => Some(table.clone()),
                _ => None,
            })
            .collect();
        let tables_changed = tables.update(wanted_tables, &style, self.image_source().as_deref());
        overlays.extend(tables.overlays(self.upcast_ref(), &parsed.index, &style));
        let wanted = tags.reserved(self.upcast_ref(), &overlays);
        let previous = imp.reserved.take();
        tags.apply(&self.buffer(), &previous, &wanted, full);
        imp.reserved.replace(wanted);
        imp.overlays.replace(Rc::new(overlays));
        imp.images.replace(Rc::new(images));
        tables.place(self.upcast_ref());
        self.queue_draw();
        if tables_changed {
            self.emit_by_name::<()>("tables-changed", &[]);
        }
        self.retain_table_selection();
    }

    fn overlay_style(&self) -> OverlayStyle {
        if let Some(style) = self.imp().overlay_style.get() {
            return style;
        }
        let style = self.current_overlay_style(&self.current_palette());
        self.imp().overlay_style.set(Some(style));
        style
    }

    fn current_overlay_style(&self, palette: &Palette) -> OverlayStyle {
        OverlayStyle {
            foreground: palette.foreground,
            accent: palette.accent,
            line_height: self.line_height(),
            high_contrast: palette.high_contrast,
        }
    }

    fn line_height(&self) -> f32 {
        let metrics = self.pango_context().metrics(None, None);
        metrics.height() as f32 / gtk::pango::SCALE as f32
    }

    fn line_height_changed(&self) -> bool {
        self.imp()
            .overlay_style
            .get()
            .is_some_and(|style| style.line_height != self.line_height())
    }

    fn current_palette(&self) -> Palette {
        let accent = self
            .imp()
            .accent_probe
            .get()
            .map_or_else(|| self.color(), accent::color);
        Palette {
            foreground: self.color(),
            accent,
            left_margin: self.left_margin(),
            high_contrast: adw::StyleManager::default().is_high_contrast(),
        }
    }

    fn queue_palette(&self) {
        let imp = self.imp();
        if imp.palette_source.borrow().is_some() {
            return;
        }
        let source = glib::idle_add_local_once({
            let view = self.downgrade();
            move || {
                if let Some(view) = view.upgrade() {
                    view.imp().palette_source.take();
                    view.refresh_palette();
                }
            }
        });
        imp.palette_source.replace(Some(source));
    }

    fn refresh_palette(&self) {
        let imp = self.imp();
        let palette = self.current_palette();
        if imp.palette.replace(Some(palette)) != Some(palette) {
            if let Some(tags) = imp.tags.get() {
                tags.set_palette(&palette);
            }
            self.queue_draw();
        }
        self.remeasure_overlays(&palette);
        self.table_overlays().set_style(&self.overlay_style());
    }

    fn remeasure_overlays(&self, palette: &Palette) {
        let imp = self.imp();
        let style = self.current_overlay_style(palette);
        let previous = imp.overlay_style.replace(Some(style));
        if previous.map(|previous| previous.line_height) != Some(style.line_height) {
            if let Some(tags) = imp.overlay_tags.get() {
                tags.forget_widths();
            }
            imp.unavailable_art.replace(None);
            self.rebuild_overlays(false);
            self.queue_draw();
        }
    }
}

impl Default for MarkdownView {
    fn default() -> Self {
        Self::new()
    }
}

pub(super) fn buffer_selection(buffer: &gtk::TextBuffer, index: &Utf16Index) -> TextSelection {
    let (anchor, caret) = buffer.selection_bounds().unwrap_or_else(|| {
        let caret = buffer.iter_at_mark(&buffer.get_insert());
        (caret, caret)
    });
    let from = index.char_to_utf16(anchor.offset().max(0) as usize);
    let to = index.char_to_utf16(caret.offset().max(0) as usize);
    TextSelection::new(from.min(to), from.abs_diff(to))
}

fn iters(
    buffer: &gtk::TextBuffer,
    range: &std::ops::Range<usize>,
) -> (gtk::TextIter, gtk::TextIter) {
    (
        buffer.iter_at_offset(range.start as i32),
        buffer.iter_at_offset(range.end as i32),
    )
}

fn apply(buffer: &gtk::TextBuffer, tag: &gtk::TextTag, ranges: &[std::ops::Range<usize>]) {
    for range in ranges {
        let (from, to) = iters(buffer, range);
        buffer.apply_tag(tag, &from, &to);
    }
}
