use std::cell::RefCell;
use std::path::PathBuf;

use gtk4::glib;
use gtk4::prelude::{IsA, ObjectExt, WidgetExt};
use pango::prelude::FontMapExt;

use crate::config;
use crate::model::AppModel;

/// A note font the core offers, identified by the core's `noteFont` setting id.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum NoteFont {
    #[default]
    Inter,
    System,
    IbmPlexSans,
    AtkinsonHyperlegible,
    Nunito,
    IaWriterQuattro,
    Literata,
    SourceSerif,
    Lora,
    JetBrainsMono,
    IbmPlexMono,
}

impl NoteFont {
    const ALL: [Self; 11] = [
        Self::Inter,
        Self::System,
        Self::IbmPlexSans,
        Self::AtkinsonHyperlegible,
        Self::Nunito,
        Self::IaWriterQuattro,
        Self::Literata,
        Self::SourceSerif,
        Self::Lora,
        Self::JetBrainsMono,
        Self::IbmPlexMono,
    ];

    /// Unknown ids fall back to the default font, as the core does.
    pub fn from_id(id: &str) -> Self {
        match id {
            "system" => Self::System,
            "ibm-plex-sans" => Self::IbmPlexSans,
            "atkinson-hyperlegible" => Self::AtkinsonHyperlegible,
            "nunito" => Self::Nunito,
            "ia-writer-quattro" => Self::IaWriterQuattro,
            "literata" => Self::Literata,
            "source-serif" => Self::SourceSerif,
            "lora" => Self::Lora,
            "jetbrains-mono" => Self::JetBrainsMono,
            "ibm-plex-mono" => Self::IbmPlexMono,
            _ => Self::Inter,
        }
    }

    /// The bundled family name; `None` for the desktop's document font.
    pub fn family(self) -> Option<&'static str> {
        match self {
            Self::Inter => Some("Inter"),
            Self::System => None,
            Self::IbmPlexSans => Some("IBM Plex Sans"),
            Self::AtkinsonHyperlegible => Some("Atkinson Hyperlegible Next"),
            Self::Nunito => Some("Nunito"),
            Self::IaWriterQuattro => Some("iA Writer Quattro S"),
            Self::Literata => Some("Literata"),
            Self::SourceSerif => Some("Source Serif 4"),
            Self::Lora => Some("Lora"),
            Self::JetBrainsMono => Some("JetBrains Mono"),
            Self::IbmPlexMono => Some("IBM Plex Mono"),
        }
    }

    pub fn css_class(self) -> &'static str {
        match self {
            Self::Inter => "note-font-inter",
            Self::System => "note-font-system",
            Self::IbmPlexSans => "note-font-ibm-plex-sans",
            Self::AtkinsonHyperlegible => "note-font-atkinson-hyperlegible",
            Self::Nunito => "note-font-nunito",
            Self::IaWriterQuattro => "note-font-ia-writer-quattro",
            Self::Literata => "note-font-literata",
            Self::SourceSerif => "note-font-source-serif",
            Self::Lora => "note-font-lora",
            Self::JetBrainsMono => "note-font-jetbrains-mono",
            Self::IbmPlexMono => "note-font-ibm-plex-mono",
        }
    }

    /// Gives the widget this font's CSS class in place of any other note font's.
    pub fn apply_to(self, widget: &impl IsA<gtk4::Widget>) {
        for other in Self::ALL.into_iter().filter(|other| *other != self) {
            widget.remove_css_class(other.css_class());
        }
        widget.add_css_class(self.css_class());
    }

    fn files(self) -> &'static [&'static str] {
        match self {
            Self::Inter => &["Inter-Variable.ttf", "Inter-VariableItalic.ttf"],
            Self::System => &[],
            Self::IbmPlexSans => &["IBMPlexSans-Variable.ttf", "IBMPlexSans-VariableItalic.ttf"],
            Self::AtkinsonHyperlegible => &[
                "AtkinsonHyperlegibleNext-Variable.ttf",
                "AtkinsonHyperlegibleNext-VariableItalic.ttf",
            ],
            Self::Nunito => &["Nunito-Variable.ttf", "Nunito-VariableItalic.ttf"],
            Self::IaWriterQuattro => &[
                "iAWriterQuattroS-Regular.ttf",
                "iAWriterQuattroS-Italic.ttf",
                "iAWriterQuattroS-Bold.ttf",
                "iAWriterQuattroS-BoldItalic.ttf",
            ],
            Self::Literata => &["Literata-Variable.ttf", "Literata-VariableItalic.ttf"],
            Self::SourceSerif => &[
                "SourceSerif4-Variable.ttf",
                "SourceSerif4-VariableItalic.ttf",
            ],
            Self::Lora => &["Lora-Variable.ttf", "Lora-VariableItalic.ttf"],
            Self::JetBrainsMono => &[
                "JetBrainsMono-Variable.ttf",
                "JetBrainsMono-VariableItalic.ttf",
            ],
            Self::IbmPlexMono => &[
                "IBMPlexMono-Regular.ttf",
                "IBMPlexMono-Italic.ttf",
                "IBMPlexMono-SemiBold.ttf",
                "IBMPlexMono-SemiBoldItalic.ttf",
            ],
        }
    }
}

