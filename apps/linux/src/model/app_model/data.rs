use std::fmt;
use std::path::Path;
use std::rc::Rc;
use std::time::Duration;

use commitnote_core_api::Command;
use commitnote_core_api::commands::{
    AtomicBlockedView, ExportNotes, ExportNotesParams, ImportArchiveOutcome, ImportCancel,
    ImportCancelParams, ImportCommit, ImportCommitParams, ImportDestinationView, ImportDropFiles,
    ImportDropFilesParams, ImportDropSource, ImportDroppedFile, ImportEnableAtomic,
    ImportEnableAtomicParams, ImportForm, ImportOutcomeView, ImportPolicy, ImportPreview,
    ImportPreviewParams, ImportReadArchive, ImportReadArchiveParams, ImportSaveWithoutAtomic,
    ImportSaveWithoutAtomicParams,
};
use commitnote_core_api::events::ImportStatusChanged;
use commitnote_core_runtime::{RequestError, SharedStagedInputs};
use gio::prelude::*;
use glib::subclass::types::ObjectSubclassIsExt;

use super::file_input::{READ_FAILED_MESSAGE, log_read_failure, read_bounded};
use super::organise::failed;
use super::{AppModel, LOG_DOMAIN, UserError, warn};

/// What the core accepts: the uncompressed size of an archive and the size of one note file.
const MAX_ARCHIVE_BYTES: usize = 200 * 1024 * 1024;
const MAX_NOTE_FILE_BYTES: usize = 1024 * 1024;
const PREVIEW_DEBOUNCE: Duration = Duration::from_millis(150);
const ARCHIVE_MIME_TYPE: &str = "application/zip";
const NOTE_MIME_TYPE: &str = "text/markdown";

/// The notes as a zip, decoded and ready to be written to a file.
#[derive(Clone, PartialEq, Eq)]
pub struct ExportedFile {
    pub file_name: String,
    pub bytes: Vec<u8>,
}

impl fmt::Debug for ExportedFile {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ExportedFile")
            .field("len", &self.bytes.len())
            .finish_non_exhaustive()
    }
}

/// Keeps the model's export marked as running until it is dropped.
pub struct ExportGuard {
    model: AppModel,
}

impl Drop for ExportGuard {
    fn drop(&mut self) {
        self.model.imp().exporting.set(false);
        self.model.emit_by_name::<()>("export-changed", &[]);
    }
}

/// An import the repository cannot take until atomic commits are enabled; the import is retried
/// with the same destination and policy afterwards.
#[derive(Clone, PartialEq, Eq)]
pub struct ImportSetup {
    pub can_configure: bool,
    pub message: String,
    pub action_label: String,
    pub destination: ImportDestinationView,
    pub policy: ImportPolicy,
}

impl fmt::Debug for ImportSetup {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ImportSetup")
            .field("can_configure", &self.can_configure)
            .field("policy", &self.policy)
            .finish_non_exhaustive()
    }
}

/// Dropped or picked files the repository cannot take until atomic commits are enabled; the core
/// holds the files and retries them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DropSetup {
    pub can_configure: bool,
    pub message: String,
    pub action_label: String,
}

/// What an outcome asks of the model besides the state change.
#[derive(Default)]
struct Effects {
    expand: Option<Vec<String>>,
    toast: Option<String>,
}

#[derive(Default)]
pub(super) struct ImportState {
    form: Option<Rc<ImportForm>>,
    preview: Option<String>,
    outcome_message: Option<String>,
    offers_rename: bool,
    setup: Option<ImportSetup>,
    drop_setup: Option<DropSetup>,
    busy: bool,
    importing: bool,
    atomic_blocked: Option<AtomicBlockedView>,
    preview_request: u64,
    queued_preview: Option<ImportDestinationView>,
    preview_running: bool,
    #[cfg(feature = "testing")]
    previews_sent: u32,
}

impl ImportState {
    pub(super) fn is_active(&self) -> bool {
        self.form.is_some()
            || self.busy
            || self.importing
            || self.atomic_blocked.is_some()
            || self.drop_setup.is_some()
    }

    fn clear_form(&mut self) {
        self.form = None;
        self.preview = None;
        self.outcome_message = None;
        self.offers_rename = false;
        self.setup = None;
        self.preview_request = self.preview_request.wrapping_add(1);
        self.queued_preview = None;
    }

    /// Returns whether anything was active. A running preview ends on its own once it finds no
    /// form, so the flag that keeps a second one from starting stays.
    fn reset(&mut self) -> bool {
        let active = self.is_active();
        self.clear_form();
        self.busy = false;
        self.importing = false;
        self.atomic_blocked = None;
        self.drop_setup = None;
        active
    }

    fn begin_commit(&mut self) {
        self.outcome_message = None;
        self.offers_rename = false;
        self.setup = None;
    }

