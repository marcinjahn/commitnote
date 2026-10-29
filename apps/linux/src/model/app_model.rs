use std::cell::{Cell, OnceCell, Ref, RefCell, RefMut};
use std::fmt;
use std::future::Future;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::OnceLock;

use commitnote_core_api::commands::{
    DeviceName, DeviceNameParams, ForgesList, ForgesListParams, LifecycleSetOnline,
    LifecycleSetOnlineParams, LifecycleSetVisible, LifecycleSetVisibleParams, LoginInitialize,
    LoginInspectRepository, LoginInspectRepositoryParams, LoginInspectRepositoryResult,
    LoginLastRepository, LoginLastRepositoryParams, LoginListRepositories,
    LoginListRepositoriesParams, LoginUnlock, NoteOpen, NoteOpenParams, NoticeIdParams,
    NoticesDismiss, NoticesPerform, PassphraseParams, PassphraseStrengthCheck,
    PassphraseStrengthParams, SessionLogout, SessionLogoutParams, SessionLogoutResult,
    SessionResume, SessionResumeParams, SessionResumeResult, SettingsOpen, SettingsOpenParams,
    SyncRefresh, SyncRefreshParams, TreeGet, TreeGetParams, TreeGetResult,
};
use commitnote_core_api::events::{NoteChanged, Notice, SyncStateChanged, TreeChanged};
use commitnote_core_api::settings::{AccentOptionView, SettingsView};
use commitnote_core_api::shapes::{
    ForgeKind, ForgeView, LogoutOutcome, NoticeAction, OpenNote, PassphraseStrength,
    RepositoryView, TagOptionView, TreeNode,
};
use commitnote_core_api::{Command, CoreError, CoreErrorKind, CoreEvent, Secret};
use commitnote_core_runtime::RequestError;
use glib::prelude::*;
use glib::subclass::Signal;
use glib::subclass::prelude::*;

use super::appearance::Appearance;
use super::core_client::{ClientConfig, CoreClient, startup_message};

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
    open_note_path: Option<Vec<String>>,
    open_note: Option<OpenNote>,
    key_changed: Option<KeyChangedView>,
    accent_options: Vec<AccentOptionView>,
    appearance: Appearance,
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

    pub fn open_note_path(&self) -> Option<Vec<String>> {
        self.state().open_note_path.clone()
    }

    pub fn key_changed(&self) -> Option<KeyChangedView> {
        self.state().key_changed.clone()
    }

    pub fn appearance(&self) -> Appearance {
        self.state().appearance.clone()
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
        {
            let mut state = self.state_mut();
            if path.is_none() {
                state.open_note = None;
            }
            state.open_note_path = path.clone();
        }
        self.emit_by_name::<()>("open-note-changed", &[]);
        let request = self.request::<NoteOpen>(NoteOpenParams { path: path.clone() });
        let model = self.downgrade();
        self.spawn(async move {
            let result = request.await;
            let Some(model) = model.upgrade() else {
                return;
            };
            match result {
                Ok(result) => model.apply_opened_note(path, result.note),
                Err(error) => warn("could not open a note", &error),
            }
        });
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

    pub async fn log_out(&self) -> Result<(), UserError> {
        let result = self
            .request::<SessionLogout>(SessionLogoutParams { anyway: false })
            .await;
        match result {
            Ok(SessionLogoutResult {
                outcome: LogoutOutcome::Unsaved { .. },
            }) => self.log_out_anyway().await,
            other => logout_result(other),
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
        let request = self.request::<NoticesPerform>(NoticeIdParams { id: id.to_owned() });
        self.spawn(async move {
            if let Err(error) = request.await {
                warn("could not perform a notice action", &error);
            }
        });
    }

    pub fn dismiss_notice(&self, id: &str) {
        let request = self.request::<NoticesDismiss>(NoticeIdParams { id: id.to_owned() });
        self.spawn(async move {
            if let Err(error) = request.await {
                warn("could not dismiss a notice", &error);
            }
        });
    }

    pub fn set_visible(&self, visible: bool) {
        self.state_mut().visible = visible;
        self.spawn(self.lifecycle_update());
    }

    pub fn set_online(&self, online: bool) {
        self.state_mut().online = online;
        self.spawn(self.lifecycle_update());
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
            self.set_loading_message(None);
            self.set_route(Route::Notes);
        }
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

    async fn log_out_anyway(&self) -> Result<(), UserError> {
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

    fn note_changed(&self, changed: NoteChanged) {
        {
            let mut state = self.state_mut();
            state.open_note_path = changed.note.as_ref().map(|note| note_path(note).to_vec());
            state.open_note = changed.note;
        }
        self.emit_by_name::<()>("open-note-changed", &[]);
    }

    fn apply_opened_note(&self, requested: Option<Vec<String>>, note: Option<OpenNote>) {
        {
            let mut state = self.state_mut();
            if state.open_note_path != requested {
                return;
            }
            if let Some(note) = &note {
                state.open_note_path = Some(note_path(note).to_vec());
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
                sync.last_refresh_error.map(|error| LoadingFailure {
                    message: error.message,
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
    }

    fn show_notice(&self, notice: Notice) {
        let action_label = notice.action.map(|action| match action {
            NoticeAction::OpenNote { label, .. } | NoticeAction::Undo { label } => label,
        });
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
                accent_options: previous.accent_options,
                appearance: previous.appearance,
                visible: previous.visible,
                online: previous.online,
                keyring_warned: previous.keyring_warned,
                ..State::default()
            };
        }
        self.emit_by_name::<()>("loading-message-changed", &[]);
        self.emit_by_name::<()>("tree-changed", &[]);
        self.emit_by_name::<()>("open-note-changed", &[]);
        self.bump_generation();
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

    use commitnote_core_api::{NATIVE_CORE_API_VERSION, NATIVE_CORE_MARKER};

    use super::*;

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

            session.model.log_out().await.expect("logging out succeeds");
            session
                .wait_until("the token page after logging out", |model| {
                    model.route() == Route::Token
                })
                .await;
            assert!(session.model.tree().is_none());
            assert_eq!(session.model.login_draft().forge.as_deref(), Some("github"));
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
