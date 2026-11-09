use std::cell::{Cell, RefCell};
use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::commands::{
    ImportDestinationView, ImportForm, ImportFormCopy, ImportPolicy, ImportTargetView,
};
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use crate::model::AppModel;
use crate::window::host_dialog_toasts;

const BASE_MARGIN: i32 = 12;
const INDENT_PER_LEVEL: i32 = 16;
const NEW_FOLDER: &str = "new-folder";
const EXISTING_FOLDER: &str = "existing-folder";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Choice {
    NewFolder,
    ExistingFolder,
}

impl Choice {
    fn name(self) -> &'static str {
        match self {
            Self::NewFolder => NEW_FOLDER,
            Self::ExistingFolder => EXISTING_FOLDER,
        }
    }

    fn from_name(name: &str) -> Option<Self> {
        match name {
            NEW_FOLDER => Some(Self::NewFolder),
            EXISTING_FOLDER => Some(Self::ExistingFolder),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    Form,
    Conflicts,
    SetUp,
}

impl Stage {
    fn of(setting_up: bool, offers_rename: bool) -> Self {
        if setting_up {
            Self::SetUp
        } else if offers_rename {
            Self::Conflicts
        } else {
            Self::Form
        }
    }

    fn title(self, copy: &ImportFormCopy) -> &str {
        match self {
            Self::Form => &copy.title,
            Self::Conflicts => &copy.conflicts_title,
            Self::SetUp => &copy.setup_title,
        }
    }
}

fn destination(choice: Choice, folder_name: &str, selected: &[String]) -> ImportDestinationView {
    match choice {
        Choice::NewFolder => ImportDestinationView::NewFolder {
            parent: Vec::new(),
            name: folder_name.trim().to_owned(),
        },
        Choice::ExistingFolder if selected.is_empty() => ImportDestinationView::Root,
        Choice::ExistingFolder => ImportDestinationView::Folder {
            path: selected.to_vec(),
        },
    }
}

fn can_import(destination: &ImportDestinationView) -> bool {
    match destination {
        ImportDestinationView::NewFolder { name, .. } => !name.is_empty(),
        ImportDestinationView::Root | ImportDestinationView::Folder { .. } => true,
    }
}

fn target_margin(depth: u32) -> i32 {
    BASE_MARGIN
        + i32::try_from(depth)
            .unwrap_or(0)
            .saturating_mul(INDENT_PER_LEVEL)
}

/// The first target is the top level, which the form's copy names.
fn target_label<'a>(
    index: usize,
    target: &'a ImportTargetView,
    copy: &'a ImportFormCopy,
) -> &'a str {
    if index == 0 {
        &copy.root_label
    } else {
        &target.label
    }
}

struct Dialog {
    model: AppModel,
    form: Rc<ImportForm>,
    dialog: adw::Dialog,
    file: adw::PreferencesGroup,
    into: adw::PreferencesGroup,
    choice: adw::ToggleGroup,
    name_group: adw::PreferencesGroup,
    folder_name: adw::EntryRow,
    targets_group: adw::PreferencesGroup,
    targets: gtk::ListBox,
    checks: Vec<gtk::Image>,
    preview: gtk::Label,
    message: gtk::Label,
    confirm: gtk::Button,
    rename: gtk::Button,
    enable_atomic: gtk::Button,
    selected: RefCell<Vec<String>>,
    open: Cell<bool>,
}

/// The import form for a picked archive, which follows the model's import state until the form
/// is gone. Closing it cancels the import.
#[derive(Clone)]
pub struct ImportDialog(Rc<Dialog>);

