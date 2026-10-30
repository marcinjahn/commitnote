use std::cell::{Cell, OnceCell, RefCell};

use adw::prelude::*;
use adw::subclass::prelude::*;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use super::sync_feedback::{SyncMenuAction, SyncStatusView, sync_status_view};
use super::{NoteView, NotesTree};
use crate::editor::NoteEditor;
use crate::model::{AppModel, EditorTarget};

const FALLBACK_TITLE: &str = "commitnote";
const DRAFT_TITLE: &str = "New Note";

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
        #[template_child]
        pub(super) formatting_bar: TemplateChild<gtk::Box>,
        #[template_child]
        pub(super) note_menu_button: TemplateChild<gtk::MenuButton>,
        #[template_child]
        pub(super) sync_status_button: TemplateChild<gtk::MenuButton>,
        #[template_child]
        pub(super) content_sync_status_button: TemplateChild<gtk::MenuButton>,
        #[property(get, set)]
        narrow: Cell<bool>,
        #[property(get, set)]
        sidebar_hidden: Cell<bool>,
        pub(super) editor: OnceCell<NoteEditor>,
        pub(super) note_view: OnceCell<NoteView>,
        pub(super) model: OnceCell<AppModel>,
        pub(super) open_path: RefCell<Option<Vec<String>>>,
        pub(super) draft_switch: Cell<Option<u64>>,
        pub(super) model_handlers: RefCell<Vec<glib::SignalHandlerId>>,
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
            if let Some(model) = self.model.get() {
                for id in self.model_handlers.take() {
                    model.disconnect(id);
                }
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
        let note_view = NoteView::new(model);
        let editor = note_view.editor();
        page.insert_action_group("editor", Some(&editor.actions()));
        editor.view().connect_editable_notify({
            let page = page.downgrade();
            move |_| {
                if let Some(page) = page.upgrade() {
                    page.update_note_controls();
                }
            }
        });
        let _ = imp.editor.set(editor);
        let _ = imp.note_view.set(note_view.clone());
        imp.content_toolbar.set_content(Some(&note_view));
        page.append_testing_menu();

        let path = model.open_note_path();
        page.set_content_title(&model.editor_target(), path.as_deref());
        imp.open_path.replace(path);
        page.update_note_controls();
        let handler = model.connect_open_note_changed({
            let page = page.downgrade();
            move |model| {
                if let Some(page) = page.upgrade() {
                    page.open_note_changed(model);
                }
            }
        });
        let sync_handler = model.connect_sync_state_changed({
            let page = page.downgrade();
            move |_| {
                if let Some(page) = page.upgrade() {
                    page.update_sync_status();
                }
            }
        });
        imp.model_handlers.replace(vec![handler, sync_handler]);
        page.update_sync_status();
        page
    }

    pub fn placeholder_visible(&self) -> bool {
        self.imp()
            .note_view
            .get()
            .is_some_and(NoteView::placeholder_visible)
    }

    #[cfg(feature = "testing")]
    fn append_testing_menu(&self) {
        self.imp()
            .main_menu
            .append_section(None, &crate::window::testing_menu());
    }

    #[cfg(not(feature = "testing"))]
    fn append_testing_menu(&self) {}

    fn set_content_title(&self, target: &EditorTarget, path: Option<&[String]>) {
        let title = match target {
            EditorTarget::Draft(_) => DRAFT_TITLE,
            EditorTarget::Note(path) => path.last().map_or(FALLBACK_TITLE, String::as_str),
            EditorTarget::None => path
                .and_then(<[String]>::last)
                .map_or(FALLBACK_TITLE, String::as_str),
        };
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
        self.update_sync_visibility();
    }

    fn update_sync_status(&self) {
        let imp = self.imp();
        let Some(model) = imp.model.get() else {
            return;
        };
        if let Some(view) = model.sync_state().as_ref().map(sync_status_view) {
            for button in [&*imp.sync_status_button, &*imp.content_sync_status_button] {
                self.show_sync_status(button, &view);
            }
        }
        self.update_sync_visibility();
    }

    fn update_sync_visibility(&self) {
        let imp = self.imp();
        let tree_loaded = imp
            .model
            .get()
            .and_then(AppModel::sync_state)
            .is_some_and(|sync| sync.tree_loaded);
        imp.sync_status_button.set_visible(tree_loaded);
        imp.content_sync_status_button
            .set_visible(tree_loaded && imp.split_view.is_collapsed());
    }

    fn show_sync_status(&self, button: &gtk::MenuButton, view: &SyncStatusView) {
        button.set_icon_name(view.icon);
        button.set_tooltip_text(Some(&view.text));
        button.update_property(&[gtk::accessible::Property::Label(&view.text)]);

        let content = gtk::Box::builder()
            .orientation(gtk::Orientation::Vertical)
            .spacing(6)
            .margin_top(6)
            .margin_bottom(6)
            .margin_start(6)
            .margin_end(6)
            .build();
        content.append(
            &gtk::Label::builder()
                .name("sync-status-text")
                .label(&view.text)
                .xalign(0.0)
                .wrap(true)
                .max_width_chars(32)
                .margin_start(6)
                .margin_end(6)
                .build(),
        );
        for entry in &view.entries {
            let item = gtk::Button::builder()
                .name(format!("sync-status-{}", entry.id))
                .child(
                    &gtk::Label::builder()
                        .label(&entry.label)
                        .xalign(0.0)
                        .wrap(true)
                        .max_width_chars(32)
                        .build(),
                )
                .sensitive(entry.action != SyncMenuAction::Inert)
                .css_classes(["flat"])
                .build();
            item.connect_clicked({
                let page = self.downgrade();
                let button = button.downgrade();
                let action = entry.action.clone();
                move |_| {
                    if let Some(button) = button.upgrade() {
                        button.popdown();
                    }
                    if let Some(page) = page.upgrade() {
                        page.activate_sync_item(&action);
                    }
                }
            });
            content.append(&item);
        }
        match button.popover() {
            Some(popover) => popover.set_child(Some(&content)),
            None => button.set_popover(Some(&gtk::Popover::builder().child(&content).build())),
        }
    }

    fn activate_sync_item(&self, action: &SyncMenuAction) {
        let Some(model) = self.imp().model.get() else {
            return;
        };
        match action {
            SyncMenuAction::Retry => {
                let model = model.clone();
                glib::spawn_future_local(async move { model.retry_sync().await });
            }
            SyncMenuAction::Open(path) => model.open_note(Some(path.clone())),
            SyncMenuAction::Inert => {}
        }
    }

    fn narrow_changed(&self) {
        if self.narrow() {
            self.set_sidebar_hidden(false);
        }
        self.update_collapsed();
        self.update_note_controls();
    }

    fn update_note_controls(&self) {
        let imp = self.imp();
        let editable = imp
            .editor
            .get()
            .is_some_and(|editor| editor.view().is_editable());
        imp.formatting_bar.set_visible(self.narrow() && editable);
        imp.note_menu_button
            .set_visible(imp.open_path.borrow().is_some());
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
        let target = model.editor_target();
        self.set_content_title(&target, path.as_deref());
        let changed = *imp.open_path.borrow() != path;
        let mut opened = changed && path.is_some();
        if target.is_draft() {
            let switch = Some(model.note_switch());
            opened |= imp.draft_switch.replace(switch) != switch;
        }
        imp.open_path.replace(path);
        self.update_note_controls();
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
