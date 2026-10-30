use std::cell::{Cell, OnceCell, Ref, RefCell, RefMut};
use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::OnceLock;

use commitnote_core_api::commands::{
    ConflictResolution, ConflictResolve, ConflictResolveParams, DeviceName, DeviceNameParams,
    DraftCommitName, DraftCommitNameParams, DraftContent, DraftContentParams, DraftLeave,
    DraftLeaveParams, DraftStart, DraftStartParams, EarlyDraftHandOff, EarlyDraftHandOffParams,
    EarlyDraftOutcome, FlushOutcome, ForgesList, ForgesListParams, LifecycleSetOnline,
    LifecycleSetOnlineParams, LifecycleSetVisible, LifecycleSetVisibleParams, LoginInitialize,
    LoginInspectRepository, LoginInspectRepositoryParams, LoginInspectRepositoryResult,
    LoginLastRepository, LoginLastRepositoryParams, LoginListRepositories,
    LoginListRepositoriesParams, LoginUnlock, NameCommitOutcome, NoteDraft, NoteDraftOutcome,
    NoteEdit, NoteEditParams, NoteOpen, NoteOpenParams, NoteRename, NoteRenameParams,
    NoticeIdParams, NoticesDismiss, NoticesPerform, PassphraseParams, PassphraseStrengthCheck,
    PassphraseStrengthParams, SessionLogout, SessionLogoutParams, SessionLogoutResult,
    SessionResume, SessionResumeParams, SessionResumeResult, SettingsOpen, SettingsOpenParams,
    SyncFlush, SyncFlushParams, SyncRefresh, SyncRefreshParams, SyncRetry, SyncRetryParams,
    TreeGet, TreeGetParams, TreeGetResult,
};
use commitnote_core_api::events::{NoteChanged, Notice, SyncStateChanged, TreeChanged};
use commitnote_core_api::settings::{AccentOptionView, SettingsView};
use commitnote_core_api::shapes::{
    ForgeKind, ForgeView, LogoutOutcome, NoticeAction, OpenNote, PassphraseStrength,
    RemoteTextEdit, RepositoryView, TagOptionView, TreeNode,
};
use commitnote_core_api::{Command, CoreError, CoreErrorKind, CoreEvent, Secret};
use commitnote_core_runtime::RequestError;
use commitnote_interaction::{TypeToStartBuffer, TypeToStartInput};
use glib::prelude::*;
use glib::subclass::Signal;
use glib::subclass::prelude::*;

use super::appearance::Appearance;
use super::core_client::{ClientConfig, CoreClient, startup_message};
use super::edit_sender::{EditDestination, EditSender};
use super::editor_lane::EditorLane;
use super::editor_settings::EditorSettings;

