use std::cell::{Cell, OnceCell};
use std::sync::Once;
use std::time::Duration;

use adw::prelude::*;
use adw::subclass::prelude::*;
use commitnote_core_api::shapes::PassphraseStrength;
use gtk4::{self as gtk, gdk, glib};
use libadwaita as adw;

use crate::model::AppModel;
use crate::pages::secret_text;

const DEBOUNCE: Duration = Duration::from_millis(150);

const STYLE: &str = "
levelbar.passphrase-strength > trough > block:not(.empty) {
  background-color: var(--accent-bg-color);
}
levelbar.passphrase-strength.weak > trough > block:not(.empty) {
  background-color: var(--error-bg-color);
}
";

fn install_style() {
    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| {
        let Some(display) = gdk::Display::default() else {
            return;
        };
        let provider = gtk::CssProvider::new();
        provider.load_from_string(STYLE);
        gtk::style_context_add_provider_for_display(
            &display,
            &provider,
            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
    });
}

fn strength_text(strength: &PassphraseStrength) -> String {
    let mut text = format!("Passphrase strength: {}.", strength.label);
    if strength.score <= 2 && !strength.warning.is_empty() {
        text.push(' ');
        text.push_str(&strength.warning);
    }
    text
}

#[derive(Debug, Default)]
struct LatestRequest {
    generation: Cell<u64>,
}

impl LatestRequest {
    fn begin(&self) -> u64 {
        let generation = self.generation.get().wrapping_add(1);
        self.generation.set(generation);
        generation
    }

    fn is_current(&self, generation: u64) -> bool {
        self.generation.get() == generation
    }
}

struct Source {
    model: AppModel,
    entry: glib::WeakRef<gtk::Editable>,
    repository_label: String,
}

mod imp {
    use super::*;

    #[derive(Default)]
    pub struct StrengthMeter {
        pub(super) bar: gtk::LevelBar,
        pub(super) label: gtk::Label,
        pub(super) requests: LatestRequest,
        pub(super) source: OnceCell<Source>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for StrengthMeter {
        const NAME: &'static str = "CommitnoteStrengthMeter";
        type Type = super::StrengthMeter;
        type ParentType = gtk::Box;
    }

    impl ObjectImpl for StrengthMeter {
        fn constructed(&self) {
            self.parent_constructed();
            install_style();
            let meter = self.obj();
            meter.set_orientation(gtk::Orientation::Vertical);
            meter.set_spacing(6);
            meter.set_visible(false);

            self.bar.set_mode(gtk::LevelBarMode::Discrete);
            self.bar.set_min_value(0.0);
            self.bar.set_max_value(4.0);
            self.bar.set_hexpand(true);
            self.bar.add_css_class("passphrase-strength");
            self.bar
                .update_state(&[gtk::accessible::State::Hidden(true)]);
            meter.append(&self.bar);

            self.label.set_widget_name("strength-label");
            self.label.set_wrap(true);
            self.label.set_xalign(0.0);
            self.label.add_css_class("caption");
            meter.append(&self.label);
        }
    }

    impl WidgetImpl for StrengthMeter {}
    impl BoxImpl for StrengthMeter {}
}

glib::wrapper! {
    pub struct StrengthMeter(ObjectSubclass<imp::StrengthMeter>)
        @extends gtk::Box, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget, gtk::Orientable;
}

impl Default for StrengthMeter {
    fn default() -> Self {
        Self::new()
    }
}

impl StrengthMeter {
    pub fn new() -> Self {
        glib::Object::new()
    }

    /// Rates whatever `entry` holds, debounced, and hides itself while the entry is empty.
    pub fn follow(
        &self,
        entry: &impl IsA<gtk::Editable>,
        model: &AppModel,
        repository_label: &str,
    ) {
        let source = Source {
            model: model.clone(),
            entry: entry.upcast_ref::<gtk::Editable>().downgrade(),
            repository_label: repository_label.to_owned(),
        };
        if self.imp().source.set(source).is_err() {
            return;
        }
        entry
            .upcast_ref::<gtk::Editable>()
            .connect_changed(glib::clone!(
                #[weak(rename_to = meter)]
                self,
                move |entry| meter.entry_changed(entry)
            ));
    }

    fn entry_changed(&self, entry: &gtk::Editable) {
        let generation = self.imp().requests.begin();
        if secret_text(entry).expose().is_empty() {
            self.set_visible(false);
            return;
        }
        glib::timeout_add_local_once(
            DEBOUNCE,
            glib::clone!(
                #[weak(rename_to = meter)]
                self,
                move || meter.request(generation)
            ),
        );
    }

    fn request(&self, generation: u64) {
        let imp = self.imp();
        let Some(source) = imp.source.get() else {
            return;
        };
        let Some(entry) = source.entry.upgrade() else {
            return;
        };
        if !imp.requests.is_current(generation) {
            return;
        }
        let passphrase = secret_text(&entry);
        let model = source.model.clone();
        let label = source.repository_label.clone();
        glib::spawn_future_local(glib::clone!(
            #[weak(rename_to = meter)]
            self,
            async move {
                let result = model.passphrase_strength(passphrase, &label).await;
                if let Ok(strength) = result
                    && meter.imp().requests.is_current(generation)
                {
                    meter.show(&strength);
                }
            }
        ));
    }

    fn show(&self, strength: &PassphraseStrength) {
        let imp = self.imp();
        imp.bar.set_value(f64::from(strength.filled_segments));
        if strength.weak {
            imp.bar.add_css_class("weak");
        } else {
            imp.bar.remove_css_class("weak");
        }
        imp.label.set_text(&strength_text(strength));
        self.set_visible(true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strength(score: u8, warning: &str) -> PassphraseStrength {
        PassphraseStrength {
            score,
            label: "Fair".to_owned(),
            filled_segments: score,
            weak: score <= 1,
            warning: warning.to_owned(),
        }
    }

    #[test]
    fn strength_text_appends_the_warning_for_weak_scores() {
        assert_eq!(
            strength_text(&strength(2, "This is a common phrase.")),
            "Passphrase strength: Fair. This is a common phrase."
        );
    }

    #[test]
    fn strength_text_without_a_warning_ends_after_the_label() {
        assert_eq!(
            strength_text(&strength(2, "")),
            "Passphrase strength: Fair."
        );
    }

    #[test]
    fn strength_text_omits_the_warning_from_score_three() {
        assert_eq!(
            strength_text(&strength(3, "Avoid repeats.")),
            "Passphrase strength: Fair."
        );
    }

    #[test]
    fn only_the_latest_request_is_current() {
        let requests = LatestRequest::default();
        let first = requests.begin();
        assert!(requests.is_current(first));
        let second = requests.begin();
        assert!(!requests.is_current(first));
        assert!(requests.is_current(second));
    }
}
