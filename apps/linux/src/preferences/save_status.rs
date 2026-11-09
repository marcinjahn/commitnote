use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::settings::{SettingsCopy, SettingsSaveView};
use gtk4 as gtk;
use libadwaita as adw;

use super::binding::Binding;

/// Whether the synced settings reached the repository, with a retry after a failed save.
pub(super) struct SaveStatus {
    pub(super) group: adw::PreferencesGroup,
    label: gtk::Label,
    detail: gtk::Label,
    retry: gtk::Button,
}

impl SaveStatus {
    pub(super) fn new(binding: &Rc<Binding>, copy: &SettingsCopy) -> Self {
        let label = gtk::Label::builder()
            .name("settings-save-status")
            .xalign(0.0)
            .wrap(true)
            .build();
        let detail = gtk::Label::builder()
            .xalign(0.0)
            .wrap(true)
            .css_classes(["caption", "dim-label"])
            .build();
        let retry = gtk::Button::builder()
            .name("settings-retry")
            .label(&copy.retry_label)
            .halign(gtk::Align::Start)
            .build();
        retry.connect_clicked({
            let binding = Rc::downgrade(binding);
            move |_| {
                if let Some(binding) = binding.upgrade() {
                    binding.send(|model| async move { model.retry_settings_save().await });
                }
            }
        });
        let lines = gtk::Box::builder()
            .orientation(gtk::Orientation::Vertical)
            .spacing(6)
            .build();
        lines.append(&label);
        lines.append(&detail);
        lines.append(&retry);
        let group = adw::PreferencesGroup::new();
        group.add(&lines);
        Self {
            group,
            label,
            detail,
            retry,
        }
    }

    pub(super) fn show(&self, save: Option<&SettingsSaveView>) {
        self.group.set_visible(save.is_some());
        let Some(save) = save else {
            return;
        };
        self.label.set_label(&save.label);
        self.detail.set_label(&save.detail);
        self.detail.set_visible(!save.detail.is_empty());
        self.retry.set_visible(save.can_retry);
    }
}
