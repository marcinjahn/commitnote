mod appearance;
mod binding;
mod data;
mod device;
mod editor;
mod notes;
mod rows;
mod save_status;
mod scope;
mod swatches;

use std::cell::RefCell;
use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::settings::SettingsCopy;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use self::appearance::Appearance;
use self::binding::Binding;
use self::data::Data;
use self::device::Device;
use self::editor::Editor;
use self::notes::Notes;
use self::save_status::SaveStatus;
use crate::model::{AppModel, Route};
use crate::window::host_dialog_toasts;

const NARROW_WIDTH_SP: f64 = 500.0;

struct Preferences {
    dialog: adw::PreferencesDialog,
    copy: Rc<SettingsCopy>,
    binding: Rc<Binding>,
    save_status: SaveStatus,
    appearance: Appearance,
    editor: Editor,
    notes: Notes,
    device: Rc<Device>,
    data: Data,
}

struct Connections {
    model: AppModel,
    model_handlers: Vec<glib::SignalHandlerId>,
    style: adw::StyleManager,
    style_handlers: Vec<glib::SignalHandlerId>,
}

/// Presents the settings of the open repository over `anchor`; `None` before they are loaded.
pub fn present(model: &AppModel, anchor: &impl IsA<gtk::Widget>) -> Option<adw::PreferencesDialog> {
    let copy = model.settings_copy()?;
    let binding = Binding::new(model);
    let preferences = Rc::new(Preferences {
        dialog: adw::PreferencesDialog::builder()
            .name("preferences-dialog")
            .title(&copy.title)
            .search_enabled(true)
            .build(),
        save_status: SaveStatus::new(&binding, &copy),
        appearance: Appearance::new(&binding, &copy),
        editor: Editor::new(&binding, &copy),
        notes: Notes::new(&binding, &copy),
        device: Device::new(&binding, &copy),
        data: Data::new(&copy),
        copy,
        binding,
    });
    preferences.build_page();
    preferences.binding.on_failure({
        let preferences = Rc::downgrade(&preferences);
        move || {
            if let Some(preferences) = preferences.upgrade() {
                preferences.show_view();
            }
        }
    });

    let connections = RefCell::new(Some(preferences.connect()));
    let owner = RefCell::new(Some(preferences.clone()));
    preferences.dialog.connect_closed(move |_| {
        if let Some(connections) = connections.take() {
            connections.disconnect();
        }
        if let Some(preferences) = owner.take() {
            preferences.save_on_close();
        }
    });

    let dialog = preferences.dialog.clone();
    host_dialog_toasts(anchor, dialog.upcast_ref(), &dialog);
    preferences.show_view();
    preferences.show_save();
    preferences.show_export();
    preferences.show_import();
    dialog.present(Some(anchor));
    Some(dialog)
}

impl Preferences {
    fn build_page(&self) {
        let page = adw::PreferencesPage::builder()
            .title(&self.copy.title)
            .description(glib::markup_escape_text(&self.copy.intro))
            .build();
        page.add(&self.save_status.group);
        page.add(&self.appearance.group);
        page.add(&self.editor.group);
        page.add(&self.notes.group);
        page.add(&self.device.group);
        page.add(&self.data.group);
        self.dialog.add(&page);

        let narrow = adw::Breakpoint::new(adw::BreakpointCondition::new_length(
            adw::BreakpointConditionLengthType::MaxWidth,
            NARROW_WIDTH_SP,
            adw::LengthUnit::Sp,
        ));
        let vertical = gtk::Orientation::Vertical.to_value();
        for scope in self
            .appearance
            .inline_scopes()
            .into_iter()
            .chain([self.editor.inline_scope()])
        {
            narrow.add_setter(scope, "orientation", Some(&vertical));
        }
        self.dialog.add_breakpoint(narrow);
    }

    fn connect(self: &Rc<Self>) -> Connections {
        let model = self.binding.model().clone();
        let model_handlers = vec![
            model.connect_settings_changed({
                let preferences = self.clone();
                move |_| preferences.show_view()
            }),
            model.connect_settings_save_changed({
                let preferences = self.clone();
                move |_| preferences.show_save()
            }),
            model.connect_export_changed({
                let preferences = self.clone();
                move |_| preferences.show_export()
            }),
            model.connect_import_changed({
                let preferences = self.clone();
                move |_| preferences.show_import()
            }),
            model.connect_route_changed({
                let preferences = self.clone();
                move |_| {
                    preferences.close_if_stale();
                }
            }),
        ];
        let style = adw::StyleManager::default();
        let style_handlers = vec![
            style.connect_dark_notify({
                let preferences = self.clone();
                move |_| preferences.appearance.follow_style()
            }),
            style.connect_accent_color_rgba_notify({
                let preferences = self.clone();
                move |_| preferences.appearance.follow_style()
            }),
        ];
        Connections {
            model,
            model_handlers,
            style,
            style_handlers,
        }
    }

    /// Whether the settings shown still belong to the open notes page's repository.
    fn is_current(&self) -> bool {
        let model = self.binding.model();
        model.route() == Route::Notes
            && model
                .settings_copy()
                .is_some_and(|copy| Rc::ptr_eq(&copy, &self.copy))
    }

    fn close_if_stale(&self) -> bool {
        let stale = !self.is_current();
        if stale {
            self.dialog.force_close();
        }
        stale
    }

    fn show_view(&self) {
        if self.close_if_stale() {
            return;
        }
        let Some(view) = self.binding.model().settings_view() else {
            return;
        };
        self.binding.showing_view(|| {
            self.appearance.show(&view);
            self.editor.show(&view);
            self.notes.show(&view);
            self.device.show(&view);
        });
    }

    fn show_export(&self) {
        self.data.show_export(self.binding.model().exporting());
    }

    fn show_import(&self) {
        self.data.show_import(self.binding.model().is_importing());
    }

    fn show_save(&self) {
        if self.close_if_stale() {
            return;
        }
        self.save_status
            .show(self.binding.model().settings_save().as_ref());
    }

    /// Stores a device name left unsaved in its entry, then saves pending settings at once
    /// instead of after the core's debounce.
    fn save_on_close(&self) {
        let model = self.binding.model().clone();
        let name = model
            .settings_view()
            .and_then(|view| self.device.unsaved_name(&view));
        glib::spawn_future_local(async move {
            if let Some(name) = name
                && let Err(error) = model.set_device_name(name).await
            {
                model.report_error(&error);
            }
            if let Err(error) = model.flush_settings().await {
                model.report_error(&error);
            }
        });
    }
}

impl Connections {
    fn disconnect(self) {
        for handler in self.model_handlers {
            self.model.disconnect(handler);
        }
        for handler in self.style_handlers {
            self.style.disconnect(handler);
        }
    }
}
