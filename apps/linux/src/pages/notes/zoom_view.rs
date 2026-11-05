use std::cell::{Cell, RefCell};
use std::rc::Rc;

use gtk4::{self as gtk, gdk, glib, prelude::*};

use super::zoom_logic::{MIN_ZOOM, anchored_offset, clamp_zoom, content_size, fit_size, zoom_by};
use crate::editor::frame_at;
use crate::model::LoadedImage;

type ZoomCallback = Box<dyn Fn(f64)>;

#[derive(Debug, Clone, Copy)]
struct Pending {
    offset: (f64, f64),
    content: (f64, f64),
}

pub struct ZoomView {
    scrolled: gtk::ScrolledWindow,
    picture: gtk::Picture,
    image: RefCell<Option<Rc<LoadedImage>>>,
    zoom: Cell<f64>,
    content: Cell<(f64, f64)>,
    pointer: Cell<Option<(f64, f64)>>,
    pending: Cell<Option<Pending>>,
    drag_origin: Cell<(f64, f64)>,
    pinch_base: Cell<f64>,
    shown_frame: Cell<usize>,
    epoch: Cell<Option<i64>>,
    tick: RefCell<Option<gtk::TickCallbackId>>,
    animations_handler: RefCell<Option<glib::SignalHandlerId>>,
    on_zoom: RefCell<Option<ZoomCallback>>,
}

fn animations_enabled() -> bool {
    gtk::Settings::default().is_none_or(|settings| settings.is_gtk_enable_animations())
}

impl ZoomView {
    pub fn new() -> Rc<Self> {
        let picture = gtk::Picture::builder()
            .name("image-viewer-image")
            .can_shrink(true)
            .content_fit(gtk::ContentFit::Contain)
            .halign(gtk::Align::Center)
            .valign(gtk::Align::Center)
            .build();
        let scrolled = gtk::ScrolledWindow::builder()
            .name("image-viewer-scroll")
            .hexpand(true)
            .vexpand(true)
            .child(&picture)
            .build();
        let view = Rc::new(Self {
            scrolled,
            picture,
            image: RefCell::default(),
            zoom: Cell::new(MIN_ZOOM),
            content: Cell::new((0.0, 0.0)),
            pointer: Cell::new(None),
            pending: Cell::new(None),
            drag_origin: Cell::new((0.0, 0.0)),
            pinch_base: Cell::new(MIN_ZOOM),
            shown_frame: Cell::new(0),
            epoch: Cell::new(None),
            tick: RefCell::default(),
            animations_handler: RefCell::default(),
            on_zoom: RefCell::default(),
        });
        view.connect_layout();
        view.connect_input();
        view.connect_animation();
        view
    }

    pub fn widget(&self) -> &gtk::ScrolledWindow {
        &self.scrolled
    }

    pub fn zoom(&self) -> f64 {
        self.zoom.get()
    }

    pub fn connect_zoom_changed(&self, f: impl Fn(f64) + 'static) {
        self.on_zoom.replace(Some(Box::new(f)));
    }

    pub fn set_image(self: &Rc<Self>, image: Option<Rc<LoadedImage>>) {
        let same = match (&*self.image.borrow(), &image) {
            (Some(current), Some(next)) => Rc::ptr_eq(current, next),
            (None, None) => true,
            _ => false,
        };
        if same {
            return;
        }
        self.stop_animation();
        self.shown_frame.set(0);
        self.picture.set_paintable(
            image
                .as_ref()
                .and_then(|image| image.frames.first())
                .map(|(texture, _)| texture),
        );
        self.image.replace(image);
        self.relayout();
        self.start_animation();
    }

    pub fn zoom_in(&self) {
        self.zoom_to(zoom_by(self.zoom.get(), 1.0), None);
    }

    pub fn zoom_out(&self) {
        self.zoom_to(zoom_by(self.zoom.get(), -1.0), None);
    }

    pub fn zoom_fit(&self) {
        self.zoom_to(MIN_ZOOM, None);
    }

    pub fn shutdown(&self) {
        self.stop_animation();
        if let (Some(settings), Some(handler)) =
            (gtk::Settings::default(), self.animations_handler.take())
        {
            settings.disconnect(handler);
        }
    }

    fn viewport(&self) -> (f64, f64) {
        (
            self.scrolled.hadjustment().page_size(),
            self.scrolled.vadjustment().page_size(),
        )
    }

