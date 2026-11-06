mod document;
mod renderer;

use std::path::Path;

use gtk4::{self as gtk, gio, glib};

use self::document::{FaceStyle, FontFace, printable_document};
use self::renderer::PrintPage;
pub use self::renderer::initialize_web_engine;
use crate::fonts::{self, FaceFiles, NoteFont};
use crate::model::{AppModel, UserError};

#[cfg(feature = "testing")]
pub use self::renderer::{testing_last_document, testing_load_finished};

const PRINT_FAILED: &str = "Could not print the note";

/// Prints the note or draft open in the editor through the print dialog, in the chosen note
/// font. A cancelled dialog prints nothing and is not an error.
pub async fn print_note(model: &AppModel, parent: Option<&gtk::Window>) -> Result<(), UserError> {
    let Some(html) = model.render_print_document().await? else {
        return Ok(());
    };
    let faces = read_faces(model.note_font()).await;
    let page = PrintPage::load(&printable_document(&html, &faces))
        .await
        .map_err(|error| failure("could not lay out a note for printing", &error))?;
    let setup = match gtk::PrintDialog::new().setup_future(parent).await {
        Ok(setup) => setup,
        Err(error) if dismissed(&error) => return Ok(()),
        Err(error) => return Err(failure("could not open the print dialog", &error)),
    };
    page.print(&setup)
        .await
        .map_err(|error| failure("could not print a note", &error))
}

async fn read_faces(font: NoteFont) -> Vec<FontFace> {
    let Some(files) = font.face_files() else {
        return Vec::new();
    };
    let faces = gio::spawn_blocking(move || {
        fonts::bundled_fonts_dir()
            .map(|dir| read_face_files(&dir, files))
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default();
    if faces.len() < 2 {
        glib::g_warning!(
            "commitnote",
            "note font faces unavailable for printing: {} of 2",
            2 - faces.len()
        );
    }
    faces
}

fn read_face_files(dir: &Path, files: FaceFiles) -> Vec<FontFace> {
    [
        (FaceStyle::Normal, files.regular),
        (FaceStyle::Italic, files.italic),
    ]
    .into_iter()
    .filter_map(|(style, file)| {
        std::fs::read(dir.join(file))
            .ok()
            .map(|bytes| FontFace { style, bytes })
    })
    .collect()
}

fn dismissed(error: &glib::Error) -> bool {
    error.matches(gtk::DialogError::Dismissed) || error.matches(gtk::DialogError::Cancelled)
}

/// Logs only the failing step and the error's domain, which never carry note content.
fn failure(what: &str, error: &glib::Error) -> UserError {
    glib::g_warning!("commitnote", "{what}: {}", error.domain().as_str());
    UserError {
        message: PRINT_FAILED.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn bundled_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../ios/Commitnote/Fonts")
    }

    #[test]
    fn a_font_with_files_embeds_its_regular_and_italic_faces() {
        let files = NoteFont::Inter.face_files().expect("Inter has files");

        let faces = read_face_files(&bundled_dir(), files);
        let document = printable_document("<head></head>", &faces);

        assert_eq!(
            faces.iter().map(|face| face.style).collect::<Vec<_>>(),
            [FaceStyle::Normal, FaceStyle::Italic]
        );
        assert!(faces.iter().all(|face| !face.bytes.is_empty()));
        assert_eq!(document.matches("@font-face{").count(), 2);
        assert!(document.contains("font-style:normal;font-weight:100 900}</style>"));
        assert!(document.contains("font-style:italic;font-weight:100 900}</style>"));
    }

    #[test]
    fn the_system_font_embeds_no_face() {
        let faces = glib::MainContext::new().block_on(read_faces(NoteFont::System));

        assert!(faces.is_empty());
        assert!(!printable_document("<head></head>", &faces).contains("@font-face"));
    }

    #[test]
    fn a_missing_file_leaves_out_only_its_face() {
        let files = FaceFiles {
            regular: "Inter-Variable.ttf",
            italic: "Missing-Italic.ttf",
        };

        let faces = read_face_files(&bundled_dir(), files);

        assert_eq!(
            faces.iter().map(|face| face.style).collect::<Vec<_>>(),
            [FaceStyle::Normal]
        );
    }

    #[test]
    fn a_dismissed_or_cancelled_dialog_is_not_a_failure() {
        for code in [gtk::DialogError::Dismissed, gtk::DialogError::Cancelled] {
            assert!(dismissed(&glib::Error::new(code, "closed")));
        }
        assert!(!dismissed(&glib::Error::new(
            gtk::DialogError::Failed,
            "broken"
        )));
    }
}
