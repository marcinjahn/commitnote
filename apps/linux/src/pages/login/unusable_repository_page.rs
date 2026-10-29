use std::cell::{Cell, OnceCell, RefCell};

use adw::prelude::*;
use adw::subclass::prelude::*;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use super::open_uri;
use super::text::{
    CHECKING_MESSAGE, FOREIGN_HINT_PHRASE, forge_id, linked_markup, preferred_forge_index,
    progress_message,
};
use crate::model::{AppModel, UnusableOutcome};

mod imp {
    use super::*;

    #[derive(Debug, Default, gtk::CompositeTemplate)]
    #[template(resource = "/io/github/marcinjahn/commitnote/ui/unusable-repository-page.ui")]
    pub struct UnusableRepositoryPage {
        pub(super) model: OnceCell<AppModel>,
        pub(super) busy: Cell<bool>,
        pub(super) loading_handler: RefCell<Option<glib::SignalHandlerId>>,
        #[template_child]
        pub(super) repository_row: TemplateChild<adw::ActionRow>,
        #[template_child]
        pub(super) error_label: TemplateChild<gtk::Label>,
        #[template_child]
        pub(super) hint_label: TemplateChild<gtk::Label>,
        #[template_child]
        pub(super) progress_box: TemplateChild<gtk::Box>,
        #[template_child]
        pub(super) progress_label: TemplateChild<gtk::Label>,
        #[template_child]
        pub(super) check_again_button: TemplateChild<gtk::Button>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for UnusableRepositoryPage {
        const NAME: &'static str = "CommitnoteUnusableRepositoryPage";
        type Type = super::UnusableRepositoryPage;
        type ParentType = adw::NavigationPage;

        fn class_init(klass: &mut Self::Class) {
            klass.bind_template();
        }

        fn instance_init(obj: &glib::subclass::InitializingObject<Self>) {
            obj.init_template();
        }
    }

    impl ObjectImpl for UnusableRepositoryPage {
        fn dispose(&self) {
            if let (Some(model), Some(id)) = (self.model.get(), self.loading_handler.take()) {
                model.disconnect(id);
            }
        }
    }
    impl WidgetImpl for UnusableRepositoryPage {}
    impl NavigationPageImpl for UnusableRepositoryPage {}
}

glib::wrapper! {
    pub struct UnusableRepositoryPage(ObjectSubclass<imp::UnusableRepositoryPage>)
        @extends adw::NavigationPage, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl UnusableRepositoryPage {
    pub fn new(model: &AppModel, outcome: UnusableOutcome) -> Self {
        let page: Self = glib::Object::new();
        let imp = page.imp();
        let _ = imp.model.set(model.clone());

        imp.repository_row.set_title(&outcome.repository.label);
        imp.error_label.set_label(&outcome.error.message);
        if let Some(hint) = &outcome.foreign_hint {
            imp.hint_label.set_markup(&linked_markup(
                hint,
                FOREIGN_HINT_PHRASE,
                &page.creation_url(model),
            ));
            imp.hint_label.set_visible(true);
        }
        imp.check_again_button.set_visible(outcome.can_check_again);

        imp.hint_label.connect_activate_link(|label, uri| {
            open_uri(label, uri);
            glib::Propagation::Stop
        });
        imp.check_again_button.connect_clicked({
            let page = page.downgrade();
            move |_| {
                if let Some(page) = page.upgrade() {
                    page.check_again();
                }
            }
        });
        let handler = model.connect_loading_message_changed({
            let page = page.downgrade();
            move |_| {
                if let Some(page) = page.upgrade()
                    && page.imp().busy.get()
                {
                    page.refresh_progress();
                }
            }
        });
        imp.loading_handler.replace(Some(handler));
        page
    }

    fn creation_url(&self, model: &AppModel) -> String {
        let forges = model.forges();
        let ids: Vec<&str> = forges.iter().map(|forge| forge_id(forge.id)).collect();
        let draft = model.login_draft();
        let last_forge = model.last_repository().map(|(_, forge)| forge);
        preferred_forge_index(&ids, [draft.forge.as_deref(), last_forge.as_deref()])
            .map(|index| forges[index].repository_creation_url.clone())
            .unwrap_or_default()
    }

    fn refresh_progress(&self) {
        let imp = self.imp();
        let message = imp.model.get().and_then(AppModel::loading_message);
        imp.progress_label
            .set_label(&progress_message(message, CHECKING_MESSAGE));
    }

    fn set_busy(&self, busy: bool) {
        let imp = self.imp();
        imp.busy.set(busy);
        imp.check_again_button.set_sensitive(!busy);
        imp.progress_box.set_visible(busy);
        if busy {
            self.refresh_progress();
        }
    }

    fn check_again(&self) {
        let imp = self.imp();
        if imp.busy.get() {
            return;
        }
        let Some(model) = imp.model.get().cloned() else {
            return;
        };
        self.set_busy(true);
        let page = self.downgrade();
        glib::spawn_future_local(async move {
            model.check_again().await;
            if let Some(page) = page.upgrade() {
                page.set_busy(false);
            }
        });
    }
}
