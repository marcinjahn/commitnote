use std::cell::{Cell, OnceCell, RefCell};

use adw::prelude::*;
use adw::subclass::prelude::*;
use commitnote_core_api::Secret;
use commitnote_core_api::shapes::ForgeView;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use super::open_uri;
use super::text::{
    BLANK_TOKEN_MESSAGE, LISTING_MESSAGE, NEW_REPOSITORY_NOTE, NEW_REPOSITORY_PHRASE, draft_token,
    forge_id, is_blank, linked_markup, preferred_forge_index, progress_message, token_error_text,
    token_link_text,
};
use crate::config;
use crate::model::{AppModel, GENERIC_ERROR_MESSAGE};
use crate::pages::{secret_text, set_secret_text};

mod imp {
    use super::*;

    #[derive(Debug, Default, gtk::CompositeTemplate)]
    #[template(resource = "/io/github/marcinjahn/commitnote/ui/token-page.ui")]
    pub struct TokenPage {
        pub(super) model: OnceCell<AppModel>,
        pub(super) forges: RefCell<Vec<ForgeView>>,
        pub(super) busy: Cell<bool>,
        pub(super) loading_handler: RefCell<Option<glib::SignalHandlerId>>,
        #[template_child]
        pub(super) app_icon: TemplateChild<gtk::Image>,
        #[template_child]
        pub(super) forge_group: TemplateChild<adw::PreferencesGroup>,
        #[template_child]
        pub(super) forge_toggle: TemplateChild<adw::ToggleGroup>,
        #[template_child]
        pub(super) token_group: TemplateChild<adw::PreferencesGroup>,
        #[template_child]
        pub(super) token_row: TemplateChild<adw::PasswordEntryRow>,
        #[template_child]
        pub(super) error_label: TemplateChild<gtk::Label>,
        #[template_child]
        pub(super) token_link: TemplateChild<gtk::Label>,
        #[template_child]
        pub(super) repository_note: TemplateChild<gtk::Label>,
        #[template_child]
        pub(super) progress_box: TemplateChild<gtk::Box>,
        #[template_child]
        pub(super) progress_label: TemplateChild<gtk::Label>,
        #[template_child]
        pub(super) continue_button: TemplateChild<gtk::Button>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for TokenPage {
        const NAME: &'static str = "CommitnoteTokenPage";
        type Type = super::TokenPage;
        type ParentType = adw::NavigationPage;

        fn class_init(klass: &mut Self::Class) {
            klass.bind_template();
        }

        fn instance_init(obj: &glib::subclass::InitializingObject<Self>) {
            obj.init_template();
        }
    }

