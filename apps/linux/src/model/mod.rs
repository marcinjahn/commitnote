mod app_model;
pub mod appearance;
mod core_client;
pub mod lifecycle;

pub use app_model::{
    AppConfig, AppModel, GENERIC_ERROR_MESSAGE, KeyChangedView, LoadingFailure, LoginDraft,
    NoticeView, RepositoryChoice, Route, TokenError, UnlockError, UnusableOutcome, UserError,
};
pub use appearance::{Appearance, ColorMode};
