use std::cell::{Cell, OnceCell, RefCell};
use std::sync::Once;

use adw::prelude::*;
use adw::subclass::prelude::*;
use commitnote_core_api::shapes::{PassphraseStrength, RepositoryView};
use gtk4::{self as gtk, gdk, glib};
use libadwaita as adw;

use super::forms::{LatestRequest, STRENGTH_DEBOUNCE, strength_text, validate_initialize};
use crate::model::{AppModel, UnlockError};
use crate::pages::secret_text;

const STRENGTH_STYLE: &str = "
levelbar.passphrase-strength > trough > block:not(.empty) {
  background-color: var(--accent-bg-color);
}
levelbar.passphrase-strength.weak > trough > block:not(.empty) {
  background-color: var(--error-bg-color);
}
";

fn install_strength_style() {
    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| {
        let Some(display) = gdk::Display::default() else {
            return;
        };
        let provider = gtk::CssProvider::new();
        provider.load_from_string(STRENGTH_STYLE);
        gtk::style_context_add_provider_for_display(
            &display,
            &provider,
            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
    });
}

mod imp {
    use super::*;

    #[derive(Debug, Default, gtk::CompositeTemplate)]
    #[template(resource = "/io/github/marcinjahn/commitnote/ui/initialize-page.ui")]
    pub struct InitializePage {
        #[template_child]
        pub(super) warning_group: TemplateChild<adw::PreferencesGroup>,
        #[template_child]
        pub(super) warning_row: TemplateChild<adw::ActionRow>,
        #[template_child]
        pub(super) description_label: TemplateChild<gtk::Label>,
        #[template_child]
        pub(super) repository_row: TemplateChild<adw::ActionRow>,
        #[template_child]
        pub(super) passphrase_row: TemplateChild<adw::PasswordEntryRow>,
        #[template_child]
        pub(super) strength_box: TemplateChild<gtk::Box>,
        #[template_child]
        pub(super) strength_bar: TemplateChild<gtk::LevelBar>,
        #[template_child]
        pub(super) strength_label: TemplateChild<gtk::Label>,
        #[template_child]
        pub(super) repeat_row: TemplateChild<adw::PasswordEntryRow>,
        #[template_child]
        pub(super) remember_row: TemplateChild<adw::SwitchRow>,
        #[template_child]
        pub(super) progress_group: TemplateChild<adw::PreferencesGroup>,
        #[template_child]
        pub(super) progress_row: TemplateChild<adw::ActionRow>,
        #[template_child]
        pub(super) error_label: TemplateChild<gtk::Label>,
        #[template_child]
        pub(super) init_button: TemplateChild<gtk::Button>,
        pub(super) model: OnceCell<AppModel>,
        pub(super) repository: OnceCell<RepositoryView>,
        pub(super) busy: Cell<bool>,
        pub(super) strength_requests: LatestRequest,
        pub(super) loading_handler: RefCell<Option<glib::SignalHandlerId>>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for InitializePage {
        const NAME: &'static str = "CommitnoteInitializePage";
        type Type = super::InitializePage;
        type ParentType = adw::NavigationPage;

        fn class_init(klass: &mut Self::Class) {
            klass.bind_template();
        }

        fn instance_init(obj: &glib::subclass::InitializingObject<Self>) {
            obj.init_template();
        }
    }

    impl ObjectImpl for InitializePage {
        fn constructed(&self) {
            self.parent_constructed();
            install_strength_style();
        }

        fn dispose(&self) {
            if let (Some(model), Some(handler)) = (self.model.get(), self.loading_handler.take()) {
                model.disconnect(handler);
            }
        }
    }