    impl ObjectImpl for TokenPage {
        fn dispose(&self) {
            if let (Some(model), Some(id)) = (self.model.get(), self.loading_handler.take()) {
                model.disconnect(id);
            }
        }
    }
    impl WidgetImpl for TokenPage {}
    impl NavigationPageImpl for TokenPage {}
}

glib::wrapper! {
    pub struct TokenPage(ObjectSubclass<imp::TokenPage>)
        @extends adw::NavigationPage, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl TokenPage {
    pub fn new(model: &AppModel) -> Self {
        let page: Self = glib::Object::new();
        let _ = page.imp().model.set(model.clone());
        page.populate();
        page.connect_signals();
        if let Some(message) = model.token_page_error() {
            page.show_error(&message);
        }
        page
    }

    fn model(&self) -> AppModel {
        self.imp()
            .model
            .get()
            .expect("the model is set on construction")
            .clone()
    }

    fn populate(&self) {
        let imp = self.imp();
        let model = self.model();
        imp.app_icon
            .set_icon_name(Some(&format!("{}-symbolic", config::APP_ID)));

        let forges = model.forges();
        for forge in &forges {
            let toggle = adw::Toggle::builder()
                .name(forge_id(forge.id))
                .label(forge.name.as_str())
                .build();
            imp.forge_toggle.add(toggle);
        }
        imp.forge_group.set_visible(forges.len() > 1);

        let ids: Vec<&str> = forges.iter().map(|forge| forge_id(forge.id)).collect();
        let draft = model.login_draft();
        let last_forge = model.last_repository().map(|(_, forge)| forge);
        let index = preferred_forge_index(&ids, [last_forge.as_deref(), draft.forge.as_deref()])
            .unwrap_or(0);
        if let Some(&id) = ids.get(index) {
            imp.forge_toggle.set_active_name(Some(id));
            let token = draft_token(
                draft.forge.as_deref(),
                draft.token.as_ref().map(Secret::expose),
                id,
            );
            set_secret_text(&*imp.token_row, token);
        }
        imp.forges.replace(forges);
        self.show_forge_details();
    }

    fn connect_signals(&self) {
        let imp = self.imp();

        imp.forge_toggle.connect_active_name_notify({
            let page = self.downgrade();
            move |_| {
                if let Some(page) = page.upgrade() {
                    page.forge_changed();
                }
            }
        });
        imp.token_row.connect_changed({
            let page = self.downgrade();
            move |_| {
                if let Some(page) = page.upgrade() {
                    page.token_edited();
                }
            }
        });
        imp.token_row.connect_entry_activated({
            let page = self.downgrade();
            move |_| {
                if let Some(page) = page.upgrade() {
                    page.submit();
                }
            }
        });
        imp.continue_button.connect_clicked({
            let page = self.downgrade();
            move |_| {
                if let Some(page) = page.upgrade() {
                    page.submit();
                }
            }
        });
        for label in [&*imp.token_link, &*imp.repository_note] {
            label.connect_activate_link(|label, uri| {
                open_uri(label, uri);
                glib::Propagation::Stop
            });
        }
        let handler = self.model().connect_loading_message_changed({
            let page = self.downgrade();
            move |_| {
                if let Some(page) = page.upgrade()
                    && page.imp().busy.get()
                {
                    page.refresh_progress();
                }
            }
        });
        imp.loading_handler.replace(Some(handler));
        self.connect_shown(|page| {
            let imp = page.imp();
            imp.token_row.grab_focus();
            if imp.error_label.is_visible() {
                imp.error_label.announce(
                    &imp.error_label.label(),
                    gtk::AccessibleAnnouncementPriority::High,
                );
            }
        });
    }

    fn selected_forge(&self) -> Option<ForgeView> {
        let imp = self.imp();
        let active = imp.forge_toggle.active_name()?;
        imp.forges
            .borrow()
            .iter()
            .find(|forge| forge_id(forge.id) == active)
            .cloned()
    }

    fn show_forge_details(&self) {
        let imp = self.imp();
        let forge = self.selected_forge();
        imp.token_link.set_visible(forge.is_some());
        imp.repository_note.set_visible(forge.is_some());
        let Some(forge) = forge else {
            imp.token_group.set_description(None);
            return;
        };
        imp.token_group
            .set_description(Some(&glib::markup_escape_text(&forge.access_token_hint)));
        let link_text = token_link_text(&forge.name);
        imp.token_link.set_markup(&linked_markup(
            &link_text,
            &link_text,
            &forge.access_token_creation_url,
        ));
        imp.repository_note.set_markup(&linked_markup(
            NEW_REPOSITORY_NOTE,
            NEW_REPOSITORY_PHRASE,
            &forge.repository_creation_url,
        ));
    }

    fn forge_changed(&self) {
        let imp = self.imp();
        self.clear_error();
        self.show_forge_details();
        imp.token_row.set_text("");
        if let Some(forge) = self.selected_forge() {
            self.model()
                .set_login_draft(forge_id(forge.id), Secret::new(""));
        }
    }

    fn token_edited(&self) {
        self.clear_error();
        if let Some(forge) = self.selected_forge() {
            self.model()
                .set_login_draft(forge_id(forge.id), secret_text(&*self.imp().token_row));
        }
    }

    fn show_error(&self, message: &str) {
        let label = &self.imp().error_label;
        label.set_label(message);
        label.set_visible(true);
        if label.root().is_some() {
            label.announce(message, gtk::AccessibleAnnouncementPriority::High);
        }
    }

    fn clear_error(&self) {
        let label = &self.imp().error_label;
        label.set_visible(false);
        label.set_label("");
    }

    fn refresh_progress(&self) {
        self.imp().progress_label.set_label(&progress_message(
            self.model().loading_message(),
            LISTING_MESSAGE,
        ));
    }

    fn set_busy(&self, busy: bool) {
        let imp = self.imp();
        imp.busy.set(busy);
        imp.token_row.set_sensitive(!busy);
        imp.continue_button.set_sensitive(!busy);
        imp.forge_toggle.set_sensitive(!busy);
        imp.progress_box.set_visible(busy);
        if busy {
            self.refresh_progress();
        }
    }

    fn submit(&self) {
        let imp = self.imp();
        if imp.busy.get() {
            return;
        }
        let token = secret_text(&*imp.token_row);
        if is_blank(token.expose()) {
            self.show_error(BLANK_TOKEN_MESSAGE);
            imp.token_row.grab_focus();
            return;
        }
        let Some(forge) = self.selected_forge() else {
            self.show_error(GENERIC_ERROR_MESSAGE);
            return;
        };
        self.clear_error();
        self.set_busy(true);
        let model = self.model();
        let page = self.downgrade();
        glib::spawn_future_local(async move {
            let result = model.submit_token(forge_id(forge.id), token).await;
            let Some(page) = page.upgrade() else {
                return;
            };
            page.set_busy(false);
            if let Err(error) = result {
                page.show_error(&token_error_text(&error, &forge.name));
                page.imp().token_row.grab_focus();
            }
        });
    }
}
