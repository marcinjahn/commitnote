use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::settings::{ScopedSettingKey, SettingKeyView, SettingsCopy, SettingsView};
use gtk4::glib;
use libadwaita as adw;

use super::binding::Binding;
use super::rows::setting_switch_row;
use super::scope;

pub(super) struct Editor {
    pub(super) group: adw::PreferencesGroup,
    type_to_start: adw::SwitchRow,
    type_to_start_scope: adw::ToggleGroup,
    vim_mode: Option<adw::SwitchRow>,
}

impl Editor {
    pub(super) fn new(binding: &Rc<Binding>, copy: &SettingsCopy) -> Self {
        let group = adw::PreferencesGroup::builder()
            .title(glib::markup_escape_text(&copy.sections.editor))
            .description(glib::markup_escape_text(&copy.editor_unavailable))
            .build();
        let type_to_start = setting_switch_row(
            binding,
            SettingKeyView::TypeToStart,
            &copy.type_to_start.label,
            &copy.type_to_start.hint,
            "settings-type-to-start",
        );
        let type_to_start_scope =
            scope::toggles(binding, &copy.scope_labels, ScopedSettingKey::TypeToStart);
        type_to_start.add_suffix(&type_to_start_scope);
        group.add(&type_to_start);
        let vim_mode = copy.vim_mode.as_ref().map(|vim_mode| {
            let row = setting_switch_row(
                binding,
                SettingKeyView::VimMode,
                &vim_mode.label,
                &vim_mode.hint,
                "settings-vim-mode",
            );
            group.add(&row);
            row
        });
        Self {
            group,
            type_to_start,
            type_to_start_scope,
            vim_mode,
        }
    }

    pub(super) fn show(&self, view: &SettingsView) {
        self.type_to_start.set_active(view.values.type_to_start);
        scope::show(&self.type_to_start_scope, view.scopes.type_to_start);
        if let Some(row) = &self.vim_mode {
            row.set_active(view.values.vim_mode.unwrap_or_default());
        }
    }

    pub(super) fn inline_scope(&self) -> &adw::ToggleGroup {
        &self.type_to_start_scope
    }
}