    fn zoom_to(&self, zoom: f64, anchor: Option<(f64, f64)>) {
        let zoom = clamp_zoom(zoom);
        let changed = zoom != self.zoom.get();
        self.zoom.set(zoom);
        self.layout(anchor);
        if changed && let Some(notify) = &*self.on_zoom.borrow() {
            notify(zoom);
        }
    }

    fn relayout(&self) {
        self.layout(None);
    }

    fn layout(&self, anchor: Option<(f64, f64)>) {
        let viewport = self.viewport();
        let dims = self
            .image
            .borrow()
            .as_ref()
            .map(|image| (f64::from(image.width), f64::from(image.height)));
        let scale_factor = f64::from(self.picture.scale_factor());
        let fit = dims.map_or((0.0, 0.0), |dims| fit_size(dims, viewport, scale_factor));
        let content = content_size(fit, self.zoom.get());
        let content = (content.0.round(), content.1.round());
        let old = self.content.replace(content);
        if content.0 < 1.0 || content.1 < 1.0 {
            self.pending.set(None);
            return;
        }
        let anchor = anchor.unwrap_or((viewport.0 / 2.0, viewport.1 / 2.0));
        let (hadj, vadj) = (self.scrolled.hadjustment(), self.scrolled.vadjustment());
        let offset = (
            anchored_offset(hadj.value(), anchor.0, old.0, content.0, viewport.0),
            anchored_offset(vadj.value(), anchor.1, old.1, content.1, viewport.1),
        );
        self.picture
            .set_size_request(content.0 as i32, content.1 as i32);
        self.pending.set(Some(Pending { offset, content }));
        self.settle();
    }

    fn settle(&self) {
        let Some(pending) = self.pending.get() else {
            return;
        };
        let (hadj, vadj) = (self.scrolled.hadjustment(), self.scrolled.vadjustment());
        let reached = |adjustment: &gtk::Adjustment, content: f64| {
            (adjustment.upper() - content.max(adjustment.page_size())).abs() < 1.5
        };
        if reached(&hadj, pending.content.0) && reached(&vadj, pending.content.1) {
            self.pending.set(None);
            hadj.set_value(pending.offset.0);
            vadj.set_value(pending.offset.1);
        }
    }

    fn connect_layout(self: &Rc<Self>) {
        self.picture.connect_scale_factor_notify({
            let view = Rc::downgrade(self);
            move |_| {
                if let Some(view) = view.upgrade() {
                    view.relayout();
                }
            }
        });
        for adjustment in [self.scrolled.hadjustment(), self.scrolled.vadjustment()] {
            let view = Rc::downgrade(self);
            adjustment.connect_page_size_notify({
                let view = view.clone();
                move |_| {
                    if let Some(view) = view.upgrade() {
                        view.relayout();
                    }
                }
            });
            adjustment.connect_changed(move |_| {
                if let Some(view) = view.upgrade() {
                    view.settle();
                }
            });
        }
    }

