use std::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;

use adw::prelude::*;
use adw::subclass::prelude::*;
use gtk4::{self as gtk, gio, glib};
use libadwaita as adw;

use super::zoom_logic::{can_zoom_in, can_zoom_out};
use super::zoom_view::ZoomView;
use crate::a11y::label_loading;
use crate::model::{AppModel, ImageState};

const LOADING: &str = "loading";
const IMAGE: &str = "image";
const UNAVAILABLE: &str = "unavailable";
const ZOOM_IN: &str = "zoom-in";
const ZOOM_OUT: &str = "zoom-out";
const ZOOM_FIT: &str = "zoom-fit";

mod imp {
    use super::*;

    #[derive(Default)]
    pub struct ImageViewer {
        pub(super) view: OnceCell<Rc<ZoomView>>,
        pub(super) stack: OnceCell<gtk::Stack>,
        pub(super) actions: OnceCell<gio::SimpleActionGroup>,
        pub(super) model: OnceCell<AppModel>,
        pub(super) image_id: OnceCell<String>,
        pub(super) handler: RefCell<Option<glib::SignalHandlerId>>,
        pub(super) closed: Cell<bool>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for ImageViewer {
        const NAME: &'static str = "CommitnoteImageViewer";
        type Type = super::ImageViewer;
        type ParentType = adw::Dialog;
    }

    impl ObjectImpl for ImageViewer {}
    impl WidgetImpl for ImageViewer {}