    fn apply_commit(
        &mut self,
        outcome: ImportOutcomeView,
        destination: ImportDestinationView,
        policy: ImportPolicy,
    ) -> Effects {
        let mut effects = Effects::default();
        match outcome {
            ImportOutcomeView::Queued { expand } => {
                self.clear_form();
                effects.expand = expand.filter(|path| !path.is_empty());
            }
            ImportOutcomeView::Conflicts { message, .. } => {
                self.outcome_message = Some(message);
                self.offers_rename = true;
            }
            ImportOutcomeView::NeedsSetup {
                can_configure,
                message,
                action_label,
            } => {
                self.setup = Some(ImportSetup {
                    can_configure,
                    message,
                    action_label,
                    destination,
                    policy,
                });
            }
            ImportOutcomeView::Error { message } => self.outcome_message = Some(message),
        }
        effects
    }

    fn apply_drop(&mut self, outcome: ImportOutcomeView) -> Effects {
        let mut effects = Effects::default();
        match outcome {
            ImportOutcomeView::Queued { expand } => {
                effects.expand = expand.filter(|path| !path.is_empty());
            }
            ImportOutcomeView::NeedsSetup {
                can_configure,
                message,
                action_label,
            } => {
                self.drop_setup = Some(DropSetup {
                    can_configure,
                    message,
                    action_label,
                });
            }
            ImportOutcomeView::Conflicts { message, .. } | ImportOutcomeView::Error { message } => {
                effects.toast = Some(message)
            }
        }
        effects
    }

    /// Whether the caller should run the preview loop: false when a newer request replaced this
    /// one, the form is gone, or a loop is already running and will pick the destination up.
    fn accept_preview(&mut self, request: u64, destination: ImportDestinationView) -> bool {
        if request != self.preview_request || self.form.is_none() {
            return false;
        }
        self.queued_preview = Some(destination);
        !std::mem::replace(&mut self.preview_running, true)
    }

    /// The destination to preview next; ends the loop when there is none or the form is gone.
    fn next_preview(&mut self) -> Option<ImportDestinationView> {
        let next = self.queued_preview.take().filter(|_| self.form.is_some());
        if next.is_none() {
            self.preview_running = false;
        } else {
            #[cfg(feature = "testing")]
            {
                self.previews_sent += 1;
            }
        }
        next
    }

    /// Keeps the text only while a form is open and no newer destination waits for its own.
    fn store_preview(&mut self, text: Option<String>) -> bool {
        if self.form.is_none() || self.queued_preview.is_some() {
            return false;
        }
        self.preview = text;
        true
    }
}

struct StagedFiles {
    inputs: SharedStagedInputs,
    files: Vec<ImportDroppedFile>,
}

impl StagedFiles {
    fn single_archive(&self) -> Option<&ImportDroppedFile> {
        match self.files.as_slice() {
            [file] if is_archive(&file.name) => Some(file),
            _ => None,
        }
    }
}

impl Drop for StagedFiles {
    fn drop(&mut self) {
        self.inputs
            .discard(self.files.iter().map(|file| &file.input));
    }
}

fn is_archive(name: &str) -> bool {
    Path::new(name)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
}

fn mime_type(name: &str) -> &'static str {
    if is_archive(name) {
        ARCHIVE_MIME_TYPE
    } else {
        NOTE_MIME_TYPE
    }
}

fn size_limit(name: &str) -> usize {
    if is_archive(name) {
        MAX_ARCHIVE_BYTES
    } else {
        MAX_NOTE_FILE_BYTES
    }
}

