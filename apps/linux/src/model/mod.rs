mod app_model;
pub mod appearance;
mod core_client;
pub mod edit_sender;
mod editor_lane;
mod editor_settings;
pub mod lifecycle;

pub use app_model::{
    AppConfig, AppModel, COLOR_TAGS, DraftFocus, EarlyDraftState, EditorTarget,
    GENERIC_ERROR_MESSAGE, KeyChangedView, LoadingFailure, LogOutResult, LoginDraft,
    NoteContentUpdate, NoticeView, RenameResult, RepositoryChoice, Route, TokenError, TrashResult,
    TrashState, UnlockError, UnusableOutcome, UserError,
};
pub use appearance::{Appearance, ColorMode};
pub use editor_settings::EditorSettings;