pub const GENERIC_ERROR_MESSAGE: &str = "Something went wrong. Try again.";
const NO_KEYRING_MESSAGE: &str = "No keyring is available, so this session will not be remembered.";
const LOG_DOMAIN: &str = "commitnote";

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub app_id: String,
    pub version: String,
    pub bundle_source: String,
    pub cache_dir: PathBuf,
    pub config_dir: PathBuf,
    pub device_model: String,
    pub testing: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryChoice {
    pub url: String,
    pub label: String,
    pub private: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnusableOutcome {
    pub repository: RepositoryView,
    pub error: CoreError,
    pub can_check_again: bool,
    pub foreign_hint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadingFailure {
    pub message: String,
    pub can_retry: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyChangedView {
    pub unsaved_count: u32,
    pub message: String,
    pub detail: String,
    pub export_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LogOutResult {
    LoggedOut,
    Unsaved { message: String },
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum Route {
    #[default]
    Starting,
    StartupFailed {
        message: String,
    },
    Token,
    RepositoryList {
        repositories: Vec<RepositoryChoice>,
    },
    Unlock {
        repository: RepositoryView,
    },
    Initialize {
        repository: RepositoryView,
        set_up_description: String,
    },
    Unusable {
        outcome: UnusableOutcome,
    },
    Loading {
        failure: Option<LoadingFailure>,
    },
    Notes,
    KeyChanged {
        view: KeyChangedView,
    },
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum EditorTarget {
    #[default]
    None,
    Note(Vec<String>),
    Draft(NoteDraft),
}

impl EditorTarget {
    pub fn note_path(&self) -> Option<&[String]> {
        match self {
            Self::Note(path) => Some(path),
            Self::None | Self::Draft(_) => None,
        }
    }

    pub fn is_draft(&self) -> bool {
        matches!(self, Self::Draft(_))
    }
}

/// Where the cursor goes when a draft starts.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum DraftFocus {
    #[default]
    Name,
    Editor,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RenameResult {
    None,
    Restore,
    Error(String),
    Renamed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteContentUpdate {
    pub serial: u64,
    pub path: Vec<String>,
    pub content: String,
    pub edits: Option<Vec<RemoteTextEdit>>,
}

/// Text typed on the loading page before the notes are available.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EarlyDraftState {
    pub name: String,
    pub body: String,
    pub name_confirmed: bool,
}

impl EarlyDraftState {
    pub fn is_empty(&self) -> bool {
        self.name.is_empty() && self.body.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserError {
    pub message: String,
}

impl UserError {
    pub fn generic() -> Self {
        Self {
            message: GENERIC_ERROR_MESSAGE.to_owned(),
        }
    }
}

impl From<RequestError> for UserError {
    fn from(error: RequestError) -> Self {
        match error {
            RequestError::Core(error) => Self {
                message: error.message,
            },
            RequestError::Stopped | RequestError::Decode(_) => Self::generic(),
        }
    }
}

impl fmt::Display for UserError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for UserError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenError {
    NoRepositories,
    Message(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UnlockError {
    Retry {
        message: String,
        wrong_passphrase: bool,
    },
    Routed,
}

#[derive(Debug, Clone, Default)]
pub struct LoginDraft {
    pub forge: Option<String>,
    pub token: Option<Secret>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoticeView {
    pub id: String,
    pub message: String,
    pub persistent: bool,
    pub action_label: Option<String>,
}

#[derive(Default)]
struct State {
    route: Route,
    forges: Vec<ForgeView>,
    last_repository: Option<(String, String)>,
    device_name: Option<String>,
    draft: LoginDraft,
    repositories: Vec<RepositoryChoice>,
    repository_url: Option<String>,
    repository: Option<RepositoryView>,
    token_page_error: Option<String>,
    loading_message: Option<String>,
    tree: Option<Vec<TreeNode>>,
    tag_options: Vec<TagOptionView>,
    notice_actions: HashMap<String, NoticeAction>,
    open_note_path: Option<Vec<String>>,
    core_open_path: Option<Vec<String>>,
    pending_opens: usize,
    open_note: Option<OpenNote>,
    editor_target: EditorTarget,
    editor_lineage: u64,
    draft_name: String,
    draft_body: String,
    draft_error: Option<String>,
    draft_focus: DraftFocus,
    focus_end: bool,
    early_draft: EarlyDraftState,
    handing_off: bool,
    type_to_start: Option<TypeToStartBuffer>,
    note_name_error: Option<String>,
    note_switch: u64,
    note_update: Option<NoteContentUpdate>,
    note_update_serial: u64,
    sync: Option<SyncStateChanged>,
    key_changed: Option<KeyChangedView>,
    accent_options: Vec<AccentOptionView>,
    appearance: Appearance,
    editor_settings: EditorSettings,
    visible: bool,
    online: bool,
    sent_visible: Option<bool>,
    sent_online: Option<bool>,
    awaiting_tree: bool,
    session_active: bool,
    keyring_warned: bool,
    shut_down: bool,
}

mod imp {
    use super::*;

    #[derive(Default)]
    pub struct AppModel {
        pub(super) config: OnceCell<AppConfig>,
        pub(super) context: OnceCell<glib::MainContext>,
        pub(super) client: RefCell<Option<Rc<CoreClient>>>,
        pub(super) state: RefCell<State>,
        pub(super) generation: Cell<u64>,
        pub(super) edit_sender: OnceCell<EditSender>,
        pub(super) editor_lane: EditorLane,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for AppModel {
        const NAME: &'static str = "CommitnoteAppModel";
        type Type = super::AppModel;
    }

    impl ObjectImpl for AppModel {
        fn signals() -> &'static [Signal] {
            static SIGNALS: OnceLock<Vec<Signal>> = OnceLock::new();
            SIGNALS.get_or_init(|| {
                vec![
                    Signal::builder("route-changed").build(),
                    Signal::builder("loading-message-changed").build(),
                    Signal::builder("tree-changed").build(),
                    Signal::builder("open-note-changed").build(),
                    Signal::builder("appearance-changed").build(),
                    Signal::builder("editor-settings-changed").build(),
                    Signal::builder("early-draft-changed").build(),
                    Signal::builder("early-draft-presence-changed").build(),
                    Signal::builder("sync-state-changed").build(),
                    Signal::builder("notice")
                        .param_types([
                            String::static_type(),
                            String::static_type(),
                            bool::static_type(),
                            String::static_type(),
                        ])
                        .build(),
                    Signal::builder("notice-cleared")
                        .param_types([String::static_type()])
                        .build(),
                    Signal::builder("toast")
                        .param_types([String::static_type()])
                        .build(),
                ]
            })
        }
    }
}

glib::wrapper! {
    /// The whole app session: core runtime, login, loading and notes state, independent of GTK.
    pub struct AppModel(ObjectSubclass<imp::AppModel>);
}

impl AppModel {
    pub fn new(config: AppConfig) -> Self {
        let model: Self = glib::Object::new();
        let imp = model.imp();
        let _ = imp.context.set(glib::MainContext::ref_thread_default());
        let _ = imp.config.set(config);
        let _ = imp.edit_sender.set(model.new_edit_sender());
        {
            let mut state = imp.state.borrow_mut();
            state.visible = true;
            state.online = true;
        }
        let starting = model.clone();
        model.spawn(async move { starting.start().await });
        model
    }

    /// Stops the core runtime and flushes the blob cache; the model is unusable afterwards.
    pub fn shutdown(&self) {
        self.state_mut().shut_down = true;
        self.bump_generation();
        let client = self.imp().client.take();
        if let Some(client) = client {
            client.shutdown();
        }
    }

    pub fn route(&self) -> Route {
        self.state().route.clone()
    }

    pub fn forges(&self) -> Vec<ForgeView> {
        self.state().forges.clone()
    }

    pub fn last_repository(&self) -> Option<(String, String)> {
        self.state().last_repository.clone()
    }

    pub fn device_name(&self) -> Option<String> {
        self.state().device_name.clone()
    }

    pub fn login_draft(&self) -> LoginDraft {
        self.state().draft.clone()
    }

    pub fn set_login_draft(&self, forge: &str, token: Secret) {
        self.state_mut().draft = LoginDraft {
            forge: Some(forge.to_owned()),
            token: Some(token),
        };
    }

    pub fn token_page_error(&self) -> Option<String> {
        self.state_mut().token_page_error.take()
    }

    pub fn keyring_available(&self) -> bool {
        self.client()
            .is_some_and(|client| client.keyring_available())
    }

    pub fn repository_label(&self) -> Option<String> {
        self.state()
            .repository
            .as_ref()
            .map(|repository| repository.label.clone())
    }

    pub fn loading_message(&self) -> Option<String> {
        self.state().loading_message.clone()
    }

    pub fn tree(&self) -> Option<Vec<TreeNode>> {
        self.state().tree.clone()
    }

    pub fn tag_options(&self) -> Vec<TagOptionView> {
        self.state().tag_options.clone()
    }

    pub fn open_note_state(&self) -> Option<OpenNote> {
        self.state().open_note.clone()
    }

    pub fn note_switch(&self) -> u64 {
        self.state().note_switch
    }

    pub fn sync_state(&self) -> Option<SyncStateChanged> {
        self.state().sync.clone()
    }

    pub fn editor_target(&self) -> EditorTarget {
        self.state().editor_target.clone()
    }

    /// Changes whenever the editor starts on a different note or draft; a draft that becomes
    /// a note keeps it.
    pub fn editor_lineage(&self) -> u64 {
        self.state().editor_lineage
    }

    pub fn draft_name(&self) -> String {
        self.state().draft_name.clone()
    }

    pub fn set_draft_name(&self, name: String) {
        self.state_mut().draft_name = name;
    }

    /// The text a draft starts with when it comes from the early draft.
    pub fn draft_body(&self) -> String {
        self.state().draft_body.clone()
    }

    /// Whether the note that opens next takes the caret at the end of its text; asking clears it.
    pub fn take_focus_end(&self) -> bool {
        std::mem::take(&mut self.state_mut().focus_end)
    }

    pub fn early_draft(&self) -> EarlyDraftState {
        self.state().early_draft.clone()
    }

    pub fn has_early_draft_text(&self) -> bool {
        !self.state().early_draft.is_empty()
    }

    pub fn set_early_draft_name(&self, name: String) {
        self.edit_early_draft(|early| early.name = name);
    }

    pub fn set_early_draft_body(&self, body: String) {
        self.edit_early_draft(|early| early.body = body);
    }

    pub fn confirm_early_draft_name(&self) {
        self.edit_early_draft(|early| early.name_confirmed = true);
    }

    fn edit_early_draft(&self, edit: impl FnOnce(&mut EarlyDraftState)) {
        let flipped = {
            let mut state = self.state_mut();
            let was_empty = state.early_draft.is_empty();
            edit(&mut state.early_draft);
            was_empty != state.early_draft.is_empty()
        };
        if flipped {
            self.emit_by_name::<()>("early-draft-presence-changed", &[]);
        }
    }

    /// True while the early draft is being sent, when it must not change.
    pub fn handing_off(&self) -> bool {
        self.state().handing_off
    }

    pub fn draft_error(&self) -> Option<String> {
        self.state().draft_error.clone()
    }

    pub fn draft_focus(&self) -> DraftFocus {
        self.state().draft_focus
    }

    pub fn note_name_error(&self) -> Option<String> {
        self.state().note_name_error.clone()
    }

    pub fn note_update(&self) -> Option<NoteContentUpdate> {
        self.state().note_update.clone()
    }

    pub fn open_note_path(&self) -> Option<Vec<String>> {
        self.state().open_note_path.clone()
    }

    pub fn key_changed(&self) -> Option<KeyChangedView> {
        self.state().key_changed.clone()
    }

    pub fn appearance(&self) -> Appearance {
        self.state().appearance.clone()
    }

    pub fn editor_settings(&self) -> EditorSettings {
        self.state().editor_settings
    }

    pub fn vim_mode(&self) -> bool {
        self.state().editor_settings.vim_mode
    }

    pub fn type_to_start(&self) -> bool {
        self.state().editor_settings.type_to_start
    }

    pub fn connect_route_changed<F: Fn(&Self) + 'static>(&self, f: F) -> glib::SignalHandlerId {
        self.connect_unit_signal("route-changed", f)
    }

    pub fn connect_loading_message_changed<F: Fn(&Self) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_unit_signal("loading-message-changed", f)
    }

    pub fn connect_tree_changed<F: Fn(&Self) + 'static>(&self, f: F) -> glib::SignalHandlerId {
        self.connect_unit_signal("tree-changed", f)
    }

    pub fn connect_open_note_changed<F: Fn(&Self) + 'static>(&self, f: F) -> glib::SignalHandlerId {
        self.connect_unit_signal("open-note-changed", f)
    }

    pub fn connect_appearance_changed<F: Fn(&Self) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_unit_signal("appearance-changed", f)
    }

    pub fn connect_editor_settings_changed<F: Fn(&Self) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_unit_signal("editor-settings-changed", f)
    }

    pub fn connect_early_draft_changed<F: Fn(&Self) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_unit_signal("early-draft-changed", f)
    }

    pub fn connect_early_draft_presence_changed<F: Fn(&Self) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_unit_signal("early-draft-presence-changed", f)
    }

    pub fn connect_sync_state_changed<F: Fn(&Self) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_unit_signal("sync-state-changed", f)
    }

    pub fn connect_notice<F: Fn(&Self, &NoticeView) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_local("notice", false, move |args| {
            let model = args[0].get::<Self>().ok()?;
            let notice = NoticeView {
                id: args[1].get().ok()?,
                message: args[2].get().ok()?,
                persistent: args[3].get().ok()?,
                action_label: args[4].get().ok()?,
            };
            f(&model, &notice);
            None
        })
    }

    pub fn connect_notice_cleared<F: Fn(&Self, &str) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_string_signal("notice-cleared", f)
    }

    pub fn connect_toast<F: Fn(&Self, &str) + 'static>(&self, f: F) -> glib::SignalHandlerId {
        self.connect_string_signal("toast", f)
    }

    pub async fn submit_token(&self, forge: &str, token: Secret) -> Result<(), TokenError> {
        self.set_login_draft(forge, token.clone());
        let Some(forge) = parse_forge(forge) else {
            return Err(TokenError::Message(GENERIC_ERROR_MESSAGE.to_owned()));
        };
        let result = self
            .request::<LoginListRepositories>(LoginListRepositoriesParams {
                forge,
                access_token: token,
            })
            .await;
        match result {
            Ok(result) if result.repositories.is_empty() => Err(TokenError::NoRepositories),
            Ok(result) => {
                let repositories: Vec<RepositoryChoice> = result
                    .repositories
                    .into_iter()
                    .map(|listing| RepositoryChoice {
                        url: listing.url,
                        label: listing.label,
                        private: listing.private,
                    })
                    .collect();
                self.state_mut().repositories = repositories.clone();
                self.set_route(Route::RepositoryList { repositories });
                Ok(())
            }
            Err(error) => Err(TokenError::Message(UserError::from(error).message)),
        }
    }

    pub async fn choose_repository(&self, url: &str) {
        self.state_mut().repository_url = Some(url.to_owned());
        self.inspect().await;
    }

    pub async fn check_again(&self) {
        self.inspect().await;
    }

    pub async fn unlock(&self, passphrase: Secret, remember: bool) -> Result<(), UnlockError> {
        self.log_in(passphrase, remember, false).await
    }

    pub async fn initialize(&self, passphrase: Secret, remember: bool) -> Result<(), UnlockError> {
        self.log_in(passphrase, remember, true).await
    }

    pub async fn passphrase_strength(
        &self,
        passphrase: Secret,
        repository_label: &str,
    ) -> Result<PassphraseStrength, UserError> {
        self.request::<PassphraseStrengthCheck>(PassphraseStrengthParams {
            passphrase,
            repository_label: repository_label.to_owned(),
        })
        .await
        .map_err(UserError::from)
    }

    pub fn open_note(&self, path: Option<Vec<String>>) {
        let mut turn = self.imp().editor_lane.reserve(true);
        let leaving_draft = {
            let mut state = self.state_mut();
            state.type_to_start = None;
            if path.is_none() {
                state.open_note = None;
            }
            state.open_note_path = path.clone();
            state.pending_opens += 1;
            let leaving_draft = state.editor_target.is_draft();
            let target = path.clone().map_or(EditorTarget::None, EditorTarget::Note);
            if state.editor_target != target {
                state.draft_error = None;
                state.open_note = None;
                state.note_update = None;
                retarget(&mut state, target);
                state.note_switch += 1;
                state.editor_lineage += 1;
            }
            leaving_draft
        };
        self.emit_by_name::<()>("open-note-changed", &[]);
        let sender = self.edit_sender().clone();
        let model = self.downgrade();
        let generation = self.imp().generation.get();
        self.spawn(async move {
            sender.flush().await;
            turn.begin().await;
            if leaving_draft
                && let Some(request) = model
                    .upgrade()
                    .map(|model| model.request::<DraftLeave>(DraftLeaveParams {}))
                && let Err(error) = request.await
            {
                warn("could not leave a draft", &error);
            }
            let Some(request) = model
                .upgrade()
                .map(|model| model.request::<NoteOpen>(NoteOpenParams { path: path.clone() }))
            else {
                return;
            };
            let result = request.await;
            let Some(model) = model.upgrade() else {
                return;
            };
            model.open_answered(generation);
            match result {
                Ok(result) => model.apply_opened_note(path, result.note),
                Err(error) => warn("could not open a note", &error),
            }
        });
    }

    /// Starts a note that exists only in the editor until it gets a name or some content.
    /// A start that the user has moved past in the meantime changes nothing.
    pub fn start_draft(
        &self,
        parent: Vec<String>,
        focus: DraftFocus,
    ) -> impl Future<Output = Result<(), UserError>> + use<> {
        let model = self.clone();
        let mut turn = self.imp().editor_lane.reserve(true);
        async move {
            model.flush_edits().await;
            turn.begin().await;
            if !model.imp().editor_lane.is_current(&turn) {
                return Ok(());
            }
            let reply = model
                .request::<DraftStart>(DraftStartParams { parent })
                .await;
            if !model.imp().editor_lane.is_current(&turn) {
                if let Err(error) = &reply {
                    warn("could not start a draft", error);
                }
                return Ok(());
            }
            let draft = match reply {
                Ok(result) => result.draft,
                Err(error) => {
                    warn("could not start a draft", &error);
                    return Err(UserError::from(error));
                }
            };
            {
                let mut state = model.state_mut();
                state.draft_name.clear();
                state.draft_body.clear();
                state.focus_end = false;
                if focus == DraftFocus::Name {
                    state.type_to_start = None;
                }
                state.draft_focus = focus;
                state.draft_error = None;
                state.open_note_path = None;
                state.core_open_path = None;
                state.open_note = None;
                retarget(&mut state, EditorTarget::Draft(draft));
                state.note_switch += 1;
                state.editor_lineage += 1;
            }
            model.emit_by_name::<()>("open-note-changed", &[]);
            Ok(())
        }
    }

    /// Creates the draft's note under the name typed so far.
    pub async fn commit_draft_name(&self) -> NoteDraftOutcome {
        self.flush_edits().await;
        let name = {
            let state = self.state();
            if !state.editor_target.is_draft() {
                return NoteDraftOutcome::None;
            }
            state.draft_name.clone()
        };
        let outcome = match self
            .request::<DraftCommitName>(DraftCommitNameParams { name })
            .await
        {
            Ok(result) => result.outcome,
            Err(error) => {
                warn("could not name a draft", &error);
                self.show_toast(&UserError::from(error).message);
                return NoteDraftOutcome::None;
            }
        };
        {
            let mut state = self.state_mut();
            match &outcome {
                NoteDraftOutcome::None => {}
                NoteDraftOutcome::Error { message } => state.draft_error = Some(message.clone()),
                NoteDraftOutcome::Created { path, field_error } => {
                    if state.editor_target.is_draft() {
                        retarget(&mut state, EditorTarget::Note(path.clone()));
                        state.draft_error = field_error.clone();
                        state.draft_name.clear();
                        state.note_switch += 1;
                    }
                }
            }
        }
        self.emit_by_name::<()>("open-note-changed", &[]);
        outcome
    }

    /// Drops the draft open in the editor, if any; a draft with content is already a note.
    /// It does nothing when the editor was moved after it was asked for.
    pub fn leave_draft(&self) -> impl Future<Output = ()> + use<> {
        let model = self.clone();
        let mut turn = self.imp().editor_lane.reserve(false);
        async move {
            model.flush_edits().await;
            turn.begin().await;
            if !model.imp().editor_lane.is_current(&turn) || !model.state().editor_target.is_draft()
            {
                return;
            }
            if let Err(error) = model.request::<DraftLeave>(DraftLeaveParams {}).await {
                warn("could not leave a draft", &error);
            }
            {
                let mut state = model.state_mut();
                if !state.editor_target.is_draft() {
                    return;
                }
                retarget(&mut state, EditorTarget::None);
                state.core_open_path = None;
                state.draft_error = None;
                state.draft_name.clear();
                state.draft_body.clear();
                state.type_to_start = None;
            }
            model.emit_by_name::<()>("open-note-changed", &[]);
        }
    }

    /// Starts a note from the first typed character, holding on to what is typed while the
    /// draft opens.
    pub fn start_type_to_start(&self, characters: &str) {
        {
            let mut state = self.state_mut();
            if state.type_to_start.is_some() {
                return;
            }
            let mut buffer = TypeToStartBuffer::new();
            buffer.append(TypeToStartInput::Text(characters.to_owned()));
            state.type_to_start = Some(buffer);
        }
        let model = self.clone();
        let start = self.start_draft(Vec::new(), DraftFocus::Editor);
        self.spawn(async move {
            if let Err(error) = start.await {
                model.cancel_type_to_start();
                model.show_toast(&error.message);
            }
        });
    }

    pub fn type_to_start_pending(&self) -> bool {
        self.state().type_to_start.is_some()
    }

    /// Returns whether the key was held for the draft that is opening.
    pub fn buffer_type_to_start(&self, input: TypeToStartInput) -> bool {
        match self.state_mut().type_to_start.as_mut() {
            Some(buffer) => {
                buffer.append(input);
                true
            }
            None => false,
        }
    }

    pub fn cancel_type_to_start(&self) {
        self.state_mut().type_to_start = None;
    }

    /// Hands over what was typed while the draft opened, once, if the draft is open.
    pub fn take_type_to_start_text(&self) -> Option<String> {
        let mut state = self.state_mut();
        if !state.editor_target.is_draft() {
            return None;
        }
        state.type_to_start.take().map(|mut buffer| buffer.drain())
    }

    pub async fn rename_open_note(&self, name: String) -> RenameResult {
        let Some(path) = self
            .state()
            .editor_target
            .note_path()
            .map(<[String]>::to_vec)
        else {
            return RenameResult::None;
        };
        self.flush_edits().await;
        let result = self
            .request::<NoteRename>(NoteRenameParams {
                path: path.clone(),
                name,
            })
            .await;
        let result = {
            let mut state = self.state_mut();
            match result {
                Ok(result) => match result.outcome {
                    NameCommitOutcome::None => {
                        state.note_name_error = None;
                        RenameResult::None
                    }
                    NameCommitOutcome::Restore => {
                        state.note_name_error = None;
                        RenameResult::Restore
                    }
                    NameCommitOutcome::Error { message } => {
                        state.note_name_error = Some(message.clone());
                        RenameResult::Error(message)
                    }
                    NameCommitOutcome::Ok { path: renamed } => {
                        if state.editor_target.note_path() == Some(path.as_slice())
                            && renamed != path
                        {
                            if state.core_open_path.as_deref() == Some(path.as_slice()) {
                                state.core_open_path = Some(renamed.clone());
                            }
                            if state.open_note_path.as_deref() == Some(path.as_slice()) {
                                state.open_note_path = Some(renamed.clone());
                            }
                            retarget(&mut state, EditorTarget::Note(renamed));
                        }
                        state.note_name_error = None;
                        state.draft_error = None;
                        RenameResult::Renamed
                    }
                },
                Err(error) => {
                    warn("could not rename a note", &error);
                    let message = UserError::from(error).message;
                    state.note_name_error = Some(message.clone());
                    RenameResult::Error(message)
                }
            }
        };
        self.emit_by_name::<()>("open-note-changed", &[]);
        result
    }

    pub async fn refresh(&self) -> Result<(), UserError> {
        self.request::<SyncRefresh>(SyncRefreshParams {})
            .await
            .map(|_| ())
            .map_err(UserError::from)
    }

    pub fn retry_resume(&self) {
        let model = self.clone();
        self.spawn(async move {
            if model.state().session_active {
                model.state_mut().awaiting_tree = true;
                model.set_route(Route::Loading { failure: None });
                if let Err(error) = model.request::<SyncRefresh>(SyncRefreshParams {}).await {
                    warn("could not refresh", &error);
                }
                model.load_tree().await;
            } else {
                model.resume().await;
            }
        });
    }

    pub fn show_login(&self) {
        if self.state().session_active {
            let model = self.clone();
            self.spawn(async move {
                if let Err(error) = model.log_in_again().await {
                    model.show_toast(&error.message);
                }
            });
        } else {
            self.set_route(Route::Token);
        }
    }

    pub async fn log_in_again(&self) -> Result<(), UserError> {
        self.log_out_anyway().await
    }

    /// Logs out once every edit is saved; otherwise reports what would be lost and stays.
    pub async fn log_out(&self) -> Result<LogOutResult, UserError> {
        self.flush_edits().await;
        let result = self
            .request::<SessionLogout>(SessionLogoutParams { anyway: false })
            .await;
        match result {
            Ok(SessionLogoutResult {
                outcome: LogoutOutcome::Unsaved { message, .. },
            }) => Ok(LogOutResult::Unsaved { message }),
            other => logout_result(other).map(|()| LogOutResult::LoggedOut),
        }
    }

    /// Records that the user went back one login step, which the view has already shown.
    pub fn navigated_back(&self) {
        let mut state = self.state_mut();
        state.route = match state.route {
            Route::Unlock { .. } | Route::Initialize { .. } | Route::Unusable { .. } => {
                Route::RepositoryList {
                    repositories: state.repositories.clone(),
                }
            }
            Route::RepositoryList { .. } => Route::Token,
            _ => return,
        };
    }

    pub fn perform_notice(&self, id: &str) {
        let performed = self.perform_notice_action(id);
        self.spawn(async move {
            if let Err(error) = performed.await {
                warn("could not perform a notice action", &error);
            }
        });
    }

    fn perform_notice_action(
        &self,
        id: &str,
    ) -> impl Future<Output = Result<(), RequestError>> + use<> {
        let action = self.state_mut().notice_actions.remove(id);
        if let Some(NoticeAction::OpenNote { path, .. }) = &action {
            self.open_note(Some(path.clone()));
        }
        let model = self.clone();
        let params = NoticeIdParams { id: id.to_owned() };
        async move {
            match action {
                Some(NoticeAction::OpenNote { .. }) => {
                    model.request::<NoticesDismiss>(params).await.map(|_| ())
                }
                Some(NoticeAction::Undo { .. }) => {
                    model.flush_edits().await;
                    model.request::<NoticesPerform>(params).await.map(|_| ())
                }
                None => Ok(()),
            }
        }
    }

    pub fn dismiss_notice(&self, id: &str) {
        self.state_mut().notice_actions.remove(id);
        let request = self.request::<NoticesDismiss>(NoticeIdParams { id: id.to_owned() });
        self.spawn(async move {
            if let Err(error) = request.await {
                warn("could not dismiss a notice", &error);
            }
        });
    }

    pub fn set_visible(&self, visible: bool) {
        self.state_mut().visible = visible;
        if visible {
            self.spawn(self.lifecycle_update());
            return;
        }
        let model = self.clone();
        self.spawn(async move {
            model.flush_edits().await;
            model.lifecycle_update().await;
            if model.state().session_active {
                model.send_sync_flush().await;
            }
        });
    }

    pub fn edit(&self, text: String) {
        let destination = match &self.state().editor_target {
            EditorTarget::None => return,
            EditorTarget::Note(path) => EditDestination::Note(path.clone()),
            EditorTarget::Draft(_) => EditDestination::Draft,
        };
        self.edit_sender().submit(text, destination);
    }

    pub async fn flush_edits(&self) {
        self.edit_sender().flush().await;
    }

    pub async fn save_now(&self) {
        self.flush_edits().await;
        self.send_sync_flush().await;
    }

    /// Saves every edit for a close; a failed request counts the edits last reported unsaved.
    pub async fn flush_for_close(&self) -> FlushOutcome {
        self.flush_edits().await;
        match self.request::<SyncFlush>(SyncFlushParams {}).await {
            Ok(result) => result.result,
            Err(RequestError::Stopped) => FlushOutcome::Saved,
            Err(error) => {
                warn("could not save before closing", &error);
                let count = self.unsaved_count();
                if count == 0 {
                    FlushOutcome::Saved
                } else {
                    FlushOutcome::Unsaved { count }
                }
            }
        }
    }

    pub fn unsaved_count(&self) -> u32 {
        self.state()
            .sync
            .as_ref()
            .map_or(0, |sync| sync.unsaved_count)
    }

    pub async fn retry_sync(&self) {
        if let Err(error) = self.request::<SyncRetry>(SyncRetryParams {}).await {
            warn("could not retry saving", &error);
            self.show_toast(&UserError::from(error).message);
        }
    }

    pub async fn resolve_conflict(&self, resolution: ConflictResolution) {
        self.flush_edits().await;
        let path = match self.state().open_note.as_ref() {
            Some(OpenNote::Loaded {
                path,
                conflict: Some(_),
                ..
            }) => path.clone(),
            _ => return,
        };
        let result = self
            .request::<ConflictResolve>(ConflictResolveParams { path, resolution })
            .await;
        if let Err(error) = result {
            warn("could not resolve the conflict", &error);
            self.show_toast(&UserError::from(error).message);
        }
    }

    pub fn set_online(&self, online: bool) {
        self.state_mut().online = online;
        self.spawn(self.lifecycle_update());
    }

    async fn send_sync_flush(&self) {
        if let Err(error) = self.request::<SyncFlush>(SyncFlushParams {}).await {
            warn("could not save", &error);
        }
    }

    fn new_edit_sender(&self) -> EditSender {
        let notes = self.downgrade();
        let drafts = self.downgrade();
        EditSender::new(
            move |path, text| {
                let model = notes.upgrade();
                async move {
                    if let Some(model) = model {
                        model.send_note_edit(path, text).await;
                    }
                }
            },
            move |text| {
                let model = drafts.upgrade();
                async move {
                    match model {
                        Some(model) => model.send_draft_content(text).await,
                        None => None,
                    }
                }
            },
        )
    }

    async fn send_note_edit(&self, path: Vec<String>, text: String) {
        if let Err(error) = self
            .request::<NoteEdit>(NoteEditParams { path, text })
            .await
        {
            warn("could not send an edit", &error);
        }
    }

    async fn send_draft_content(&self, content: String) -> Option<NoteDraftOutcome> {
        let name = self.state().draft_name.clone();
        match self
            .request::<DraftContent>(DraftContentParams { name, content })
            .await
        {
            Ok(result) => {
                {
                    let mut state = self.state_mut();
                    if state.editor_target.is_draft() {
                        match &result.outcome {
                            NoteDraftOutcome::None => {}
                            NoteDraftOutcome::Error { message } => {
                                state.draft_error = Some(message.clone());
                            }
                            NoteDraftOutcome::Created { path, field_error } => {
                                retarget(&mut state, EditorTarget::Note(path.clone()));
                                state.draft_error = field_error.clone();
                                state.draft_name.clear();
                            }
                        }
                    }
                }
                self.emit_by_name::<()>("open-note-changed", &[]);
                Some(result.outcome)
            }
            Err(error) => {
                warn("could not send a draft", &error);
                None
            }
        }
    }

    async fn start(&self) {
        let config = self.config().clone();
        let opened = CoreClient::open(ClientConfig {
            app_id: config.app_id,
            version: config.version,
            bundle: config.bundle_source,
            device_model: config.device_model,
            cache_dir: config.cache_dir,
            config_dir: config.config_dir,
            allow_loopback_http: config.testing,
        })
        .await;
        let client = match opened {
            Ok(client) => Rc::new(client),
            Err(error) => {
                glib::g_warning!(LOG_DOMAIN, "the core could not start: {error}");
                self.set_route(Route::StartupFailed {
                    message: startup_message(&error),
                });
                return;
            }
        };
        if self.state().shut_down {
            client.shutdown();
            return;
        }
        self.imp().client.replace(Some(client));
        self.attach_events();
        #[cfg(feature = "testing")]
        self.hold_loading_if_requested().await;
        self.lifecycle_update().await;
        self.load_login_context().await;
        self.resume().await;
    }

    async fn resume(&self) {
        self.set_route(Route::Loading { failure: None });
        match self.request::<SessionResume>(SessionResumeParams {}).await {
            Ok(SessionResumeResult::None) => self.set_route(Route::Token),
            Ok(SessionResumeResult::Resumed) => self.begin_session(),
            Ok(SessionResumeResult::Failed {
                error,
                can_retry: true,
            }) => self.set_route(Route::Loading {
                failure: Some(LoadingFailure {
                    message: error.message,
                    can_retry: true,
                }),
            }),
            Ok(SessionResumeResult::Failed { error, .. }) => {
                self.state_mut().token_page_error = Some(error.message);
                self.set_route(Route::Token);
            }
            Err(error) => {
                warn("could not resume the session", &error);
                self.set_route(Route::Loading {
                    failure: Some(LoadingFailure {
                        message: GENERIC_ERROR_MESSAGE.to_owned(),
                        can_retry: true,
                    }),
                });
            }
        }
    }

    fn begin_session(&self) {
        {
            let mut state = self.state_mut();
            state.session_active = true;
            state.awaiting_tree = true;
        }
        self.set_route(Route::Loading { failure: None });
        let model = self.clone();
        self.spawn(async move {
            model.load_settings().await;
        });
        let model = self.clone();
        self.spawn(async move {
            model.load_tree().await;
        });
    }

    async fn load_tree(&self) {
        match self.request::<TreeGet>(TreeGetParams {}).await {
            Ok(TreeGetResult { tree: Some(tree) }) => {
                let changed = {
                    let mut state = self.state_mut();
                    let changed = state.tree.as_ref() != Some(&tree);
                    state.tree = Some(tree);
                    changed
                };
                if changed {
                    self.emit_by_name::<()>("tree-changed", &[]);
                }
                self.finish_loading_if_ready();
            }
            Ok(TreeGetResult { tree: None }) => {}
            Err(error) => {
                warn("could not read the note tree", &error);
                let awaiting = self.state().awaiting_tree;
                if awaiting {
                    self.set_route(Route::Loading {
                        failure: Some(LoadingFailure {
                            message: UserError::from(error).message,
                            can_retry: true,
                        }),
                    });
                }
            }
        }
    }

    fn finish_loading_if_ready(&self) {
        let ready = {
            let mut state = self.state_mut();
            if state.awaiting_tree && state.tree.is_some() {
                state.awaiting_tree = false;
                matches!(state.route, Route::Loading { .. })
            } else {
                false
            }
        };
        if ready {
            let model = self.clone();
            self.spawn(async move { model.enter_notes().await });
        }
    }

    async fn enter_notes(&self) {
        match self.hand_off_early_draft().await {
            Ok(()) => {
                if matches!(self.state().route, Route::Loading { .. }) {
                    self.set_loading_message(None);
                    self.set_route(Route::Notes);
                }
            }
            Err(error) => {
                if matches!(self.state().route, Route::Loading { .. }) {
                    self.show_toast(&error.message);
                    self.set_route(Route::Loading {
                        failure: Some(LoadingFailure {
                            message: error.message,
                            can_retry: true,
                        }),
                    });
                }
            }
        }
    }

    /// Sends the text typed on the loading page. A failure keeps it for another try.
    async fn hand_off_early_draft(&self) -> Result<(), UserError> {
        let early = {
            let mut state = self.state_mut();
            if state.early_draft.is_empty() {
                return Ok(());
            }
            state.handing_off = true;
            state.early_draft.clone()
        };
        self.emit_by_name::<()>("early-draft-changed", &[]);
        let generation = self.imp().generation.get();
        let result = self
            .request::<EarlyDraftHandOff>(EarlyDraftHandOffParams {
                name: early.name,
                body: early.body.clone(),
                name_confirmed: early.name_confirmed,
            })
            .await;
        if self.imp().generation.get() != generation {
            return Ok(());
        }
        let outcome = match result {
            Ok(result) => result.outcome,
            Err(error) => {
                warn("could not hand off the early draft", &error);
                self.state_mut().handing_off = false;
                self.emit_by_name::<()>("early-draft-changed", &[]);
                return Err(UserError::from(error));
            }
        };
        {
            let mut state = self.state_mut();
            state.handing_off = false;
        }
        self.edit_early_draft(|early| *early = EarlyDraftState::default());
        self.emit_by_name::<()>("early-draft-changed", &[]);
        match outcome {
            EarlyDraftOutcome::None => {}
            EarlyDraftOutcome::Draft { name, error } => {
                {
                    let mut state = self.state_mut();
                    state.draft_name = name.clone();
                    state.draft_body = early.body;
                    state.draft_focus = DraftFocus::Name;
                    state.draft_error = error;
                    state.open_note_path = None;
                    state.core_open_path = None;
                    state.open_note = None;
                    retarget(
                        &mut state,
                        EditorTarget::Draft(NoteDraft {
                            parent: Vec::new(),
                            name,
                        }),
                    );
                    state.note_switch += 1;
                    state.editor_lineage += 1;
                }
                self.emit_by_name::<()>("open-note-changed", &[]);
            }
            EarlyDraftOutcome::Created { path, field_error } => {
                {
                    let mut state = self.state_mut();
                    state.draft_error = field_error;
                    state.focus_end = true;
                }
                self.open_note(Some(path));
            }
        }
        Ok(())
    }

    async fn load_settings(&self) {
        match self.request::<SettingsOpen>(SettingsOpenParams {}).await {
            Ok(result) => {
                self.state_mut().accent_options = result.copy.accent_color.options;
                self.apply_settings_view(&result.view);
            }
            Err(error) => warn("could not read settings", &error),
        }
    }

    fn apply_settings_view(&self, view: &SettingsView) {
        let appearance = {
            let state = self.state();
            Appearance::from_settings(&view.values, &state.accent_options)
        };
        let changed = {
            let mut state = self.state_mut();
            let changed = state.appearance != appearance;
            state.appearance = appearance;
            changed
        };
        if changed {
            self.emit_by_name::<()>("appearance-changed", &[]);
        }
        let editor_settings = EditorSettings::from_settings(&view.values);
        let editor_changed = {
            let mut state = self.state_mut();
            std::mem::replace(&mut state.editor_settings, editor_settings) != editor_settings
        };
        if editor_changed {
            self.emit_by_name::<()>("editor-settings-changed", &[]);
        }
    }

    async fn load_login_context(&self) {
        let (forges, last_repository, device_name) = futures_util::join!(
            self.request::<ForgesList>(ForgesListParams {}),
            self.request::<LoginLastRepository>(LoginLastRepositoryParams {}),
            self.request::<DeviceName>(DeviceNameParams {}),
        );
        let mut state = self.state_mut();
        match forges {
            Ok(result) => state.forges = result.forges,
            Err(error) => warn("could not list forges", &error),
        }
        match last_repository {
            Ok(result) => {
                state.last_repository = result
                    .repo_url
                    .zip(result.forge.map(|forge| forge_id(forge).to_owned()));
            }
            Err(error) => warn("could not read the last repository", &error),
        }
        match device_name {
            Ok(result) => state.device_name = Some(result.name),
            Err(error) => warn("could not read the device name", &error),
        }
        if state.draft.forge.is_none() {
            state.draft.forge = state
                .last_repository
                .as_ref()
                .map(|(_, forge)| forge.clone());
        }
    }

    async fn inspect(&self) {
        let (forge, access_token, repository_url) = {
            let state = self.state();
            (
                state.draft.forge.as_deref().and_then(parse_forge),
                state.draft.token.clone(),
                state.repository_url.clone(),
            )
        };
        let (Some(forge), Some(access_token), Some(repository_url)) =
            (forge, access_token, repository_url)
        else {
            self.set_route(Route::Token);
            return;
        };
        let result = self
            .request::<LoginInspectRepository>(LoginInspectRepositoryParams {
                forge,
                access_token,
                repository_url: repository_url.clone(),
            })
            .await;
        let route = match result {
            Ok(LoginInspectRepositoryResult::NotesRepo { repository }) => {
                Route::Unlock { repository }
            }
            Ok(LoginInspectRepositoryResult::Uninitialized {
                repository,
                set_up_description,
            }) => Route::Initialize {
                repository,
                set_up_description,
            },
            Ok(LoginInspectRepositoryResult::Unusable {
                repository,
                error,
                can_check_again,
                foreign_hint,
            }) => Route::Unusable {
                outcome: UnusableOutcome {
                    repository,
                    error,
                    can_check_again,
                    foreign_hint,
                },
            },
            Err(error) => {
                warn("could not inspect the repository", &error);
                let error = match error {
                    RequestError::Core(error) => error,
                    RequestError::Stopped | RequestError::Decode(_) => {
                        CoreError::new(CoreErrorKind::NotReady, GENERIC_ERROR_MESSAGE, false)
                    }
                };
                Route::Unusable {
                    outcome: unusable(self.listed_repository(&repository_url), error),
                }
            }
        };
        if let Route::Unlock { repository }
        | Route::Initialize { repository, .. }
        | Route::Unusable {
            outcome: UnusableOutcome { repository, .. },
        } = &route
        {
            self.state_mut().repository = Some(repository.clone());
        }
        self.set_route(route);
    }

    async fn log_in(
        &self,
        passphrase: Secret,
        remember: bool,
        initialize: bool,
    ) -> Result<(), UnlockError> {
        let Some(client) = self.client() else {
            return Err(UnlockError::Retry {
                message: GENERIC_ERROR_MESSAGE.to_owned(),
                wrong_passphrase: false,
            });
        };
        if let Err(error) = client.set_persist(remember).await {
            glib::g_warning!(LOG_DOMAIN, "could not change session persistence: {error}");
        }
        if remember && !client.keyring_available() {
            let warn_now = !std::mem::replace(&mut self.state_mut().keyring_warned, true);
            if warn_now {
                self.show_toast(NO_KEYRING_MESSAGE);
            }
        }
        self.set_loading_message(None);
        let params = PassphraseParams { passphrase };
        let result = if initialize {
            client.request::<LoginInitialize>(params).await
        } else {
            client.request::<LoginUnlock>(params).await
        };
        match result {
            Ok(_) => {
                self.begin_session();
                Ok(())
            }
            Err(RequestError::Core(error))
                if error.kind == CoreErrorKind::WrongPassphrase || error.transient =>
            {
                self.set_loading_message(None);
                Err(UnlockError::Retry {
                    wrong_passphrase: error.kind == CoreErrorKind::WrongPassphrase,
                    message: error.message,
                })
            }
            Err(RequestError::Core(error)) => {
                self.set_loading_message(None);
                let repository = {
                    let state = self.state();
                    state.repository.clone()
                };
                let repository = repository.unwrap_or_else(|| {
                    let url = self.state().repository_url.clone().unwrap_or_default();
                    self.listed_repository(&url)
                });
                self.set_route(Route::Unusable {
                    outcome: unusable(repository, error),
                });
                Err(UnlockError::Routed)
            }
            Err(error) => {
                warn("could not unlock the repository", &error);
                self.set_loading_message(None);
                Err(UnlockError::Retry {
                    message: GENERIC_ERROR_MESSAGE.to_owned(),
                    wrong_passphrase: false,
                })
            }
        }
    }

    pub async fn log_out_anyway(&self) -> Result<(), UserError> {
        self.leave_draft().await;
        logout_result(
            self.request::<SessionLogout>(SessionLogoutParams { anyway: true })
                .await,
        )
    }

    fn listed_repository(&self, url: &str) -> RepositoryView {
        let state = self.state();
        let listed = state.repositories.iter().find(|choice| choice.url == url);
        RepositoryView {
            label: listed.map_or_else(|| url.to_owned(), |choice| choice.label.clone()),
            url: url.to_owned(),
            private: listed.is_none_or(|choice| choice.private),
            public_warning: None,
        }
    }

    fn attach_events(&self) {
        let Some(receiver) = self.client().and_then(|client| client.subscribe()) else {
            return;
        };
        let generation = self.imp().generation.get();
        let model = self.downgrade();
        self.spawn(async move {
            while let Ok(event) = receiver.recv().await {
                let Some(model) = model.upgrade() else {
                    break;
                };
                if model.imp().generation.get() != generation {
                    break;
                }
                model.handle_event(event);
            }
        });
    }

    fn handle_event(&self, event: CoreEvent) {
        match event {
            CoreEvent::LoadingProgress(progress) => {
                self.set_loading_message(Some(progress.message));
            }
            CoreEvent::TreeChanged(changed) => self.tree_changed(changed),
            CoreEvent::NoteChanged(changed) => self.note_changed(changed),
            CoreEvent::SyncStateChanged(sync) => self.sync_state_changed(sync),
            CoreEvent::Notice(notice) => self.show_notice(notice),
            CoreEvent::NoticeCleared(cleared) => {
                self.state_mut().notice_actions.remove(&cleared.id);
                self.emit_by_name::<()>("notice-cleared", &[&cleared.id]);
            }
            CoreEvent::KeyChanged {
                unsaved_count,
                message,
                detail,
                export_label,
            } => {
                let view = KeyChangedView {
                    unsaved_count,
                    message,
                    detail,
                    export_label,
                };
                {
                    let mut state = self.state_mut();
                    state.key_changed = Some(view.clone());
                    state.awaiting_tree = false;
                }
                self.set_route(Route::KeyChanged { view });
            }
            CoreEvent::SessionEnded { .. } => self.session_ended(),
            CoreEvent::SettingsChanged { view } => self.apply_settings_view(&view),
            CoreEvent::NoteContentChangedRemotely(changed) => self.show_toast(&changed.message),
            CoreEvent::Other { .. } => {}
        }
    }

    fn tree_changed(&self, changed: TreeChanged) {
        {
            let mut state = self.state_mut();
            state.tree = changed.tree;
            state.tag_options = changed.tag_options;
        }
        self.emit_by_name::<()>("tree-changed", &[]);
        self.finish_loading_if_ready();
    }

    /// While any open is unanswered, an event only tracks what the core holds: the reply to
    /// the latest open fills the editor, so neither an echo of an edit made before leaving
    /// nor the note of an earlier open can show older text in the meantime.
    fn note_changed(&self, changed: NoteChanged) {
        {
            let mut state = self.state_mut();
            let reported = changed.note.as_ref().map(|note| note_path(note).to_vec());
            let previous_path = std::mem::replace(&mut state.core_open_path, reported.clone());
            let stale = state.pending_opens > 0
                || (state.open_note_path != previous_path && reported != state.open_note_path);
            if stale {
                return;
            }
            state.open_note_path = reported;
            if let Some(OpenNote::Loaded { path, content, .. }) = &changed.note {
                let no_remote_edits = changed.edits.as_ref().is_none_or(Vec::is_empty);
                if !(delivered(&state, path, content) && no_remote_edits) {
                    let renamed = changed.edits.is_some()
                        && matches!(
                            &state.editor_target,
                            EditorTarget::Note(target)
                                if target != path && previous_path.as_ref() == Some(target)
                        );
                    if renamed {
                        retarget(&mut state, EditorTarget::Note(path.clone()));
                    }
                    publish(&mut state, path, content, changed.edits.clone());
                }
            }
            state.open_note = changed.note;
        }
        self.emit_by_name::<()>("open-note-changed", &[]);
    }

    fn open_answered(&self, generation: u64) {
        if self.imp().generation.get() == generation {
            let mut state = self.state_mut();
            state.pending_opens = state.pending_opens.saturating_sub(1);
        }
    }

    #[cfg(all(test, feature = "testing"))]
    fn opens_pending(&self) -> bool {
        self.state().pending_opens > 0
    }

    fn apply_opened_note(&self, requested: Option<Vec<String>>, note: Option<OpenNote>) {
        {
            let mut state = self.state_mut();
            state.core_open_path = note.as_ref().map(|note| note_path(note).to_vec());
            if state.pending_opens > 0 || state.open_note_path != requested {
                return;
            }
            if let Some(note) = &note {
                state.open_note_path = Some(note_path(note).to_vec());
            }
            if let Some(OpenNote::Loaded { path, content, .. }) = &note
                && !delivered(&state, path, content)
            {
                publish(&mut state, path, content, None);
            }
            state.open_note = note;
        }
        self.emit_by_name::<()>("open-note-changed", &[]);
    }

    fn sync_state_changed(&self, sync: SyncStateChanged) {
        let failure = {
            let state = self.state();
            let still_loading = state.awaiting_tree
                && state.route == Route::Loading { failure: None }
                && !sync.tree_loaded
                && !sync.refreshing;
            if still_loading {
                sync.last_refresh_error
                    .as_ref()
                    .map(|error| LoadingFailure {
                        message: error.message.clone(),
                        can_retry: true,
                    })
            } else {
                None
            }
        };
        if let Some(failure) = failure {
            self.set_route(Route::Loading {
                failure: Some(failure),
            });
        }
        self.state_mut().sync = Some(sync);
        self.emit_by_name::<()>("sync-state-changed", &[]);
    }

    fn show_notice(&self, notice: Notice) {
        let action_label = notice.action.as_ref().map(|action| match action {
            NoticeAction::OpenNote { label, .. } | NoticeAction::Undo { label } => label.clone(),
        });
        match notice.action {
            Some(action) => {
                self.state_mut()
                    .notice_actions
                    .insert(notice.id.clone(), action);
            }
            None => {
                self.state_mut().notice_actions.remove(&notice.id);
            }
        }
        self.emit_by_name::<()>(
            "notice",
            &[
                &notice.id,
                &notice.message,
                &notice.persistent,
                &action_label,
            ],
        );
    }

    fn session_ended(&self) {
        let Some(client) = self.client() else {
            return;
        };
        {
            let mut state = self.state_mut();
            let previous = std::mem::take(&mut *state);
            *state = State {
                route: previous.route,
                forges: previous.forges,
                last_repository: previous.last_repository,
                device_name: previous.device_name,
                draft: LoginDraft {
                    forge: previous.draft.forge,
                    token: None,
                },
                note_switch: previous.note_switch + 1,
                editor_lineage: previous.editor_lineage + 1,
                note_update_serial: previous.note_update_serial,
                accent_options: previous.accent_options,
                appearance: previous.appearance,
                editor_settings: previous.editor_settings,
                visible: previous.visible,
                online: previous.online,
                keyring_warned: previous.keyring_warned,
                ..State::default()
            };
        }
        self.emit_by_name::<()>("loading-message-changed", &[]);
        self.emit_by_name::<()>("tree-changed", &[]);
        self.emit_by_name::<()>("open-note-changed", &[]);
        self.emit_by_name::<()>("sync-state-changed", &[]);
        self.bump_generation();
        self.imp().editor_lane.supersede();
        let model = self.clone();
        self.spawn(async move {
            match client.restart().await {
                Ok(()) => {
                    if model.state().shut_down {
                        client.shutdown();
                        return;
                    }
                    model.attach_events();
                    model.lifecycle_update().await;
                    model.load_login_context().await;
                    model.set_route(Route::Token);
                }
                Err(error) => {
                    glib::g_warning!(LOG_DOMAIN, "the core could not restart: {error}");
                    model.set_route(Route::StartupFailed {
                        message: startup_message(&error),
                    });
                }
            }
        });
    }

    fn lifecycle_update(&self) -> impl Future<Output = ()> + use<> {
        let client = self.client();
        let (visible, online) = if client.is_some() {
            let mut state = self.state_mut();
            let visible = (state.sent_visible != Some(state.visible)).then_some(state.visible);
            let online = (state.sent_online != Some(state.online)).then_some(state.online);
            if visible.is_some() {
                state.sent_visible = visible;
            }
            if online.is_some() {
                state.sent_online = online;
            }
            (visible, online)
        } else {
            (None, None)
        };
        let visible = client.as_ref().zip(visible).map(|(client, visible)| {
            client.request::<LifecycleSetVisible>(LifecycleSetVisibleParams { visible })
        });
        let online = client.as_ref().zip(online).map(|(client, online)| {
            client.request::<LifecycleSetOnline>(LifecycleSetOnlineParams { online })
        });
        async move {
            if let Some(request) = visible
                && let Err(error) = request.await
            {
                warn("could not report visibility", &error);
            }
            if let Some(request) = online
                && let Err(error) = request.await
            {
                warn("could not report connectivity", &error);
            }
        }
    }

    fn set_route(&self, route: Route) {
        {
            let mut state = self.state_mut();
            if state.route == route {
                return;
            }
            state.route = route;
        }
        self.emit_by_name::<()>("route-changed", &[]);
    }

    fn set_loading_message(&self, message: Option<String>) {
        {
            let mut state = self.state_mut();
            if state.loading_message == message {
                return;
            }
            state.loading_message = message;
        }
        self.emit_by_name::<()>("loading-message-changed", &[]);
    }

    fn show_toast(&self, message: &str) {
        self.emit_by_name::<()>("toast", &[&message]);
    }

    fn request<C: Command>(
        &self,
        params: C::Params,
    ) -> impl Future<Output = Result<C::Result, RequestError>> + use<C> {
        let pending = self.client().map(|client| client.request::<C>(params));
        async move {
            match pending {
                Some(pending) => pending.await,
                None => Err(RequestError::Stopped),
            }
        }
    }

    fn spawn(&self, future: impl Future<Output = ()> + 'static) {
        if let Some(context) = self.imp().context.get() {
            context.spawn_local(future);
        }
    }

    fn client(&self) -> Option<Rc<CoreClient>> {
        self.imp().client.borrow().clone()
    }

    fn edit_sender(&self) -> &EditSender {
        self.imp()
            .edit_sender
            .get()
            .expect("the model is created with an edit sender")
    }

    fn config(&self) -> &AppConfig {
        self.imp()
            .config
            .get()
            .expect("the model is created with a configuration")
    }

    fn bump_generation(&self) {
        let generation = &self.imp().generation;
        generation.set(generation.get().wrapping_add(1));
    }

    fn state(&self) -> Ref<'_, State> {
        self.imp().state.borrow()
    }

    fn state_mut(&self) -> RefMut<'_, State> {
        self.imp().state.borrow_mut()
    }

    fn connect_unit_signal<F: Fn(&Self) + 'static>(
        &self,
        name: &str,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_local(name, false, move |args| {
            let model = args[0].get::<Self>().ok()?;
            f(&model);
            None
        })
    }

    fn connect_string_signal<F: Fn(&Self, &str) + 'static>(
        &self,
        name: &str,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_local(name, false, move |args| {
            let model = args[0].get::<Self>().ok()?;
            let value = args[1].get::<String>().ok()?;
            f(&model, &value);
            None
        })
    }
}

