use commitnote_core_api::settings::SettingsValues;

use crate::fonts::NoteFont;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EditorSettings {
    pub vim_mode: bool,
    pub type_to_start: bool,
    pub note_font: NoteFont,
}

impl EditorSettings {
    pub fn from_settings(values: &SettingsValues) -> Self {
        Self {
            vim_mode: values.vim_mode.unwrap_or(false),
            type_to_start: values.type_to_start,
            note_font: NoteFont::from_id(&values.note_font),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(type_to_start: bool, vim_mode: Option<bool>, note_font: &str) -> SettingsValues {
        SettingsValues {
            color_mode: "system".to_owned(),
            accent_color: "system".to_owned(),
            note_font: note_font.to_owned(),
            new_note_placement: "top".to_owned(),
            new_folder_placement: "top".to_owned(),
            type_to_start,
            vim_mode,
        }
    }

    #[test]
    fn a_missing_vim_mode_is_off() {
        assert_eq!(
            EditorSettings::from_settings(&values(true, None, "inter")),
            EditorSettings {
                vim_mode: false,
                type_to_start: true,
                note_font: NoteFont::Inter,
            }
        );
    }

    #[test]
    fn the_flags_are_kept() {
        assert_eq!(
            EditorSettings::from_settings(&values(false, Some(true), "inter")),
            EditorSettings {
                vim_mode: true,
                type_to_start: false,
                note_font: NoteFont::Inter,
            }
        );
        assert_eq!(
            EditorSettings::from_settings(&values(true, Some(false), "inter")),
            EditorSettings {
                vim_mode: false,
                type_to_start: true,
                note_font: NoteFont::Inter,
            }
        );
    }

    #[test]
    fn the_note_font_follows_its_id_and_an_unknown_id_means_inter() {
        for (id, font) in [
            ("inter", NoteFont::Inter),
            ("system", NoteFont::System),
            ("lora", NoteFont::Lora),
            ("comic-sans", NoteFont::Inter),
        ] {
            assert_eq!(
                EditorSettings::from_settings(&values(true, None, id)).note_font,
                font,
                "{id}"
            );
        }
    }
}