    impl WidgetImpl for InitializePage {}
    impl NavigationPageImpl for InitializePage {}
}

glib::wrapper! {
    pub struct InitializePage(ObjectSubclass<imp::InitializePage>)
        @extends adw::NavigationPage, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl InitializePage {
    pub fn new(model: &AppModel, repository: RepositoryView, set_up_description: String) -> Self {
        let page: Self = glib::Object::new();
        let imp = page.imp();
        let _ = imp.model.set(model.clone());
        imp.repository_row.set_subtitle(&repository.label);
        imp.description_label.set_text(&set_up_description);
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
        imp.passphrase_row.connect_changed(glib::clone!(
            #[weak(rename_to = page)]
            self,
            move |_| page.passphrase_changed()
        ));
        imp.passphrase_row.connect_entry_activated(glib::clone!(
            #[weak(rename_to = page)]
            self,
            move |_| {
                page.imp().repeat_row.grab_focus();
            }
        ));
        imp.repeat_row.connect_entry_activated(glib::clone!(
            #[weak(rename_to = page)]
            self,
            move |_| page.submit()
        ));
        imp.init_button.connect_clicked(glib::clone!(
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

    fn passphrase_changed(&self) {
        let imp = self.imp();
        let generation = imp.strength_requests.begin();
        if secret_text(&*imp.passphrase_row).expose().is_empty() {
            imp.strength_box.set_visible(false);
            return;
        }
        glib::timeout_add_local_once(
            STRENGTH_DEBOUNCE,
            glib::clone!(
                #[weak(rename_to = page)]
                self,
                move || page.request_strength(generation)
            ),
        );
    }

    fn request_strength(&self, generation: u64) {
        let imp = self.imp();
        if !imp.strength_requests.is_current(generation) {
            return;
        }
        let passphrase = secret_text(&*imp.passphrase_row);
        let label = imp
            .repository
            .get()
            .map(|repository| repository.label.clone())
            .unwrap_or_default();
        let model = self.model().clone();
        glib::spawn_future_local(glib::clone!(
            #[weak(rename_to = page)]
            self,
            async move {
                let result = model.passphrase_strength(passphrase, &label).await;
                let imp = page.imp();
                if let Ok(strength) = result
                    && imp.strength_requests.is_current(generation)
                {
                    page.show_strength(&strength);
                }
            }
        ));
    }

    fn show_strength(&self, strength: &PassphraseStrength) {
        let imp = self.imp();
        imp.strength_bar
            .set_value(f64::from(strength.filled_segments));
        if strength.weak {
            imp.strength_bar.add_css_class("weak");
        } else {
            imp.strength_bar.remove_css_class("weak");
        }
        imp.strength_label.set_text(&strength_text(strength));
        imp.strength_box.set_visible(true);
    }

    fn show_progress(&self) {
        let message = self
            .model()
            .loading_message()
            .unwrap_or_else(|| "Setting up…".to_owned());
        self.imp().progress_row.set_title(&message);
    }

    fn set_busy(&self, busy: bool) {
        let imp = self.imp();
        imp.busy.set(busy);
        imp.passphrase_row.set_sensitive(!busy);
        imp.repeat_row.set_sensitive(!busy);
        imp.remember_row.set_sensitive(!busy);
        imp.init_button.set_sensitive(!busy);
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
        let repeated = secret_text(&*imp.repeat_row);
        if let Err(message) = validate_initialize(passphrase.expose(), repeated.expose()) {
            self.show_error(message);
            return;
        }
        drop(repeated);
        imp.error_label.set_visible(false);
        self.set_busy(true);
        let remember = imp.remember_row.is_active();
        let model = self.model().clone();
        glib::spawn_future_local(glib::clone!(
            #[weak(rename_to = page)]
            self,
            async move {
                let result = model.initialize(passphrase, remember).await;
                page.finish(result);
            }
        ));
    }

    fn clear_entries(&self) {
        let imp = self.imp();
        imp.passphrase_row.set_text("");
        imp.repeat_row.set_text("");
    }

    fn finish(&self, result: Result<(), UnlockError>) {
        self.set_busy(false);
        match result {
            Ok(()) | Err(UnlockError::Routed) => self.clear_entries(),
            Err(UnlockError::Retry {
                message,
                wrong_passphrase,
            }) => {
                self.show_error(&message);
                if wrong_passphrase {
                    self.clear_entries();
                    self.imp().passphrase_row.grab_focus();
                }
            }
        }
    }
}
