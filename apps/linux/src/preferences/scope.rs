use std::rc::Rc;

use commitnote_core_api::settings::{ScopeLabels, ScopedSettingKey, SettingScope};
use gtk4 as gtk;
use libadwaita as adw;

use super::binding::Binding;

/// The two toggles that choose whether a setting syncs to every device or applies to this one.
/// Their labels are plain child labels, which never ellipsize, so a row with a long subtitle
/// cannot squeeze them.
pub(super) fn toggles(
    binding: &Rc<Binding>,
    labels: &ScopeLabels,
    key: ScopedSettingKey,
) -> adw::ToggleGroup {
    let group = adw::ToggleGroup::builder()
        .name(format!("scope-{}", key_id(key)))
        .css_classes(["scope-toggles"])
        .valign(gtk::Align::Center)
        .build();
    for scope in [SettingScope::Synced, SettingScope::Device] {
        let label = match scope {
            SettingScope::Synced => &labels.synced,
            SettingScope::Device => &labels.device,
        };
        group.add(
            adw::Toggle::builder()
                .name(scope_name(scope))
                .label(label)
                .child(&gtk::Label::new(Some(label)))
                .build(),
        );
    }
    group.connect_active_name_notify({
        let binding = Rc::downgrade(binding);
        move |group| {
            let scope = group.active_name().as_deref().and_then(scope_from_name);
            if let (Some(binding), Some(scope)) = (binding.upgrade(), scope) {
                binding.set_scope(key, scope);
            }
        }
    });
    group
}

pub(super) fn show(group: &adw::ToggleGroup, scope: SettingScope) {
    group.set_active_name(Some(scope_name(scope)));
}

fn scope_name(scope: SettingScope) -> &'static str {
    match scope {
        SettingScope::Synced => "synced",
        SettingScope::Device => "device",
    }
}

fn scope_from_name(name: &str) -> Option<SettingScope> {
    match name {
        "synced" => Some(SettingScope::Synced),
        "device" => Some(SettingScope::Device),
        _ => None,
    }
}

/// The core's name for the key, which the toggle group's widget name carries.
fn key_id(key: ScopedSettingKey) -> &'static str {
    match key {
        ScopedSettingKey::ColorMode => "colorMode",
        ScopedSettingKey::AccentColor => "accentColor",
        ScopedSettingKey::NoteFont => "noteFont",
        ScopedSettingKey::TypeToStart => "typeToStart",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_names_round_trip() {
        for scope in [SettingScope::Synced, SettingScope::Device] {
            assert_eq!(scope_from_name(scope_name(scope)), Some(scope));
        }
        assert_eq!(scope_from_name("everywhere"), None);
    }

    #[test]
    fn key_ids_match_the_core_wire_names() {
        for key in [
            ScopedSettingKey::ColorMode,
            ScopedSettingKey::AccentColor,
            ScopedSettingKey::NoteFont,
            ScopedSettingKey::TypeToStart,
        ] {
            let wire = serde_json::to_value(key).expect("the key serialises");
            assert_eq!(wire.as_str(), Some(key_id(key)));
        }
    }
}
