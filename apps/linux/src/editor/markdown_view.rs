use std::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;

use commitnote_editor_text::{TextSelection, Utf16Index};
use commitnote_markdown::{CommandResult, MarkdownDocument, Placement, link_url, parse, render};
use gtk4::subclass::prelude::*;
use gtk4::{self as gtk, glib, graphene};
use libadwaita as adw;
use sourceview5::prelude::*;
use sourceview5::subclass::prelude::*;

use super::overlay::{
    self, HIT_SLOP_Y, HitBehaviour, Overlay, OverlayKind, OverlayStyle, OverlayTags, Reserved,
};
use super::spans::{self, Spans};
use super::tags::{Palette, PreviewTags};
use crate::links;

const MARGIN: i32 = 12;
const LIGHT_SCHEME: &str = "Adwaita";
const DARK_SCHEME: &str = "Adwaita-dark";

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
        pub(super) command_handler: RefCell<Option<CommandHandler>>,
        pub(super) pressed_overlay: Cell<Option<usize>>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for MarkdownView {
        const NAME: &'static str = "CommitnoteMarkdownView";
        type Type = super::MarkdownView;
        type ParentType = sourceview5::View;
    }

    impl ObjectImpl for MarkdownView {
        fn constructed(&self) {
            self.parent_constructed();
            let view = self.obj();
            view.set_widget_name("note-editor-view");
            view.set_editable(false);
            view.set_cursor_visible(false);
            view.set_wrap_mode(gtk::WrapMode::WordChar);
            view.set_left_margin(MARGIN);
            view.set_right_margin(MARGIN);
            view.set_top_margin(MARGIN);
            view.set_bottom_margin(MARGIN);
            view.set_show_line_numbers(false);
            view.set_highlight_current_line(false);

            let buffer = sourceview5::Buffer::new(None);
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

            let probe = gtk::Label::new(None);
            probe.add_css_class("accent");
            probe.set_visible(false);
            view.add_overlay(&probe, 0, 0);
            let _ = self.accent_probe.set(probe);

            let style_manager = adw::StyleManager::default();
            let dark = style_manager.connect_dark_notify({
                let view = view.downgrade();
                move |_| {
                    if let Some(view) = view.upgrade() {
                        view.update_scheme();
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
            self.style_handlers.replace(vec![dark, accent]);
            view.update_scheme();

            let click = gtk::GestureClick::new();
            click.set_button(gtk::gdk::BUTTON_PRIMARY);
            click.set_propagation_phase(gtk::PropagationPhase::Capture);
            click.connect_pressed({
                let view = view.downgrade();
                move |gesture, _, x, y| {
                    let Some(view) = view.upgrade() else {
                        return;
                    };
                    let hit = view
                        .is_editable()
                        .then(|| view.command_overlay_at(x, y))
                        .flatten();
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
                    if view.command_overlay_at(x, y) == Some(pressed)
                        && let Some(result) = view.toggle_at_point(x, y)
                    {
                        view.run_command(result);
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
        }

        fn dispose(&self) {
            let style_manager = adw::StyleManager::default();
            for handler in self.style_handlers.take() {
                style_manager.disconnect(handler);
            }
            for source in [self.render_source.take(), self.palette_source.take()]
                .into_iter()
                .flatten()
            {
                source.remove();
            }
        }
    }

    impl WidgetImpl for MarkdownView {
        fn map(&self) {
            self.parent_map();
            self.obj().refresh_palette();
        }

        fn snapshot(&self, snapshot: &gtk::Snapshot) {
            let view = self.obj();
            if self.palette.get() != Some(view.current_palette()) {
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
        let found = self.command_overlay_at(x, y)?;
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

    /// Opens the link under a point in widget coordinates when Control is held, and says
    /// whether it did.
    pub fn handle_primary_press(&self, x: f64, y: f64, control: bool) -> bool {
        if !control {
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

    fn command_overlay_at(&self, x: f64, y: f64) -> Option<usize> {
        if self.imp().render_source.borrow().is_some() {
            self.render_now();
        }
        let (bx, by) =
            self.window_to_buffer_coords(gtk::TextWindowType::Widget, x as i32, y as i32);
        let point = graphene::Point::new(bx as f32, by as f32);
        let slop = HIT_SLOP_Y.ceil() as i32;
        let (first, _) = self.line_at_y(by - slop);
        let (last, _) = self.line_at_y(by + slop);
        let mut lines = first;
        lines.set_line_offset(0);
        let mut until = last;
        if !until.ends_line() {
            until.forward_to_line_end();
        }
        let lines = lines.offset() as usize..until.offset().max(0) as usize + 1;
        self.overlays().iter().position(|overlay| {
            matches!(overlay.hit, HitBehaviour::Command(_))
                && overlay.range.start < lines.end
                && overlay.range.end >= lines.start
                && overlay::hit_area(&overlay::overlay_rect(self.upcast_ref(), overlay))
                    .contains_point(&point)
        })
    }

    fn paint_overlays(&self, snapshot: &gtk::Snapshot) {
        let overlays = self.overlays();
        if overlays.is_empty() {
            return;
        }
        let style = self.overlay_style();
        let visible = self.visible_rect();
        let visible = graphene::Rect::new(
            visible.x() as f32,
            visible.y() as f32,
            visible.width() as f32,
            visible.height() as f32,
        );
        let (top, _) = self.line_at_y(visible.y() as i32);
        let (mut bottom, _) = self.line_at_y((visible.y() + visible.height()) as i32);
        if !bottom.ends_line() {
            bottom.forward_to_line_end();
        }
        let shown = top.offset().max(0) as usize..bottom.offset().max(0) as usize + 1;
        for overlay in overlays.iter() {
            if overlay.range.end < shown.start || overlay.range.start >= shown.end {
                continue;
            }
            let rect = overlay::overlay_rect(self.upcast_ref(), overlay);
            if rect.intersection(&visible).is_some() {
                (overlay.painter)(snapshot, &rect, &style);
            }
        }
    }

    /// Drops everything derived from the previous text and renders the current one at once.
    pub fn reset(&self) {
        let imp = self.imp();
        imp.parsed.replace(None);
        imp.text_changed.set(true);
        self.render_now();
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
        let output = render(&parsed.document, &[selection]);
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
        let style = self.overlay_style();
        let overlays = overlay::overlays(&imp.placements.borrow(), &parsed.index, &style);
        let wanted = tags.reserved(self.upcast_ref(), &overlays);
        let previous = imp.reserved.take();
        tags.apply(&self.buffer(), &previous, &wanted, full);
        imp.reserved.replace(wanted);
        imp.overlays.replace(Rc::new(overlays));
        self.queue_draw();
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
        let metrics = self.pango_context().metrics(None, None);
        OverlayStyle {
            foreground: palette.foreground,
            accent: palette.accent,
            line_height: metrics.height() as f32 / gtk::pango::SCALE as f32,
        }
    }

    fn update_scheme(&self) {
        let id = if adw::StyleManager::default().is_dark() {
            DARK_SCHEME
        } else {
            LIGHT_SCHEME
        };
        let scheme = sourceview5::StyleSchemeManager::default().scheme(id);
        self.source_buffer().set_style_scheme(scheme.as_ref());
    }

    fn current_palette(&self) -> Palette {
        let accent = self
            .imp()
            .accent_probe
            .get()
            .map_or_else(|| self.color(), |probe| probe.color());
        Palette {
            foreground: self.color(),
            accent,
            left_margin: self.left_margin(),
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
        if imp.palette.replace(Some(palette)) == Some(palette) {
            return;
        }
        if let Some(tags) = imp.tags.get() {
            tags.set_palette(&palette);
        }
        let style = self.current_overlay_style(&palette);
        let previous = imp.overlay_style.replace(Some(style));
        if previous.map(|previous| previous.line_height) != Some(style.line_height) {
            if let Some(tags) = imp.overlay_tags.get() {
                tags.forget_widths();
            }
            self.rebuild_overlays(false);
        }
        self.queue_draw();
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
