use std::cell::{Cell, OnceCell, RefCell};

use adw::prelude::*;
use adw::subclass::prelude::*;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use crate::model::{AppModel, Route};

const IN_PROGRESS_MESSAGE: &str = "Loading…";

mod imp {
    use super::*;

    #[derive(Debug, Default, gtk::CompositeTemplate)]
    #[template(resource = "/io/github/marcinjahn/commitnote/ui/loading-page.ui")]
    pub struct LoadingPage {
        #[template_child]
        pub(super) status_page: TemplateChild<adw::StatusPage>,
        #[template_child]
        pub(super) spinner: TemplateChild<adw::Spinner>,
        #[template_child]
        pub(super) early_draft_name_entry: TemplateChild<gtk::Entry>,
        #[template_child]
        pub(super) early_draft_body: TemplateChild<gtk::TextView>,
        #[template_child]
        pub(super) try_again_button: TemplateChild<gtk::Button>,
        #[template_child]
        pub(super) log_in_button: TemplateChild<gtk::Button>,
        #[template_child]
        #[cfg_attr(not(feature = "testing"), allow(dead_code))]
        pub(super) actions: TemplateChild<gtk::Box>,
        #[cfg(feature = "testing")]
        pub(super) finish_loading_button: OnceCell<gtk::Button>,
        pub(super) model: OnceCell<AppModel>,
        pub(super) handlers: RefCell<Vec<glib::SignalHandlerId>>,
        pub(super) syncing: Cell<bool>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for LoadingPage {
        const NAME: &'static str = "CommitnoteLoadingPage";
        type Type = super::LoadingPage;
        type ParentType = adw::NavigationPage;

        fn class_init(klass: &mut Self::Class) {
            klass.bind_template();
        }

        fn instance_init(obj: &glib::subclass::InitializingObject<Self>) {
            obj.init_template();
        }
    }

    impl ObjectImpl for LoadingPage {
        fn dispose(&self) {
            if let Some(model) = self.model.get() {
                for handler in self.handlers.take() {
                    model.disconnect(handler);
                }
            }
        }
    }

    impl WidgetImpl for LoadingPage {}
    impl NavigationPageImpl for LoadingPage {}
}

glib::wrapper! {
    pub struct LoadingPage(ObjectSubclass<imp::LoadingPage>)
        @extends adw::NavigationPage, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl LoadingPage {
    pub fn new(model: &AppModel) -> Self {
        let page: Self = glib::Object::new();
        let imp = page.imp();
        let _ = imp.model.set(model.clone());
        imp.try_again_button.connect_clicked(glib::clone!(
            #[weak]
            model,
            move |_| model.retry_resume()
        ));
        imp.log_in_button.connect_clicked(glib::clone!(
            #[weak]
            model,
            move |_| model.show_login()
        ));
        let route = model.connect_route_changed(glib::clone!(
            #[weak(rename_to = page)]
            page,
            move |_| page.refresh()
        ));
        let message = model.connect_loading_message_changed(glib::clone!(
            #[weak(rename_to = page)]
            page,
            move |_| page.refresh()
        ));
        let early_draft = model.connect_early_draft_changed(glib::clone!(
            #[weak(rename_to = page)]
            page,
            move |_| page.sync_early_draft()
        ));
        imp.handlers.replace(vec![route, message, early_draft]);
        page.setup_early_draft(model);
        #[cfg(feature = "testing")]
        page.add_finish_loading_button();
        page.refresh();
        page
    }

    pub fn focus_name(&self) {
        self.imp().early_draft_name_entry.grab_focus();
    }

    fn setup_early_draft(&self, model: &AppModel) {
        let model = model.clone();
        let imp = self.imp();
        imp.early_draft_name_entry.connect_changed(glib::clone!(
            #[weak(rename_to = page)]
            self,
            #[weak]
            model,
            move |entry| {
                if !page.imp().syncing.get() {
                    model.set_early_draft_name(entry.text().to_string());
                }
            }
        ));
        imp.early_draft_name_entry.connect_activate(glib::clone!(
            #[weak(rename_to = page)]
            self,
            #[weak]
            model,
            move |_| {
                model.confirm_early_draft_name();
                page.imp().early_draft_body.grab_focus();
            }
        ));
        imp.early_draft_body.buffer().connect_changed(glib::clone!(
            #[weak(rename_to = page)]
            self,
            #[weak]
            model,
            move |buffer| {
                if !page.imp().syncing.get() {
                    let (start, end) = buffer.bounds();
                    model.set_early_draft_body(buffer.text(&start, &end, false).to_string());
                }
            }
        ));
    }

    fn sync_early_draft(&self) {
        let imp = self.imp();
        let model = imp.model.get().expect("the page is created with a model");
        let early = model.early_draft();
        imp.syncing.set(true);
        if imp.early_draft_name_entry.text() != early.name {
            imp.early_draft_name_entry.set_text(&early.name);
        }
        let buffer = imp.early_draft_body.buffer();
        let (start, end) = buffer.bounds();
        if buffer.text(&start, &end, false) != early.body {
            buffer.set_text(&early.body);
        }
        imp.syncing.set(false);
        let editable = !model.handing_off();
        imp.early_draft_name_entry.set_editable(editable);
        imp.early_draft_body.set_editable(editable);
    }

    fn refresh(&self) {
        let imp = self.imp();
        let model = imp.model.get().expect("the page is created with a model");
        let Route::Loading { failure } = model.route() else {
            return;
        };
        let status = &imp.status_page;
        match failure {
            Some(failure) => {
                status.set_icon_name(Some("dialog-error-symbolic"));
                status.set_title(&failure.message);
                imp.spinner.set_visible(false);
                imp.try_again_button.set_visible(failure.can_retry);
                imp.log_in_button.set_visible(true);
            }
            None => {
                status.set_icon_name(None);
                status.set_title(
                    &model
                        .loading_message()
                        .unwrap_or_else(|| IN_PROGRESS_MESSAGE.to_owned()),
                );
                imp.spinner.set_visible(true);
                imp.try_again_button.set_visible(false);
                imp.log_in_button.set_visible(false);
            }
        }
        #[cfg(feature = "testing")]
        if let Some(button) = imp.finish_loading_button.get() {
            button.set_visible(matches!(model.route(), Route::Loading { failure: None }));
        }
    }

    #[cfg(feature = "testing")]
    fn add_finish_loading_button(&self) {
        let imp = self.imp();
        let button = gtk::Button::builder()
            .label("Finish Loading")
            .name("loading-finish-button")
            .action_name("win.testing-finish-loading")
            .halign(gtk::Align::Center)
            .css_classes(["pill"])
            .build();
        imp.actions.append(&button);
        let _ = imp.finish_loading_button.set(button);
    }
}