impl ImportDialog {
    pub fn present(model: &AppModel, anchor: &impl IsA<gtk::Widget>, form: Rc<ImportForm>) -> Self {
        let copy = &form.copy;
        let file = adw::PreferencesGroup::new();
        file.add(
            &adw::ActionRow::builder()
                .name("import-file-name")
                .title(&form.file_name)
                .use_markup(false)
                .build(),
        );
        if let Some(skipped) = &form.skipped {
            file.add(&note_label("import-skipped", skipped));
        }
        if form.empty {
            file.add(&note_label("import-empty", &copy.empty_text));
        }

        let choice = adw::ToggleGroup::builder()
            .name("import-target")
            .homogeneous(true)
            .build();
        for (option, label) in [
            (Choice::NewFolder, &copy.new_folder_label),
            (Choice::ExistingFolder, &copy.existing_folder_label),
        ] {
            choice.add(
                adw::Toggle::builder()
                    .name(option.name())
                    .label(label)
                    .build(),
            );
        }
        choice.set_active_name(Some(Choice::NewFolder.name()));
        let into = adw::PreferencesGroup::builder()
            .title(glib::markup_escape_text(&copy.into_label))
            .build();
        into.add(&choice);

        let folder_name = adw::EntryRow::builder()
            .name("import-folder-name")
            .title(&copy.folder_name_label)
            .text(&form.default_folder_name)
            .activates_default(true)
            .build();
        let name_group = adw::PreferencesGroup::new();
        name_group.add(&folder_name);

        let targets = gtk::ListBox::builder()
            .name("import-targets")
            .selection_mode(gtk::SelectionMode::Browse)
            .css_classes(["boxed-list"])
            .build();
        let checks = fill_targets(&targets, &form);
        let targets_group = adw::PreferencesGroup::builder().visible(false).build();
        targets_group.add(&targets);

        let preview = gtk::Label::builder()
            .name("import-preview")
            .xalign(0.0)
            .wrap(true)
            .visible(false)
            .build();
        let message = gtk::Label::builder()
            .name("import-message")
            .accessible_role(gtk::AccessibleRole::Alert)
            .xalign(0.0)
            .wrap(true)
            .visible(false)
            .build();
        let confirm = action_button("import-confirm", &copy.import_label);
        let rename = action_button("import-rename", &copy.rename_label);
        let enable_atomic = action_button("import-enable-atomic", &copy.enable_atomic_label);
        let outcome = adw::PreferencesGroup::new();
        for widget in [
            preview.upcast_ref::<gtk::Widget>(),
            message.upcast_ref(),
            confirm.upcast_ref(),
            rename.upcast_ref(),
            enable_atomic.upcast_ref(),
        ] {
            outcome.add(widget);
        }

        let page = adw::PreferencesPage::new();
        for group in [&file, &into, &name_group, &targets_group, &outcome] {
            page.add(group);
        }

        let cancel = gtk::Button::builder()
            .name("import-cancel")
            .label(&copy.cancel_label)
            .build();
        let header = adw::HeaderBar::builder()
            .show_start_title_buttons(false)
            .show_end_title_buttons(false)
            .build();
        header.pack_start(&cancel);
        let toolbar = adw::ToolbarView::new();
        toolbar.add_top_bar(&header);
        toolbar.set_content(Some(&page));
        let toasts = adw::ToastOverlay::new();
        toasts.set_child(Some(&toolbar));

        let dialog = adw::Dialog::builder()
            .name("import-dialog")
            .content_width(480)
            .content_height(560)
            .child(&toasts)
            .build();

        let state = Rc::new(Dialog {
            model: model.clone(),
            form: form.clone(),
            dialog: dialog.clone(),
            file,
            into,
            choice,
            name_group,
            folder_name,
            targets_group,
            targets,
            checks,
            preview,
            message,
            confirm,
            rename,
            enable_atomic,
            selected: RefCell::new(
                form.targets
                    .first()
                    .map(|target| target.path.clone())
                    .unwrap_or_default(),
            ),
            open: Cell::new(true),
        });
        state.connect(&cancel);
        state.refresh();
        state.choose_target_row(0);

        host_dialog_toasts(anchor, &dialog, &toasts);
        dialog.present(Some(anchor));
        state.request_preview();
        Self(state)
    }

    pub fn shows(&self, form: &Rc<ImportForm>) -> bool {
        Rc::ptr_eq(&self.0.form, form)
    }

    pub fn is_open(&self) -> bool {
        self.0.open.get()
    }

    pub fn refresh(&self) {
        self.0.refresh();
    }

    /// Closes the dialog without cancelling the import.
    pub fn close(&self) {
        if self.0.open.replace(false) {
            self.0.dialog.force_close();
        }
    }
}

fn note_label(name: &str, text: &str) -> gtk::Label {
    gtk::Label::builder()
        .name(name)
        .label(text)
        .css_classes(["dim-label"])
        .margin_top(12)
        .xalign(0.0)
        .wrap(true)
        .build()
}

fn action_button(name: &str, label: &str) -> gtk::Button {
    gtk::Button::builder()
        .name(name)
        .label(label)
        .margin_top(12)
        .halign(gtk::Align::Center)
        .css_classes(["suggested-action", "pill"])
        .visible(false)
        .build()
}

fn fill_targets(list: &gtk::ListBox, form: &ImportForm) -> Vec<gtk::Image> {
    form.targets
        .iter()
        .enumerate()
        .map(|(index, target)| {
            let label = gtk::Label::builder()
                .label(target_label(index, target, &form.copy))
                .xalign(0.0)
                .hexpand(true)
                .ellipsize(gtk::pango::EllipsizeMode::End)
                .build();
            let check = gtk::Image::builder()
                .icon_name("object-select-symbolic")
                .visible(false)
                .build();
            let content = gtk::Box::builder()
                .spacing(6)
                .margin_top(12)
                .margin_bottom(12)
                .margin_start(target_margin(target.depth))
                .margin_end(BASE_MARGIN)
                .build();
            content.append(&label);
            content.append(&check);
            list.append(
                &gtk::ListBoxRow::builder()
                    .name(format!("import-target-{index}"))
                    .child(&content)
                    .build(),
            );
            check
        })
        .collect()
}

