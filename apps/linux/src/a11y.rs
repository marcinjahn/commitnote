use gtk4::{self as gtk, prelude::*};

const LOADING: &str = "Loading";

#[cfg(feature = "testing")]
thread_local! {
    static ANNOUNCEMENTS: std::cell::RefCell<Vec<(String, gtk::AccessibleAnnouncementPriority)>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

pub fn announce(
    widget: &impl IsA<gtk::Accessible>,
    message: &str,
    priority: gtk::AccessibleAnnouncementPriority,
) {
    if message.is_empty() {
        return;
    }
    #[cfg(feature = "testing")]
    ANNOUNCEMENTS.with_borrow_mut(|log| log.push((message.to_owned(), priority)));
    widget.announce(message, priority);
}

#[cfg(feature = "testing")]
pub fn testing_take_announcements() -> Vec<(String, gtk::AccessibleAnnouncementPriority)> {
    ANNOUNCEMENTS.with_borrow_mut(std::mem::take)
}

pub fn label_loading(spinner: &impl IsA<gtk::Widget>) {
    spinner
        .upcast_ref::<gtk::Widget>()
        .update_property(&[gtk::accessible::Property::Label(LOADING)]);
}

pub fn label_progress(bar: &gtk::ProgressBar, label: &str) {
    bar.update_property(&[gtk::accessible::Property::Label(label)]);
}

pub fn show_fraction(bar: &gtk::ProgressBar, fraction: f64) {
    let fraction = fraction.clamp(0.0, 1.0);
    bar.set_fraction(fraction);
    let text = format!("{}%", (fraction * 100.0).round());
    bar.update_property(&[gtk::accessible::Property::ValueText(&text)]);
}

pub fn show_pulse(bar: &gtk::ProgressBar) {
    bar.reset_property(gtk::AccessibleProperty::ValueText);
}
