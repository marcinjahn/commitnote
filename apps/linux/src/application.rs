use std::cell::OnceCell;

use adw::subclass::prelude::*;
use gtk4::{gio, glib, prelude::*};
use libadwaita as adw;

use crate::config;
use crate::model::appearance::AppearanceApplier;
use crate::model::{AppConfig, AppModel};
use crate::window::CommitnoteWindow;

const BUNDLE_RESOURCE: &str = "core/commitnote-core.js";

mod imp {
    use super::*;

    #[derive(Default)]
    pub struct CommitnoteApplication {
        pub(super) model: OnceCell<AppModel>,
        pub(super) window: glib::WeakRef<CommitnoteWindow>,
        pub(super) appearance: OnceCell<AppearanceApplier>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for CommitnoteApplication {
        const NAME: &'static str = "CommitnoteApplication";
        type Type = super::CommitnoteApplication;
        type ParentType = adw::Application;
    }

    impl ObjectImpl for CommitnoteApplication {}

    impl ApplicationImpl for CommitnoteApplication {
        fn startup(&self) {
            self.parent_startup();
            sourceview5::init();
            let applier = AppearanceApplier::new();
            let model = AppModel::new(app_config());
            applier.apply(&model.appearance());
            model.connect_appearance_changed({
                let application = self.obj().downgrade();
                move |model| {
                    if let Some(application) = application.upgrade()
                        && let Some(applier) = application.imp().appearance.get()
                    {
                        applier.apply(&model.appearance());
                    }
                }
            });
            let _ = self.appearance.set(applier);
            let _ = self.model.set(model);
        }

        fn activate(&self) {
            self.parent_activate();
            if let Some(window) = self.window.upgrade() {
                window.present();
                return;
            }
            let Some(model) = self.model.get() else {
                return;
            };
            let application = self.obj();
            let window = CommitnoteWindow::new(application.upcast_ref(), model);
            self.window.set(Some(&window));
            window.present();
        }

        fn shutdown(&self) {
            if let Some(model) = self.model.get() {
                model.shutdown();
            }
            self.parent_shutdown();
        }
    }

    impl GtkApplicationImpl for CommitnoteApplication {}
    impl AdwApplicationImpl for CommitnoteApplication {}
}

glib::wrapper! {
    pub struct CommitnoteApplication(ObjectSubclass<imp::CommitnoteApplication>)
        @extends adw::Application, gtk4::Application, gio::Application,
        @implements gio::ActionGroup, gio::ActionMap;
}

impl CommitnoteApplication {
    pub fn new() -> Self {
        glib::Object::builder()
            .property("application-id", config::APP_ID)
            .property(
                "resource-base-path",
                config::RESOURCE_PREFIX.trim_end_matches('/'),
            )
            .build()
    }
}

impl Default for CommitnoteApplication {
    fn default() -> Self {
        Self::new()
    }
}

fn app_config() -> AppConfig {
    let bundle_path = format!("{}{BUNDLE_RESOURCE}", config::RESOURCE_PREFIX);
    let bundle_source = gio::resources_lookup_data(&bundle_path, gio::ResourceLookupFlags::NONE)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes.to_vec()).ok())
        .unwrap_or_default();
    AppConfig {
        app_id: config::APP_ID.to_owned(),
        version: config::VERSION.to_owned(),
        bundle_source,
        cache_dir: glib::user_cache_dir().join(config::APP_ID),
        config_dir: glib::user_config_dir().join(config::APP_ID),
        device_model: "Linux".to_owned(),
        testing: cfg!(feature = "testing"),
    }
}