    fn connect_input(self: &Rc<Self>) {
        let motion = gtk::EventControllerMotion::new();
        motion.set_propagation_phase(gtk::PropagationPhase::Capture);
        motion.connect_motion({
            let view = Rc::downgrade(self);
            move |_, x, y| {
                if let Some(view) = view.upgrade() {
                    view.pointer.set(Some((x, y)));
                }
            }
        });
        motion.connect_leave({
            let view = Rc::downgrade(self);
            move |_| {
                if let Some(view) = view.upgrade() {
                    view.pointer.set(None);
                }
            }
        });
        self.scrolled.add_controller(motion);

        let scroll = gtk::EventControllerScroll::new(gtk::EventControllerScrollFlags::VERTICAL);
        scroll.set_propagation_phase(gtk::PropagationPhase::Capture);
        scroll.connect_scroll({
            let view = Rc::downgrade(self);
            move |controller, _, dy| {
                let control = controller
                    .current_event_state()
                    .contains(gdk::ModifierType::CONTROL_MASK);
                let Some(view) = view.upgrade().filter(|_| control) else {
                    return glib::Propagation::Proceed;
                };
                view.zoom_to(zoom_by(view.zoom.get(), -dy), view.pointer.get());
                glib::Propagation::Stop
            }
        });
        self.scrolled.add_controller(scroll);

        let pinch = gtk::GestureZoom::new();
        pinch.connect_begin({
            let view = Rc::downgrade(self);
            move |_, _| {
                if let Some(view) = view.upgrade() {
                    view.pinch_base.set(view.zoom.get());
                }
            }
        });
        pinch.connect_scale_changed({
            let view = Rc::downgrade(self);
            move |gesture, scale| {
                if let Some(view) = view.upgrade() {
                    gesture.set_state(gtk::EventSequenceState::Claimed);
                    view.zoom_to(view.pinch_base.get() * scale, gesture.bounding_box_center());
                }
            }
        });
        self.scrolled.add_controller(pinch);

        let drag = gtk::GestureDrag::new();
        drag.set_button(gdk::BUTTON_PRIMARY);
        drag.connect_drag_begin({
            let view = Rc::downgrade(self);
            move |gesture, _, _| {
                let Some(view) = view.upgrade() else {
                    return;
                };
                let touch = gesture
                    .current_event_device()
                    .is_some_and(|device| device.source() == gdk::InputSource::Touchscreen);
                if touch {
                    gesture.set_state(gtk::EventSequenceState::Denied);
                    return;
                }
                view.drag_origin.set((
                    view.scrolled.hadjustment().value(),
                    view.scrolled.vadjustment().value(),
                ));
            }
        });
        drag.connect_drag_update({
            let view = Rc::downgrade(self);
            move |_, dx, dy| {
                let Some(view) = view.upgrade() else {
                    return;
                };
                let (x, y) = view.drag_origin.get();
                view.scrolled.hadjustment().set_value(x - dx);
                view.scrolled.vadjustment().set_value(y - dy);
            }
        });
        self.scrolled.add_controller(drag);
    }

    fn connect_animation(self: &Rc<Self>) {
        self.picture.connect_map({
            let view = Rc::downgrade(self);
            move |_| {
                if let Some(view) = view.upgrade() {
                    view.start_animation();
                }
            }
        });
        if let Some(settings) = gtk::Settings::default() {
            let handler = settings.connect_gtk_enable_animations_notify({
                let view = Rc::downgrade(self);
                move |_| {
                    let Some(view) = view.upgrade() else {
                        return;
                    };
                    if animations_enabled() {
                        view.start_animation();
                    } else {
                        view.stop_animation();
                        view.show_frame(0);
                    }
                }
            });
            self.animations_handler.replace(Some(handler));
        }
    }

    fn animated(&self) -> bool {
        self.image
            .borrow()
            .as_ref()
            .is_some_and(|image| image.frames.len() > 1)
    }

    fn show_frame(&self, index: usize) {
        if self.shown_frame.replace(index) == index {
            return;
        }
        if let Some(image) = &*self.image.borrow()
            && let Some((texture, _)) = image.frames.get(index)
        {
            self.picture.set_paintable(Some(texture));
        }
    }

    fn start_animation(self: &Rc<Self>) {
        if self.tick.borrow().is_some()
            || !self.animated()
            || !animations_enabled()
            || !self.picture.is_mapped()
        {
            return;
        }
        self.epoch.set(None);
        let view = Rc::downgrade(self);
        let tick = self.picture.add_tick_callback(move |_, clock| {
            view.upgrade()
                .map_or(glib::ControlFlow::Break, |view| view.advance(clock))
        });
        self.tick.replace(Some(tick));
    }

    fn advance(&self, clock: &gdk::FrameClock) -> glib::ControlFlow {
        if !animations_enabled() || !self.animated() || !self.picture.is_mapped() {
            self.tick.take();
            self.epoch.set(None);
            return glib::ControlFlow::Break;
        }
        let now = clock.frame_time();
        let epoch = self.epoch.get().unwrap_or(now);
        self.epoch.set(Some(epoch));
        let elapsed = u64::try_from(now.saturating_sub(epoch) / 1000).unwrap_or(0);
        let frame = self
            .image
            .borrow()
            .as_ref()
            .map_or(0, |image| frame_at(&image.frames, elapsed));
        self.show_frame(frame);
        glib::ControlFlow::Continue
    }

    fn stop_animation(&self) {
        if let Some(tick) = self.tick.take() {
            tick.remove();
        }
        self.epoch.set(None);
    }
}
