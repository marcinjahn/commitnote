use std::future::Future;
use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::settings::{SettingKeyView, SettingOptionView};
use gtk4 as gtk;
use libadwaita as adw;

use super::binding::Binding;
use crate::model::{AppModel, UserError};

/// A combo row choosing one of the core's options for a setting.
pub(super) struct Choice {
    pub(super) row: adw::ComboRow,
    ids: Vec<String>,
}

impl Choice {
    pub(super) fn new(
        binding: &Rc<Binding>,
        key: SettingKeyView,
        title: &str,
        options: &[SettingOptionView],
        name: &str,
    ) -> Self {
        let labels: Vec<&str> = options.iter().map(|option| option.label.as_str()).collect();
        let row = adw::ComboRow::builder()
            .name(name)
            .title(title)
            .use_markup(false)
            .model(&gtk::StringList::new(&labels))
            .build();
        let ids: Vec<String> = options.iter().map(|option| option.id.clone()).collect();
        row.connect_selected_notify({
            let binding = Rc::downgrade(binding);
            let ids = ids.clone();
            move |row| {
                let id = usize::try_from(row.selected())
                    .ok()
                    .and_then(|position| ids.get(position));
                if let (Some(binding), Some(id)) = (binding.upgrade(), id) {
                    binding.change(key, id.as_str());
                }
            }
        });
        Self { row, ids }
    }

    pub(super) fn show(&self, id: &str) {
        self.row
            .set_selected(option_position(&self.ids, id).unwrap_or(gtk::INVALID_LIST_POSITION));
    }
}

/// A switch row whose changes go to the model through `request`.
pub(super) fn switch_row<Request, Response>(
    binding: &Rc<Binding>,
    title: &str,
    subtitle: Option<&str>,
    name: &str,
    request: Request,
) -> adw::SwitchRow
where
    Request: Fn(AppModel, bool) -> Response + 'static,
    Response: Future<Output = Result<(), UserError>> + 'static,
{
    let row = adw::SwitchRow::builder()
        .name(name)
        .title(title)
        .use_markup(false)
        .build();
    if let Some(subtitle) = subtitle {
        row.set_subtitle(subtitle);
    }
    row.connect_active_notify({
        let binding = Rc::downgrade(binding);
        move |row| {
            let active = row.is_active();
            if let Some(binding) = binding.upgrade() {
                binding.send(|model| request(model, active));
            }
        }
    });
    row
}

/// A switch row for a boolean setting the core changes through `change_setting`.
pub(super) fn setting_switch_row(
    binding: &Rc<Binding>,
    key: SettingKeyView,
    title: &str,
    subtitle: &str,
    name: &str,
) -> adw::SwitchRow {
    switch_row(
        binding,
        title,
        Some(subtitle),
        name,
        move |model, active| async move { model.change_setting(key, active.to_string()).await },
    )
}

fn option_position(ids: &[String], id: &str) -> Option<u32> {
    ids.iter()
        .position(|option| option == id)
        .and_then(|position| u32::try_from(position).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_position_of_the_current_option() {
        let ids = ["system".to_owned(), "light".to_owned(), "dark".to_owned()];
        assert_eq!(option_position(&ids, "light"), Some(1));
        assert_eq!(option_position(&ids, "sepia"), None);
    }
}
