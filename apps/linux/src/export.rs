use gtk4::prelude::*;
use gtk4::{self as gtk, gio, glib};

use crate::file_dialogs;
use crate::model::{AppModel, UserError};

const SAVE_TITLE: &str = "Export Notes";

/// Exports the notes and saves the zip where the user chooses; a cancelled dialog writes
/// nothing and is not an error. Does nothing while another export runs.
pub async fn export_notes(
    model: &AppModel,
    parent: Option<&gtk::Window>,
    include_images: bool,
) -> Result<(), UserError> {
    let Some(_running) = model.begin_export() else {
        return Ok(());
    };
    model.flush_edits().await;
    let exported = model.export_notes(include_images).await?;
    let Some(file) = file_dialogs::save_file(parent, SAVE_TITLE, &exported.file_name).await else {
        return Ok(());
    };
    write(&file, exported.bytes).await.map_err(|error| {
        glib::g_warning!(
            "commitnote",
            "could not write the export: {:?}",
            error.kind::<gio::IOErrorEnum>()
        );
        write_failure(model)
    })
}

async fn write(file: &gio::File, bytes: Vec<u8>) -> Result<(), glib::Error> {
    file.replace_contents_future(
        bytes,
        None,
        false,
        gio::FileCreateFlags::REPLACE_DESTINATION,
    )
    .await
    .map(|_| ())
    .map_err(|(_, error)| error)
}

fn write_failure(model: &AppModel) -> UserError {
    model
        .settings_copy()
        .map_or_else(UserError::generic, |copy| UserError {
            message: copy.data.export_failed.clone(),
        })
}

#[cfg(all(test, feature = "testing"))]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "commitnote-export-test-{}-{name}",
            std::process::id()
        ))
    }

    #[test]
    fn writing_replaces_the_contents_of_an_existing_file() {
        let path = temp_path("replace");
        std::fs::write(&path, vec![1; 64]).expect("the file is prepared");

        glib::MainContext::new().block_on(async {
            write(&gio::File::for_path(&path), b"PK".to_vec())
                .await
                .expect("the file is written");
        });

        assert_eq!(std::fs::read(&path).expect("the file is read"), b"PK");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn writing_into_a_missing_folder_fails() {
        let file = gio::File::for_path(temp_path("missing").join("export.zip"));

        let result = glib::MainContext::new().block_on(write(&file, b"PK".to_vec()));

        assert!(result.is_err());
    }
}