fn file_name(file: &gio::File) -> String {
    file.basename()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

impl AppModel {
    pub fn import_form(&self) -> Option<Rc<ImportForm>> {
        self.state().import.form.clone()
    }

    pub fn import_preview(&self) -> Option<String> {
        self.state().import.preview.clone()
    }

    pub fn import_outcome_message(&self) -> Option<String> {
        self.state().import.outcome_message.clone()
    }

    pub fn import_offers_rename(&self) -> bool {
        self.state().import.offers_rename
    }

    pub fn import_setup(&self) -> Option<ImportSetup> {
        self.state().import.setup.clone()
    }

    pub fn import_drop_setup(&self) -> Option<DropSetup> {
        self.state().import.drop_setup.clone()
    }

    pub fn import_busy(&self) -> bool {
        self.state().import.busy
    }

    pub fn is_importing(&self) -> bool {
        self.state().import.importing
    }

    pub fn import_atomic_blocked(&self) -> Option<AtomicBlockedView> {
        self.state().import.atomic_blocked.clone()
    }

    pub fn connect_import_changed<F: Fn(&Self) + 'static>(&self, f: F) -> glib::SignalHandlerId {
        self.connect_unit_signal("import-changed", f)
    }

    /// Fires with the folder to reveal once an import into it is queued.
    pub fn connect_import_expand<F: Fn(&Self, Vec<String>) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_local("import-expand", false, move |args| {
            let model = args[0].get::<Self>().ok()?;
            let path = args[1].get::<Vec<String>>().ok()?;
            f(&model, path);
            None
        })
    }

    #[cfg(feature = "testing")]
    pub fn testing_previews_sent(&self) -> u32 {
        self.state().import.previews_sent
    }

    pub fn exporting(&self) -> bool {
        self.imp().exporting.get()
    }

    /// `None` while another export runs, so exports never overlap.
    pub fn begin_export(&self) -> Option<ExportGuard> {
        if self.imp().exporting.replace(true) {
            return None;
        }
        self.emit_by_name::<()>("export-changed", &[]);
        Some(ExportGuard {
            model: self.clone(),
        })
    }

    pub fn connect_export_changed<F: Fn(&Self) + 'static>(&self, f: F) -> glib::SignalHandlerId {
        self.connect_unit_signal("export-changed", f)
    }

    pub async fn export_notes(&self, include_images: bool) -> Result<ExportedFile, UserError> {
        let archive = self
            .request::<ExportNotes>(ExportNotesParams { include_images })
            .await
            .map_err(|error| failed("could not export notes", error))?;
        let base64 = archive.base64;
        let bytes = gio::spawn_blocking(move || glib::base64_decode(&base64))
            .await
            .map_err(|_| {
                glib::g_warning!(LOG_DOMAIN, "the export could not be decoded");
                UserError::generic()
            })?;
        let file_name = Path::new(&archive.file_name)
            .file_name()
            .map_or(archive.file_name.clone(), |name| {
                name.to_string_lossy().into_owned()
            });
        Ok(ExportedFile { file_name, bytes })
    }

    /// Reads a picked zip into the import form, or imports picked notes straight away.
    pub async fn import_files(&self, files: Vec<gio::File>) {
        let Some(staged) = self.stage_files(files).await else {
            return;
        };
        match staged.single_archive() {
            Some(archive) => self.read_archive(archive).await,
            None => {
                self.send_dropped_files(&staged.files, None, ImportDropSource::Picker)
                    .await;
            }
        }
    }

    /// Imports files dropped on the tree into `parent`, or the top level.
    pub async fn drop_import_files(&self, files: Vec<gio::File>, parent: Option<Vec<String>>) {
        let Some(staged) = self.stage_files(files).await else {
            return;
        };
        self.send_dropped_files(&staged.files, parent, ImportDropSource::Tree)
            .await;
    }

    /// Debounced: only the newest destination of a burst is sent, and at most one preview is in
    /// flight, so a result is never older than the destination shown.
    pub async fn preview_import(&self, destination: ImportDestinationView) {
        let request = {
            let mut state = self.state_mut();
            let import = &mut state.import;
            import.preview_request = import.preview_request.wrapping_add(1);
            import.preview_request
        };
        glib::timeout_future(PREVIEW_DEBOUNCE).await;
        if !self.state_mut().import.accept_preview(request, destination) {
            return;
        }
        while let Some(next) = self.take_next_preview() {
            let result = self
                .request::<ImportPreview>(ImportPreviewParams { destination: next })
                .await;
            let text = match result {
                Ok(result) => result.text,
                Err(error) => {
                    warn("could not preview the import", &error);
                    None
                }
            };
            if self.state_mut().import.store_preview(text) {
                self.emit_by_name::<()>("import-changed", &[]);
            }
        }
    }

    pub async fn commit_import(&self, destination: ImportDestinationView, policy: ImportPolicy) {
        {
            let mut state = self.state_mut();
            if state.import.form.is_none() || state.import.busy {
                return;
            }
            state.import.busy = true;
        }
        self.emit_by_name::<()>("import-changed", &[]);
        self.perform_import_commit(destination, policy).await;
        self.update_import(|import| import.busy = false);
    }

    /// Enables atomic commits, then goes on with what needed them: the open form's commit, or the
    /// files the core holds.
    pub async fn enable_atomic_and_retry(&self) {
        let (setup, dropping) = {
            let mut state = self.state_mut();
            let import = &mut state.import;
            if import.busy {
                return;
            }
            let dropping = import.drop_setup.is_some() || import.form.is_none();
            import.drop_setup = None;
            import.busy = true;
            (import.setup.clone(), dropping)
        };
        self.emit_by_name::<()>("import-changed", &[]);
        let Some(result) = self
            .request_in_session::<ImportEnableAtomic>(ImportEnableAtomicParams {})
            .await
        else {
            return;
        };
        match result {
            Err(error) => {
                let error = failed("could not enable atomic commits", error);
                self.report_import_failure(error.message, dropping);
            }
            Ok(result) => {
                if let Some(message) = result.error {
                    self.report_import_failure(message, dropping);
                } else if let Some(outcome) = result.outcome {
                    self.apply_drop_outcome(outcome);
                } else if let Some(setup) = setup.filter(|_| self.import_form().is_some()) {
                    self.update_import(|import| import.setup = None);
                    self.perform_import_commit(setup.destination, setup.policy)
                        .await;
                }
            }
        }
        self.update_import(|import| import.busy = false);
    }

    pub fn cancel_import(&self) {
        self.update_import(ImportState::clear_form);
        let request = self.request::<ImportCancel>(ImportCancelParams {});
        self.spawn(async move {
            if let Err(error) = request.await {
                warn("could not cancel the import", &error);
            }
        });
    }

    /// Forgets the prompt about files the repository cannot take until atomic commits are enabled.
    pub fn dismiss_drop_setup(&self) {
        if self.state().import.drop_setup.is_some() {
            self.update_import(|import| import.drop_setup = None);
        }
    }

    /// Answers the prompt shown when a save needs atomic commits: enable them, or save without.
    /// The prompt is gone once answered; the core raises it again if the save is still blocked.
    pub async fn resolve_atomic_blocked(&self, enable: bool) {
        if self.state().import.atomic_blocked.is_some() {
            self.update_import(|import| import.atomic_blocked = None);
        }
        if enable {
            let Some(result) = self
                .request_in_session::<ImportEnableAtomic>(ImportEnableAtomicParams {})
                .await
            else {
                return;
            };
            match result {
                Ok(result) => {
                    if let Some(message) = result.error {
                        self.show_toast(&message);
                    } else if let Some(outcome) = result.outcome {
                        self.apply_drop_outcome(outcome);
                    }
                }
                Err(error) => {
                    self.report_error(&failed("could not enable atomic commits", error));
                }
            }
        } else if let Err(error) = self
            .request::<ImportSaveWithoutAtomic>(ImportSaveWithoutAtomicParams {})
            .await
        {
            self.report_error(&failed("could not save without atomic commits", error));
        }
    }

    pub(super) fn reset_import_state(&self) {
        if self.state_mut().import.reset() {
            self.emit_by_name::<()>("import-changed", &[]);
        }
    }

    pub(super) fn import_status_changed(&self, status: ImportStatusChanged) {
        let changed = {
            let mut state = self.state_mut();
            let import = &mut state.import;
            let changed = import.importing != status.importing
                || import.atomic_blocked != status.atomic_blocked;
            import.importing = status.importing;
            import.atomic_blocked = status.atomic_blocked;
            changed
        };
        if changed {
            self.emit_by_name::<()>("import-changed", &[]);
        }
    }
}

