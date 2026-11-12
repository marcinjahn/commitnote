use std::rc::Rc;

use gtk4::{self as gtk, glib, prelude::*};

pub fn may_animate() -> bool {
    gtk::Settings::default().is_none_or(|settings| {
        settings.is_gtk_enable_animations()
            && settings.gtk_interface_reduced_motion() != gtk::ReducedMotion::Reduce
    })
}

#[derive(Debug)]
pub struct MotionWatch {
    settings: gtk::Settings,
    handlers: Vec<glib::SignalHandlerId>,
}

pub fn watch(on_change: impl Fn() + 'static) -> Option<MotionWatch> {
    let settings = gtk::Settings::default()?;
    let on_change = Rc::new(on_change);
    let handlers = vec![
        settings.connect_gtk_enable_animations_notify({
            let on_change = Rc::clone(&on_change);
            move |_| on_change()
        }),
        settings.connect_gtk_interface_reduced_motion_notify(move |_| on_change()),
    ];
    Some(MotionWatch { settings, handlers })
}

impl Drop for MotionWatch {
    fn drop(&mut self) {
        for handler in self.handlers.drain(..) {
            self.settings.disconnect(handler);
        }
    }
}