    impl AdwDialogImpl for ImageViewer {
        fn closed(&self) {
            self.closed.set(true);
            if let Some(view) = self.view.get() {
                view.shutdown();
            }
            if let (Some(model), Some(handler)) = (self.model.get(), self.handler.take()) {
                model.disconnect(handler);
            }
            self.parent_closed();
        }
    }
}

glib::wrapper! {
    pub struct ImageViewer(ObjectSubclass<imp::ImageViewer>)
        @extends adw::Dialog, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl ImageViewer {
    pub fn new(model: &AppModel, image_id: &str) -> Self {
        let viewer: Self = glib::Object::builder()
            .property("title", "Image")
            .property("content-width", 900)
            .property("content-height", 700)
            .build();
        viewer.set_widget_name("image-viewer");
        let imp = viewer.imp();
        let _ = imp.model.set(model.clone());
        let _ = imp.image_id.set(image_id.to_owned());
        viewer.build();
        viewer.refresh();
        let handler = model.connect_image_changed({
            let viewer = viewer.downgrade();
            move |_, changed| {
                if let Some(viewer) = viewer.upgrade()
                    && viewer.imp().image_id.get().map(String::as_str) == Some(changed)
                {
                    viewer.refresh();
                }
            }
        });
        imp.handler.replace(Some(handler));
        viewer
    }

    pub fn is_open(&self) -> bool {
        !self.imp().closed.get()
    }

    #[cfg(feature = "testing")]
    pub fn testing_zoom(&self) -> f64 {
        self.imp().view.get().map_or(1.0, |view| view.zoom())
    }

    fn build(&self) {
        let imp = self.imp();
        let view = ZoomView::new();
        let actions = self.install_actions(&view);

        let spinner = adw::Spinner::builder()
            .name("image-viewer-spinner")
            .width_request(32)
            .height_request(32)
            .halign(gtk::Align::Center)
            .valign(gtk::Align::Center)
            .build();
        label_loading(&spinner);
        let stack = gtk::Stack::new();
        stack.add_named(&spinner, Some(LOADING));
        stack.add_named(view.widget(), Some(IMAGE));
        stack.add_named(
            &adw::StatusPage::builder()
                .name("image-viewer-unavailable")
                .icon_name("image-missing-symbolic")
                .title("Image Unavailable")
                .build(),
            Some(UNAVAILABLE),
        );

        let header = adw::HeaderBar::new();
        for (name, icon, tooltip, action) in [
            (
                "image-zoom-fit",
                "zoom-fit-best-symbolic",
                "Best Fit",
                ZOOM_FIT,
            ),
            ("image-zoom-in", "zoom-in-symbolic", "Zoom In", ZOOM_IN),
            ("image-zoom-out", "zoom-out-symbolic", "Zoom Out", ZOOM_OUT),
        ] {
            let button = gtk::Button::builder()
                .name(name)
                .icon_name(icon)
                .tooltip_text(tooltip)
                .action_name(format!("viewer.{action}"))
                .build();
            button.update_property(&[gtk::accessible::Property::Label(tooltip)]);
            header.pack_end(&button);
        }
        let toolbar = adw::ToolbarView::new();
        toolbar.add_top_bar(&header);
        toolbar.set_content(Some(&stack));
        self.set_child(Some(&toolbar));
        self.add_controller(shortcuts());

        view.connect_zoom_changed({
            let viewer = self.downgrade();
            move |_| {
                if let Some(viewer) = viewer.upgrade() {
                    viewer.update_actions();
                }
            }
        });
        let _ = imp.view.set(view);
        let _ = imp.stack.set(stack);
        let _ = imp.actions.set(actions);
    }

    fn install_actions(&self, view: &Rc<ZoomView>) -> gio::SimpleActionGroup {
        let group = gio::SimpleActionGroup::new();
        for (name, run) in [
            (ZOOM_IN, ZoomView::zoom_in as fn(&ZoomView)),
            (ZOOM_OUT, ZoomView::zoom_out),
            (ZOOM_FIT, ZoomView::zoom_fit),
        ] {
            let action = gio::SimpleAction::new(name, None);
            action.connect_activate({
                let view = Rc::downgrade(view);
                move |_, _| {
                    if let Some(view) = view.upgrade() {
                        run(&view);
                    }
                }
            });
            group.add_action(&action);
        }
        self.insert_action_group("viewer", Some(&group));
        group
    }

    fn update_actions(&self) {
        let imp = self.imp();
        let (Some(view), Some(group)) = (imp.view.get(), imp.actions.get()) else {
            return;
        };
        let ready = imp
            .stack
            .get()
            .is_some_and(|stack| stack.visible_child_name().as_deref() == Some(IMAGE));
        let zoom = view.zoom();
        for (name, enabled) in [
            (ZOOM_IN, ready && can_zoom_in(zoom)),
            (ZOOM_OUT, ready && can_zoom_out(zoom)),
            (ZOOM_FIT, ready && can_zoom_out(zoom)),
        ] {
            if let Some(action) = group
                .lookup_action(name)
                .and_then(|action| action.downcast::<gio::SimpleAction>().ok())
            {
                action.set_enabled(enabled);
            }
        }
        if ready && self.focus().is_none() {
            view.widget().grab_focus();
        }
    }

    fn refresh(&self) {
        let imp = self.imp();
        if imp.closed.get() {
            return;
        }
        let (Some(model), Some(image_id), Some(view), Some(stack)) = (
            imp.model.get(),
            imp.image_id.get(),
            imp.view.get(),
            imp.stack.get(),
        ) else {
            return;
        };
        let page = match model.image(image_id) {
            ImageState::Loading => LOADING,
            ImageState::Unavailable => UNAVAILABLE,
            ImageState::Ready(image) => {
                view.set_image(Some(image));
                IMAGE
            }
        };
        if page != IMAGE {
            view.set_image(None);
        }
        stack.set_visible_child_name(page);
        self.update_actions();
    }
}

fn shortcuts() -> gtk::ShortcutController {
    let controller = gtk::ShortcutController::new();
    controller.set_scope(gtk::ShortcutScope::Managed);
    for (trigger, action) in [
        ("<Control>plus", "viewer.zoom-in"),
        ("<Control>equal", "viewer.zoom-in"),
        ("<Control>KP_Add", "viewer.zoom-in"),
        ("<Control>minus", "viewer.zoom-out"),
        ("<Control>KP_Subtract", "viewer.zoom-out"),
        ("<Control>0", "viewer.zoom-fit"),
        ("<Control>KP_0", "viewer.zoom-fit"),
    ] {
        controller.add_shortcut(gtk::Shortcut::new(
            gtk::ShortcutTrigger::parse_string(trigger),
            Some(gtk::NamedAction::new(action)),
        ));
    }
    controller
}