impl AppModel {
    fn update_import<R>(&self, change: impl FnOnce(&mut ImportState) -> R) -> R {
        let result = change(&mut self.state_mut().import);
        self.emit_by_name::<()>("import-changed", &[]);
        result
    }

    /// `None` when the session ended meanwhile, so a late reply cannot touch the next session.
    async fn request_in_session<C: Command>(
        &self,
        params: C::Params,
    ) -> Option<Result<C::Result, RequestError>> {
        let generation = self.imp().generation.get();
        let result = self.request::<C>(params).await;
        (self.imp().generation.get() == generation).then_some(result)
    }

    /// Reads every file before staging any, so one unreadable file stops the whole import.
    async fn stage_files(&self, files: Vec<gio::File>) -> Option<StagedFiles> {
        if files.is_empty() {
            return None;
        }
        self.flush_edits().await;
        let inputs = self.client()?.staged_inputs();
        let mut read = Vec::with_capacity(files.len());
        for file in &files {
            let name = file_name(file);
            match read_bounded(file, size_limit(&name)).await {
                Ok(bytes) => read.push((name, bytes)),
                Err(error) => {
                    log_read_failure(&error);
                    self.show_toast(READ_FAILED_MESSAGE);
                    return None;
                }
            }
        }
        let files = read
            .into_iter()
            .map(|(name, bytes)| ImportDroppedFile {
                input: inputs.stage(bytes, mime_type(&name)),
                name,
            })
            .collect();
        Some(StagedFiles { inputs, files })
    }

    async fn read_archive(&self, archive: &ImportDroppedFile) {
        let params = ImportReadArchiveParams {
            input: archive.input.clone(),
            file_name: archive.name.clone(),
        };
        let Some(result) = self.request_in_session::<ImportReadArchive>(params).await else {
            return;
        };
        match result {
            Ok(ImportArchiveOutcome::Ready { form }) => self.update_import(|import| {
                import.clear_form();
                import.form = Some(Rc::new(*form));
            }),
            Ok(ImportArchiveOutcome::Error { message }) => self.show_toast(&message),
            Err(error) => self.report_error(&failed("could not read the archive", error)),
        }
    }

    async fn send_dropped_files(
        &self,
        files: &[ImportDroppedFile],
        parent: Option<Vec<String>>,
        source: ImportDropSource,
    ) {
        let params = ImportDropFilesParams {
            files: files.to_vec(),
            parent,
            source,
        };
        let Some(result) = self.request_in_session::<ImportDropFiles>(params).await else {
            return;
        };
        match result {
            Ok(result) => self.apply_drop_outcome(result.outcome),
            Err(error) => self.report_error(&failed("could not import the files", error)),
        }
    }

