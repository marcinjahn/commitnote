use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::settings::{SettingsCopy, SettingsView};
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use super::binding::Binding;
use super::rows::switch_row;

pub(super) struct Device {
    pub(super) group: adw::PreferencesGroup,
    binding: Rc<Binding>,
    name: adw::EntryRow,
    name_focus: gtk::EventControllerFocus,
    max_length: usize,
    reopen_last_view: adw::SwitchRow,
}

impl Device {
    pub(super) fn new(binding: &Rc<Binding>, copy: &SettingsCopy) -> Rc<Self> {
        let group = adw::PreferencesGroup::builder()
            .title(glib::markup_escape_text(&copy.sections.this_device))
            .description(glib::markup_escape_text(&copy.device_name.hint))
            .build();
        let max_length = usize::try_from(copy.device_name.max_length).unwrap_or(usize::MAX);
        let name = adw::EntryRow::builder()
            .name("settings-device-name")
            .title(&copy.device_name.label)
            .use_markup(false)
            .show_apply_button(true)
            .build();
        if let Some(text) = name.delegate().and_downcast::<gtk::Text>() {
            text.set_max_length(i32::try_from(max_length).unwrap_or(i32::MAX));
        }
        let name_focus = gtk::EventControllerFocus::new();
        name.add_controller(name_focus.clone());
        group.add(&name);
        let reopen_last_view = switch_row(
            binding,
            &copy.reopen_last_view.label,
            None,
            "settings-reopen-last-view",
            |model, enabled| async move { model.set_reopen_last_view(enabled).await },
        );
        group.add(&reopen_last_view);

        let device = Rc::new(Self {
            group,
            binding: binding.clone(),
            name,
            name_focus,
            max_length,
            reopen_last_view,
        });
        device.name.connect_apply({
            let device = Rc::downgrade(&device);
            move |_| {
                if let Some(device) = device.upgrade() {
                    device.commit_name();
                }
            }
        });
        device.name_focus.connect_leave({
            let device = Rc::downgrade(&device);
            move |_| {
                if let Some(device) = device.upgrade() {
                    device.commit_name();
                }
            }
        });
        device
    }

    /// Shows the core's view; the name being edited is left alone until it is committed.
    pub(super) fn show(&self, view: &SettingsView) {
        if !self.name_focus.contains_focus() {
            self.show_name(view);
        }
        self.reopen_last_view.set_active(view.reopen_last_view);
    }

    /// The name to store for what the entry shows, when that differs from the stored name.
    pub(super) fn unsaved_name(&self, view: &SettingsView) -> Option<Option<String>> {
        name_commit(
            &self.name.text(),
            &view.device_name,
            &view.automatic_device_name,
            self.max_length,
        )
        .request()
    }

    fn show_name(&self, view: &SettingsView) {
        self.set_name(shown_name(view));
    }

    fn set_name(&self, name: &str) {
        self.binding.showing_view(|| self.name.set_text(name));
    }

    /// The core answers with the name it stores, which replaces what was typed even while the
    /// entry keeps the focus.
    fn commit_name(self: &Rc<Self>) {
        let Some(view) = self.binding.model().settings_view() else {
            return;
        };
        match self.unsaved_name(&view) {
            Some(name) => {
                let device = Rc::downgrade(self);
                self.binding.send(|model| async move {
                    let stored = model.set_device_name(name).await?;
                    if let Some(device) = device.upgrade() {
                        device.set_name(&stored);
                    }
                    Ok(())
                });
            }
            None => self.show_name(&view),
        }
    }
}

/// The automatic name stands in for an empty stored name, as the core uses it then.
fn shown_name(view: &SettingsView) -> &str {
    if view.device_name.is_empty() {
        &view.automatic_device_name
    } else {
        &view.device_name
    }
}

#[derive(Debug, PartialEq, Eq)]
enum NameCommit {
    Unchanged,
    Automatic,
    Named(String),
}

impl NameCommit {
    /// The `set_device_name` argument, or `None` when there is nothing to store.
    fn request(self) -> Option<Option<String>> {
        match self {
            Self::Unchanged => None,
            Self::Automatic => Some(None),
            Self::Named(name) => Some(Some(name)),
        }
    }
}

/// Compares the entry's trimmed text with the shown name, which the entry cut to `max_length`
/// characters when it was longer.
fn name_commit(text: &str, stored: &str, automatic: &str, max_length: usize) -> NameCommit {
    let text = text.trim();
    let shown = if stored.is_empty() { automatic } else { stored };
    let shown_in_entry: String = shown.chars().take(max_length).collect();
    if text == shown_in_entry.trim() {
        NameCommit::Unchanged
    } else if text.is_empty() {
        if stored.is_empty() {
            NameCommit::Unchanged
        } else {
            NameCommit::Automatic
        }
    } else {
        NameCommit::Named(text.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAX: usize = 40;

    #[test]
    fn trimmed_text_equal_to_the_shown_name_is_unchanged() {
        assert_eq!(
            name_commit("  Desk  ", "Desk", "Laptop", MAX),
            NameCommit::Unchanged
        );
        assert_eq!(
            name_commit("Laptop", "", "Laptop", MAX),
            NameCommit::Unchanged
        );
    }

    #[test]
    fn new_text_is_stored_trimmed() {
        assert_eq!(
            name_commit(" Desk ", "", "Laptop", MAX),
            NameCommit::Named("Desk".to_owned())
        );
        assert_eq!(
            name_commit("Laptop", "Desk", "Laptop", MAX),
            NameCommit::Named("Laptop".to_owned())
        );
    }

    #[test]
    fn empty_text_restores_the_automatic_name() {
        assert_eq!(
            name_commit("   ", "Desk", "Laptop", MAX),
            NameCommit::Automatic
        );
        assert_eq!(name_commit("", "", "Laptop", MAX), NameCommit::Unchanged);
    }

    #[test]
    fn an_automatic_name_cut_to_the_maximum_length_is_unchanged() {
        assert_eq!(
            name_commit("Framework", "", "Framework Laptop", 9),
            NameCommit::Unchanged
        );
        assert_eq!(
            name_commit("Framework", "", "Framework Laptop", 10),
            NameCommit::Unchanged
        );
    }

    #[test]
    fn requests_only_a_changed_name() {
        assert_eq!(NameCommit::Unchanged.request(), None);
        assert_eq!(NameCommit::Automatic.request(), Some(None));
        assert_eq!(
            NameCommit::Named("Desk".to_owned()).request(),
            Some(Some("Desk".to_owned()))
        );
    }
}
