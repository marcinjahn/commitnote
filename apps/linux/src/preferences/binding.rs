use std::cell::{Cell, OnceCell};
use std::future::Future;
use std::rc::Rc;

use commitnote_core_api::settings::{ScopedSettingKey, SettingKeyView, SettingScope};
use gtk4::glib;

use crate::model::{AppModel, UserError};

/// Carries the changes the user makes in the dialog's controls to the model.
pub(super) struct Binding {
    model: AppModel,
    showing_view: Cell<bool>,
    restore_view: OnceCell<Box<dyn Fn()>>,
}

impl Binding {
    pub(super) fn new(model: &AppModel) -> Rc<Self> {
        Rc::new(Self {
            model: model.clone(),
            showing_view: Cell::new(false),
            restore_view: OnceCell::new(),
        })
    }

    pub(super) fn model(&self) -> &AppModel {
        &self.model
    }

    /// Sets how the controls show the core's view again after a request fails.
    pub(super) fn on_failure(&self, restore_view: impl Fn() + 'static) {
        let _ = self.restore_view.set(Box::new(restore_view));
    }

    /// Runs `show` with every change handler muted, so showing the core's view sends nothing
    /// back to it.
    pub(super) fn showing_view(&self, show: impl FnOnce()) {
        let outer = self.showing_view.replace(true);
        show();
        self.showing_view.set(outer);
    }

    pub(super) fn change(self: &Rc<Self>, key: SettingKeyView, value: impl Into<String>) {
        let value = value.into();
        self.send(move |model| async move { model.change_setting(key, value).await });
    }

    pub(super) fn set_scope(self: &Rc<Self>, key: ScopedSettingKey, scope: SettingScope) {
        self.send(move |model| async move { model.set_setting_scope(key, scope).await });
    }

    /// Sends a change the user made, unless the controls are showing the core's view. A failure
    /// shows as a toast and the controls show the core's view again.
    pub(super) fn send<Request, Response, T>(self: &Rc<Self>, request: Request)
    where
        Request: FnOnce(AppModel) -> Response,
        Response: Future<Output = Result<T, UserError>> + 'static,
    {
        if self.showing_view.get() {
            return;
        }
        let response = request(self.model.clone());
        let model = self.model.clone();
        let binding = Rc::downgrade(self);
        glib::spawn_future_local(async move {
            let Err(error) = response.await else {
                return;
            };
            model.report_error(&error);
            if let Some(restore_view) = binding
                .upgrade()
                .as_ref()
                .and_then(|binding| binding.restore_view.get())
            {
                restore_view();
            }
        });
    }
}
