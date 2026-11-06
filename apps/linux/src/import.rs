use std::cell::RefCell;
use std::rc::Rc;

use adw::prelude::*;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use crate::file_dialogs;
use crate::model::AppModel;
use crate::pages::notes::ImportDialog;

const PICK_TITLE: &str = "Import Notes";
const FILTER_NAME: &str = "Notes and Archives";
const IMPORTABLE_SUFFIXES: [&str; 4] = ["zip", "md", "markdown", "txt"];
const CANCEL_LABEL: &str = "Cancel";
const CANCEL: &str = "cancel";
const ENABLE: &str = "enable";
const SAVE_WITHOUT: &str = "save-without";

/// Asks for notes or archives to import and hands them to the model; a cancelled dialog imports
/// nothing.
pub async fn import_notes(model: &AppModel, parent: Option<&gtk::Window>) {
    let Some(files) = file_dialogs::pick_files(parent, PICK_TITLE, &[importable_filter()]).await
    else {
        return;
    };
    if !files.is_empty() {
        model.import_files(files).await;
    }
}

fn importable_filter() -> gtk::FileFilter {
    let filter = gtk::FileFilter::new();
    filter.set_name(Some(FILTER_NAME));
    for suffix in IMPORTABLE_SUFFIXES {
        filter.add_suffix(suffix);
    }
    filter
}

/// Shows the model's import state on the window while it is alive: the import form, the prompt
/// to set up a repository for a dropped file and the prompt for a save the repository blocked.
pub struct ImportPrompts {
    model: AppModel,
    handler: Option<glib::SignalHandlerId>,
}

struct Prompts {
    window: glib::WeakRef<gtk::Window>,
    form: RefCell<Option<ImportDialog>>,
    drop_setup: RefCell<Option<adw::AlertDialog>>,
    atomic_blocked: RefCell<Option<adw::AlertDialog>>,
}

impl ImportPrompts {
    pub fn attach(window: &impl IsA<gtk::Window>, model: &AppModel) -> Self {
        let prompts = Rc::new(Prompts {
            window: window.as_ref().downgrade(),
            form: RefCell::default(),
            drop_setup: RefCell::default(),
            atomic_blocked: RefCell::default(),
        });
        prompts.sync(model);
        let handler = model.connect_import_changed(move |model| prompts.sync(model));
        Self {
            model: model.clone(),
            handler: Some(handler),
        }
    }
}

impl Drop for ImportPrompts {
    fn drop(&mut self) {
        if let Some(handler) = self.handler.take() {
            self.model.disconnect(handler);
        }
    }
}

impl Prompts {
    fn sync(self: &Rc<Self>, model: &AppModel) {
        self.sync_form(model);
        self.sync_drop_setup(model);
        self.sync_atomic_blocked(model);
    }

    fn sync_form(&self, model: &AppModel) {
        let Some(form) = model.import_form() else {
            if let Some(open) = self.form.take() {
                open.close();
            }
            return;
        };
        let open = self.form.borrow().clone();
        match open {
            Some(open) if open.is_open() && open.shows(&form) => open.refresh(),
            open => {
                if let Some(open) = open {
                    self.form.take();
                    open.close();
                }
                if let Some(window) = self.window.upgrade() {
                    let dialog = ImportDialog::present(model, &window, form);
                    self.form.replace(Some(dialog));
                }
            }
        }
    }

    fn sync_drop_setup(self: &Rc<Self>, model: &AppModel) {
        let Some(setup) = model.import_drop_setup() else {
            close_alert(&self.drop_setup);
            return;
        };
        let Some(window) = self.missing_alert_window(&self.drop_setup) else {
            return;
        };
        let alert = adw::AlertDialog::new(Some(&setup.message), None);
        alert.set_widget_name("import-drop-setup-dialog");
        alert.add_response(CANCEL, CANCEL_LABEL);
        if setup.can_configure {
            alert.add_response(ENABLE, &setup.action_label);
            alert.set_response_appearance(ENABLE, adw::ResponseAppearance::Suggested);
            alert.set_default_response(Some(ENABLE));
        }
        alert.set_close_response(CANCEL);
        alert.connect_response(None, {
            let prompts = Rc::downgrade(self);
            let model = model.clone();
            move |alert, response| {
                if prompts
                    .upgrade()
                    .is_none_or(|prompts| !take_alert(&prompts.drop_setup, alert))
                {
                    return;
                }
                if response == ENABLE {
                    let model = model.clone();
                    glib::spawn_future_local(async move { model.enable_atomic_and_retry().await });
                } else {
                    model.dismiss_drop_setup();
                }
            }
        });
        self.drop_setup.replace(Some(alert.clone()));
        alert.present(Some(&window));
    }

    fn sync_atomic_blocked(self: &Rc<Self>, model: &AppModel) {
        let Some(blocked) = model.import_atomic_blocked() else {
            close_alert(&self.atomic_blocked);
            return;
        };
        let Some(window) = self.missing_alert_window(&self.atomic_blocked) else {
            return;
        };
        let alert = adw::AlertDialog::new(Some(&blocked.title), Some(&blocked.message));
        alert.set_widget_name("import-atomic-blocked-dialog");
        if blocked.can_configure {
            alert.add_response(ENABLE, &blocked.enable_label);
            alert.set_response_appearance(ENABLE, adw::ResponseAppearance::Suggested);
            alert.set_default_response(Some(ENABLE));
        }
        alert.add_response(SAVE_WITHOUT, &blocked.save_without_label);
        alert.set_can_close(false);
        alert.connect_response(None, {
            let prompts = Rc::downgrade(self);
            let model = model.clone();
            move |alert, response| {
                let enable = match response {
                    ENABLE => true,
                    SAVE_WITHOUT => false,
                    _ => return,
                };
                if prompts
                    .upgrade()
                    .is_none_or(|prompts| !take_alert(&prompts.atomic_blocked, alert))
                {
                    return;
                }
                alert.force_close();
                let model = model.clone();
                glib::spawn_future_local(async move { model.resolve_atomic_blocked(enable).await });
            }
        });
        self.atomic_blocked.replace(Some(alert.clone()));
        alert.present(Some(&window));
    }

    /// The window to present a prompt on, when the prompt is not shown yet.
    fn missing_alert_window(
        &self,
        slot: &RefCell<Option<adw::AlertDialog>>,
    ) -> Option<gtk::Window> {
        if slot.borrow().is_some() {
            return None;
        }
        self.window.upgrade()
    }
}

/// Forgets `alert` as the shown prompt; false when the model already dismissed it.
fn take_alert(slot: &RefCell<Option<adw::AlertDialog>>, alert: &adw::AlertDialog) -> bool {
    if slot.borrow().as_ref() != Some(alert) {
        return false;
    }
    slot.take();
    true
}

fn close_alert(slot: &RefCell<Option<adw::AlertDialog>>) {
    if let Some(alert) = slot.take() {
        alert.force_close();
    }
}
