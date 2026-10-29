use std::cell::{Cell, OnceCell, RefCell};

use adw::prelude::*;
use adw::subclass::prelude::*;
use commitnote_core_api::shapes::RepositoryView;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use super::forms::validate_unlock;
use crate::model::{AppModel, UnlockError};
use crate::pages::secret_text;

mod imp {
    use super::*;

    #[derive(Debug, Default, gtk::CompositeTemplate)]
    #[template(resource = "/io/github/marcinjahn/commitnote/ui/unlock-page.ui")]
    pub struct UnlockPage {
        #[template_child]
        pub(super) warning_group: TemplateChild<adw::PreferencesGroup>,
        #[template_child]
        pub(super) warning_row: TemplateChild<adw::ActionRow>,
        #[template_child]
        pub(super) repository_row: TemplateChild<adw::ActionRow>,
        #[template_child]
        pub(super) passphrase_row: TemplateChild<adw::PasswordEntryRow>,
        #[template_child]
        pub(super) remember_row: TemplateChild<adw::SwitchRow>,
        #[template_child]
        pub(super) progress_group: TemplateChild<adw::PreferencesGroup>,
        #[template_child]
        pub(super) progress_row: TemplateChild<adw::ActionRow>,
        #[template_child]
        pub(super) error_label: TemplateChild<gtk::Label>,
        #[template_child]
        pub(super) unlock_button: TemplateChild<gtk::Button>,
        pub(super) model: OnceCell<AppModel>,
        pub(super) repository: OnceCell<RepositoryView>,
        pub(super) busy: Cell<bool>,
        pub(super) loading_handler: RefCell<Option<glib::SignalHandlerId>>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for UnlockPage {
        const NAME: &'static str = "CommitnoteUnlockPage";
        type Type = super::UnlockPage;
        type ParentType = adw::NavigationPage;

        fn class_init(klass: &mut Self::Class) {
            klass.bind_template();
        }

        fn instance_init(obj: &glib::subclass::InitializingObject<Self>) {
            obj.init_template();
        }
    }

    impl ObjectImpl for UnlockPage {
        fn dispose(&self) {
            if let (Some(model), Some(handler)) = (self.model.get(), self.loading_handler.take()) {
                model.disconnect(handler);
            }
        }
    }

    impl WidgetImpl for UnlockPage {}
    impl NavigationPageImpl for UnlockPage {}
}

glib::wrapper! {
    pub struct UnlockPage(ObjectSubclass<imp::UnlockPage>)
        @extends adw::NavigationPage, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl UnlockPage {
    pub fn new(model: &AppModel, repository: RepositoryView) -> Self {
        let page: Self = glib::Object::new();
        let imp = page.imp();
        let _ = imp.model.set(model.clone());
        imp.repository_row.set_subtitle(&repository.label);
        if let Some(warning) = &repository.public_warning {
            imp.warning_row.set_title(warning);
            imp.warning_group.set_visible(true);
        }
        let _ = imp.repository.set(repository);
        page.connect_signals();
        page
    }

    fn model(&self) -> &AppModel {
        self.imp()
            .model
            .get()
            .expect("the page is created with a model")
    }

    fn connect_signals(&self) {
        let imp = self.imp();
        imp.passphrase_row.connect_entry_activated(glib::clone!(
            #[weak(rename_to = page)]
            self,
            move |_| page.submit()
        ));
        imp.unlock_button.connect_clicked(glib::clone!(
            #[weak(rename_to = page)]
            self,
            move |_| page.submit()
        ));
        self.connect_map(|page| {
            page.imp().passphrase_row.grab_focus();
        });
        let handler = self.model().connect_loading_message_changed(glib::clone!(
            #[weak(rename_to = page)]
            self,
            move |_| page.show_progress()
        ));
        imp.loading_handler.replace(Some(handler));
    }

    fn show_progress(&self) {
        let imp = self.imp();
        let message = self
            .model()
            .loading_message()
            .unwrap_or_else(|| "Unlocking…".to_owned());
        imp.progress_row.set_title(&message);
    }

    fn set_busy(&self, busy: bool) {
        let imp = self.imp();
        imp.busy.set(busy);
        imp.passphrase_row.set_sensitive(!busy);
        imp.remember_row.set_sensitive(!busy);
        imp.unlock_button.set_sensitive(!busy);
        imp.progress_group.set_visible(busy);
        if busy {
            self.show_progress();
        }
    }

    fn show_error(&self, message: &str) {
        let label = &self.imp().error_label;
        label.set_text(message);
        label.set_visible(true);
    }

    fn submit(&self) {
        let imp = self.imp();
        if imp.busy.get() {
            return;
        }
        let passphrase = secret_text(&*imp.passphrase_row);
        if let Err(message) = validate_unlock(passphrase.expose()) {
            self.show_error(message);
            return;
        }
        imp.error_label.set_visible(false);
        self.set_busy(true);
        let remember = imp.remember_row.is_active();
        let model = self.model().clone();
        glib::spawn_future_local(glib::clone!(
            #[weak(rename_to = page)]
            self,
            async move {
                let result = model.unlock(passphrase, remember).await;
                page.finish(result);
            }
        ));
    }

    fn finish(&self, result: Result<(), UnlockError>) {
        let imp = self.imp();
        self.set_busy(false);
        match result {
            Ok(()) | Err(UnlockError::Routed) => imp.passphrase_row.set_text(""),
            Err(UnlockError::Retry {
                message,
                wrong_passphrase,
            }) => {
                self.show_error(&message);
                if wrong_passphrase {
                    imp.passphrase_row.set_text("");
                    imp.passphrase_row.grab_focus();
                }
            }
        }
    }
}
