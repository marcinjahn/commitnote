use gtk4::prelude::*;
use gtk4::{self as gtk, gio};

/// Asks for any number of existing files; `None` when the dialog is cancelled. The first filter
/// is the one shown first.
pub async fn pick_files(
    parent: Option<&gtk::Window>,
    title: &str,
    filters: &[gtk::FileFilter],
) -> Option<Vec<gio::File>> {
    #[cfg(feature = "testing")]
    if let Some(answer) = testing::answer(title, filters) {
        return answer.into_files();
    }
    let picked = open_dialog(title, filters)
        .open_multiple_future(parent)
        .await
        .ok()?;
    Some(
        (0..picked.n_items())
            .filter_map(|position| picked.item(position).and_downcast::<gio::File>())
            .collect(),
    )
}

/// Asks for one existing file; `None` when the dialog is cancelled.
pub async fn pick_file(
    parent: Option<&gtk::Window>,
    title: &str,
    filters: &[gtk::FileFilter],
) -> Option<gio::File> {
    #[cfg(feature = "testing")]
    if let Some(answer) = testing::answer(title, filters) {
        return answer.into_files()?.into_iter().next();
    }
    open_dialog(title, filters).open_future(parent).await.ok()
}

/// Asks where to save a file named `initial_name`; `None` when the dialog is cancelled.
pub async fn save_file(
    parent: Option<&gtk::Window>,
    title: &str,
    initial_name: &str,
) -> Option<gio::File> {
    #[cfg(feature = "testing")]
    if let Some(answer) = testing::answer(title, &[]) {
        return answer.into_save();
    }
    gtk::FileDialog::builder()
        .title(title)
        .modal(true)
        .initial_name(initial_name)
        .build()
        .save_future(parent)
        .await
        .ok()
}

fn open_dialog(title: &str, filters: &[gtk::FileFilter]) -> gtk::FileDialog {
    let dialog = gtk::FileDialog::builder().title(title).modal(true).build();
    if !filters.is_empty() {
        let store = gio::ListStore::new::<gtk::FileFilter>();
        store.extend_from_slice(filters);
        dialog.set_filters(Some(&store));
        dialog.set_default_filter(filters.first());
    }
    dialog
}

#[cfg(feature = "testing")]
pub use testing::{
    testing_last_call, testing_queue_cancel, testing_queue_open, testing_queue_save,
};

#[cfg(feature = "testing")]
mod testing {
    use std::cell::RefCell;
    use std::collections::VecDeque;

    use gtk4::{self as gtk, gio};

    pub(super) enum Answer {
        Open(Vec<gio::File>),
        Save(gio::File),
        Cancel,
    }

    impl Answer {
        pub(super) fn into_files(self) -> Option<Vec<gio::File>> {
            match self {
                Self::Open(files) => Some(files),
                Self::Cancel => None,
                Self::Save(_) => panic!("a save answer was queued for an open dialog"),
            }
        }

        pub(super) fn into_save(self) -> Option<gio::File> {
            match self {
                Self::Save(file) => Some(file),
                Self::Cancel => None,
                Self::Open(_) => panic!("an open answer was queued for a save dialog"),
            }
        }
    }

    #[derive(Default)]
    struct Queue {
        answers: VecDeque<Answer>,
        last_call: Option<(String, Vec<gtk::FileFilter>)>,
    }

    thread_local! {
        static QUEUE: RefCell<Queue> = RefCell::new(Queue::default());
    }

    pub(super) fn answer(title: &str, filters: &[gtk::FileFilter]) -> Option<Answer> {
        QUEUE.with_borrow_mut(|queue| {
            let answer = queue.answers.pop_front()?;
            queue.last_call = Some((title.to_owned(), filters.to_vec()));
            Some(answer)
        })
    }

    fn queue(answer: Answer) {
        QUEUE.with_borrow_mut(|queue| queue.answers.push_back(answer));
    }

    /// Makes the next open dialog answer with `files` instead of being shown.
    pub fn testing_queue_open(files: Vec<gio::File>) {
        queue(Answer::Open(files));
    }

    /// Makes the next save dialog answer with `file` instead of being shown.
    pub fn testing_queue_save(file: gio::File) {
        queue(Answer::Save(file));
    }

    /// Makes the next dialog, open or save, answer as if it were cancelled.
    pub fn testing_queue_cancel() {
        queue(Answer::Cancel);
    }

    /// The title and filters of the last dialog that took a queued answer.
    pub fn testing_last_call() -> Option<(String, Vec<gtk::FileFilter>)> {
        QUEUE.with_borrow(|queue| queue.last_call.clone())
    }
}

#[cfg(all(test, feature = "testing"))]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn paths(files: Vec<gio::File>) -> Vec<Option<PathBuf>> {
        files.iter().map(|file| file.path()).collect()
    }

    #[test]
    fn queued_answers_are_used_in_order_and_recorded() {
        testing_queue_open(vec![gio::File::for_path("/first")]);
        testing_queue_save(gio::File::for_path("/second"));
        testing_queue_cancel();

        gtk::glib::MainContext::new().block_on(async {
            let picked = pick_files(None, "Pick", &[])
                .await
                .expect("files are picked");
            assert_eq!(paths(picked), [Some(PathBuf::from("/first"))]);
            assert_eq!(
                testing_last_call().map(|(title, _)| title).as_deref(),
                Some("Pick")
            );

            let saved = save_file(None, "Save", "a.zip")
                .await
                .expect("a file is saved");
            assert_eq!(saved.path(), Some(PathBuf::from("/second")));
            assert_eq!(
                testing_last_call().map(|(title, _)| title).as_deref(),
                Some("Save")
            );

            assert!(pick_file(None, "Again", &[]).await.is_none());
            assert_eq!(
                testing_last_call().map(|(title, _)| title).as_deref(),
                Some("Again")
            );
        });
    }

    #[test]
    fn a_single_file_is_the_first_queued_one() {
        testing_queue_open(vec![
            gio::File::for_path("/one"),
            gio::File::for_path("/two"),
        ]);

        let picked = gtk::glib::MainContext::new().block_on(pick_file(None, "Pick", &[]));

        assert_eq!(
            picked.and_then(|file| file.path()),
            Some(PathBuf::from("/one"))
        );
    }
}