    async fn perform_import_commit(
        &self,
        destination: ImportDestinationView,
        policy: ImportPolicy,
    ) {
        self.update_import(ImportState::begin_commit);
        let params = ImportCommitParams {
            destination: destination.clone(),
            policy,
        };
        let Some(result) = self.request_in_session::<ImportCommit>(params).await else {
            return;
        };
        let outcome = match result {
            Ok(result) => result.outcome,
            Err(error) => {
                let error = failed("could not import the notes", error);
                self.update_import(|import| {
                    if import.form.is_some() {
                        import.outcome_message = Some(error.message);
                    }
                });
                return;
            }
        };
        if self.import_form().is_none() {
            return;
        }
        let effects =
            self.update_import(|import| import.apply_commit(outcome, destination, policy));
        self.perform_effects(effects);
    }

    fn take_next_preview(&self) -> Option<ImportDestinationView> {
        self.state_mut().import.next_preview()
    }

    fn apply_drop_outcome(&self, outcome: ImportOutcomeView) {
        let effects = self.update_import(|import| import.apply_drop(outcome));
        self.perform_effects(effects);
    }

    fn perform_effects(&self, effects: Effects) {
        if let Some(path) = effects.expand {
            self.emit_by_name::<()>("import-expand", &[&path]);
        }
        if let Some(message) = effects.toast {
            self.show_toast(&message);
        }
    }

    fn report_import_failure(&self, message: String, dropping: bool) {
        if dropping {
            self.show_toast(&message);
        } else {
            self.update_import(|import| import.outcome_message = Some(message));
        }
    }
}

#[cfg(all(test, feature = "testing"))]
mod tests {
    use std::cell::{Cell, RefCell};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    use commitnote_core_api::commands::ImportFormCopy;
    use commitnote_core_api::shapes::TreeNode;

    use super::super::Route;
    use super::super::tests::{Session, all_notes, fake_bundle, run, tree_has};
    use super::*;