#[cfg(feature = "testing")]
const REMOTE_EDIT_LINE: &str = "Edited on another device";

#[cfg(feature = "testing")]
impl AppModel {
    pub fn testing_send(
        &self,
        name: &str,
        params: serde_json::Value,
    ) -> impl Future<Output = Result<serde_json::Value, UserError>> + use<> {
        let pending = self.client().map(|client| client.send(name, params));
        async move {
            match pending {
                Some(pending) => pending.await.map_err(UserError::from),
                None => Err(UserError::generic()),
            }
        }
    }

    pub fn testing_repo_key(&self) -> Option<String> {
        let state = self.state();
        state
            .repository
            .as_ref()
            .map(|repository| repository.url.as_str())
            .or(state.repository_url.as_deref())
            .and_then(repo_key)
    }

    pub async fn testing_remote_edit(&self) -> Result<(), UserError> {
        use commitnote_core_api::fake::{
            FakeExpectedSampleNotes, FakeExpectedSampleNotesParams, FakeRemoteEdit,
            FakeRemoteEditParams,
        };

        let repo = self.testing_repo_key().ok_or_else(UserError::generic)?;
        let (path, loaded) = {
            let state = self.state();
            let path = state
                .open_note_path
                .clone()
                .or_else(|| state.tree.as_deref().and_then(first_note));
            let loaded = match (&state.open_note, &path) {
                (Some(OpenNote::Loaded { path, content, .. }), Some(open)) if path == open => {
                    Some(content.clone())
                }
                _ => None,
            };
            (path, loaded)
        };
        let path = path.ok_or_else(UserError::generic)?;
        let text = match loaded {
            Some(text) => text,
            None => self
                .request::<FakeExpectedSampleNotes>(FakeExpectedSampleNotesParams {})
                .await
                .ok()
                .and_then(|result| {
                    result
                        .notes
                        .into_iter()
                        .find(|note| note.path == path)
                        .map(|note| note.text)
                })
                .unwrap_or_default(),
        };
        let text = match text.split_once('\n') {
            Some((_, rest)) => format!("{REMOTE_EDIT_LINE}\n{rest}"),
            None => REMOTE_EDIT_LINE.to_owned(),
        };
        self.request::<FakeRemoteEdit>(FakeRemoteEditParams {
            repo,
            path,
            text,
            device: "Other device".to_owned(),
        })
        .await
        .map(|_| ())
        .map_err(UserError::from)
    }

