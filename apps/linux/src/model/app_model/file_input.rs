use gio::prelude::*;

pub(super) const READ_FAILED_MESSAGE: &str = "Could not read the file";

const READ_CHUNK: usize = 1024 * 1024;

/// Reads at most one byte more than `limit`, so the core can tell an oversized input from one at
/// the limit without the app ever holding the rest of a huge file.
pub(super) async fn read_bounded(file: &gio::File, limit: usize) -> Result<Vec<u8>, glib::Error> {
    let bound = limit.saturating_add(1);
    let stream = file.read_future(glib::Priority::DEFAULT).await?;
    let mut data = Vec::new();
    while data.len() < bound {
        let count = (bound - data.len()).min(READ_CHUNK);
        let chunk = stream
            .read_bytes_future(count, glib::Priority::DEFAULT)
            .await?;
        if chunk.is_empty() {
            break;
        }
        data.extend_from_slice(&chunk);
    }
    let _ = stream.close_future(glib::Priority::DEFAULT).await;
    Ok(data)
}

pub(super) fn log_read_failure(error: &glib::Error) {
    glib::g_warning!(
        super::LOG_DOMAIN,
        "could not read a file: {:?}",
        error.kind::<gio::IOErrorEnum>()
    );
}

#[cfg(all(test, feature = "testing"))]
mod tests {
    use super::*;

    fn temp_file(bytes: &[u8]) -> (std::path::PathBuf, gio::File) {
        let path =
            std::env::temp_dir().join(format!("commitnote-file-input-test-{}", std::process::id()));
        std::fs::write(&path, bytes).expect("the temporary file is written");
        let file = gio::File::for_path(&path);
        (path, file)
    }

    #[test]
    fn reads_up_to_one_byte_past_the_limit() {
        glib::MainContext::new().block_on(async {
            let (path, file) = temp_file(&[7; 3 * 1024 * 1024 + 10]);

            let at_limit = read_bounded(&file, 3 * 1024 * 1024 + 10).await.unwrap();
            let past_limit = read_bounded(&file, 100).await.unwrap();
            let whole = read_bounded(&file, usize::MAX).await.unwrap();

            assert_eq!(at_limit.len(), 3 * 1024 * 1024 + 10);
            assert_eq!(past_limit.len(), 101);
            assert_eq!(whole.len(), 3 * 1024 * 1024 + 10);
            let _ = std::fs::remove_file(path);
        });
    }

    #[test]
    fn a_missing_file_is_an_error() {
        glib::MainContext::new().block_on(async {
            let file = gio::File::for_path("/nonexistent/commitnote-file-input-test");
            assert!(read_bounded(&file, 10).await.is_err());
        });
    }
}
