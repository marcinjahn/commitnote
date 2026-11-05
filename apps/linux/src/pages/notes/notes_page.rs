use std::cell::{Cell, OnceCell, RefCell};

use adw::prelude::*;
use adw::subclass::prelude::*;
use commitnote_core_api::commands::MoveDirection;
use commitnote_core_api::shapes::ColorTag;
use gtk4::{self as gtk, gdk, gio, glib};
use libadwaita as adw;

use super::sync_feedback::{SyncMenuAction, SyncStatusView, sync_status_view};
use super::tree_logic::{new_folder_parent, tag_from_id, tag_id, tag_label};
use super::{
    NoteView, NotesTree, SearchView, details_dialog, folder_dialog, move_dialog, trash_confirm,
    trash_dialog,
};
use crate::editor::{InsertAt, NoteEditor};
use crate::model::{AppModel, COLOR_TAGS, DraftFocus, EditorTarget, ImageInput};

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
        pub(super) tag_filter_banner: TemplateChild<adw::Banner>,
        #[template_child]
        pub(super) search_bar: TemplateChild<gtk::SearchBar>,
        #[template_child]
        pub(super) search_entry: TemplateChild<gtk::SearchEntry>,
        #[template_child]
        pub(super) main_menu: TemplateChild<gtk::gio::Menu>,
        #[template_child]
        pub(super) note_menu: TemplateChild<gtk::gio::Menu>,
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
        #[property(get, set)]
        filter_tag: RefCell<String>,
        #[property(get, set)]
        note_color_tag: RefCell<String>,
        pub(super) filter_menu: OnceCell<gtk::gio::Menu>,
        pub(super) organise_menu: OnceCell<gtk::gio::Menu>,
        pub(super) tree: OnceCell<NotesTree>,
        pub(super) search_view: OnceCell<SearchView>,
        pub(super) sidebar_stack: gtk::Stack,
        pub(super) editor: OnceCell<NoteEditor>,
        pub(super) note_view: OnceCell<NoteView>,
        pub(super) model: OnceCell<AppModel>,
        pub(super) open_path: RefCell<Option<Vec<String>>>,
        pub(super) draft_switch: Cell<Option<u64>>,
        pub(super) model_handlers: RefCell<Vec<glib::SignalHandlerId>>,
        pub(super) trash_dialog: glib::WeakRef<adw::Dialog>,
        pub(super) trashing: Cell<bool>,
        #[cfg(feature = "testing")]
        pub(super) next_picked_files: RefCell<Option<Vec<gio::File>>>,
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
            klass.install_action(
                "tree.new-folder",
                Some(glib::VariantTy::STRING_ARRAY),
                |page, _, parameter| {
                    if let Some(parent) = parameter.and_then(|value| value.get::<Vec<String>>()) {
                        page.show_new_folder(parent);
                    }
                },
            );
            klass.install_action(
                "tree.move-to",
                Some(glib::VariantTy::STRING_ARRAY),
                |page, _, parameter| {
                    if let Some(path) = parameter.and_then(|value| value.get::<Vec<String>>()) {
                        page.show_move_to(path);
                    }
                },
            );
            klass.install_action(
                "tree.trash",
                Some(glib::VariantTy::STRING_ARRAY),
                |page, _, parameter| {
                    if let Some(path) = parameter.and_then(|value| value.get::<Vec<String>>()) {
                        page.move_to_trash(path);
                    }
                },
            );
            klass.install_action(
                "tree.rename",
                Some(glib::VariantTy::STRING_ARRAY),
                |page, _, parameter| {
                    if let (Some(path), Some(tree)) = (
                        parameter.and_then(|value| value.get::<Vec<String>>()),
                        page.imp().tree.get(),
                    ) {
                        tree.start_rename(path);
                    }
                },
            );
            klass.install_action(
                "tree.new-note",
                Some(glib::VariantTy::STRING_ARRAY),
                |page, _, parameter| {
                    if let Some(parent) = parameter.and_then(|value| value.get::<Vec<String>>()) {
                        page.start_note_in(parent);
                    }
                },
            );
            for (name, direction) in [
                ("tree.move-up", MoveDirection::Up),
                ("tree.move-down", MoveDirection::Down),
            ] {
                klass.install_action(
                    name,
                    Some(glib::VariantTy::STRING_ARRAY),
                    move |page, _, parameter| {
                        if let Some(path) = parameter.and_then(|value| value.get::<Vec<String>>()) {
                            page.move_sibling(path, direction);
                        }
                    },
                );
            }
            klass.install_action(
                "tree.set-color-tag",
                Some(&<(Vec<String>, String)>::static_variant_type()),
                |page, _, parameter| {
                    if let Some((path, id)) =
                        parameter.and_then(|value| value.get::<(Vec<String>, String)>())
                    {
                        page.set_color_tag(path, &id);
                    }
                },
            );
            klass.install_action("notes.search", None, |page, _, _| {
                page.start_search();
            });
            klass.install_action("notes.new-folder", None, |page, _, _| {
                page.show_new_folder_here();
            });
            klass.install_action("notes.show-trash", None, |page, _, _| {
                page.show_trash();
            });
            klass.install_property_action("notes.tag-filter", "filter-tag");
            klass.install_property_action("notes.color-tag", "note-color-tag");
            klass.install_action("notes.rename-note", None, |page, _, _| {
                if let Some(note_view) = page.imp().note_view.get() {
                    note_view.focus_title();
                }
            });
            klass.install_action("notes.move-note", None, |page, _, _| {
                if let Some(path) = page.open_saved_path() {
                    page.show_move_to(path);
                }
            });
            klass.install_action("notes.show-details", None, |page, _, _| {
                if let Some(model) = page.imp().model.get()
                    && page.open_saved_path().is_some()
                {
                    details_dialog::present(model, page);
                }
            });
            klass.install_action("notes.trash-note", None, |page, _, _| {
                if let Some(path) = page.open_saved_path() {
                    page.move_to_trash(path);
                }
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
            page.connect_filter_tag_notify(|page| page.filter_tag_chosen());
            page.connect_note_color_tag_notify(|page| page.note_color_tag_chosen());
            self.tag_filter_banner.connect_button_clicked({
                let page = page.downgrade();
                move |_| {
                    if let Some(page) = page.upgrade() {
                        page.apply_tag_filter(None);
                    }
                }
            });
            self.split_view.connect_show_content_notify({
                let page = page.downgrade();
                move |_| {
                    if let Some(page) = page.upgrade() {
                        page.show_content_changed();
                    }
                }
            });
            page.add_controller(shortcuts());
            page.connect_search_signals();
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
            if sidebar_visible {
                if self.search_bar.is_search_mode() {
                    self.search_entry.grab_focus();
                } else if let Some(tree) = self.tree.get() {
                    tree.grab_focus();
                }
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
        let tree = NotesTree::new(model);
        let search_view = SearchView::new();
        search_view.bind(model);
        imp.sidebar_stack
            .set_transition_type(gtk::StackTransitionType::Crossfade);
        imp.sidebar_stack.add_named(&tree, Some("tree"));
        imp.sidebar_stack.add_named(&search_view, Some("search"));
        imp.sidebar_toolbar.set_content(Some(&imp.sidebar_stack));
        let _ = imp.tree.set(tree);
        let _ = imp.search_view.set(search_view);
        page.connect_search_results();
        let note_view = NoteView::new(model);
        let editor = note_view.editor();
        page.insert_action_group("editor", Some(&editor.actions()));
        editor.connect_insert_image_requested({
            let page = page.downgrade();
            move |_| {
                if let Some(page) = page.upgrade() {
                    glib::spawn_future_local(async move { page.insert_picked_images().await });
                }
            }
        });
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
        page.install_menus();
        page.append_testing_menu();

        let path = model.open_note_path();
        page.set_content_title(&model.editor_target(), path.as_deref());
        imp.open_path.replace(path);
        page.update_note_controls();
        page.update_organisation();
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
        let tree_handler = model.connect_tree_changed({
            let page = page.downgrade();
            move |_| {
                if let Some(page) = page.upgrade() {
                    page.update_organisation();
                }
            }
        });
        imp.model_handlers
            .replace(vec![handler, sync_handler, tree_handler]);
        page.update_sync_status();
        page
    }

    pub fn placeholder_visible(&self) -> bool {
        self.imp()
            .note_view
            .get()
            .is_some_and(NoteView::placeholder_visible)
    }

    async fn insert_picked_images(&self) {
        let files = self.pick_images().await;
        if files.is_empty() {
            return;
        }
        if let Some(editor) = self.imp().editor.get() {
            editor.insert_images(
                files.into_iter().map(ImageInput::File).collect(),
                InsertAt::Caret,
            );
        }
    }

    async fn pick_images(&self) -> Vec<gio::File> {
        #[cfg(feature = "testing")]
        if let Some(files) = self.imp().next_picked_files.take() {
            return files;
        }
        let images = gtk::FileFilter::new();
        images.set_name(Some("Images"));
        images.add_mime_type("image/*");
        let all = gtk::FileFilter::new();
        all.set_name(Some("All Files"));
        all.add_pattern("*");
        let filters = gio::ListStore::new::<gtk::FileFilter>();
        filters.append(&images);
        filters.append(&all);
        let dialog = gtk::FileDialog::builder()
            .title("Insert Image")
            .accept_label("Insert")
            .modal(true)
            .filters(&filters)
            .default_filter(&images)
            .build();
        let window = self.root().and_downcast::<gtk::Window>();
        let Ok(picked) = dialog.open_multiple_future(window.as_ref()).await else {
            return Vec::new();
        };
        (0..picked.n_items())
            .filter_map(|position| picked.item(position).and_downcast::<gio::File>())
            .collect()
    }

    /// Makes the next Insert Image request use these files instead of asking.
    #[cfg(feature = "testing")]
    pub fn testing_set_next_picked_files(&self, files: Vec<gio::File>) {
        self.imp().next_picked_files.replace(Some(files));
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

    fn connect_search_signals(&self) {
        let imp = self.imp();
        self.imp().search_bar.connect_search_mode_enabled_notify({
            let page = self.downgrade();
            move |_| {
                if let Some(page) = page.upgrade() {
                    page.search_mode_changed();
                }
            }
        });
        imp.search_entry.connect_search_changed({
            let page = self.downgrade();
            move |entry| {
                let Some(page) = page.upgrade() else {
                    return;
                };
                if let (true, Some(model)) = (
                    page.imp().search_bar.is_search_mode(),
                    page.imp().model.get(),
                ) {
                    model.set_search_query(entry.text().to_string());
                }
            }
        });
        imp.search_entry.connect_stop_search({
            let page = self.downgrade();
            move |_| {
                if let Some(page) = page.upgrade() {
                    page.imp().search_bar.set_search_mode(false);
                }
            }
        });
        imp.search_entry.connect_activate({
            let page = self.downgrade();
            move |_| {
                if let Some(view) = page
                    .upgrade()
                    .and_then(|page| page.imp().search_view.get().cloned())
                {
                    view.activate_first_result();
                }
            }
        });
        let keys = gtk::EventControllerKey::new();
        keys.set_propagation_phase(gtk::PropagationPhase::Capture);
        keys.connect_key_pressed({
            let page = self.downgrade();
            move |_, key, _, state| {
                let plain = state
                    .intersection(gtk::accelerator_get_default_mod_mask())
                    .is_empty();
                let focused = plain
                    && key == gdk::Key::Down
                    && page
                        .upgrade()
                        .and_then(|page| page.imp().search_view.get().cloned())
                        .is_some_and(|view| view.focus_first_result());
                if focused {
                    glib::Propagation::Stop
                } else {
                    glib::Propagation::Proceed
                }
            }
        });
        imp.search_entry.add_controller(keys);

        let escape = gtk::EventControllerKey::new();
        escape.connect_key_pressed({
            let page = self.downgrade();
            move |_, key, _, _| match page.upgrade() {
                Some(page) if key == gdk::Key::Escape && page.imp().search_bar.is_search_mode() => {
                    page.imp().search_bar.set_search_mode(false);
                    glib::Propagation::Stop
                }
                _ => glib::Propagation::Proceed,
            }
        });
        imp.sidebar_stack.add_controller(escape);
    }

    fn connect_search_results(&self) {
        let Some(view) = self.imp().search_view.get() else {
            return;
        };
        view.connect_result_activated({
            let page = self.downgrade();
            move |_, path| {
                if let Some(page) = page.upgrade() {
                    page.open_search_result(path);
                }
            }
        });
    }

    fn start_search(&self) {
        let imp = self.imp();
        if self.narrow() {
            imp.split_view.set_show_content(false);
        } else if self.sidebar_hidden() {
            self.set_sidebar_hidden(false);
        }
        if imp.search_bar.is_search_mode() {
            imp.search_entry.grab_focus();
            imp.search_entry.select_region(0, -1);
        } else {
            imp.search_bar.set_search_mode(true);
        }
    }

    fn search_mode_changed(&self) {
        let imp = self.imp();
        let Some(model) = imp.model.get() else {
            return;
        };
        if imp.search_bar.is_search_mode() {
            model.open_search();
            imp.sidebar_stack.set_visible_child_name("search");
            imp.search_entry.grab_focus();
        } else {
            model.close_search();
            imp.search_entry.set_text("");
            imp.sidebar_stack.set_visible_child_name("tree");
            if let Some(tree) = imp.tree.get() {
                tree.grab_focus();
            }
        }
    }

    fn open_search_result(&self, path: Vec<String>) {
        let imp = self.imp();
        let Some(model) = imp.model.get() else {
            return;
        };
        model.open_note(Some(path.clone()));
        imp.search_bar.set_search_mode(false);
        if let Some(tree) = imp.tree.get() {
            tree.reveal(path);
        }
        if self.narrow() {
            imp.split_view.set_show_content(true);
        }
    }

    fn show_new_folder_here(&self) {
        let Some(tree) = self.imp().tree.get() else {
            return;
        };
        let selected = tree.selected_target();
        let parent = new_folder_parent(
            selected
                .as_ref()
                .map(|(path, folder)| (path.as_slice(), *folder)),
        );
        self.show_new_folder(parent);
    }

    fn show_new_folder(&self, parent: Vec<String>) {
        let imp = self.imp();
        let (Some(model), Some(tree)) = (imp.model.get(), imp.tree.get()) else {
            return;
        };
        let tree = tree.downgrade();
        folder_dialog::present(model, self, parent, move |path| {
            if let Some(tree) = tree.upgrade() {
                tree.reveal(path);
            }
        });
    }

    fn start_note_in(&self, parent: Vec<String>) {
        let Some(model) = self.imp().model.get() else {
            return;
        };
        let start = model.start_draft(parent, DraftFocus::Name);
        let (model, page) = (model.clone(), self.downgrade());
        glib::spawn_future_local(async move {
            match start.await {
                Ok(()) => {
                    if let Some(page) = page.upgrade()
                        && page.narrow()
                    {
                        page.imp().split_view.set_show_content(true);
                    }
                }
                Err(error) => model.report_error(&error),
            }
        });
    }

    fn move_sibling(&self, path: Vec<String>, direction: MoveDirection) {
        let imp = self.imp();
        let (Some(model), Some(tree)) = (imp.model.get(), imp.tree.get()) else {
            return;
        };
        let (model, tree) = (model.clone(), tree.downgrade());
        glib::spawn_future_local(async move {
            match model.move_sibling(path, direction).await {
                Ok(Some(moved)) => {
                    if let Some(tree) = tree.upgrade() {
                        tree.reveal(moved);
                    }
                }
                Ok(None) => {}
                Err(error) => model.report_error(&error),
            }
        });
    }

    fn set_color_tag(&self, path: Vec<String>, id: &str) {
        let (Some(model), Some(tag)) = (self.imp().model.get(), tag_from_id(id)) else {
            return;
        };
        let model = model.clone();
        glib::spawn_future_local(async move {
            if let Err(error) = model.set_color_tag(path, tag).await {
                model.report_error(&error);
            }
        });
    }

    fn show_move_to(&self, path: Vec<String>) {
        let imp = self.imp();
        let (Some(model), Some(tree)) = (imp.model.get(), imp.tree.get()) else {
            return;
        };
        let tree = tree.downgrade();
        move_dialog::present(model, self, path, move |moved| {
            if let Some(tree) = tree.upgrade() {
                tree.reveal(moved);
            }
        });
    }

    fn move_to_trash(&self, path: Vec<String>) {
        let imp = self.imp();
        let Some(model) = imp.model.get() else {
            return;
        };
        if imp.trashing.replace(true) {
            return;
        }
        let (model, page) = (model.clone(), self.clone());
        glib::spawn_future_local(async move {
            trash_confirm::move_to_trash(model, page.clone().upcast(), path).await;
            page.imp().trashing.set(false);
        });
    }

    fn show_trash(&self) {
        let imp = self.imp();
        let (Some(model), Some(tree)) = (imp.model.get(), imp.tree.get()) else {
            return;
        };
        if imp.trash_dialog.upgrade().is_some() {
            return;
        }
        let tree = tree.downgrade();
        let dialog = trash_dialog::present(model, self, move |restored| {
            if let Some(tree) = tree.upgrade() {
                tree.reveal(restored);
            }
        });
        imp.trash_dialog.set(Some(&dialog));
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

    fn install_menus(&self) {
        let imp = self.imp();
        let filter = gtk::gio::Menu::new();
        imp.main_menu.insert_section(1, None, &filter);
        let _ = imp.filter_menu.set(filter);
        let organise = gtk::gio::Menu::new();
        imp.note_menu.insert_section(0, None, &organise);
        let _ = imp.organise_menu.set(organise);
    }

    fn open_saved_path(&self) -> Option<Vec<String>> {
        match self.imp().model.get()?.editor_target() {
            EditorTarget::Note(path) => Some(path),
            _ => None,
        }
    }

    fn update_organisation(&self) {
        self.rebuild_filter_menu();
        self.rebuild_organise_menu();
        self.update_tag_filter();
        self.update_note_actions();
    }

    fn rebuild_filter_menu(&self) {
        let imp = self.imp();
        let (Some(model), Some(menu)) = (imp.model.get(), imp.filter_menu.get()) else {
            return;
        };
        menu.remove_all();
        let tags = model.filter_tags();
        if tags.is_empty() {
            return;
        }
        let options = model.tag_options();
        let choices = gtk::gio::Menu::new();
        choices.append_item(&tag_item("All Notes", "notes.tag-filter", ""));
        for tag in tags {
            choices.append_item(&tag_item(
                &tag_label(tag, &options),
                "notes.tag-filter",
                tag_id(tag),
            ));
        }
        menu.append_submenu(Some("Filter by Color Tag"), &choices);
    }

    fn rebuild_organise_menu(&self) {
        let imp = self.imp();
        let (Some(model), Some(menu)) = (imp.model.get(), imp.organise_menu.get()) else {
            return;
        };
        menu.remove_all();
        menu.append(Some("Rename"), Some("notes.rename-note"));
        menu.append(Some("Move To…"), Some("notes.move-note"));
        if model.tags_writable() {
            let options = model.tag_options();
            let choices = gtk::gio::Menu::new();
            choices.append_item(&tag_item("None", "notes.color-tag", ""));
            for tag in COLOR_TAGS {
                choices.append_item(&tag_item(
                    &tag_label(tag, &options),
                    "notes.color-tag",
                    tag_id(tag),
                ));
            }
            menu.append_submenu(Some("Color Tag"), &choices);
        }
        menu.append(Some("Details"), Some("notes.show-details"));
        menu.append(Some("Move to Trash"), Some("notes.trash-note"));
    }

    fn update_tag_filter(&self) {
        let imp = self.imp();
        let Some(model) = imp.model.get() else {
            return;
        };
        let active = model.tag_filter();
        let id = active.map_or("", tag_id);
        if self.filter_tag() != id {
            self.set_filter_tag(id.to_owned());
        }
        match active {
            Some(tag) => {
                let label = tag_label(tag, &model.tag_options());
                imp.tag_filter_banner
                    .set_title(&format!("Showing notes tagged {label}"));
                imp.tag_filter_banner.set_revealed(true);
            }
            None => imp.tag_filter_banner.set_revealed(false),
        }
    }

    fn update_note_actions(&self) {
        let Some(model) = self.imp().model.get() else {
            return;
        };
        let path = self.open_saved_path();
        for action in [
            "notes.rename-note",
            "notes.move-note",
            "notes.show-details",
            "notes.trash-note",
        ] {
            self.action_set_enabled(action, path.is_some());
        }
        let tag = path
            .as_deref()
            .and_then(|path| open_note_menu_tag(model, path));
        self.action_set_enabled("notes.color-tag", tag.is_some());
        let id = tag.flatten().map_or("", tag_id);
        if self.note_color_tag() != id {
            self.set_note_color_tag(id.to_owned());
        }
    }

    fn filter_tag_chosen(&self) {
        match tag_from_id(&self.filter_tag()) {
            Some(tag) => self.apply_tag_filter(tag),
            None => self.update_tag_filter(),
        }
    }

    fn apply_tag_filter(&self, tag: Option<ColorTag>) {
        let Some(model) = self.imp().model.get() else {
            return;
        };
        if tag == model.tag_filter() {
            return;
        }
        let (model, page) = (model.clone(), self.downgrade());
        glib::spawn_future_local(async move {
            if let Err(error) = model.set_tag_filter(tag).await {
                model.report_error(&error);
                if let Some(page) = page.upgrade() {
                    page.update_tag_filter();
                }
            }
        });
    }

    fn note_color_tag_chosen(&self) {
        let (Some(model), Some(path)) = (self.imp().model.get(), self.open_saved_path()) else {
            return;
        };
        let Some(tag) = tag_from_id(&self.note_color_tag()) else {
            self.update_note_actions();
            return;
        };
        let current = open_note_menu_tag(model, &path);
        if current.is_none_or(|current| current == tag) {
            return;
        }
        let (model, page) = (model.clone(), self.downgrade());
        glib::spawn_future_local(async move {
            if let Err(error) = model.set_color_tag(path, tag).await {
                model.report_error(&error);
                if let Some(page) = page.upgrade() {
                    page.update_note_actions();
                }
            }
        });
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
        self.update_organisation();
        if opened && imp.split_view.is_collapsed() {
            imp.split_view.set_show_content(true);
        }
    }
}

fn open_note_menu_tag(model: &AppModel, path: &[String]) -> Option<Option<ColorTag>> {
    if !model.tags_writable() {
        return None;
    }
    model
        .open_note_tag_and_sharing(path)
        .map(|(color_tag, _)| color_tag)
}

fn shortcuts() -> gtk::ShortcutController {
    let controller = gtk::ShortcutController::new();
    controller.set_scope(gtk::ShortcutScope::Managed);
    for (trigger, action) in [
        ("F9", "notes.toggle-sidebar"),
        ("<Control>r", "win.refresh"),
        ("<Control>f", "notes.search"),
        ("<Control>k", "notes.search"),
        ("<Control><Shift>n", "notes.new-folder"),
    ] {
        controller.add_shortcut(gtk::Shortcut::new(
            gtk::ShortcutTrigger::parse_string(trigger),
            Some(gtk::NamedAction::new(action)),
        ));
    }
    controller
}

fn tag_item(label: &str, action: &str, target: &str) -> gtk::gio::MenuItem {
    let item = gtk::gio::MenuItem::new(Some(label), None);
    item.set_action_and_target_value(Some(action), Some(&target.to_variant()));
    item
}
