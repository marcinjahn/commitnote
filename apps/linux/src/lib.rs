pub mod application;
pub mod config;
pub mod model;
pub mod pages;
pub mod window;

use std::sync::Once;

use gtk4::{gio, glib, prelude::*};

use crate::application::CommitnoteApplication;

pub fn register_resources() {
    static REGISTER: Once = Once::new();
    REGISTER.call_once(|| {
        let resources = gio::Resource::from_data(&glib::Bytes::from_static(include_bytes!(env!(
            "COMMITNOTE_RESOURCES"
        ))))
        .expect("embedded resources are valid");
        gio::resources_register(&resources);
    });
}

pub fn run() -> glib::ExitCode {
    unsafe {
        libc::prctl(libc::PR_SET_DUMPABLE, 0, 0, 0, 0);
    }
    register_resources();
    CommitnoteApplication::new().run()
}
