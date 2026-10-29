use std::cell::{Cell, OnceCell, RefCell};
use std::time::Duration;

use adw::prelude::*;
use adw::subclass::prelude::*;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use super::note_state::{NoteDisplay, display_state, note_title, text_edit};
use crate::model::AppModel;

const SPINNER_DELAY: Duration = Duration::from_millis(300);

mod imp {
    use super::*;

    #[derive(Debug, Default, gtk::CompositeTemplate)]
    #[template(resource = "/io/github/marcinjahn/commitnote/ui/note-view.ui")]
    pub struct NoteView {
        #[template_child]
        pub(super) stack: TemplateChild<gtk::Stack>,
        #[template_child]
        pub(super) scrolled: TemplateChild<gtk::ScrolledWindow>,
        #[template_child]
        pub(super) title_label: TemplateChild<gtk::Label>,
        #[template_child]
        pub(super) text_view: TemplateChild<gtk::TextView>,
        #[template_child]
        pub(super) status_page: TemplateChild<adw::StatusPage>,
        pub(super) model: OnceCell<AppModel>,
        pub(super) handler: RefCell<Option<glib::SignalHandlerId>>,
        pub(super) spinner_timer: RefCell<Option<glib::SourceId>>,
        pub(super) loading_path: RefCell<Option<Vec<String>>>,
        pub(super) loaded_path: RefCell<Option<Vec<String>>>,
        pub(super) spinner_pending: Cell<bool>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for NoteView {
        const NAME: &'static str = "CommitnoteNoteView";
        type Type = super::NoteView;
        type ParentType = adw::Bin;

        fn class_init(klass: &mut Self::Class) {
            klass.bind_template();
        }

        fn instance_init(obj: &glib::subclass::InitializingObject<Self>) {
            obj.init_template();
        }
    }

    impl ObjectImpl for NoteView {
        fn constructed(&self) {
            self.parent_constructed();
            // The text view rewraps for a new width while it is being allocated, and the resize
            // it queues then is lost, leaving the text cut off at its old height.
            let text_view = self.text_view.downgrade();
            self.scrolled
                .hadjustment()
                .connect_page_size_notify(move |_| {
                    let text_view = text_view.clone();
                    glib::idle_add_local_once(move || {
                        if let Some(text_view) = text_view.upgrade() {
                            text_view.queue_resize();
                        }
                    });
                });
        }

        fn dispose(&self) {
            if let (Some(id), Some(model)) = (self.handler.take(), self.model.get()) {
                model.disconnect(id);
            }
            if let Some(id) = self.spinner_timer.take() {
                id.remove();
            }
        }
    }

    impl WidgetImpl for NoteView {}
    impl BinImpl for NoteView {}
}

glib::wrapper! {
    pub struct NoteView(ObjectSubclass<imp::NoteView>)
        @extends adw::Bin, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl NoteView {
    pub fn new(model: &AppModel) -> Self {
        let widget: Self = glib::Object::new();
        let _ = widget.imp().model.set(model.clone());
        widget.update();
        let handler = model.connect_open_note_changed({
            let widget = widget.downgrade();
            move |_| {
                if let Some(widget) = widget.upgrade() {
                    widget.update();
                }
            }
        });
        widget.imp().handler.replace(Some(handler));
        widget
    }

    fn update(&self) {
        let imp = self.imp();
        let Some(model) = imp.model.get() else {
            return;
        };
        let path = model.open_note_path();
        let state = model.open_note_state();
        match display_state(path.as_deref(), state.as_ref()) {
            NoteDisplay::Empty => {
                self.leave_loading();
                imp.loaded_path.replace(None);
                imp.stack.set_visible_child_name("empty");
            }
            NoteDisplay::Loading(path) => {
                imp.loaded_path.replace(None);
                self.start_loading(path);
            }
            NoteDisplay::Loaded { path, content } => {
                self.leave_loading();
                self.show_loaded(path, content);
            }
            NoteDisplay::Problem(message) => {
                self.leave_loading();
                imp.loaded_path.replace(None);
                imp.status_page
                    .set_description(Some(&glib::markup_escape_text(message)));
                imp.stack.set_visible_child_name("problem");
            }
        }
    }

    fn start_loading(&self, path: &[String]) {
        let imp = self.imp();
        if imp.loading_path.borrow().as_deref() == Some(path) {
            return;
        }
        self.leave_loading();
        imp.loading_path.replace(Some(path.to_vec()));
        imp.stack.set_visible_child_name("blank");
        imp.spinner_pending.set(true);
        let timer = glib::timeout_add_local_once(SPINNER_DELAY, {
            let widget = self.downgrade();
            move || {
                if let Some(widget) = widget.upgrade() {
                    let imp = widget.imp();
                    imp.spinner_timer.take();
                    if imp.spinner_pending.get() {
                        imp.stack.set_visible_child_name("loading");
                    }
                }
            }
        });
        imp.spinner_timer.replace(Some(timer));
    }

    fn leave_loading(&self) {
        let imp = self.imp();
        imp.loading_path.replace(None);
        imp.spinner_pending.set(false);
        if let Some(timer) = imp.spinner_timer.take() {
            timer.remove();
        }
    }

    fn show_loaded(&self, path: &[String], content: &str) {
        let imp = self.imp();
        imp.title_label.set_label(note_title(path));
        let buffer = imp.text_view.buffer();
        let unchanged_path = imp.loaded_path.borrow().as_deref() == Some(path);
        if unchanged_path {
            let (start, end) = buffer.bounds();
            let current = buffer.text(&start, &end, false);
            if let Some(edit) = text_edit(&current, content) {
                let mut from = buffer.iter_at_offset(edit.start);
                let mut to = buffer.iter_at_offset(edit.end);
                buffer.delete(&mut from, &mut to);
                let mut at = buffer.iter_at_offset(edit.start);
                buffer.insert(&mut at, edit.insert);
            }
        } else {
            buffer.set_text(content);
            imp.scrolled.vadjustment().set_value(0.0);
            imp.loaded_path.replace(Some(path.to_vec()));
        }
        imp.stack.set_visible_child_name("loaded");
    }
}
