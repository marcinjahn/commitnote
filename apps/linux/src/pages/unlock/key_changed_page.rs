use std::cell::{Cell, OnceCell, RefCell};

use adw::prelude::*;
use adw::subclass::prelude::*;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use crate::model::{AppModel, UserError};

mod imp {
    use super::*;

    #[derive(Debug, Default, gtk::CompositeTemplate)]
    #[template(resource = "/io/github/marcinjahn/commitnote/ui/key-changed-page.ui")]
    pub struct KeyChangedPage {
        #[template_child]
        pub(super) status_page: TemplateChild<adw::StatusPage>,
        #[template_child]
        pub(super) log_in_again_button: TemplateChild<gtk::Button>,
        #[template_child]
        pub(super) log_out_button: TemplateChild<gtk::Button>,
        #[template_child]
        pub(super) error_label: TemplateChild<gtk::Label>,
        pub(super) model: OnceCell<AppModel>,
        pub(super) busy: Cell<bool>,
        pub(super) route_handler: RefCell<Option<glib::SignalHandlerId>>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for KeyChangedPage {
        const NAME: &'static str = "CommitnoteKeyChangedPage";
        type Type = super::KeyChangedPage;
        type ParentType = adw::NavigationPage;

        fn class_init(klass: &mut Self::Class) {
            klass.bind_template();
        }

        fn instance_init(obj: &glib::subclass::InitializingObject<Self>) {
            obj.init_template();
        }
    }

    impl ObjectImpl for KeyChangedPage {
        fn dispose(&self) {
            if let (Some(model), Some(handler)) = (self.model.get(), self.route_handler.take()) {
                model.disconnect(handler);
            }
        }
    }

    impl WidgetImpl for KeyChangedPage {}
    impl NavigationPageImpl for KeyChangedPage {}
}

glib::wrapper! {
    pub struct KeyChangedPage(ObjectSubclass<imp::KeyChangedPage>)
        @extends adw::NavigationPage, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl KeyChangedPage {
    pub fn new(model: &AppModel) -> Self {
        let page: Self = glib::Object::new();
        let imp = page.imp();
        let _ = imp.model.set(model.clone());
        imp.log_in_again_button.connect_clicked(glib::clone!(
            #[weak(rename_to = page)]
            page,
            move |_| page.run(|model| async move { model.log_in_again().await })
        ));
        imp.log_out_button.connect_clicked(glib::clone!(
            #[weak(rename_to = page)]
            page,
            move |_| page.run(|model| async move { model.log_out_anyway().await })
        ));
        let handler = model.connect_route_changed(glib::clone!(
            #[weak(rename_to = page)]
            page,
            move |_| page.refresh()
        ));
        imp.route_handler.replace(Some(handler));
        page.refresh();
        page
    }

    fn model(&self) -> &AppModel {
        self.imp()
            .model
            .get()
            .expect("the page is created with a model")
    }

    fn refresh(&self) {
        let Some(view) = self.model().key_changed() else {
            return;
        };
        let status = &self.imp().status_page;
        status.set_title(&view.message);
        status.set_description(Some(&glib::markup_escape_text(&view.detail)));
    }

    fn set_busy(&self, busy: bool) {
        let imp = self.imp();
        imp.busy.set(busy);
        imp.log_in_again_button.set_sensitive(!busy);
        imp.log_out_button.set_sensitive(!busy);
    }

    fn run<F, Fut>(&self, action: F)
    where
        F: FnOnce(AppModel) -> Fut,
        Fut: std::future::Future<Output = Result<(), UserError>> + 'static,
    {
        if self.imp().busy.get() {
            return;
        }
        self.imp().error_label.set_visible(false);
        self.set_busy(true);
        let future = action(self.model().clone());
        glib::spawn_future_local(glib::clone!(
            #[weak(rename_to = page)]
            self,
            async move {
                let result = future.await;
                page.set_busy(false);
                if let Err(error) = result {
                    let label = &page.imp().error_label;
                    label.set_text(&error.message);
                    label.set_visible(true);
                }
            }
        ));
    }
}
