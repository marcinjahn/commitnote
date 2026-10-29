use std::cell::RefCell;
use std::rc::Rc;

use commitnote_core_api::settings::{AccentOptionView, SettingsValues};
use gtk4::{self as gtk, gdk};
use libadwaita as adw;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ColorMode {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AccentColor {
    pub light: Option<String>,
    pub dark: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Appearance {
    pub color_mode: ColorMode,
    pub accent: Option<AccentColor>,
}

impl Appearance {
    pub fn from_settings(values: &SettingsValues, accent_options: &[AccentOptionView]) -> Self {
        let color_mode = match values.color_mode.as_str() {
            "light" => ColorMode::Light,
            "dark" => ColorMode::Dark,
            _ => ColorMode::System,
        };
        let accent = accent_options
            .iter()
            .find(|option| option.id == values.accent_color && option.id != "system")
            .map(|option| AccentColor {
                light: option.light.clone(),
                dark: option.dark.clone(),
            });
        Self { color_mode, accent }
    }
}

/// Applies an [`Appearance`] to the default display and follows the light or dark switch.
pub struct AppearanceApplier {
    style_manager: adw::StyleManager,
    provider: gtk::CssProvider,
    current: Rc<RefCell<Appearance>>,
}

impl AppearanceApplier {
    pub fn new() -> Self {
        let style_manager = adw::StyleManager::default();
        let provider = gtk::CssProvider::new();
        if let Some(display) = gdk::Display::default() {
            gtk::style_context_add_provider_for_display(
                &display,
                &provider,
                gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
            );
        }
        let current = Rc::new(RefCell::new(Appearance::default()));
        style_manager.connect_dark_notify({
            let provider = provider.clone();
            let current = current.clone();
            move |style_manager| {
                load_accent(
                    &provider,
                    current.borrow().accent.as_ref(),
                    style_manager.is_dark(),
                );
            }
        });
        Self {
            style_manager,
            provider,
            current,
        }
    }

    pub fn apply(&self, appearance: &Appearance) {
        self.style_manager
            .set_color_scheme(match appearance.color_mode {
                ColorMode::System => adw::ColorScheme::Default,
                ColorMode::Light => adw::ColorScheme::ForceLight,
                ColorMode::Dark => adw::ColorScheme::ForceDark,
            });
        self.current.replace(appearance.clone());
        load_accent(
            &self.provider,
            appearance.accent.as_ref(),
            self.style_manager.is_dark(),
        );
    }
}

impl Default for AppearanceApplier {
    fn default() -> Self {
        Self::new()
    }
}

fn load_accent(provider: &gtk::CssProvider, accent: Option<&AccentColor>, dark: bool) {
    let color = accent.and_then(|accent| {
        if dark {
            accent.dark.as_deref()
        } else {
            accent.light.as_deref()
        }
    });
    let css = color
        .map(|color| format!(":root {{ --accent-bg-color: {color}; --accent-color: {color}; }}"))
        .unwrap_or_default();
    provider.load_from_string(&css);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(color_mode: &str, accent_color: &str) -> SettingsValues {
        SettingsValues {
            color_mode: color_mode.to_owned(),
            accent_color: accent_color.to_owned(),
            note_font: "system".to_owned(),
            new_note_placement: "top".to_owned(),
            new_folder_placement: "top".to_owned(),
            type_to_start: true,
            vim_mode: None,
        }
    }

    fn options() -> Vec<AccentOptionView> {
        vec![
            AccentOptionView {
                id: "system".to_owned(),
                label: "System".to_owned(),
                light: None,
                dark: None,
            },
            AccentOptionView {
                id: "violet".to_owned(),
                label: "Violet".to_owned(),
                light: Some("#111111".to_owned()),
                dark: Some("#eeeeee".to_owned()),
            },
        ]
    }

    #[test]
    fn maps_color_modes_and_leaves_the_system_accent_alone() {
        assert_eq!(
            Appearance::from_settings(&values("dark", "system"), &options()),
            Appearance {
                color_mode: ColorMode::Dark,
                accent: None,
            }
        );
        assert_eq!(
            Appearance::from_settings(&values("light", "system"), &options()).color_mode,
            ColorMode::Light
        );
        assert_eq!(
            Appearance::from_settings(&values("system", "system"), &options()).color_mode,
            ColorMode::System
        );
    }

    #[test]
    fn takes_accent_colors_from_the_core_options() {
        let appearance = Appearance::from_settings(&values("system", "violet"), &options());
        assert_eq!(
            appearance.accent,
            Some(AccentColor {
                light: Some("#111111".to_owned()),
                dark: Some("#eeeeee".to_owned()),
            })
        );
    }
}
