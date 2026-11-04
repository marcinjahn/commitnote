use gtk4::{self as gtk, gdk, prelude::*};

pub fn probe() -> gtk::Label {
    let probe = gtk::Label::new(None);
    probe.add_css_class("accent");
    probe.set_visible(false);
    probe
}

pub fn color(probe: &gtk::Label) -> gdk::RGBA {
    probe.color()
}