impl Dialog {
    fn connect(self: &Rc<Self>, cancel: &gtk::Button) {
        cancel.connect_clicked({
            let dialog = self.dialog.downgrade();
            move |_| {
                if let Some(dialog) = dialog.upgrade() {
                    dialog.close();
                }
            }
        });
        self.choice.connect_active_name_notify({
            let state = Rc::downgrade(self);
            move |_| {
                if let Some(state) = state.upgrade() {
                    state.destination_changed();
                }
            }
        });
        self.folder_name.connect_changed({
            let state = Rc::downgrade(self);
            move |_| {
                if let Some(state) = state.upgrade() {
                    state.destination_changed();
                }
            }
        });
        self.targets.connect_row_selected({
            let state = Rc::downgrade(self);
            move |_, row| {
                if let (Some(state), Some(row)) = (state.upgrade(), row) {
                    state.target_selected(row);
                }
            }
        });
        self.confirm.connect_clicked({
            let state = Rc::downgrade(self);
            move |_| {
                if let Some(state) = state.upgrade() {
                    state.commit(ImportPolicy::Stop);
                }
            }
        });
        self.rename.connect_clicked({
            let state = Rc::downgrade(self);
            move |_| {
                if let Some(state) = state.upgrade() {
                    state.commit(ImportPolicy::Rename);
                }
            }
        });
        self.enable_atomic.connect_clicked({
            let model = self.model.clone();
            move |_| {
                let model = model.clone();
                glib::spawn_future_local(async move { model.enable_atomic_and_retry().await });
            }
        });
        self.dialog.connect_closed({
            let state = Rc::downgrade(self);
            let (model, form) = (self.model.clone(), self.form.clone());
            move |_| {
                if let Some(state) = state.upgrade() {
                    state.open.set(false);
                }
                if model
                    .import_form()
                    .is_some_and(|current| Rc::ptr_eq(&current, &form))
                {
                    model.cancel_import();
                }
            }
        });
    }

    fn choice(&self) -> Choice {
        self.choice
            .active_name()
            .as_deref()
            .and_then(Choice::from_name)
            .unwrap_or(Choice::NewFolder)
    }

    fn destination(&self) -> ImportDestinationView {
        destination(
            self.choice(),
            &self.folder_name.text(),
            &self.selected.borrow(),
        )
    }

    fn stage(&self) -> Stage {
        Stage::of(
            self.model.import_setup().is_some(),
            self.model.import_offers_rename(),
        )
    }

    fn refresh(&self) {
        let model = &self.model;
        let copy = &self.form.copy;
        let busy = model.import_busy();
        let setup = model.import_setup();
        let stage = self.stage();
        self.dialog.set_title(stage.title(copy));
        self.dialog.set_can_close(!busy);

        let form = stage == Stage::Form;
        let choosing = form && !self.form.empty;
        self.file.set_visible(form);
        self.into.set_visible(choosing);
        self.show_choice(choosing);

        let preview = model.import_preview().filter(|_| choosing);
        self.preview
            .set_label(preview.as_deref().unwrap_or_default());
        self.preview.set_visible(preview.is_some());

        let message = match &setup {
            Some(setup) => Some(setup.message.clone()),
            None => model.import_outcome_message(),
        };
        self.message
            .set_label(message.as_deref().unwrap_or_default());
        self.message.set_visible(message.is_some());
        if form {
            self.message.add_css_class("error");
        } else {
            self.message.remove_css_class("error");
        }

        self.confirm.set_visible(choosing);
        self.confirm.set_label(if busy {
            &copy.importing_label
        } else {
            &copy.import_label
        });
        self.update_confirm();
        self.rename.set_visible(stage == Stage::Conflicts);
        self.rename.set_sensitive(!busy);
        self.enable_atomic
            .set_visible(setup.as_ref().is_some_and(|setup| setup.can_configure));
        self.enable_atomic.set_sensitive(!busy);

        let default = match stage {
            Stage::Form => &self.confirm,
            Stage::Conflicts => &self.rename,
            Stage::SetUp => &self.enable_atomic,
        };
        self.dialog
            .set_default_widget(default.is_visible().then_some(default));
    }

    fn show_choice(&self, choosing: bool) {
        let choice = self.choice();
        self.name_group
            .set_visible(choosing && choice == Choice::NewFolder);
        self.targets_group
            .set_visible(choosing && choice == Choice::ExistingFolder);
    }

