use gtk4::{self as gtk, gio, glib, prelude::*};

use super::AppModel;

/// Reports window visibility and network availability to the model while it is alive.
pub struct Lifecycle {
    monitor: gio::NetworkMonitor,
    handler: Option<glib::SignalHandlerId>,
}

impl Lifecycle {
    pub fn attach(window: &impl IsA<gtk::Window>, model: &AppModel) -> Self {
        let window = window.as_ref();
        let update_visible = {
            let model = model.downgrade();
            move |window: &gtk::Window| {
                if let Some(model) = model.upgrade() {
                    model.set_visible(window.is_mapped() && !window.is_suspended());
                }
            }
        };
        window.connect_map(update_visible.clone());
        window.connect_unmap(update_visible.clone());
        window.connect_suspended_notify(update_visible.clone());
        update_visible(window);

        let monitor = gio::NetworkMonitor::default();
        model.set_online(monitor.is_network_available());
        let handler = monitor.connect_network_available_notify({
            let model = model.downgrade();
            move |monitor| {
                if let Some(model) = model.upgrade() {
                    model.set_online(monitor.is_network_available());
                }
            }
        });
        Self {
            monitor,
            handler: Some(handler),
        }
    }
}

impl Drop for Lifecycle {
    fn drop(&mut self) {
        if let Some(handler) = self.handler.take() {
            self.monitor.disconnect(handler);
        }
    }
}