    pub fn testing_remote_change(
        &self,
        change: commitnote_core_api::events::RemoteChange,
        message: &str,
    ) {
        self.handle_event(CoreEvent::NoteContentChangedRemotely(
            commitnote_core_api::events::NoteContentChangedRemotely {
                change,
                message: message.to_owned(),
            },
        ));
    }

    pub async fn testing_fail_next(&self) -> Result<(), UserError> {
        use commitnote_core_api::fake::{FakeFailNext, FakeFailNextParams};

        let repo = self.testing_repo_key().ok_or_else(UserError::generic)?;
        self.request::<FakeFailNext>(FakeFailNextParams {
            repo,
            operation: "getHead".to_owned(),
            kind: "Network".to_owned(),
            count: 1,
        })
        .await
        .map(|_| ())
        .map_err(UserError::from)
    }

    pub async fn testing_change_passphrase(&self) -> Result<(), UserError> {
        use commitnote_core_api::fake::{FakeChangeRepoKey, FakeChangeRepoKeyParams};

        let repo = self.testing_repo_key().ok_or_else(UserError::generic)?;
        self.request::<FakeChangeRepoKey>(FakeChangeRepoKeyParams { repo })
            .await
            .map(|_| ())
            .map_err(UserError::from)
    }

    pub async fn testing_hold_loading(&self) -> Result<(), UserError> {
        use commitnote_core_api::fake::{FakeHoldLoading, FakeHoldLoadingParams};

        self.request::<FakeHoldLoading>(FakeHoldLoadingParams {})
            .await
            .map(|_| ())
            .map_err(UserError::from)
    }

