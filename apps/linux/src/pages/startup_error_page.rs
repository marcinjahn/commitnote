use adw::subclass::prelude::*;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

mod imp {
    use super::*;

    #[derive(Debug, Default, gtk::CompositeTemplate)]
    #[template(resource = "/io/github/marcinjahn/commitnote/ui/startup-error-page.ui")]
    pub struct StartupErrorPage {
        #[template_child]
        pub(super) status_page: TemplateChild<adw::StatusPage>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for StartupErrorPage {
        const NAME: &'static str = "CommitnoteStartupErrorPage";
        type Type = super::StartupErrorPage;
        type ParentType = adw::NavigationPage;

        fn class_init(klass: &mut Self::Class) {
            klass.bind_template();
        }

        fn instance_init(obj: &glib::subclass::InitializingObject<Self>) {
            obj.init_template();
        }
    }

    impl ObjectImpl for StartupErrorPage {}
    impl WidgetImpl for StartupErrorPage {}
    impl NavigationPageImpl for StartupErrorPage {}
}

glib::wrapper! {
    pub struct StartupErrorPage(ObjectSubclass<imp::StartupErrorPage>)
        @extends adw::NavigationPage, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl StartupErrorPage {
    pub fn new(message: &str) -> Self {
        let page: Self = glib::Object::new();
        page.imp().status_page.set_description(Some(message));
        page
    }
}
