use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::commands::{ShareActionId, ShareCopy, ShareRowView};
use gtk4::glib;
use libadwaita as adw;

use super::{share_prompts, share_row, shared_version_page};
use crate::model::AppModel;

const TOAST_TIMEOUT_SECONDS: u32 = 4;

pub struct ShareActions {
    model: AppModel,
    dialog: adw::Dialog,
    navigation: adw::NavigationView,
    toasts: adw::ToastOverlay,
}

impl ShareActions {
    pub fn new(
        model: &AppModel,
        dialog: &adw::Dialog,
        navigation: &adw::NavigationView,
        toasts: &adw::ToastOverlay,
    ) -> Rc<Self> {
        Rc::new(Self {
            model: model.clone(),
            dialog: dialog.clone(),
            navigation: navigation.clone(),
            toasts: toasts.clone(),
        })
    }

    pub fn handler(self: &Rc<Self>) -> share_row::ActionHandler {
        let this = Rc::downgrade(self);
        Rc::new(move |share, id| {
            if let Some(this) = this.upgrade() {
                this.perform(share, id);
            }
        })
    }

    pub fn toast(&self, message: &str) {
        self.toasts.add_toast(
            adw::Toast::builder()
                .title(message)
                .use_markup(false)
                .timeout(TOAST_TIMEOUT_SECONDS)
                .build(),
        );
    }

    fn perform(&self, share: &ShareRowView, id: ShareActionId) {
        let Some(copy) = self.model.share_copy() else {
            return;
        };
        match id {
            ShareActionId::CopyLink => {
                self.dialog.clipboard().set_text(&share.link);
                self.toast(&copy.link_copied);
            }
            ShareActionId::CopyPassword => {
                if let Some(password) = &share.password {
                    self.dialog.clipboard().set_text(password.expose());
                    self.toast(&copy.password_copied);
                }
            }
            ShareActionId::Update => {
                let (model, id) = (self.model.clone(), share.id.clone());
                glib::spawn_future_local(async move { model.update_share(id).await });
            }
            ShareActionId::View => self.show_shared_version(share, &copy),
            ShareActionId::Open => {
                if let Some(path) = &share.note_path {
                    self.model.open_note(Some(path.clone()));
                    self.dialog.close();
                }
            }
            ShareActionId::Rename => {
                share_prompts::rename(&self.dialog, &self.model, share, &copy);
            }
            ShareActionId::Revoke => {
                share_prompts::revoke(&self.dialog, &self.model, share, &copy);
            }
        }
    }

    fn show_shared_version(&self, share: &ShareRowView, copy: &ShareCopy) {
        if self
            .navigation
            .visible_page()
            .is_some_and(|page| page.widget_name() == shared_version_page::PAGE_NAME)
        {
            return;
        }
        self.navigation.push(&shared_version_page::page(
            &self.model,
            share.id.clone(),
            &share.title,
            copy,
        ));
    }
}
