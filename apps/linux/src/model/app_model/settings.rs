use std::rc::Rc;

use commitnote_core_api::commands::{
    DeviceSetName, DeviceSetNameParams, SettingsChange, SettingsChangeParams, SettingsFlush,
    SettingsFlushParams, SettingsOpen, SettingsOpenParams, SettingsOpenResult, SettingsRetry,
    SettingsRetryParams, SettingsSetScope, SettingsSetScopeParams,
};
use commitnote_core_api::settings::{
    AccentOptionView, ScopedSettingKey, SettingKeyView, SettingScope, SettingsCopy,
    SettingsSaveView, SettingsView,
};
use glib::prelude::*;
use glib::subclass::types::ObjectSubclassIsExt;

use super::organise::failed;
use super::{AppModel, UserError, warn};
use crate::model::appearance::Appearance;
use crate::model::editor_settings::EditorSettings;

#[derive(Default)]
pub(super) struct SettingsState {
    copy: Option<Rc<SettingsCopy>>,
    view: Option<SettingsView>,
    save: Option<SettingsSaveView>,
}

impl SettingsState {
    pub(super) fn is_loaded(&self) -> bool {
        self.view.is_some()
    }

    fn accent_options(&self) -> &[AccentOptionView] {
        self.copy
            .as_deref()
            .map_or(&[], |copy| copy.accent_color.options.as_slice())
    }
}

impl AppModel {
    pub fn settings_copy(&self) -> Option<Rc<SettingsCopy>> {
        self.state().settings.copy.clone()
    }

    pub fn settings_view(&self) -> Option<SettingsView> {
        self.state().settings.view.clone()
    }

    pub fn settings_save(&self) -> Option<SettingsSaveView> {
        self.state().settings.save.clone()
    }

    pub fn connect_settings_changed<F: Fn(&Self) + 'static>(&self, f: F) -> glib::SignalHandlerId {
        self.connect_unit_signal("settings-changed", f)
    }

    pub fn connect_settings_save_changed<F: Fn(&Self) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_unit_signal("settings-save-changed", f)
    }

    /// Changes one setting; the new view arrives through the core's `settingsChanged` event.
    pub async fn change_setting(
        &self,
        key: SettingKeyView,
        value: String,
    ) -> Result<(), UserError> {
        self.request::<SettingsChange>(SettingsChangeParams { key, value })
            .await
            .map(|_| ())
            .map_err(|error| failed("could not change a setting", error))
    }

    pub async fn set_setting_scope(
        &self,
        key: ScopedSettingKey,
        scope: SettingScope,
    ) -> Result<(), UserError> {
        self.request::<SettingsSetScope>(SettingsSetScopeParams { key, scope })
            .await
            .map(|_| ())
            .map_err(|error| failed("could not change where a setting applies", error))
    }

    pub async fn retry_settings_save(&self) -> Result<(), UserError> {
        self.request::<SettingsRetry>(SettingsRetryParams {})
            .await
            .map(|_| ())
            .map_err(|error| failed("could not retry saving settings", error))
    }

    /// Saves pending settings now instead of after the core's debounce. Does nothing before the
    /// settings are loaded, because then nothing can be pending and the core has no app to save to.
    pub async fn flush_settings(&self) -> Result<(), UserError> {
        if !self.state().settings.is_loaded() {
            return Ok(());
        }
        self.request::<SettingsFlush>(SettingsFlushParams {})
            .await
            .map(|_| ())
            .map_err(|error| failed("could not save settings", error))
    }

    /// Failures are already logged and show in the save status, which the caller cannot improve on.
    pub(super) async fn flush_settings_before_leaving(&self) {
        let _ = self.flush_settings().await;
    }

    /// Returns the name the core stores; `None` restores the automatic name.
    pub async fn set_device_name(&self, name: Option<String>) -> Result<String, UserError> {
        self.request::<DeviceSetName>(DeviceSetNameParams { name })
            .await
            .map(|result| result.name)
            .map_err(|error| failed("could not change the device name", error))
    }
}