    async fn hold_loading_if_requested(&self) {
        if std::env::var_os("COMMITNOTE_TESTING_HOLD_LOADING").is_some_and(|value| value == "1")
            && let Err(error) = self.testing_hold_loading().await
        {
            glib::g_warning!(LOG_DOMAIN, "could not hold loading: {error}");
        }
    }

    pub async fn testing_finish_loading(&self) -> Result<(), UserError> {
        use commitnote_core_api::fake::{FakeReleaseLoading, FakeReleaseLoadingParams};

        self.request::<FakeReleaseLoading>(FakeReleaseLoadingParams {})
            .await
            .map(|_| ())
            .map_err(UserError::from)
    }
}

fn unusable(repository: RepositoryView, error: CoreError) -> UnusableOutcome {
    UnusableOutcome {
        repository,
        can_check_again: error.kind != CoreErrorKind::Unauthorized,
        error,
        foreign_hint: None,
    }
}

fn logout_result(result: Result<SessionLogoutResult, RequestError>) -> Result<(), UserError> {
    match result {
        Ok(_) | Err(RequestError::Stopped) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn parse_forge(forge: &str) -> Option<ForgeKind> {
    match forge {
        "github" => Some(ForgeKind::Github),
        "gitlab" => Some(ForgeKind::Gitlab),
        _ => None,
    }
}

fn forge_id(forge: ForgeKind) -> &'static str {
    match forge {
        ForgeKind::Github => "github",
        ForgeKind::Gitlab => "gitlab",
    }
}

fn note_path(note: &OpenNote) -> &[String] {
    match note {
        OpenNote::Loading { path }
        | OpenNote::Loaded { path, .. }
        | OpenNote::Missing { path, .. }
        | OpenNote::Trashed { path, .. }
        | OpenNote::Failed { path, .. } => path,
    }
}

#[cfg(feature = "testing")]
fn first_note(nodes: &[TreeNode]) -> Option<Vec<String>> {
    nodes.iter().find_map(|node| match node {
        TreeNode::Note { path, .. } => Some(path.clone()),
        TreeNode::Folder { children, .. } => first_note(children),
    })
}

#[cfg(feature = "testing")]
fn repo_key(url: &str) -> Option<String> {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let (_, path) = rest.split_once('/')?;
    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    (!path.is_empty()).then(|| path.to_owned())
}

fn delivered(state: &State, path: &[String], content: &str) -> bool {
    state
        .note_update
        .as_ref()
        .is_some_and(|update| update.path == path && update.content == content)
}

fn publish(state: &mut State, path: &[String], content: &str, edits: Option<Vec<RemoteTextEdit>>) {
    state.note_update_serial += 1;
    state.note_update = Some(NoteContentUpdate {
        serial: state.note_update_serial,
        path: path.to_vec(),
        content: content.to_owned(),
        edits,
    });
}

fn retarget(state: &mut State, target: EditorTarget) {
    if state.editor_target.note_path() != target.note_path() {
        state.note_name_error = None;
    }
    state.editor_target = target;
}

/// Names only the failing step and the error kind, never request content.
fn warn(what: &str, error: &RequestError) {
    let reason = match error {
        RequestError::Core(error) => error.kind.as_str(),
        RequestError::Stopped => "the core stopped",
        RequestError::Decode(_) => "the reply could not be decoded",
    };
    glib::g_warning!(LOG_DOMAIN, "{what}: {reason}");
}

#[cfg(all(test, feature = "testing"))]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::{Duration, Instant};

    use commitnote_core_api::shapes::{OutOfSyncReason, SyncState};
    use commitnote_core_api::{NATIVE_CORE_API_VERSION, NATIVE_CORE_MARKER};

    use super::*;
    use crate::pages::notes::note_state::{NoteDisplay, display_state, loaded_update};

    const NOTES_URL: &str = "https://github.com/sample/notes";
    const PASSPHRASE: &str = "sample notes repo passphrase";
    const BUNDLE_PATH: &str = "/io/github/marcinjahn/commitnote/core/commitnote-core.js";

    static NEXT_ID: AtomicU32 = AtomicU32::new(0);

    struct Session {
        model: AppModel,
        root: PathBuf,
    }

    impl Session {
        fn start(bundle_source: String) -> Self {
            let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
            let app_id = format!(
                "io.github.marcinjahn.commitnote.Test{}x{id}",
                std::process::id()
            );
            let root = std::env::temp_dir().join(&app_id);
            let model = AppModel::new(AppConfig {
                app_id,
                version: "test".to_owned(),
                bundle_source,
                cache_dir: root.join("cache"),
                config_dir: root.join("config"),
                device_model: "Linux".to_owned(),
                testing: true,
            });
            Self { model, root }
        }

        async fn wait_until(&self, what: &str, done: impl Fn(&AppModel) -> bool) {
            let deadline = Instant::now() + Duration::from_secs(30);
            while !done(&self.model) {
                assert!(
                    Instant::now() < deadline,
                    "timed out waiting for {what}; the route is {:?}",
                    self.model.route()
                );
                glib::timeout_future(Duration::from_millis(20)).await;
            }
        }

        async fn choose(&self, url: &str) {
            self.wait_until("the token page", |model| model.route() == Route::Token)
                .await;
            self.model
                .submit_token("github", Secret::new("token"))
                .await
                .expect("the fake forge lists repositories");
            self.model.choose_repository(url).await;
        }

        async fn log_in(&self) {
            self.choose(NOTES_URL).await;
            self.model
                .unlock(Secret::new(PASSPHRASE), false)
                .await
                .expect("the sample passphrase unlocks");
            self.wait_until("the notes page", |model| model.route() == Route::Notes)
                .await;
        }
    }

    impl Drop for Session {
        fn drop(&mut self) {
            self.model.shutdown();
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn fake_bundle() -> String {
        crate::register_resources();
        let bytes = gio::resources_lookup_data(BUNDLE_PATH, gio::ResourceLookupFlags::NONE)
            .expect("the core bundle is embedded");
        String::from_utf8(bytes.to_vec()).expect("the core bundle is UTF-8")
    }

    fn run<F: Future<Output = ()>>(test: impl FnOnce() -> F) {
        glib::MainContext::new().block_on(test());
    }

    #[test]
    fn logs_in_reads_a_note_and_logs_out() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session
                .wait_until("the token page", |model| model.route() == Route::Token)
                .await;
            session
                .model
                .submit_token("github", Secret::new("token"))
                .await
                .expect("the fake forge lists repositories");
            let Route::RepositoryList { repositories } = session.model.route() else {
                panic!(
                    "expected the repository list, got {:?}",
                    session.model.route()
                );
            };
            assert!(repositories.iter().any(|choice| choice.url == NOTES_URL));

            session.model.choose_repository(NOTES_URL).await;
            assert!(matches!(session.model.route(), Route::Unlock { .. }));

            match session
                .model
                .unlock(Secret::new("not the passphrase"), false)
                .await
            {
                Err(UnlockError::Retry {
                    message,
                    wrong_passphrase,
                }) => {
                    assert!(wrong_passphrase);
                    assert!(!message.is_empty());
                    assert_ne!(message, GENERIC_ERROR_MESSAGE);
                }
                other => panic!("expected a wrong passphrase, got {other:?}"),
            }
            assert!(matches!(session.model.route(), Route::Unlock { .. }));

            session
                .model
                .unlock(Secret::new(PASSPHRASE), false)
                .await
                .expect("the sample passphrase unlocks");
            session
                .wait_until("the notes page", |model| model.route() == Route::Notes)
                .await;
            let tree = session.model.tree().unwrap_or_default();
            let path = first_note(&tree).expect("the sample tree has a note");

            session.model.open_note(Some(path.clone()));
            session
                .wait_until("the loaded note", |model| {
                    matches!(
                        model.open_note_state(),
                        Some(OpenNote::Loaded { path: loaded, .. }) if loaded == path
                    )
                })
                .await;

            assert_eq!(
                session.model.log_out().await.expect("logging out succeeds"),
                LogOutResult::LoggedOut
            );
            session
                .wait_until("the token page after logging out", |model| {
                    model.route() == Route::Token
                })
                .await;
            assert!(session.model.tree().is_none());
            assert_eq!(session.model.login_draft().forge.as_deref(), Some("github"));
        });
    }

    async fn exported_main(session: &Session) -> serde_json::Value {
        use commitnote_core_api::fake::{FakeExportRepo, FakeExportRepoParams};

        let exported = session
            .model
            .request::<FakeExportRepo>(FakeExportRepoParams {
                repo_key: "sample/notes".to_owned(),
            })
            .await
            .expect("the fake core exports the repository")
            .exported;
        let exported: serde_json::Value =
            serde_json::from_str(&exported).expect("the export is JSON");
        exported["main"].clone()
    }

    #[test]
    fn an_edit_followed_by_save_now_reaches_the_repository() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let tree = session.model.tree().unwrap_or_default();
            let path = first_note(&tree).expect("the sample tree has a note");
            session.model.open_note(Some(path.clone()));
            session
                .wait_until("the loaded note", |model| {
                    matches!(
                        model.open_note_state(),
                        Some(OpenNote::Loaded { path: loaded, .. }) if loaded == path
                    )
                })
                .await;
            session
                .wait_until("the note content update", |model| {
                    model
                        .note_update()
                        .is_some_and(|update| update.path == path)
                })
                .await;
            assert_eq!(session.model.note_switch(), 1);

            let before = exported_main(&session).await;
            session.model.edit("Typed in the editor\n".to_owned());
            session.model.save_now().await;
            assert_ne!(exported_main(&session).await, before);

            session.model.open_note(Some(path));
            assert_eq!(session.model.note_switch(), 1);
        });
    }

    #[test]
    fn a_failed_save_is_reported_and_retried() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            open_first_note(&session).await;
            let signals = Rc::new(Cell::new(0_u32));
            session.model.connect_sync_state_changed({
                let signals = signals.clone();
                move |_| signals.set(signals.get() + 1)
            });
            let failed = |model: &AppModel| {
                model.sync_state().is_some_and(|sync| {
                    sync.can_retry
                        && sync.state
                            == SyncState::OutOfSync {
                                reason: OutOfSyncReason::Failed,
                            }
                })
            };
            let repo = session.model.testing_repo_key().expect("a repository");
            let fail = serde_json::json!({
                "repo": repo, "operation": "commit", "kind": "Network", "count": 50,
            });
            session
                .model
                .testing_send("fake.failNext", fail)
                .await
                .expect("the fake forge fails commits");

            session.model.edit("Typed while failing\n".to_owned());
            session.model.save_now().await;
            session.wait_until("the failed state", failed).await;
            assert!(signals.get() > 0);

            let clear = serde_json::json!({ "repo": repo, "operation": "commit" });
            session
                .model
                .testing_send("fake.clearFailures", clear)
                .await
                .expect("the fake forge clears failures");
            session.model.retry_sync().await;
            session
                .wait_until("the synced state", |model| {
                    model
                        .sync_state()
                        .is_some_and(|sync| sync.state == SyncState::Synced)
                })
                .await;
        });
    }

    #[test]
    fn a_remote_change_to_the_open_note_is_a_toast() {
        run(|| async {
            let session = Session::start(String::new());
            let toasts = Rc::new(RefCell::new(Vec::new()));
            session.model.connect_toast({
                let toasts = toasts.clone();
                move |_, message| toasts.borrow_mut().push(message.to_owned())
            });
            session.model.testing_remote_change(
                commitnote_core_api::events::RemoteChange::Trashed,
                "Moved to trash elsewhere.",
            );
            assert_eq!(*toasts.borrow(), ["Moved to trash elsewhere."]);
        });
    }

    async fn open_first_note(session: &Session) -> Vec<String> {
        let tree = session.model.tree().unwrap_or_default();
        let path = first_note(&tree).expect("the sample tree has a note");
        session.model.open_note(Some(path.clone()));
        session
            .wait_until("the note content update", |model| {
                model
                    .note_update()
                    .is_some_and(|update| update.path == path)
            })
            .await;
        path
    }

    fn all_notes(nodes: &[TreeNode]) -> Vec<Vec<String>> {
        nodes
            .iter()
            .flat_map(|node| match node {
                TreeNode::Note { path, .. } => vec![path.clone()],
                TreeNode::Folder { children, .. } => all_notes(children),
            })
            .collect()
    }

    fn tree_has(model: &AppModel, path: &[String]) -> bool {
        all_notes(&model.tree().unwrap_or_default())
            .iter()
            .any(|note| note == path)
    }

    fn renamed(path: &[String], name: &str) -> Vec<String> {
        let mut renamed = path.to_vec();
        if let Some(last) = renamed.last_mut() {
            *last = name.to_owned();
        }
        renamed
    }

    #[test]
    fn renaming_the_open_note_moves_the_editor_along() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let path = open_first_note(&session).await;
            let switch = session.model.note_switch();
            let before = exported_main(&session).await;

            let result = session
                .model
                .rename_open_note("Renamed note".to_owned())
                .await;

            assert_eq!(result, RenameResult::Renamed);
            let target = renamed(&path, "Renamed note");
            assert_eq!(
                session.model.editor_target(),
                EditorTarget::Note(target.clone())
            );
            assert_eq!(session.model.note_switch(), switch);
            assert_eq!(session.model.note_name_error(), None);
            session
                .wait_until("the tree to hold the new name", |model| {
                    tree_has(model, &target) && !tree_has(model, &path)
                })
                .await;
            session.model.save_now().await;
            assert_ne!(exported_main(&session).await, before);
        });
    }

    async fn open_and_read(session: &Session, path: &[String]) -> String {
        session.model.open_note(Some(path.to_vec()));
        session
            .wait_until("the opened note's content", |model| {
                model.note_update().is_some_and(|update| {
                    update.path == path
                        && matches!(
                            model.open_note_state(),
                            Some(OpenNote::Loaded { path: loaded, .. }) if loaded == path
                        )
                })
            })
            .await;
        session
            .model
            .note_update()
            .map(|update| update.content)
            .expect("the note was delivered")
    }

    type Shown = (Vec<String>, String);

    fn shown(model: &AppModel) -> Option<Shown> {
        let path = model.open_note_path();
        let state = model.open_note_state();
        let display = display_state(path.as_deref(), state.as_ref());
        loaded_update(&display, &model.editor_target(), model.note_update())
            .map(|update| (update.path, update.content))
    }

    fn record_shown(model: &AppModel) -> Rc<RefCell<Vec<Shown>>> {
        let log = Rc::new(RefCell::new(Vec::new()));
        model.connect_open_note_changed({
            let log = log.clone();
            move |model| {
                if let Some(shown) = shown(model) {
                    log.borrow_mut().push(shown);
                }
            }
        });
        log
    }

    fn assert_only_shown(seen: &[Shown], allowed: &[(&[String], &str)]) {
        for (path, text) in seen {
            assert!(
                allowed.iter().any(
                    |(allowed_path, allowed_text)| *allowed_path == path.as_slice()
                        && *allowed_text == text
                ),
                "the editor got {text:?} for {path:?}"
            );
        }
    }

    async fn settle_and_type(session: &Session, path: &[String], text: &str) -> String {
        session
            .wait_until("the editor to settle on the note", |model| {
                !model.opens_pending() && shown(model) == Some((path.to_vec(), text.to_owned()))
            })
            .await;
        let typed = format!("{text}K");
        session.model.edit(typed.clone());
        session.model.save_now().await;
        typed
    }

    async fn until_sent(session: &Session) {
        while session.model.edit_sender().has_pending() {
            glib::timeout_future(Duration::ZERO).await;
        }
    }

    async fn two_notes(session: &Session) -> (Vec<String>, String, Vec<String>, String) {
        let notes = all_notes(&session.model.tree().unwrap_or_default());
        let (a, b) = (notes[0].clone(), notes[1].clone());
        let b_content = open_and_read(session, &b).await;
        let a_content = open_and_read(session, &a).await;
        (a, a_content, b, b_content)
    }

    async fn return_while_an_edit_is_in_flight(after_turns: bool) {
        let session = Session::start(fake_bundle());
        session.log_in().await;
        let (a, a_content, b, b_content) = two_notes(&session).await;
        let typed = format!("{a_content}typed in A\n");
        let log = record_shown(&session.model);

        session.model.edit(typed.clone());
        if after_turns {
            glib::timeout_future(Duration::ZERO).await;
        }
        session.model.open_note(Some(b.clone()));
        if after_turns {
            glib::timeout_future(Duration::ZERO).await;
        }
        session.model.open_note(Some(a.clone()));
        let typed_k = settle_and_type(&session, &a, &typed).await;

        let seen = log.take();
        assert_only_shown(&seen, &[(&a, &typed), (&a, &typed_k), (&b, &b_content)]);
        assert!(seen.contains(&(a.clone(), typed.clone())));
        assert_eq!(open_and_read(&session, &b).await, b_content);
        assert_eq!(open_and_read(&session, &a).await, typed_k);
    }

    #[test]
    fn returning_at_once_to_a_note_with_an_edit_in_flight_shows_the_typed_text() {
        run(|| return_while_an_edit_is_in_flight(false));
    }

    #[test]
    fn returning_after_a_turn_to_a_note_with_an_edit_in_flight_shows_the_typed_text() {
        run(|| return_while_an_edit_is_in_flight(true));
    }

    #[test]
    fn returning_with_two_edits_outstanding_shows_only_the_newest() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let (a, a_content, b, b_content) = two_notes(&session).await;
            let first = format!("{a_content}first\n");
            let second = format!("{first}second\n");
            let log = record_shown(&session.model);

            session.model.edit(first);
            until_sent(&session).await;
            session.model.edit(second.clone());
            session.model.open_note(Some(b.clone()));
            session.model.open_note(Some(a.clone()));
            let typed_k = settle_and_type(&session, &a, &second).await;

            let seen = log.take();
            assert_only_shown(&seen, &[(&a, &second), (&a, &typed_k)]);
            assert!(seen.contains(&(a.clone(), second.clone())));
            assert_eq!(open_and_read(&session, &b).await, b_content);
            assert_eq!(open_and_read(&session, &a).await, typed_k);
        });
    }

    #[test]
    fn an_edit_echo_for_the_note_just_left_does_not_pull_the_editor_back() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let (a, a_content, b, b_content) = two_notes(&session).await;
            let typed = format!("{a_content}typed in A\n");
            let log = record_shown(&session.model);

            session.model.edit(typed.clone());
            session.model.open_note(Some(b.clone()));
            let b_typed = settle_and_type(&session, &b, &b_content).await;

            assert_eq!(session.model.editor_target(), EditorTarget::Note(b.clone()));
            assert_eq!(session.model.open_note_path(), Some(b.clone()));
            let seen = log.take();
            assert_only_shown(&seen, &[(&b, &b_content), (&b, &b_typed)]);
            assert!(seen.contains(&(b.clone(), b_content.clone())));
            assert_eq!(open_and_read(&session, &a).await, typed);
            assert_eq!(open_and_read(&session, &b).await, b_typed);
        });
    }

    #[test]
    fn returning_to_a_note_whose_echo_was_held_back_shows_its_newest_text() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let (a, a_content, b, b_content) = two_notes(&session).await;
            let typed = format!("{a_content}typed in A\n");
            let log = record_shown(&session.model);

            session.model.edit(typed.clone());
            session.model.open_note(Some(b.clone()));
            session.model.flush_edits().await;
            assert!(session.model.opens_pending(), "the echo was not held back");
            session.model.open_note(Some(a.clone()));
            let typed_k = settle_and_type(&session, &a, &typed).await;

            let seen = log.take();
            assert_only_shown(&seen, &[(&a, &typed), (&a, &typed_k), (&b, &b_content)]);
            assert!(seen.contains(&(a.clone(), typed.clone())));
            assert_eq!(open_and_read(&session, &a).await, typed_k);
            assert_eq!(open_and_read(&session, &b).await, b_content);
        });
    }

    #[test]
    fn returning_to_a_note_while_the_opens_are_queued_keeps_the_editor_on_it() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let (a, a_content, b, b_content) = two_notes(&session).await;
            let log = record_shown(&session.model);

            session.model.open_note(Some(b.clone()));
            session.model.open_note(Some(a.clone()));
            let typed_k = settle_and_type(&session, &a, &a_content).await;

            assert_eq!(session.model.editor_target(), EditorTarget::Note(a.clone()));
            assert_eq!(session.model.open_note_path(), Some(a.clone()));
            let seen = log.take();
            assert_only_shown(&seen, &[(&a, &a_content), (&a, &typed_k)]);
            assert!(seen.contains(&(a.clone(), a_content.clone())));
            assert_eq!(open_and_read(&session, &b).await, b_content);
            assert_eq!(open_and_read(&session, &a).await, typed_k);
        });
    }

    #[test]
    fn passing_through_a_note_shows_only_the_last_one() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let notes = all_notes(&session.model.tree().unwrap_or_default());
            let c = notes[2].clone();
            let c_content = open_and_read(&session, &c).await;
            let (a, a_content, b, b_content) = two_notes(&session).await;
            let typed = format!("{a_content}typed in A\n");
            let log = record_shown(&session.model);

            session.model.edit(typed.clone());
            session.model.open_note(Some(b.clone()));
            session.model.open_note(Some(c.clone()));
            let c_typed = settle_and_type(&session, &c, &c_content).await;

            assert_only_shown(&log.take(), &[(&c, &c_content), (&c, &c_typed)]);
            assert_eq!(open_and_read(&session, &a).await, typed);
            assert_eq!(open_and_read(&session, &b).await, b_content);
            assert_eq!(open_and_read(&session, &c).await, c_typed);
        });
    }

    #[test]
    fn an_open_after_a_failed_one_shows_the_requested_note() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let notes = all_notes(&session.model.tree().unwrap_or_default());
            let c = notes[2].clone();
            let (_, _, b, b_content) = two_notes(&session).await;
            let repo = session.model.testing_repo_key().expect("a repository");
            let fail = serde_json::json!({
                "repo": repo, "operation": "readBlob", "kind": "Network", "count": 1,
            });
            session
                .model
                .testing_send("fake.failNext", fail)
                .await
                .expect("the fake forge fails a read");
            let log = record_shown(&session.model);

            session.model.open_note(Some(c.clone()));
            session
                .wait_until("the failed open", |model| {
                    !model.opens_pending()
                        && matches!(
                            model.open_note_state(),
                            Some(OpenNote::Failed { path, .. }) if path == c
                        )
                })
                .await;
            let path = session.model.open_note_path();
            let state = session.model.open_note_state();
            assert!(matches!(
                display_state(path.as_deref(), state.as_ref()),
                NoteDisplay::Problem(_)
            ));
            assert!(log.borrow().is_empty());

            session.model.open_note(Some(c.clone()));
            session
                .wait_until("the note after the failure", |model| {
                    !model.opens_pending() && shown(model).is_some()
                })
                .await;
            let (shown_path, c_content) = shown(&session.model).expect("the note is shown");
            assert_eq!(shown_path, c);
            let c_typed = settle_and_type(&session, &c, &c_content).await;

            assert_only_shown(&log.take(), &[(&c, &c_content), (&c, &c_typed)]);
            assert_eq!(open_and_read(&session, &b).await, b_content);
            assert_eq!(open_and_read(&session, &c).await, c_typed);
        });
    }

    async fn rename_and_type(reply_first: bool) {
        let session = Session::start(fake_bundle());
        session.log_in().await;
        let notes = all_notes(&session.model.tree().unwrap_or_default());
        let other = notes[1].clone();
        let path = notes[0].clone();
        let content = open_and_read(&session, &path).await;
        let switch = session.model.note_switch();
        let target = renamed(&path, "Renamed note");
        let log = record_shown(&session.model);

        let mut rename = Box::pin(session.model.rename_open_note("Renamed note".to_owned()));
        let result = if reply_first {
            let deadline = Instant::now() + Duration::from_secs(30);
            loop {
                if let std::task::Poll::Ready(result) = poll_once(&mut rename) {
                    break result;
                }
                assert!(
                    Instant::now() < deadline,
                    "timed out waiting for the rename"
                );
                std::thread::yield_now();
            }
        } else {
            assert!(poll_once(&mut rename).is_pending());
            session
                .wait_until("the event to move the editor", |model| {
                    model.editor_target() == EditorTarget::Note(target.clone())
                })
                .await;
            rename.await
        };

        assert_eq!(result, RenameResult::Renamed);
        assert_eq!(
            session.model.editor_target(),
            EditorTarget::Note(target.clone())
        );
        let typed = settle_and_type(&session, &target, &content).await;
        assert_eq!(session.model.note_switch(), switch);
        assert_only_shown(
            &log.take(),
            &[(&path, &content), (&target, &content), (&target, &typed)],
        );
        open_and_read(&session, &other).await;
        assert_eq!(open_and_read(&session, &target).await, typed);
    }

    #[test]
    fn a_rename_announced_before_its_reply_keeps_the_text() {
        run(|| rename_and_type(false));
    }

    #[test]
    fn a_rename_answered_before_its_announcement_keeps_the_text() {
        run(|| rename_and_type(true));
    }

    #[test]
    fn renaming_to_a_sibling_name_reports_the_error_and_keeps_the_note() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let notes = all_notes(&session.model.tree().unwrap_or_default());
            let (path, sibling) = notes
                .iter()
                .find_map(|path| {
                    let sibling = notes.iter().find(|other| {
                        *other != path
                            && other.len() == path.len()
                            && other[..other.len() - 1] == path[..path.len() - 1]
                    })?;
                    Some((path.clone(), sibling.clone()))
                })
                .expect("the sample tree has two sibling notes");
            session.model.open_note(Some(path.clone()));
            session
                .wait_until("the note content update", |model| {
                    model
                        .note_update()
                        .is_some_and(|update| update.path == path)
                })
                .await;

            let name = sibling.last().cloned().unwrap_or_default();
            let RenameResult::Error(message) = session.model.rename_open_note(name).await else {
                panic!("a sibling's name is refused");
            };

            assert_eq!(session.model.note_name_error(), Some(message));
            assert_eq!(
                session.model.editor_target(),
                EditorTarget::Note(path.clone())
            );
            assert!(tree_has(&session.model, &path));

            let current = path.last().cloned().unwrap_or_default();
            assert_eq!(
                session.model.rename_open_note(current).await,
                RenameResult::None
            );
            assert_eq!(session.model.note_name_error(), None);
        });
    }

    #[test]
    fn an_empty_name_restores_the_current_one() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let path = open_first_note(&session).await;

            assert_eq!(
                session.model.rename_open_note("  ".to_owned()).await,
                RenameResult::Restore
            );
            assert_eq!(
                session.model.editor_target(),
                EditorTarget::Note(path.clone())
            );
            assert_eq!(session.model.note_name_error(), None);
            assert!(tree_has(&session.model, &path));
        });
    }

    #[test]
    fn a_draft_name_creates_the_note_and_switches_the_editor() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let existing = all_notes(&session.model.tree().unwrap_or_default())
                .into_iter()
                .find(|path| path.len() == 1)
                .expect("the sample tree has a top-level note");

            session
                .model
                .start_draft(Vec::new(), DraftFocus::Name)
                .await
                .expect("a draft starts at the root");
            assert!(session.model.editor_target().is_draft());
            assert_eq!(session.model.draft_focus(), DraftFocus::Name);
            assert_eq!(session.model.open_note_path(), None);
            let switch = session.model.note_switch();

            session.model.set_draft_name(existing[0].clone());
            assert!(matches!(
                session.model.commit_draft_name().await,
                NoteDraftOutcome::Error { .. }
            ));
            assert!(session.model.draft_error().is_some());
            assert!(session.model.editor_target().is_draft());

            session.model.set_draft_name("Fresh note".to_owned());
            let outcome = session.model.commit_draft_name().await;

            let path = vec!["Fresh note".to_owned()];
            assert!(
                matches!(&outcome, NoteDraftOutcome::Created { path: created, .. } if *created == path)
            );
            assert_eq!(
                session.model.editor_target(),
                EditorTarget::Note(path.clone())
            );
            assert_eq!(session.model.note_switch(), switch + 1);
            assert_eq!(session.model.draft_name(), "");
            assert_eq!(session.model.draft_error(), None);
            session
                .wait_until("the tree to hold the new note", |model| {
                    tree_has(model, &path)
                })
                .await;
        });
    }

    #[test]
    fn draft_content_promotes_the_draft_without_a_switch() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let notes = all_notes(&session.model.tree().unwrap_or_default());
            session
                .model
                .start_draft(Vec::new(), DraftFocus::Editor)
                .await
                .expect("a draft starts at the root");
            let switch = session.model.note_switch();
            let lineage = session.model.editor_lineage();
            let before = exported_main(&session).await;

            session.model.edit("Body of the draft\n".to_owned());
            session.model.flush_edits().await;

            let EditorTarget::Note(path) = session.model.editor_target() else {
                panic!("the draft became a note");
            };
            assert!(!notes.contains(&path));
            assert_eq!(session.model.note_switch(), switch);
            assert_eq!(session.model.editor_lineage(), lineage);
            session
                .wait_until("the created note's content", |model| {
                    model.note_update().is_some_and(|update| {
                        update.path == path && update.content == "Body of the draft\n"
                    })
                })
                .await;
            session.model.save_now().await;
            assert_ne!(exported_main(&session).await, before);
        });
    }

    #[test]
    fn leaving_an_empty_draft_discards_it() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let notes = all_notes(&session.model.tree().unwrap_or_default());
            let before = exported_main(&session).await;
            session
                .model
                .start_draft(Vec::new(), DraftFocus::Name)
                .await
                .expect("a draft starts at the root");
            session.model.set_draft_name("Never named".to_owned());

            session.model.leave_draft().await;

            assert_eq!(session.model.editor_target(), EditorTarget::None);
            assert_eq!(session.model.draft_name(), "");
            assert_eq!(
                session.model.commit_draft_name().await,
                NoteDraftOutcome::None
            );
            session.model.save_now().await;
            assert_eq!(exported_main(&session).await, before);
            assert_eq!(all_notes(&session.model.tree().unwrap_or_default()), notes);
        });
    }

    #[test]
    fn an_untouched_early_draft_hands_off_nothing() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let switch = session.model.note_switch();

            session
                .model
                .hand_off_early_draft()
                .await
                .expect("an empty early draft needs no request");

            assert_eq!(session.model.editor_target(), EditorTarget::None);
            assert_eq!(session.model.note_switch(), switch);
            assert!(!session.model.take_focus_end());
        });
    }

    #[test]
    fn an_early_body_becomes_a_note_with_the_caret_at_the_end() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            session
                .model
                .set_early_draft_body("Quick thought".to_owned());

            session
                .model
                .hand_off_early_draft()
                .await
                .expect("the hand-off succeeds");

            let EditorTarget::Note(path) = session.model.editor_target() else {
                panic!("the early draft became a note");
            };
            assert_eq!(session.model.open_note_path(), Some(path.clone()));
            assert!(session.model.early_draft().is_empty());
            assert!(!session.model.handing_off());
            assert!(session.model.take_focus_end());
            assert!(!session.model.take_focus_end());
            session
                .wait_until("the created note's content", |model| {
                    model.note_update().is_some_and(|update| {
                        update.path == path && update.content == "Quick thought"
                    })
                })
                .await;
        });
    }

    #[test]
    fn a_confirmed_early_name_creates_the_note_under_that_name() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            session.model.set_early_draft_name("Plans".to_owned());
            session.model.set_early_draft_body("Body text".to_owned());
            session.model.confirm_early_draft_name();

            session
                .model
                .hand_off_early_draft()
                .await
                .expect("the hand-off succeeds");

            assert_eq!(
                session.model.editor_target(),
                EditorTarget::Note(vec!["Plans".to_owned()])
            );
            assert_eq!(session.model.draft_error(), None);
        });
    }

    #[test]
    fn an_early_name_alone_opens_a_draft_with_that_name() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let switch = session.model.note_switch();
            let lineage = session.model.editor_lineage();
            session.model.set_early_draft_name("Half".to_owned());

            session
                .model
                .hand_off_early_draft()
                .await
                .expect("the hand-off succeeds");

            assert!(session.model.editor_target().is_draft());
            assert_eq!(session.model.draft_name(), "Half");
            assert_eq!(session.model.draft_body(), "");
            assert_eq!(session.model.draft_focus(), DraftFocus::Name);
            assert_eq!(session.model.draft_error(), None);
            assert_eq!(session.model.note_switch(), switch + 1);
            assert_eq!(session.model.editor_lineage(), lineage + 1);
            assert!(session.model.early_draft().is_empty());
            assert!(!session.model.take_focus_end());
        });
    }

    #[test]
    fn a_taken_early_name_alone_opens_a_draft_with_the_error() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let existing = all_notes(&session.model.tree().unwrap_or_default())
                .into_iter()
                .find(|path| path.len() == 1)
                .expect("the sample tree has a top-level note");
            session.model.set_early_draft_name(existing[0].clone());
            session.model.confirm_early_draft_name();

            session
                .model
                .hand_off_early_draft()
                .await
                .expect("the hand-off succeeds");

            assert!(session.model.editor_target().is_draft());
            assert_eq!(session.model.draft_name(), existing[0]);
            assert!(session.model.draft_error().is_some());
            assert!(session.model.early_draft().is_empty());
        });
    }

    #[test]
    fn a_taken_early_name_with_a_body_still_creates_a_note() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let existing = all_notes(&session.model.tree().unwrap_or_default())
                .into_iter()
                .find(|path| path.len() == 1)
                .expect("the sample tree has a top-level note");
            session.model.set_early_draft_name(existing[0].clone());
            session.model.set_early_draft_body("Body".to_owned());
            session.model.confirm_early_draft_name();

            session
                .model
                .hand_off_early_draft()
                .await
                .expect("the hand-off succeeds");

            let target = session.model.editor_target();
            assert!(target.note_path().is_some_and(|path| path != existing));
            assert!(session.model.early_draft().is_empty());
        });
    }

    #[test]
    fn type_to_start_holds_keys_until_the_draft_hands_them_over() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            assert!(
                !session
                    .model
                    .buffer_type_to_start(TypeToStartInput::Text("x".into()))
            );

            session.model.start_type_to_start("H");
            assert!(session.model.type_to_start_pending());
            assert!(
                session
                    .model
                    .buffer_type_to_start(TypeToStartInput::Text("i".into()))
            );
            assert!(session.model.buffer_type_to_start(TypeToStartInput::Enter));
            assert_eq!(session.model.take_type_to_start_text(), None);
            session
                .wait_until("the draft", |model| model.editor_target().is_draft())
                .await;
            assert_eq!(session.model.draft_focus(), DraftFocus::Editor);

            assert_eq!(
                session.model.take_type_to_start_text().as_deref(),
                Some("Hi\n")
            );
            assert!(!session.model.type_to_start_pending());
            assert_eq!(session.model.take_type_to_start_text(), None);
        });
    }

    fn poll_once<F: Future>(future: &mut std::pin::Pin<Box<F>>) -> std::task::Poll<F::Output> {
        future
            .as_mut()
            .poll(&mut std::task::Context::from_waker(std::task::Waker::noop()))
    }

    async fn assert_opened_note_is_what_the_core_holds(session: &Session, path: &[String]) {
        assert_eq!(
            session.model.editor_target(),
            EditorTarget::Note(path.to_vec())
        );
        assert_eq!(session.model.open_note_path().as_deref(), Some(path));
        session
            .wait_until("the opened note", |model| {
                matches!(
                    model.open_note_state(),
                    Some(OpenNote::Loaded { path: loaded, .. }) if loaded == path
                )
            })
            .await;
        let probe = session
            .model
            .request::<DraftContent>(DraftContentParams {
                name: String::new(),
                content: "probe".to_owned(),
            })
            .await
            .expect("the core answers a draft probe");
        assert_eq!(probe.outcome, NoteDraftOutcome::None);

        let before = exported_main(session).await;
        session.model.edit("Typed after the race\n".to_owned());
        session.model.save_now().await;
        assert_ne!(exported_main(session).await, before);
        assert_eq!(session.model.unsaved_count(), 0);
    }

    fn superseded_start_test(focus: DraftFocus) {
        run(|| async move {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let note = first_note(&session.model.tree().unwrap_or_default())
                .expect("the sample tree has a note");
            let toasts = Rc::new(RefCell::new(Vec::new()));
            let sink = toasts.clone();
            session
                .model
                .connect_toast(move |_, message| sink.borrow_mut().push(message.to_owned()));

            let mut start = Box::pin(session.model.start_draft(Vec::new(), focus));
            assert!(poll_once(&mut start).is_pending());
            let switch = session.model.note_switch();
            session.model.open_note(Some(note.clone()));
            assert_eq!(session.model.note_switch(), switch + 1);

            assert_eq!(start.await, Ok(()));

            assert_eq!(session.model.note_switch(), switch + 1);
            assert_opened_note_is_what_the_core_holds(&session, &note).await;
            assert!(toasts.borrow().is_empty());
        });
    }

    #[test]
    fn a_draft_started_into_the_editor_does_not_replace_a_note_opened_meanwhile() {
        superseded_start_test(DraftFocus::Editor);
    }

    #[test]
    fn a_draft_started_with_a_name_does_not_replace_a_note_opened_meanwhile() {
        superseded_start_test(DraftFocus::Name);
    }

    #[test]
    fn a_draft_start_still_waiting_to_be_sent_is_dropped_when_a_note_is_opened() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let note = first_note(&session.model.tree().unwrap_or_default())
                .expect("the sample tree has a note");

            let start = session.model.start_draft(Vec::new(), DraftFocus::Editor);
            session.model.open_note(Some(note.clone()));

            assert_eq!(start.await, Ok(()));

            assert_opened_note_is_what_the_core_holds(&session, &note).await;
        });
    }

    #[test]
    fn typing_to_start_a_note_is_dropped_when_another_note_is_opened_first() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let note = first_note(&session.model.tree().unwrap_or_default())
                .expect("the sample tree has a note");
            let toasts = Rc::new(RefCell::new(Vec::new()));
            let sink = toasts.clone();
            session
                .model
                .connect_toast(move |_, message| sink.borrow_mut().push(message.to_owned()));

            session.model.start_type_to_start("H");
            session.model.open_note(Some(note.clone()));
            assert!(!session.model.type_to_start_pending());

            assert_opened_note_is_what_the_core_holds(&session, &note).await;
            assert!(!session.model.type_to_start_pending());
            assert!(toasts.borrow().is_empty());
        });
    }

    #[test]
    fn a_later_draft_start_survives_an_earlier_superseded_one() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let note = first_note(&session.model.tree().unwrap_or_default())
                .expect("the sample tree has a note");

            let mut first = Box::pin(session.model.start_draft(Vec::new(), DraftFocus::Editor));
            assert!(poll_once(&mut first).is_pending());
            session.model.open_note(Some(note));
            let second = session.model.start_draft(Vec::new(), DraftFocus::Name);

            let (first, second) = futures_util::future::join(first, second).await;

            assert_eq!((first, second), (Ok(()), Ok(())));
            assert!(session.model.editor_target().is_draft());
            assert_eq!(session.model.draft_focus(), DraftFocus::Name);
            session.model.set_draft_name("Second draft".to_owned());
            assert!(matches!(
                session.model.commit_draft_name().await,
                NoteDraftOutcome::Created { .. }
            ));
        });
    }

    #[test]
    fn leaving_a_draft_does_not_clear_one_started_after_it() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            session
                .model
                .start_draft(Vec::new(), DraftFocus::Name)
                .await
                .expect("a draft starts at the root");

            let leave = session.model.leave_draft();
            let start = session.model.start_draft(Vec::new(), DraftFocus::Name);
            futures_util::future::join(leave, async {
                start.await.expect("the second draft starts");
            })
            .await;

            assert!(session.model.editor_target().is_draft());
            session.model.set_draft_name("Kept draft".to_owned());
            assert!(matches!(
                session.model.commit_draft_name().await,
                NoteDraftOutcome::Created { .. }
            ));
        });
    }

    #[test]
    fn leaving_the_draft_drops_the_held_keys() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            session.model.start_type_to_start("H");
            session
                .wait_until("the draft", |model| model.editor_target().is_draft())
                .await;

            session.model.leave_draft().await;

            assert!(!session.model.type_to_start_pending());
        });
    }

    #[test]
    fn a_changed_repository_key_routes_to_key_changed() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            assert_eq!(
                session.model.testing_repo_key().as_deref(),
                Some("sample/notes")
            );

            session
                .model
                .testing_change_passphrase()
                .await
                .expect("the fake core changes the key");
            let _ = session.model.refresh().await;
            session
                .wait_until("the key changed page", |model| {
                    matches!(model.route(), Route::KeyChanged { .. })
                })
                .await;
            assert!(session.model.key_changed().is_some());

            session
                .model
                .log_in_again()
                .await
                .expect("logging out succeeds");
            session.log_in().await;
        });
    }

    #[test]
    fn inspection_routes_empty_and_foreign_repositories() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.choose("https://github.com/sample/empty").await;
            assert!(
                matches!(session.model.route(), Route::Initialize { .. }),
                "got {:?}",
                session.model.route()
            );

            session
                .model
                .choose_repository("https://github.com/sample/foreign")
                .await;
            assert!(
                matches!(session.model.route(), Route::Unusable { .. }),
                "got {:?}",
                session.model.route()
            );
        });
    }

    #[test]
    fn a_core_with_another_api_version_cannot_start() {
        run(|| async {
            let bundle = format!(
                "globalThis.CommitnoteNativeCore = {{ marker: {NATIVE_CORE_MARKER:?}, apiVersion: 999, start() {{ return {{ send() {{}}, stop() {{}} }}; }} }};"
            );
            let session = Session::start(bundle);
            session
                .wait_until("the startup error", |model| {
                    matches!(model.route(), Route::StartupFailed { .. })
                })
                .await;
            assert_eq!(
                session.model.route(),
                Route::StartupFailed {
                    message: format!(
                        "This build of the app is broken: its core has API version 999, but the app expects {NATIVE_CORE_API_VERSION}."
                    ),
                }
            );
        });
    }

    #[test]
    fn editor_settings_follow_the_core_and_signal_changes() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            assert!(!session.model.vim_mode());
            assert!(session.model.type_to_start());

            let signals = Rc::new(Cell::new(0_u32));
            session.model.connect_editor_settings_changed({
                let signals = signals.clone();
                move |_| signals.set(signals.get() + 1)
            });
            let change = |key: &'static str, value: &'static str| {
                session.model.testing_send(
                    "settings.change",
                    serde_json::json!({ "key": key, "value": value }),
                )
            };

            change("vimMode", "true").await.expect("vimMode changes");
            session
                .wait_until("Vim mode to turn on", |model| model.vim_mode())
                .await;
            assert_eq!(signals.get(), 1);

            change("colorMode", "dark")
                .await
                .expect("colorMode changes");
            change("typeToStart", "false")
                .await
                .expect("typeToStart changes");
            session
                .wait_until("type to start to turn off", |model| !model.type_to_start())
                .await;
            assert!(session.model.vim_mode());
            assert_eq!(signals.get(), 2);

            change("vimMode", "false").await.expect("vimMode changes");
            session
                .wait_until("Vim mode to turn off", |model| !model.vim_mode())
                .await;
            assert!(!session.model.type_to_start());
            assert_eq!(signals.get(), 3);
        });
    }

    fn open_notes_pair(notes: &[Vec<String>]) -> (Vec<String>, Vec<String>) {
        (notes[0].clone(), notes[1].clone())
    }

    fn feed_notice(session: &Session, id: &str, action: NoticeAction) {
        session.model.handle_event(CoreEvent::Notice(Notice {
            id: id.to_owned(),
            tone: commitnote_core_api::shapes::NoticeTone::Warning,
            message: "A notice".to_owned(),
            persistent: true,
            action: Some(action),
        }));
    }

    #[test]
    fn an_open_note_notice_opens_its_note_and_asks_the_core_to_dismiss_it() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let notes = all_notes(&session.model.tree().unwrap_or_default());
            let (a, b) = open_notes_pair(&notes);
            open_and_read(&session, &a).await;
            feed_notice(
                &session,
                "engine-x",
                NoticeAction::OpenNote {
                    label: "Open note".to_owned(),
                    path: b.clone(),
                },
            );

            let dismissed = session.model.perform_notice_action("engine-x").await;

            assert!(matches!(dismissed, Err(RequestError::Core(_))));
            session
                .wait_until("the named note", |model| {
                    matches!(
                        model.open_note_state(),
                        Some(OpenNote::Loaded { path, .. }) if path == b
                    )
                })
                .await;
            assert_eq!(session.model.editor_target(), EditorTarget::Note(b));
            assert_eq!(
                session.model.perform_notice_action("engine-x").await,
                Ok(())
            );
        });
    }

    #[test]
    fn an_undo_notice_is_performed_by_the_core_and_leaves_the_open_note() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let notes = all_notes(&session.model.tree().unwrap_or_default());
            let (a, _) = open_notes_pair(&notes);
            open_and_read(&session, &a).await;
            feed_notice(
                &session,
                "engine-x",
                NoticeAction::Undo {
                    label: "Undo".to_owned(),
                },
            );

            let performed = session.model.perform_notice_action("engine-x").await;

            assert_eq!(performed, Ok(()));
            assert_eq!(session.model.editor_target(), EditorTarget::Note(a));
        });
    }

    #[test]
    fn a_conflict_notice_for_another_note_opens_it_without_losing_the_open_note_edits() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let notes = all_notes(&session.model.tree().unwrap_or_default());
            let (a, b) = open_notes_pair(&notes);
            let notices = Rc::new(RefCell::new(Vec::<NoticeView>::new()));
            session.model.connect_notice({
                let notices = notices.clone();
                move |_, notice| notices.borrow_mut().push(notice.clone())
            });
            let b_content = open_and_read(&session, &b).await;
            session
                .model
                .testing_remote_edit()
                .await
                .expect("the other device edits the note");
            session.model.edit(format!("Local {b_content}"));
            let a_content = open_and_read(&session, &a).await;
            session.model.save_now().await;
            session
                .wait_until("the conflict notice", |_| {
                    notices
                        .borrow()
                        .iter()
                        .any(|notice| notice.action_label.is_some())
                })
                .await;
            let id = notices
                .borrow()
                .iter()
                .find(|notice| notice.action_label.is_some())
                .map(|notice| notice.id.clone())
                .expect("the conflict notice was shown");

            session.model.edit(format!("{a_content}pending\n"));
            let dismissed = session.model.perform_notice_action(&id).await;

            assert_eq!(dismissed, Ok(()));
            session
                .wait_until("the conflicted note", |model| {
                    matches!(
                        model.open_note_state(),
                        Some(OpenNote::Loaded { path, .. }) if path == b
                    )
                })
                .await;
            assert_eq!(
                open_and_read(&session, &a).await,
                format!("{a_content}pending\n")
            );
        });
    }

    #[test]
    fn repo_keys_come_from_the_url_path() {
        assert_eq!(
            repo_key("https://github.com/sample/notes").as_deref(),
            Some("sample/notes")
        );
        assert_eq!(
            repo_key("https://gitlab.example/group/notes.git/").as_deref(),
            Some("group/notes")
        );
        assert_eq!(repo_key("https://github.com/"), None);
    }
}
