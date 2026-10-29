use std::cell::{Cell, OnceCell, RefCell};

use adw::prelude::*;
use adw::subclass::prelude::*;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use super::text::{CHECKING_MESSAGE, progress_message, visibility_label};
use crate::model::{AppModel, RepositoryChoice};

mod imp {
    use super::*;

    #[derive(Debug, Default, gtk::CompositeTemplate)]
    #[template(resource = "/io/github/marcinjahn/commitnote/ui/repository-list-page.ui")]
    pub struct RepositoryListPage {
        pub(super) model: OnceCell<AppModel>,
        pub(super) busy: Cell<bool>,
        pub(super) loading_handler: RefCell<Option<glib::SignalHandlerId>>,
        #[template_child]
        pub(super) repositories_group: TemplateChild<adw::PreferencesGroup>,
        #[template_child]
        pub(super) progress_box: TemplateChild<gtk::Box>,
        #[template_child]
        pub(super) progress_label: TemplateChild<gtk::Label>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for RepositoryListPage {
        const NAME: &'static str = "CommitnoteRepositoryListPage";
        type Type = super::RepositoryListPage;
        type ParentType = adw::NavigationPage;

        fn class_init(klass: &mut Self::Class) {
            klass.bind_template();
        }

        fn instance_init(obj: &glib::subclass::InitializingObject<Self>) {
            obj.init_template();
        }
    }

    impl ObjectImpl for RepositoryListPage {
        fn dispose(&self) {
            if let (Some(model), Some(id)) = (self.model.get(), self.loading_handler.take()) {
                model.disconnect(id);
            }
        }
    }
    impl WidgetImpl for RepositoryListPage {}
    impl NavigationPageImpl for RepositoryListPage {}
}

glib::wrapper! {
    pub struct RepositoryListPage(ObjectSubclass<imp::RepositoryListPage>)
        @extends adw::NavigationPage, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl RepositoryListPage {
    pub fn new(model: &AppModel, repositories: Vec<RepositoryChoice>) -> Self {
        let page: Self = glib::Object::new();
        let imp = page.imp();
        let _ = imp.model.set(model.clone());
        for (index, repository) in repositories.iter().enumerate() {
            imp.repositories_group
                .add(&page.repository_row(index, repository));
        }
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

    fn repository_row(&self, index: usize, repository: &RepositoryChoice) -> adw::ActionRow {
        let row = adw::ActionRow::builder()
            .title(repository.label.as_str())
            .use_markup(false)
            .activatable(true)
            .build();
        row.set_widget_name(&format!("repository-row-{index}"));
        row.add_suffix(
            &gtk::Label::builder()
                .label(visibility_label(repository.private))
                .css_classes(["dim-label"])
                .build(),
        );
        row.add_suffix(&gtk::Image::from_icon_name("go-next-symbolic"));
        let url = repository.url.clone();
        row.connect_activated({
            let page = self.downgrade();
            move |_| {
                if let Some(page) = page.upgrade() {
                    page.choose(url.clone());
                }
            }
        });
        row
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
        imp.repositories_group.set_sensitive(!busy);
        imp.progress_box.set_visible(busy);
        if busy {
            self.refresh_progress();
        }
    }

    fn choose(&self, url: String) {
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
            model.choose_repository(&url).await;
            if let Some(page) = page.upgrade() {
                page.set_busy(false);
            }
        });
    }
}