impl AppModel {
    pub(super) async fn load_settings(&self) {
        let generation = self.imp().generation.get();
        let result = self.request::<SettingsOpen>(SettingsOpenParams {}).await;
        if self.imp().generation.get() != generation {
            return;
        }
        match result {
            Ok(opened) => self.settings_opened(opened),
            Err(error) => warn("could not read settings", &error),
        }
    }

    fn settings_opened(&self, opened: SettingsOpenResult) {
        self.state_mut().settings.copy = Some(Rc::new(opened.copy));
        self.settings_save_changed(opened.save);
        self.store_settings_view(opened.view);
        self.emit_by_name::<()>("settings-changed", &[]);
    }

    pub(super) fn apply_settings_view(&self, view: SettingsView) {
        if self.store_settings_view(view) {
            self.emit_by_name::<()>("settings-changed", &[]);
        }
    }

    pub(super) fn settings_save_changed(&self, save: SettingsSaveView) {
        {
            let mut state = self.state_mut();
            if state.settings.save.as_ref() == Some(&save) {
                return;
            }
            state.settings.save = Some(save);
        }
        self.emit_by_name::<()>("settings-save-changed", &[]);
    }

    /// Forgets the loaded settings and tells the open UI, which has nothing left to show.
    pub(super) fn clear_settings(&self) {
        let loaded = std::mem::take(&mut self.state_mut().settings).is_loaded();
        if loaded {
            self.emit_settings_cleared();
        }
    }

    pub(super) fn emit_settings_cleared(&self) {
        self.emit_by_name::<()>("settings-changed", &[]);
        self.emit_by_name::<()>("settings-save-changed", &[]);
    }

    /// Stores the view and the appearance and editor settings derived from it; returns whether the
    /// view differs from the stored one.
    fn store_settings_view(&self, view: SettingsView) -> bool {
        let appearance =
            Appearance::from_settings(&view.values, self.state().settings.accent_options());
        let editor_settings = EditorSettings::from_settings(&view.values);
        let (view_changed, appearance_changed, editor_changed) = {
            let mut state = self.state_mut();
            let view_changed = state.settings.view.as_ref() != Some(&view);
            state.settings.view = Some(view);
            let appearance_changed = state.appearance != appearance;
            state.appearance = appearance;
            let editor_changed =
                std::mem::replace(&mut state.editor_settings, editor_settings) != editor_settings;
            (view_changed, appearance_changed, editor_changed)
        };
        if appearance_changed {
            self.emit_by_name::<()>("appearance-changed", &[]);
        }
        if editor_changed {
            self.emit_by_name::<()>("editor-settings-changed", &[]);
        }
        view_changed
    }
}

#[cfg(all(test, feature = "testing"))]
mod tests {
    use std::cell::Cell;

    use commitnote_core_api::settings::SettingsSaveState;
    use serde_json::json;

    use super::super::tests::{Session, fake_bundle, run};
    use super::super::{LogOutResult, Route};
    use super::*;
    use crate::fonts::NoteFont;
    use crate::model::ColorMode;

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

    fn settings_changes(model: &AppModel) -> Rc<Cell<u32>> {
        count_signal(model, "settings-changed")
    }

    fn save_changes(model: &AppModel) -> Rc<Cell<u32>> {
        count_signal(model, "settings-save-changed")
    }

    async fn ready_session() -> Session {
        let session = Session::start(fake_bundle());
        session.log_in().await;
        session
            .wait_until("the settings", |model| model.settings_copy().is_some())
            .await;
        session
    }

    async fn fail_commits(model: &AppModel, count: u32) {
        let repo = model.testing_repo_key().expect("a repository");
        let fail =
            json!({ "repo": repo, "operation": "commit", "kind": "Network", "count": count });
        model
            .testing_send("fake.failNext", fail)
            .await
            .expect("the fake forge fails commits");
    }

