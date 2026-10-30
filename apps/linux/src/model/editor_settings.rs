use commitnote_core_api::settings::SettingsValues;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EditorSettings {
    pub vim_mode: bool,
    pub type_to_start: bool,
}

impl EditorSettings {
    pub fn from_settings(values: &SettingsValues) -> Self {
        Self {
            vim_mode: values.vim_mode.unwrap_or(false),
            type_to_start: values.type_to_start,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(type_to_start: bool, vim_mode: Option<bool>) -> SettingsValues {
        SettingsValues {
            color_mode: "system".to_owned(),
            accent_color: "system".to_owned(),
            note_font: "system".to_owned(),
            new_note_placement: "top".to_owned(),
            new_folder_placement: "top".to_owned(),
            type_to_start,
            vim_mode,
        }
    }

    #[test]
    fn a_missing_vim_mode_is_off() {
        assert_eq!(
            EditorSettings::from_settings(&values(true, None)),
            EditorSettings {
                vim_mode: false,
                type_to_start: true,
            }
        );
    }

    #[test]
    fn both_settings_are_kept() {
        assert_eq!(
            EditorSettings::from_settings(&values(false, Some(true))),
            EditorSettings {
                vim_mode: true,
                type_to_start: false,
            }
        );
        assert_eq!(
            EditorSettings::from_settings(&values(true, Some(false))),
            EditorSettings {
                vim_mode: false,
                type_to_start: true,
            }
        );
    }
}