    static NEXT_DIR: AtomicU32 = AtomicU32::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let id = NEXT_DIR.fetch_add(1, Ordering::SeqCst);
            let dir = std::env::temp_dir()
                .join(format!("commitnote-data-test-{}-{id}", std::process::id()));
            std::fs::create_dir_all(&dir).expect("the temporary directory is created");
            Self(dir)
        }

        fn file(&self, name: &str, bytes: &[u8]) -> gio::File {
            let path = self.0.join(name);
            std::fs::write(&path, bytes).expect("the temporary file is written");
            gio::File::for_path(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn path(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    fn new_folder(name: &str) -> ImportDestinationView {
        ImportDestinationView::NewFolder {
            parent: Vec::new(),
            name: name.to_owned(),
        }
    }

    fn folders(nodes: &[TreeNode]) -> Vec<Vec<String>> {
        nodes
            .iter()
            .flat_map(|node| match node {
                TreeNode::Folder { path, children, .. } => {
                    let mut found = vec![path.clone()];
                    found.extend(folders(children));
                    found
                }
                TreeNode::Note { .. } => Vec::new(),
            })
            .collect()
    }

    fn count_signal(model: &AppModel, signal: &str) -> Rc<Cell<u32>> {
        let count = Rc::new(Cell::new(0));
        model.connect_local(signal, false, {
            let count = count.clone();
            move |_| {
                count.set(count.get() + 1);
                None
            }
        });
        count
    }

    fn collect_toasts(model: &AppModel) -> Rc<RefCell<Vec<String>>> {
        let toasts = Rc::new(RefCell::new(Vec::new()));
        model.connect_toast({
            let toasts = toasts.clone();
            move |_, message| toasts.borrow_mut().push(message.to_owned())
        });
        toasts
    }

    fn collect_expands(model: &AppModel) -> Rc<RefCell<Vec<Vec<String>>>> {
        let expands = Rc::new(RefCell::new(Vec::new()));
        model.connect_import_expand({
            let expands = expands.clone();
            move |_, path| expands.borrow_mut().push(path)
        });
        expands
    }

    async fn ready_session() -> Session {
        let session = Session::start(fake_bundle());
        session.log_in().await;
        session
            .wait_until("the notes", |model| {
                model
                    .tree()
                    .is_some_and(|tree| !all_notes(&tree).is_empty())
            })
            .await;
        session
    }

    async fn exported_archive(session: &Session, dir: &TempDir) -> gio::File {
        let exported = session
            .model
            .export_notes(false)
            .await
            .expect("the notes are exported");
        dir.file(&exported.file_name, &exported.bytes)
    }

    async fn open_form(session: &Session, dir: &TempDir) {
        let archive = exported_archive(session, dir).await;
        session.model.import_files(vec![archive]).await;
        assert!(session.model.import_form().is_some(), "the form is open");
    }

    fn staged_is_empty(model: &AppModel) -> bool {
        model
            .client()
            .expect("the core client")
            .staged_inputs()
            .is_empty()
    }

    fn form() -> Rc<ImportForm> {
        Rc::new(ImportForm {
            file_name: "notes.zip".to_owned(),
            default_folder_name: "notes".to_owned(),
            skipped: None,
            empty: false,
            targets: Vec::new(),
            copy: ImportFormCopy {
                title: String::new(),
                conflicts_title: String::new(),
                setup_title: String::new(),
                into_label: String::new(),
                new_folder_label: String::new(),
                folder_name_label: String::new(),
                existing_folder_label: String::new(),
                root_label: String::new(),
                empty_text: String::new(),
                import_label: String::new(),
                importing_label: String::new(),
                rename_label: String::new(),
                enable_atomic_label: String::new(),
                cancel_label: String::new(),
            },
        })
    }

    fn state_with_form() -> ImportState {
        ImportState {
            form: Some(form()),
            ..ImportState::default()
        }
    }

    #[test]
    fn only_one_export_runs_at_a_time() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let changes = count_signal(model, "export-changed");

            let guard = model.begin_export().expect("the first export may begin");
            assert!(model.exporting());
            assert!(model.begin_export().is_none());
            drop(guard);

            assert!(!model.exporting());
            assert!(model.begin_export().is_some());
            assert_eq!(changes.get(), 4);
        });
    }

    #[test]
    fn exports_the_notes_as_a_zip_with_or_without_images() {
        run(|| async {
            let session = ready_session().await;

            for include_images in [false, true] {
                let exported = session
                    .model
                    .export_notes(include_images)
                    .await
                    .expect("the notes are exported");

                assert!(exported.file_name.ends_with(".zip"));
                assert!(!exported.file_name.contains('/'));
                assert_eq!(&exported.bytes[..2], b"PK");
            }
        });
    }

    #[test]
    fn an_exported_archive_imports_into_a_new_folder() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let dir = TempDir::new();
            let notes = all_notes(&model.tree().unwrap_or_default());
            let changes = count_signal(model, "import-changed");
            let expands = collect_expands(model);

            open_form(&session, &dir).await;
            assert!(staged_is_empty(model));
            assert!(changes.get() >= 1);
            model.preview_import(new_folder("Round trip")).await;
            assert!(
                model
                    .import_preview()
                    .is_some_and(|text| text.starts_with("Imports "))
            );
            model
                .commit_import(new_folder("Round trip"), ImportPolicy::Stop)
                .await;

            assert!(model.import_form().is_none());
            assert_eq!(model.import_preview(), None);
            assert_eq!(model.import_outcome_message(), None);
            assert!(!model.import_busy());
            assert_eq!(*expands.borrow(), vec![path(&["Round trip"])]);
            session
                .wait_until("the imported notes", |model| {
                    notes.iter().all(|note| {
                        let mut imported = path(&["Round trip"]);
                        imported.extend(note.iter().cloned());
                        tree_has(model, &imported)
                    })
                })
                .await;
        });
    }

    #[test]
    fn conflicts_stop_the_import_until_the_user_renames() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let dir = TempDir::new();
            let notes_before = all_notes(&model.tree().unwrap_or_default()).len();
            let expands = collect_expands(model);

            open_form(&session, &dir).await;
            model
                .commit_import(ImportDestinationView::Root, ImportPolicy::Stop)
                .await;

            assert!(model.import_form().is_some());
            assert!(model.import_offers_rename());
            assert!(model.import_outcome_message().is_some());
            assert!(expands.borrow().is_empty());
            assert_eq!(
                all_notes(&model.tree().unwrap_or_default()).len(),
                notes_before
            );

            model
                .commit_import(ImportDestinationView::Root, ImportPolicy::Rename)
                .await;

            assert!(model.import_form().is_none());
            assert!(!model.import_offers_rename());
            assert_eq!(model.import_outcome_message(), None);
            session
                .wait_until("the renamed copies", |model| {
                    all_notes(&model.tree().unwrap_or_default()).len() > notes_before
                })
                .await;
        });
    }

    #[test]
    fn dropped_markdown_files_become_notes() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let dir = TempDir::new();
            let file = dir.file("Dropped note.md", b"Dropped body");

            model.drop_import_files(vec![file], None).await;

            assert!(staged_is_empty(model));
            assert!(model.import_form().is_none());
            session
                .wait_until("the dropped note", |model| {
                    tree_has(model, &path(&["Dropped note"]))
                })
                .await;
        });
    }

    #[test]
    fn a_dropped_file_lands_in_the_folder_it_was_dropped_on() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let dir = TempDir::new();
            let folder = folders(&model.tree().unwrap_or_default())
                .into_iter()
                .next()
                .expect("the sample notes have a folder");
            let file = dir.file("Dropped note.md", b"Dropped body");

            model
                .drop_import_files(vec![file], Some(folder.clone()))
                .await;

            let mut expected = folder;
            expected.push("Dropped note".to_owned());
            session
                .wait_until("the dropped note in the folder", |model| {
                    tree_has(model, &expected)
                })
                .await;
        });
    }

    #[test]
    fn picked_notes_are_imported_without_a_form() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let dir = TempDir::new();
            let files = vec![
                dir.file("First picked.md", b"one"),
                dir.file("Second picked.markdown", b"two"),
            ];

            model.import_files(files).await;

            assert!(model.import_form().is_none());
            assert!(staged_is_empty(model));
            session
                .wait_until("the picked notes", |model| {
                    tree_has(model, &path(&["First picked"]))
                        && tree_has(model, &path(&["Second picked"]))
                })
                .await;
        });
    }

    #[test]
    fn a_burst_of_previews_sends_one_request_for_the_last_destination() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let dir = TempDir::new();
            open_form(&session, &dir).await;
            model.preview_import(new_folder("Valid")).await;
            assert!(model.import_preview().is_some());
            assert_eq!(model.testing_previews_sent(), 1);

            for name in ["One", "Two", "invalid/name"] {
                let model = model.clone();
                session.model.spawn(async move {
                    model.preview_import(new_folder(name)).await;
                });
            }
            session
                .wait_until("the last destination's preview", |model| {
                    model.import_preview().is_none()
                })
                .await;
            glib::timeout_future(Duration::from_millis(400)).await;

            assert_eq!(model.testing_previews_sent(), 2);
            assert_eq!(model.import_preview(), None);
        });
    }

    #[test]
    fn cancelling_clears_the_form_and_drops_a_pending_preview() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let dir = TempDir::new();
            open_form(&session, &dir).await;
            let pending = {
                let model = model.clone();
                glib::spawn_future_local(async move {
                    model.preview_import(new_folder("Valid")).await;
                })
            };

            model.cancel_import();
            pending.await.expect("the preview task finishes");

            assert!(model.import_form().is_none());
            assert_eq!(model.import_preview(), None);
            assert_eq!(model.testing_previews_sent(), 0);
        });
    }

    #[test]
    fn an_unreadable_file_gives_a_toast_and_stages_nothing() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let dir = TempDir::new();
            let toasts = collect_toasts(model);
            let readable = dir.file("Readable.md", b"body");
            let missing = gio::File::for_path(dir.0.join("Missing.md"));

            model.import_files(vec![readable, missing]).await;

            assert_eq!(*toasts.borrow(), vec![READ_FAILED_MESSAGE.to_owned()]);
            assert!(staged_is_empty(model));
            assert!(model.import_form().is_none());
            assert!(!tree_has(model, &path(&["Readable"])));
        });
    }

    #[test]
    fn an_archive_the_core_rejects_toasts_and_stages_nothing() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let dir = TempDir::new();
            let toasts = collect_toasts(model);
            let broken = dir.file("Broken.zip", b"not an archive");

            model.import_files(vec![broken]).await;

            assert_eq!(toasts.borrow().len(), 1);
            assert!(staged_is_empty(model));
            assert!(model.import_form().is_none());
        });
    }

    #[test]
    fn logging_out_clears_the_import() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let dir = TempDir::new();
            open_form(&session, &dir).await;
            let changes = count_signal(model, "import-changed");

            model.log_out().await.expect("the session logs out");
            session
                .wait_until("the token page", |model| model.route() == Route::Token)
                .await;

            assert!(model.import_form().is_none());
            assert!(changes.get() >= 1);
        });
    }

    #[test]
    fn the_status_event_updates_the_getters_and_signals_only_on_change() {
        run(|| async {
            let session = Session::start(fake_bundle());
            let model = &session.model;
            let changes = count_signal(model, "import-changed");
            let blocked = AtomicBlockedView {
                title: "Title".to_owned(),
                message: "Message".to_owned(),
                enable_label: "Enable".to_owned(),
                save_without_label: "Save".to_owned(),
                can_configure: true,
            };
            let status = ImportStatusChanged {
                importing: true,
                atomic_blocked: Some(blocked.clone()),
            };

            model.import_status_changed(status.clone());
            model.import_status_changed(status);

            assert!(model.is_importing());
            assert_eq!(model.import_atomic_blocked(), Some(blocked));
            assert_eq!(changes.get(), 1);
        });
    }

    #[test]
    fn dismissing_the_drop_prompt_clears_it_and_signals_only_when_shown() {
        run(|| async {
            let session = Session::start(fake_bundle());
            let model = &session.model;
            model.state_mut().import.drop_setup = Some(DropSetup {
                can_configure: true,
                message: "Needs setup".to_owned(),
                action_label: "Enable".to_owned(),
            });
            let changes = count_signal(model, "import-changed");

            model.dismiss_drop_setup();
            model.dismiss_drop_setup();

            assert_eq!(model.import_drop_setup(), None);
            assert_eq!(changes.get(), 1);
        });
    }

    #[test]
    fn answering_the_atomic_prompt_clears_it() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            model.import_status_changed(ImportStatusChanged {
                importing: false,
                atomic_blocked: Some(AtomicBlockedView {
                    title: "Title".to_owned(),
                    message: "Message".to_owned(),
                    enable_label: "Enable".to_owned(),
                    save_without_label: "Save".to_owned(),
                    can_configure: true,
                }),
            });

            model.resolve_atomic_blocked(false).await;

            assert_eq!(model.import_atomic_blocked(), None);
        });
    }

    #[test]
    fn a_queued_commit_clears_the_form_and_asks_to_expand() {
        let mut state = state_with_form();
        state.preview = Some("Imports 1 notes and 0 folders.".to_owned());

        let effects = state.apply_commit(
            ImportOutcomeView::Queued {
                expand: Some(path(&["Folder"])),
            },
            ImportDestinationView::Root,
            ImportPolicy::Stop,
        );

        assert!(state.form.is_none());
        assert_eq!(state.preview, None);
        assert_eq!(effects.expand, Some(path(&["Folder"])));
    }

    #[test]
    fn a_queued_commit_without_a_folder_expands_nothing() {
        let mut state = state_with_form();

        let effects = state.apply_commit(
            ImportOutcomeView::Queued {
                expand: Some(Vec::new()),
            },
            ImportDestinationView::Root,
            ImportPolicy::Stop,
        );

        assert_eq!(effects.expand, None);
    }

    #[test]
    fn a_commit_that_needs_setup_remembers_what_to_retry() {
        let mut state = state_with_form();
        let destination = new_folder("Target");

        let effects = state.apply_commit(
            ImportOutcomeView::NeedsSetup {
                can_configure: true,
                message: "Needs setup".to_owned(),
                action_label: "Enable".to_owned(),
            },
            destination.clone(),
            ImportPolicy::Rename,
        );

        assert!(state.form.is_some());
        assert_eq!(
            state.setup,
            Some(ImportSetup {
                can_configure: true,
                message: "Needs setup".to_owned(),
                action_label: "Enable".to_owned(),
                destination,
                policy: ImportPolicy::Rename,
            })
        );
        assert!(effects.expand.is_none() && effects.toast.is_none());
    }

    #[test]
    fn a_commit_error_keeps_the_form_with_its_message() {
        let mut state = state_with_form();

        state.apply_commit(
            ImportOutcomeView::Error {
                message: "Failed".to_owned(),
            },
            ImportDestinationView::Root,
            ImportPolicy::Stop,
        );

        assert!(state.form.is_some());
        assert_eq!(state.outcome_message.as_deref(), Some("Failed"));
        assert!(!state.offers_rename);
    }

    #[test]
    fn starting_a_commit_forgets_the_previous_outcome() {
        let mut state = state_with_form();
        state.outcome_message = Some("Old".to_owned());
        state.offers_rename = true;

        state.begin_commit();

        assert_eq!(state.outcome_message, None);
        assert!(!state.offers_rename);
    }

    #[test]
    fn a_drop_that_needs_setup_waits_for_the_user() {
        let mut state = ImportState::default();

        let effects = state.apply_drop(ImportOutcomeView::NeedsSetup {
            can_configure: false,
            message: "Needs setup".to_owned(),
            action_label: "Enable".to_owned(),
        });

        assert_eq!(
            state.drop_setup,
            Some(DropSetup {
                can_configure: false,
                message: "Needs setup".to_owned(),
                action_label: "Enable".to_owned(),
            })
        );
        assert!(effects.toast.is_none());
        assert!(state.is_active());
    }

    #[test]
    fn a_drop_error_becomes_a_toast() {
        let mut state = ImportState::default();

        let effects = state.apply_drop(ImportOutcomeView::Error {
            message: "Failed".to_owned(),
        });

        assert_eq!(effects.toast.as_deref(), Some("Failed"));
        assert!(!state.is_active());
    }

    #[test]
    fn a_preview_for_a_replaced_request_is_not_run() {
        let mut state = state_with_form();
        state.preview_request = 3;

        assert!(!state.accept_preview(2, ImportDestinationView::Root));
        assert!(state.accept_preview(3, ImportDestinationView::Root));
        assert!(!state.accept_preview(3, new_folder("Later")));
        assert_eq!(state.next_preview(), Some(new_folder("Later")));
        assert_eq!(state.next_preview(), None);
        assert!(!state.preview_running);
    }

    #[test]
    fn a_late_preview_result_is_dropped_once_the_form_is_gone_or_a_newer_one_waits() {
        let mut state = state_with_form();
        state.queued_preview = Some(ImportDestinationView::Root);
        assert!(!state.store_preview(Some("Old".to_owned())));

        state.queued_preview = None;
        assert!(state.store_preview(Some("Current".to_owned())));
        assert_eq!(state.preview.as_deref(), Some("Current"));

        state.clear_form();
        assert!(!state.store_preview(Some("Late".to_owned())));
        assert_eq!(state.preview, None);
    }

    #[test]
    fn resetting_keeps_the_running_preview_flag_and_reports_activity() {
        let mut state = state_with_form();
        state.preview_running = true;
        state.busy = true;
        state.importing = true;

        assert!(state.reset());

        assert!(!state.is_active());
        assert!(state.preview_running);
        assert!(!state.reset());
    }

    #[test]
    fn debug_output_leaves_out_names() {
        let exported = ExportedFile {
            file_name: "secret-name.zip".to_owned(),
            bytes: vec![1, 2, 3],
        };
        let setup = ImportSetup {
            can_configure: true,
            message: "secret message".to_owned(),
            action_label: "secret label".to_owned(),
            destination: new_folder("secret folder"),
            policy: ImportPolicy::Stop,
        };

        let shown = format!("{exported:?} {setup:?}");

        assert!(!shown.contains("secret"));
    }
}