    fn update_confirm(&self) {
        self.confirm
            .set_sensitive(!self.model.import_busy() && can_import(&self.destination()));
    }

    fn destination_changed(&self) {
        self.show_choice(self.stage() == Stage::Form && !self.form.empty);
        self.update_confirm();
        self.request_preview();
    }

    fn target_selected(&self, row: &gtk::ListBoxRow) {
        let Some(index) = usize::try_from(row.index()).ok() else {
            return;
        };
        let Some(target) = self.form.targets.get(index) else {
            return;
        };
        for (position, check) in self.checks.iter().enumerate() {
            check.set_visible(position == index);
        }
        if *self.selected.borrow() == target.path {
            return;
        }
        self.selected.replace(target.path.clone());
        self.destination_changed();
    }

    fn choose_target_row(&self, index: i32) {
        if let Some(row) = self.targets.row_at_index(index) {
            self.targets.select_row(Some(&row));
        }
    }

    fn request_preview(&self) {
        if self.form.empty {
            return;
        }
        let (model, destination) = (self.model.clone(), self.destination());
        glib::spawn_future_local(async move { model.preview_import(destination).await });
    }

    fn commit(&self, policy: ImportPolicy) {
        let (model, destination) = (self.model.clone(), self.destination());
        if !can_import(&destination) {
            return;
        }
        glib::spawn_future_local(async move { model.commit_import(destination, policy).await });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    fn copy() -> ImportFormCopy {
        let text = |value: &str| value.to_owned();
        ImportFormCopy {
            title: text("Import"),
            conflicts_title: text("Conflicts"),
            setup_title: text("Set up"),
            into_label: text("Into"),
            new_folder_label: text("New folder"),
            folder_name_label: text("Folder name"),
            existing_folder_label: text("Existing folder"),
            root_label: text("Top level"),
            empty_text: text("Empty"),
            import_label: text("Import"),
            importing_label: text("Importing…"),
            rename_label: text("Rename"),
            enable_atomic_label: text("Enable"),
            cancel_label: text("Cancel"),
        }
    }

    #[test]
    fn a_new_folder_is_named_by_the_trimmed_text_at_the_top_level() {
        assert_eq!(
            destination(Choice::NewFolder, "  Imported  ", &path(&["a"])),
            ImportDestinationView::NewFolder {
                parent: Vec::new(),
                name: "Imported".to_owned(),
            }
        );
    }

    #[test]
    fn an_existing_folder_is_the_selected_path_or_the_top_level() {
        assert_eq!(
            destination(Choice::ExistingFolder, "Ignored", &[]),
            ImportDestinationView::Root
        );
        assert_eq!(
            destination(Choice::ExistingFolder, "Ignored", &path(&["a", "b"])),
            ImportDestinationView::Folder {
                path: path(&["a", "b"])
            }
        );
    }

    #[test]
    fn only_a_new_folder_without_a_name_cannot_be_imported_into() {
        assert!(!can_import(&destination(Choice::NewFolder, "   ", &[])));
        assert!(can_import(&destination(Choice::NewFolder, "x", &[])));
        assert!(can_import(&ImportDestinationView::Root));
        assert!(can_import(&ImportDestinationView::Folder {
            path: path(&["a"])
        }));
    }

    #[test]
    fn targets_are_indented_by_depth() {
        assert_eq!(target_margin(0), BASE_MARGIN);
        assert_eq!(target_margin(2), BASE_MARGIN + 2 * INDENT_PER_LEVEL);
    }

    #[test]
    fn the_first_target_is_labelled_as_the_top_level() {
        let copy = copy();
        let target = ImportTargetView {
            path: path(&["a"]),
            label: "a".to_owned(),
            depth: 0,
        };
        assert_eq!(target_label(0, &target, &copy), "Top level");
        assert_eq!(target_label(1, &target, &copy), "a");
    }

    #[test]
    fn the_stage_prefers_set_up_then_conflicts() {
        assert_eq!(Stage::of(true, true), Stage::SetUp);
        assert_eq!(Stage::of(false, true), Stage::Conflicts);
        assert_eq!(Stage::of(false, false), Stage::Form);
        let copy = copy();
        assert_eq!(Stage::SetUp.title(&copy), "Set up");
        assert_eq!(Stage::Conflicts.title(&copy), "Conflicts");
        assert_eq!(Stage::Form.title(&copy), "Import");
    }

    #[test]
    fn choices_round_trip_through_their_toggle_names() {
        for choice in [Choice::NewFolder, Choice::ExistingFolder] {
            assert_eq!(Choice::from_name(choice.name()), Some(choice));
        }
        assert_eq!(Choice::from_name("elsewhere"), None);
    }
}