/// Calls `apply` with the chosen note font now and after every change of it, until `owner` is
/// destroyed.
pub fn follow_note_font(
    model: &AppModel,
    owner: &impl IsA<gtk4::Widget>,
    apply: impl Fn(NoteFont) + 'static,
) {
    apply(model.note_font());
    let handler =
        RefCell::new(Some(model.connect_editor_settings_changed(move |model| {
            apply(model.note_font())
        })));
    let model = model.downgrade();
    owner.connect_destroy(move |_| {
        if let (Some(model), Some(handler)) = (model.upgrade(), handler.take()) {
            model.disconnect(handler);
        }
    });
}

/// Registers the installed note fonts with the font map GTK renders through. Missing fonts are
/// only logged: text then uses the fallback family of the font's CSS class.
pub fn register_bundled_fonts() {
    let files = || NoteFont::ALL.into_iter().flat_map(NoteFont::files);
    let total = files().count();
    let font_map = pangocairo::FontMap::default();
    let unavailable = match bundled_fonts_dir() {
        Some(dir) => files()
            .filter(|file| font_map.add_font_file(dir.join(file)).is_err())
            .count(),
        None => total,
    };
    if unavailable > 0 {
        glib::g_warning!(
            "commitnote",
            "bundled note fonts unavailable: {unavailable} of {total}"
        );
    }
}

fn bundled_fonts_dir() -> Option<PathBuf> {
    let data_dirs = std::iter::once(glib::user_data_dir()).chain(glib::system_data_dirs());
    find_fonts_dir(data_dirs, config::APP_ID)
}

fn find_fonts_dir(data_dirs: impl IntoIterator<Item = PathBuf>, app_id: &str) -> Option<PathBuf> {
    data_dirs
        .into_iter()
        .map(|dir| dir.join(app_id).join("fonts"))
        .find(|dir| dir.is_dir())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use super::*;

    const CORE_IDS: [(&str, NoteFont); 11] = [
        ("inter", NoteFont::Inter),
        ("system", NoteFont::System),
        ("ibm-plex-sans", NoteFont::IbmPlexSans),
        ("atkinson-hyperlegible", NoteFont::AtkinsonHyperlegible),
        ("nunito", NoteFont::Nunito),
        ("ia-writer-quattro", NoteFont::IaWriterQuattro),
        ("literata", NoteFont::Literata),
        ("source-serif", NoteFont::SourceSerif),
        ("lora", NoteFont::Lora),
        ("jetbrains-mono", NoteFont::JetBrainsMono),
        ("ibm-plex-mono", NoteFont::IbmPlexMono),
    ];

    fn bundled_files() -> Vec<&'static str> {
        NoteFont::ALL
            .into_iter()
            .flat_map(NoteFont::files)
            .copied()
            .collect()
    }

    #[test]
    fn every_core_id_has_its_own_font_and_css_class() {
        for (id, font) in CORE_IDS {
            assert_eq!(NoteFont::from_id(id), font, "{id}");
            assert_eq!(font.css_class(), format!("note-font-{id}"));
        }
        assert_eq!(CORE_IDS.map(|(_, font)| font), NoteFont::ALL);
    }

    #[test]
    fn an_unknown_id_falls_back_to_inter() {
        assert_eq!(NoteFont::from_id("comic-sans"), NoteFont::Inter);
        assert_eq!(NoteFont::from_id(""), NoteFont::Inter);
        assert_eq!(NoteFont::default(), NoteFont::Inter);
    }

    #[test]
    fn only_system_has_no_bundled_family_or_files() {
        assert_eq!(NoteFont::System.family(), None);
        assert!(NoteFont::System.files().is_empty());
        assert_eq!(NoteFont::Inter.family(), Some("Inter"));
        assert_eq!(
            NoteFont::IaWriterQuattro.family(),
            Some("iA Writer Quattro S")
        );
        for font in NoteFont::ALL
            .into_iter()
            .filter(|font| *font != NoteFont::System)
        {
            assert!(font.family().is_some(), "{font:?}");
            assert!(!font.files().is_empty(), "{font:?}");
        }
    }

    #[test]
    fn every_css_class_is_styled() {
        let css = include_str!("../data/style.css");
        for font in NoteFont::ALL {
            let rule = format!(".{} {{", font.css_class());
            assert!(css.contains(&rule), "{rule}");
            if let Some(family) = font.family() {
                assert!(css.contains(&format!("\"{family}\"")), "{family}");
            }
        }
    }

    #[test]
    fn the_bundled_files_exist_and_are_all_installed() {
        let fonts_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../ios/Commitnote/Fonts");
        let meson = include_str!("../data/meson.build");
        let files = bundled_files();
        for file in &files {
            assert!(fonts_dir.join(file).is_file(), "{file} is missing");
            assert!(
                meson.contains(&format!("'{file}'")),
                "{file} is not installed"
            );
        }
        assert_eq!(files.len(), 24);
        assert_eq!(meson.matches(".ttf'").count(), files.len());
    }

    #[test]
    fn the_first_data_dir_with_fonts_wins() {
        let root = std::env::temp_dir().join(format!(
            "io.github.marcinjahn.commitnote.FontsTest{}",
            std::process::id()
        ));
        let (empty, user, system) = (root.join("empty"), root.join("user"), root.join("system"));
        for dir in [&user, &system] {
            fs::create_dir_all(dir.join("app").join("fonts")).expect("a fonts dir");
        }

        let found = find_fonts_dir([empty.clone(), user.clone(), system.clone()], "app");
        let missing = find_fonts_dir([empty, system], "other");

        fs::remove_dir_all(&root).expect("the test dirs are removed");
        assert_eq!(found, Some(user.join("app").join("fonts")));
        assert_eq!(missing, None);
    }
}
