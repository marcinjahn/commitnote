mod app_model;
pub mod appearance;
mod core_client;
pub mod edit_sender;
mod editor_lane;
mod editor_settings;
pub mod lifecycle;

pub use app_model::{
    AppConfig, AppModel, COLOR_TAGS, DraftFocus, DropSetup, EarlyDraftState, EditorTarget,
    ExportGuard, ExportedFile, GENERIC_ERROR_MESSAGE, ImageInput, ImageState, ImportSetup,
    KeyChangedView, LoadedImage, LoadingFailure, LogOutResult, LoginDraft, NoteContentUpdate,
    NoteDetails, NoticeView, PassphraseChangeState, PassphraseStage, RenameResult,
    RepositoryChoice, RestoreResult, Route, SearchStatus, TokenError, TrashResult, TrashState,
    UnlockError, UnusableOutcome, UserError,
};
pub use appearance::{Appearance, ColorMode};
pub use editor_settings::EditorSettings;
