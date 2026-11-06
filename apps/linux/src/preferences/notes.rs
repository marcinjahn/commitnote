use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::settings::{SettingKeyView, SettingsCopy, SettingsView};
use gtk4::glib;
use libadwaita as adw;

use super::binding::Binding;
use super::rows::Choice;

pub(super) struct Notes {
    pub(super) group: adw::PreferencesGroup,
    new_note_placement: Choice,
    new_folder_placement: Choice,
}

impl Notes {
    pub(super) fn new(binding: &Rc<Binding>, copy: &SettingsCopy) -> Self {
        let group = adw::PreferencesGroup::builder()
            .title(glib::markup_escape_text(&copy.sections.notes))
            .build();
        let new_note_placement = Choice::new(
            binding,
            SettingKeyView::NewNotePlacement,
            &copy.new_note_placement.label,
            &copy.new_note_placement.options,
            "settings-new-note-placement",
        );
        group.add(&new_note_placement.row);
        let new_folder_placement = Choice::new(
            binding,
            SettingKeyView::NewFolderPlacement,
            &copy.new_folder_placement.label,
            &copy.new_folder_placement.options,
            "settings-new-folder-placement",
        );
        group.add(&new_folder_placement.row);
        Self {
            group,
            new_note_placement,
            new_folder_placement,
        }
    }

    pub(super) fn show(&self, view: &SettingsView) {
        self.new_note_placement
            .show(&view.values.new_note_placement);
        self.new_folder_placement
            .show(&view.values.new_folder_placement);
    }
}