    async fn clear_commit_failures(model: &AppModel) {
        let repo = model.testing_repo_key().expect("a repository");
        let clear = json!({ "repo": repo, "operation": "commit" });
        model
            .testing_send("fake.clearFailures", clear)
            .await
            .expect("the fake forge clears failures");
    }

    fn save_state(model: &AppModel) -> Option<SettingsSaveState> {
        model.settings_save().map(|save| save.state)
    }

    #[test]
    fn loads_the_copy_view_and_save_status_after_login() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;

            let copy = model.settings_copy().expect("the copy is loaded");
            assert!(!copy.accent_color.options.is_empty());
            let view = model.settings_view().expect("the view is loaded");
            assert_eq!(view.values.color_mode, "system");
            assert_eq!(view.device_name, "");
            assert_eq!(view.automatic_device_name, "Linux");
            assert_eq!(save_state(model), Some(SettingsSaveState::Synced));
        });
    }

    #[test]
    fn changing_the_color_mode_updates_the_view_and_appearance() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let settings = settings_changes(model);
            let appearance = Rc::new(Cell::new(0));
            model.connect_appearance_changed({
                let appearance = appearance.clone();
                move |_| appearance.set(appearance.get() + 1)
            });

            model
                .change_setting(SettingKeyView::ColorMode, "dark".to_owned())
                .await
                .expect("the color mode changes");

            session
                .wait_until("the dark view", |model| {
                    model
                        .settings_view()
                        .is_some_and(|view| view.values.color_mode == "dark")
                })
                .await;
            assert!(settings.get() >= 1);
            assert_eq!(appearance.get(), 1);
            assert_eq!(model.appearance().color_mode, ColorMode::Dark);
        });
    }

    #[test]
    fn every_core_note_font_has_its_own_font() {
        run(|| async {
            let session = ready_session().await;
            let copy = session.model.settings_copy().expect("the copy is loaded");
            let ids = copy
                .note_font
                .options
                .iter()
                .map(|option| option.id.as_str());

            assert!(ids.clone().any(|id| id == "inter"));
            for id in ids {
                let font = NoteFont::from_id(id);
                assert_eq!(font == NoteFont::default(), id == "inter", "{id}");
            }
        });
    }

    #[test]
    fn changing_the_accent_color_applies_the_core_palette() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let copy = model.settings_copy().expect("the copy is loaded");
            let option = copy
                .accent_color
                .options
                .iter()
                .find(|option| option.id != "system")
                .expect("a palette accent");

            model
                .change_setting(SettingKeyView::AccentColor, option.id.clone())
                .await
                .expect("the accent changes");

            session
                .wait_until("the accent", |model| model.appearance().accent.is_some())
                .await;
            let accent = model.appearance().accent.expect("an accent");
            assert_eq!(accent.light, option.light);
            assert_eq!(accent.dark, option.dark);
        });
    }

    #[test]
    fn moving_a_setting_to_this_device_changes_its_scope() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            assert_eq!(
                model.settings_view().map(|view| view.scopes.accent_color),
                Some(SettingScope::Synced)
            );

            model
                .set_setting_scope(ScopedSettingKey::AccentColor, SettingScope::Device)
                .await
                .expect("the scope changes");

            session
                .wait_until("the device scope", |model| {
                    model
                        .settings_view()
                        .is_some_and(|view| view.scopes.accent_color == SettingScope::Device)
                })
                .await;
        });
    }

    #[test]
    fn changing_vim_mode_updates_the_editor_settings() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let editor = Rc::new(Cell::new(0));
            model.connect_editor_settings_changed({
                let editor = editor.clone();
                move |_| editor.set(editor.get() + 1)
            });
            assert!(!model.vim_mode());

            model
                .change_setting(SettingKeyView::VimMode, "true".to_owned())
                .await
                .expect("vim mode changes");

            session
                .wait_until("vim mode", |model| model.vim_mode())
                .await;
            assert_eq!(editor.get(), 1);
        });
    }

    #[test]
    fn changing_the_note_font_updates_the_editor_settings() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let editor = count_signal(model, "editor-settings-changed");
            assert_eq!(model.note_font(), NoteFont::Inter);

            model
                .change_setting(SettingKeyView::NoteFont, "lora".to_owned())
                .await
                .expect("the note font changes");

            session
                .wait_until("the note font", |model| model.note_font() == NoteFont::Lora)
                .await;
            assert_eq!(editor.get(), 1);
        });
    }

    #[test]
    fn naming_the_device_follows_the_core_and_none_restores_the_automatic_name() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;

            let stored = model
                .set_device_name(Some("Work laptop".to_owned()))
                .await
                .expect("the name is stored");

            assert_eq!(stored, "Work laptop");
            session
                .wait_until("the device name", |model| {
                    model
                        .settings_view()
                        .is_some_and(|view| view.device_name == "Work laptop")
                })
                .await;

            let automatic = model
                .set_device_name(None)
                .await
                .expect("the automatic name returns");
            assert_eq!(automatic, "Linux");
            session
                .wait_until("the automatic name", |model| {
                    model
                        .settings_view()
                        .is_some_and(|view| view.device_name.is_empty())
                })
                .await;
        });
    }

    #[test]
    fn a_failed_save_can_be_retried() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let saves = save_changes(model);
            fail_commits(model, 50).await;

            model
                .change_setting(SettingKeyView::AccentColor, "teal".to_owned())
                .await
                .expect("the accent changes");
            model.flush_settings().await.expect("the flush is accepted");

            session
                .wait_until("the failed save", |model| {
                    model.settings_save().is_some_and(|save| {
                        save.state == SettingsSaveState::Failed && save.can_retry
                    })
                })
                .await;
            assert!(saves.get() >= 1);

            clear_commit_failures(model).await;
            model
                .retry_settings_save()
                .await
                .expect("the retry is accepted");
            session
                .wait_until("the saved settings", |model| {
                    save_state(model) == Some(SettingsSaveState::Synced)
                })
                .await;
        });
    }

    #[test]
    fn a_change_made_outside_the_model_still_reaches_it() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let settings = settings_changes(model);

            model
                .testing_send(
                    "settings.change",
                    json!({ "key": "newNotePlacement", "value": "end" }),
                )
                .await
                .expect("the core changes the setting");

            session
                .wait_until("the changed view", |model| {
                    model
                        .settings_view()
                        .is_some_and(|view| view.values.new_note_placement == "end")
                })
                .await;
            assert!(settings.get() >= 1);
        });
    }

    #[test]
    fn logging_out_clears_the_settings() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;
            let settings = settings_changes(model);
            let saves = save_changes(model);

            assert_eq!(model.log_out().await, Ok(LogOutResult::LoggedOut));

            session
                .wait_until("the cleared settings", |model| {
                    model.settings_copy().is_none() && model.route() == Route::Token
                })
                .await;
            assert!(model.settings_view().is_none());
            assert!(model.settings_save().is_none());
            assert!(settings.get() >= 1);
            assert!(saves.get() >= 1);
        });
    }

    #[test]
    fn flushing_saves_a_pending_change_without_waiting_for_the_debounce() {
        run(|| async {
            let session = ready_session().await;
            let model = &session.model;

            model
                .change_setting(SettingKeyView::AccentColor, "teal".to_owned())
                .await
                .expect("the accent changes");
            session
                .wait_until("the pending save", |model| {
                    save_state(model) == Some(SettingsSaveState::Pending)
                })
                .await;

            model.flush_settings().await.expect("the flush is accepted");

            session
                .wait_until("the saved settings", |model| {
                    save_state(model) == Some(SettingsSaveState::Synced)
                })
                .await;
        });
    }
}
