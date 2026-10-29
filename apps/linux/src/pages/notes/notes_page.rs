use std::cell::{Cell, OnceCell, RefCell};

use adw::prelude::*;
use adw::subclass::prelude::*;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use super::{NoteView, NotesTree};
use crate::model::AppModel;

const FALLBACK_TITLE: &str = "commitnote";

mod imp {
    use super::*;

    #[derive(Debug, Default, gtk::CompositeTemplate, glib::Properties)]
    #[properties(wrapper_type = super::NotesPage)]
    #[template(resource = "/io/github/marcinjahn/commitnote/ui/notes-page.ui")]
    pub struct NotesPage {
        #[template_child]
        pub(super) split_view: TemplateChild<adw::NavigationSplitView>,
        #[template_child]
        pub(super) sidebar_page: TemplateChild<adw::NavigationPage>,
        #[template_child]
        pub(super) sidebar_toolbar: TemplateChild<adw::ToolbarView>,
        #[template_child]
        pub(super) content_page: TemplateChild<adw::NavigationPage>,
        #[template_child]
        pub(super) content_toolbar: TemplateChild<adw::ToolbarView>,
        #[template_child]
        pub(super) main_menu: TemplateChild<gtk::gio::Menu>,
        #[property(get, set)]
        narrow: Cell<bool>,
        #[property(get, set)]
        sidebar_hidden: Cell<bool>,
        pub(super) model: OnceCell<AppModel>,
        pub(super) open_path: RefCell<Option<Vec<String>>>,
        pub(super) model_handler: RefCell<Option<glib::SignalHandlerId>>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for NotesPage {
        const NAME: &'static str = "CommitnoteNotesPage";
        type Type = super::NotesPage;
        type ParentType = adw::NavigationPage;

        fn class_init(klass: &mut Self::Class) {
            klass.bind_template();
            klass.install_action("notes.toggle-sidebar", None, |page, _, _| {
                page.toggle_sidebar();
            });
        }

        fn instance_init(obj: &glib::subclass::InitializingObject<Self>) {
            obj.init_template();
        }
    }

    #[glib::derived_properties]
    impl ObjectImpl for NotesPage {
        fn constructed(&self) {
            self.parent_constructed();
            let page = self.obj();
            page.connect_narrow_notify(|page| page.narrow_changed());
            page.connect_sidebar_hidden_notify(|page| page.sidebar_hidden_changed());
            self.split_view.connect_show_content_notify({
                let page = page.downgrade();
                move |_| {
                    if let Some(page) = page.upgrade() {
                        page.show_content_changed();
                    }
                }
            });
            page.add_controller(shortcuts());
        }

        fn dispose(&self) {
            if let (Some(id), Some(model)) = (self.model_handler.take(), self.model.get()) {
                model.disconnect(id);
            }
        }
    }

    impl WidgetImpl for NotesPage {}

    impl NavigationPageImpl for NotesPage {
        fn shown(&self) {
            self.parent_shown();
            let sidebar_visible =
                !self.split_view.is_collapsed() || !self.split_view.shows_content();
            if sidebar_visible && let Some(tree) = self.sidebar_toolbar.content() {
                tree.grab_focus();
            }
        }
    }
}

glib::wrapper! {
    pub struct NotesPage(ObjectSubclass<imp::NotesPage>)
        @extends adw::NavigationPage, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl NotesPage {
    pub fn new(model: &AppModel) -> Self {
        let page: Self = glib::Object::new();
        let imp = page.imp();
        let _ = imp.model.set(model.clone());

        let label = model
            .repository_label()
            .unwrap_or_else(|| FALLBACK_TITLE.to_owned());
        page.set_title(&label);
        imp.sidebar_page.set_title(&label);
        imp.sidebar_toolbar
            .set_content(Some(&NotesTree::new(model)));
        imp.content_toolbar.set_content(Some(&NoteView::new(model)));
        page.append_testing_menu();

        let path = model.open_note_path();
        page.set_content_title(path.as_deref());
        imp.open_path.replace(path);
        let handler = model.connect_open_note_changed({
            let page = page.downgrade();
            move |model| {
                if let Some(page) = page.upgrade() {
                    page.open_note_changed(model);
                }
            }
        });
        imp.model_handler.replace(Some(handler));
        page
    }

    #[cfg(feature = "testing")]
    fn append_testing_menu(&self) {
        self.imp()
            .main_menu
            .append_section(None, &crate::window::testing_menu());
    }

    #[cfg(not(feature = "testing"))]
    fn append_testing_menu(&self) {}

    fn set_content_title(&self, path: Option<&[String]>) {
        let title = path
            .and_then(<[String]>::last)
            .map_or(FALLBACK_TITLE, String::as_str);
        self.imp().content_page.set_title(title);
    }

    fn toggle_sidebar(&self) {
        let split_view = &self.imp().split_view;
        if self.narrow() {
            split_view.set_show_content(!split_view.shows_content());
        } else {
            self.set_sidebar_hidden(!self.sidebar_hidden());
        }
    }

    fn update_collapsed(&self) {
        self.imp()
            .split_view
            .set_collapsed(self.narrow() || self.sidebar_hidden());
    }

    fn narrow_changed(&self) {
        if self.narrow() {
            self.set_sidebar_hidden(false);
        }
        self.update_collapsed();
    }

    fn sidebar_hidden_changed(&self) {
        if self.sidebar_hidden() {
            self.imp().split_view.set_show_content(true);
        }
        self.update_collapsed();
    }

    fn show_content_changed(&self) {
        if !self.narrow() && self.sidebar_hidden() && !self.imp().split_view.shows_content() {
            self.set_sidebar_hidden(false);
        }
    }

    fn open_note_changed(&self, model: &AppModel) {
        let imp = self.imp();
        let path = model.open_note_path();
        self.set_content_title(path.as_deref());
        let changed = *imp.open_path.borrow() != path;
        let opened = changed && path.is_some();
        imp.open_path.replace(path);
        if opened && imp.split_view.is_collapsed() {
            imp.split_view.set_show_content(true);
        }
    }
}

fn shortcuts() -> gtk::ShortcutController {
    let controller = gtk::ShortcutController::new();
    controller.set_scope(gtk::ShortcutScope::Managed);
    for (trigger, action) in [
        ("F9", "notes.toggle-sidebar"),
        ("<Control>r", "win.refresh"),
    ] {
        controller.add_shortcut(gtk::Shortcut::new(
            gtk::ShortcutTrigger::parse_string(trigger),
            Some(gtk::NamedAction::new(action)),
        ));
    }
    controller
}
