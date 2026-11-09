use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use adw::prelude::*;
use commitnote_core_api::commands::PassphraseChangeCopy;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use crate::a11y::{label_progress, show_fraction, show_pulse};
use crate::model::{AppModel, PassphraseChangeState, PassphraseStage};
use crate::pages::secret_text;
use crate::pages::unlock::StrengthMeter;
use crate::window::host_dialog_toasts;

const PULSE_INTERVAL: Duration = Duration::from_millis(120);

const FORM: &str = "form";
const WORKING: &str = "working";
const REVIEW: &str = "review";
const SETUP: &str = "setup";
const UNSETTLED: &str = "unsettled";

fn page_name(stage: &PassphraseStage) -> Option<&'static str> {
    match stage {
        PassphraseStage::Form => Some(FORM),
        PassphraseStage::Working { .. } => Some(WORKING),
        PassphraseStage::Review { .. } => Some(REVIEW),
        PassphraseStage::Setup { .. } => Some(SETUP),
        PassphraseStage::Unsettled { .. } => Some(UNSETTLED),
        PassphraseStage::Done => None,
    }
}

fn fraction(done: Option<u32>, total: Option<u32>) -> Option<f64> {
    match (done, total) {
        (Some(done), Some(total)) if total > 0 => {
            Some((f64::from(done) / f64::from(total)).clamp(0.0, 1.0))
        }
        _ => None,
    }
}

struct Form {
    current: gtk::PasswordEntry,
    next: gtk::PasswordEntry,
    repeat: gtk::PasswordEntry,
    remove_history: adw::SwitchRow,
}

struct Dialog {
    model: AppModel,
    copy: Rc<PassphraseChangeCopy>,
    dialog: adw::Dialog,
    window: glib::WeakRef<gtk::Window>,
    stack: gtk::Stack,
    form: Form,
    working_message: gtk::Label,
    progress: gtk::ProgressBar,
    summary: gtk::Label,
    carried_over: gtk::Box,
    history_warning: gtk::Label,
    setup_message: gtk::Label,
    unsettled_message: gtk::Label,
    error: gtk::Label,
    continue_button: gtk::Button,
    confirm: gtk::Button,
    cancel: gtk::Button,
    enable_atomic: gtk::Button,
    check_again: gtk::Button,
    log_out: gtk::Button,
    pulse: RefCell<Option<glib::SourceId>>,
    open: Cell<bool>,
}

/// Presents the passphrase change the model holds over `anchor`, following it until the change
/// is done or forgotten. `None` when no change is open.
pub fn present(model: &AppModel, anchor: &impl IsA<gtk::Widget>) -> Option<adw::Dialog> {
    let change = model.passphrase_change()?;
    let copy = change.copy.clone();

    let stack = gtk::Stack::builder()
        .transition_type(gtk::StackTransitionType::Crossfade)
        .vhomogeneous(false)
        .build();
    let form = form_page(&stack, model, &change);
    let (working_message, progress) = working_page(&stack);
    let (summary, carried_over, history_warning) = review_page(&stack, &copy);
    let setup_message = message_page(&stack, SETUP, "passphrase-setup-message");
    let unsettled_message = message_page(&stack, UNSETTLED, "passphrase-unsettled-message");

    let error = gtk::Label::builder()
        .name("passphrase-error")
        .accessible_role(gtk::AccessibleRole::Alert)
        .css_classes(["error"])
        .xalign(0.0)
        .wrap(true)
        .visible(false)
        .build();
    let continue_button = action_button(
        "passphrase-continue",
        &copy.continue_label,
        "suggested-action",
    );
    let confirm = action_button(
        "passphrase-confirm",
        &copy.confirm_label,
        "destructive-action",
    );
    let cancel = action_button("passphrase-cancel", &copy.cancel_label, "flat");
    let enable_atomic = action_button(
        "passphrase-enable-atomic",
        &copy.enable_atomic_label,
        "suggested-action",
    );
    let check_again = action_button(
        "passphrase-check-again",
        &copy.check_again_label,
        "suggested-action",
    );
    let log_out = action_button(
        "passphrase-log-out",
        &copy.log_out_label,
        "destructive-action",
    );
    let actions = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .halign(gtk::Align::Center)
        .build();
    for button in [
        &continue_button,
        &confirm,
        &cancel,
        &enable_atomic,
        &check_again,
        &log_out,
    ] {
        actions.append(button);
    }

    let content = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(24)
        .margin_top(12)
        .margin_bottom(24)
        .margin_start(12)
        .margin_end(12)
        .build();
    content.append(&stack);
    content.append(&error);
    content.append(&actions);
    let scroller = gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Never)
        .propagate_natural_height(true)
        .child(
            &adw::Clamp::builder()
                .maximum_size(560)
                .child(&content)
                .build(),
        )
        .build();
    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&adw::HeaderBar::new());
    toolbar.set_content(Some(&scroller));
    let toasts = adw::ToastOverlay::new();
    toasts.set_child(Some(&toolbar));

    let dialog = adw::Dialog::builder()
        .name("change-passphrase-dialog")
        .title(&copy.title)
        .content_width(520)
        .content_height(640)
        .child(&toasts)
        .build();

    let state = Rc::new(Dialog {
        model: model.clone(),
        copy,
        dialog: dialog.clone(),
        window: anchor
            .as_ref()
            .root()
            .and_downcast::<gtk::Window>()
            .map(|window| window.downgrade())
            .unwrap_or_default(),
        stack,
        form,
        working_message,
        progress,
        summary,
        carried_over,
        history_warning,
        setup_message,
        unsettled_message,
        error,
        continue_button,
        confirm,
        cancel,
        enable_atomic,
        check_again,
        log_out,
        pulse: RefCell::new(None),
        open: Cell::new(true),
    });
    state.connect();
    state.refresh();

    host_dialog_toasts(anchor, &dialog, &toasts);
    dialog.present(Some(anchor));
    state.form.current.grab_focus();
    Some(dialog)
}

fn group(title: Option<&str>, description: Option<&str>) -> adw::PreferencesGroup {
    let group = adw::PreferencesGroup::new();
    if let Some(title) = title {
        group.set_title(&glib::markup_escape_text(title));
    }
    if let Some(description) = description {
        group.set_description(Some(&glib::markup_escape_text(description)));
    }
    group
}

fn text_label(name: Option<&str>, text: &str) -> gtk::Label {
    let label = gtk::Label::builder()
        .label(text)
        .xalign(0.0)
        .wrap(true)
        .build();
    if let Some(name) = name {
        label.set_widget_name(name);
    }
    label
}

fn notice_label(text: &str) -> gtk::Label {
    let label = text_label(None, text);
    label.add_css_class("dim-label");
    label
}

fn passphrase_entry(name: &str, label: &str) -> gtk::PasswordEntry {
    let entry = gtk::PasswordEntry::builder()
        .name(name)
        .show_peek_icon(true)
        .build();
    entry.update_property(&[gtk::accessible::Property::Label(label)]);
    entry
}

fn action_button(name: &str, label: &str, style: &str) -> gtk::Button {
    gtk::Button::builder()
        .name(name)
        .label(label)
        .css_classes(["pill", style])
        .visible(false)
        .build()
}

fn stage_box() -> gtk::Box {
    gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(24)
        .build()
}

fn notices_group(copy: &PassphraseChangeCopy, lead: Option<&gtk::Label>) -> adw::PreferencesGroup {
    let notices = group(None, None);
    let column = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .build();
    if let Some(lead) = lead {
        column.append(lead);
    }
    column.append(&notice_label(&copy.other_devices_warning));
    column.append(&notice_label(&copy.version_history_notice));
    notices.add(&column);
    notices
}

fn form_page(stack: &gtk::Stack, model: &AppModel, change: &PassphraseChangeState) -> Form {
    let copy = &change.copy;
    let page = stage_box();

    let intro = group(None, None);
    intro.add(&text_label(None, &copy.intro));
    page.append(&intro);

    let current = passphrase_entry("passphrase-current", &copy.current_label);
    let current_group = group(Some(&copy.current_label), None);
    current_group.add(&current);
    page.append(&current_group);

    let next = passphrase_entry("passphrase-new", &copy.new_label);
    let meter = StrengthMeter::new();
    meter.set_widget_name("passphrase-strength");
    meter.set_margin_top(12);
    meter.follow(&next, model, &change.repository_label);
    let next_group = group(Some(&copy.new_label), Some(&copy.new_hint));
    next_group.add(&next);
    next_group.add(&meter);
    page.append(&next_group);

    let repeat = passphrase_entry("passphrase-repeat", &copy.repeat_label);
    let repeat_group = group(Some(&copy.repeat_label), None);
    repeat_group.add(&repeat);
    page.append(&repeat_group);

    let remove_history = adw::SwitchRow::builder()
        .name("passphrase-remove-history")
        .title(glib::markup_escape_text(&copy.remove_history_label))
        .subtitle(glib::markup_escape_text(&copy.remove_history_description))
        .build();
    if change.can_remove_history {
        let history_group = group(None, None);
        history_group.add(&remove_history);
        page.append(&history_group);
    }

    page.append(&notices_group(copy, None));
    stack.add_named(&page, Some(FORM));
    Form {
        current,
        next,
        repeat,
        remove_history,
    }
}

fn working_page(stack: &gtk::Stack) -> (gtk::Label, gtk::ProgressBar) {
    let page = stage_box();
    page.set_margin_top(24);
    let progress = gtk::ProgressBar::builder()
        .name("passphrase-progress")
        .pulse_step(0.1)
        .build();
    label_progress(&progress, "Re-encryption Progress");
    let message = text_label(Some("passphrase-working-message"), "");
    message.set_xalign(0.5);
    message.set_justify(gtk::Justification::Center);
    page.append(&progress);
    page.append(&message);
    stack.add_named(&page, Some(WORKING));
    (message, progress)
}

fn review_page(
    stack: &gtk::Stack,
    copy: &PassphraseChangeCopy,
) -> (gtk::Label, gtk::Box, gtk::Label) {
    let page = stage_box();
    let summary = text_label(Some("passphrase-review-summary"), "");
    let carried_over = gtk::Box::builder()
        .name("passphrase-carried-over")
        .orientation(gtk::Orientation::Vertical)
        .spacing(6)
        .build();
    let overview = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .build();
    overview.append(&summary);
    overview.append(&carried_over);
    let overview_group = group(None, None);
    overview_group.add(&overview);
    page.append(&overview_group);

    let history_warning = text_label(Some("passphrase-history-warning"), "");
    history_warning.add_css_class("warning");
    page.append(&notices_group(copy, Some(&history_warning)));
    stack.add_named(&page, Some(REVIEW));
    (summary, carried_over, history_warning)
}

fn message_page(stack: &gtk::Stack, page_name: &str, label_name: &str) -> gtk::Label {
    let page = stage_box();
    let message = text_label(Some(label_name), "");
    let message_group = group(None, None);
    message_group.add(&message);
    page.append(&message_group);
    stack.add_named(&page, Some(page_name));
    message
}

impl Dialog {
    fn connect(self: &Rc<Self>) {
        let handler = self.model.connect_passphrase_change_changed({
            let state = Rc::downgrade(self);
            move |_| {
                if let Some(state) = state.upgrade() {
                    state.refresh();
                }
            }
        });
        self.on_click(&self.continue_button, Self::submit);
        self.form.repeat.connect_activate({
            let state = Rc::downgrade(self);
            move |_| {
                if let Some(state) = state.upgrade() {
                    state.submit();
                }
            }
        });
        self.on_click(&self.confirm, |state| {
            let model = state.model.clone();
            glib::spawn_future_local(async move { model.commit_passphrase_change().await });
        });
        self.on_click(&self.cancel, |state| {
            let model = state.model.clone();
            glib::spawn_future_local(async move { model.cancel_passphrase_change().await });
        });
        self.on_click(&self.enable_atomic, |state| {
            let state = state.clone();
            glib::spawn_future_local(async move {
                if state.model.enable_passphrase_atomic().await {
                    state.submit();
                }
            });
        });
        self.on_click(&self.check_again, |state| {
            let model = state.model.clone();
            glib::spawn_future_local(async move { model.settle_passphrase_change().await });
        });
        self.on_click(&self.log_out, Self::log_out);
        let owner = RefCell::new(Some((self.clone(), handler)));
        self.dialog.connect_closed(move |_| {
            if let Some((state, handler)) = owner.take() {
                state.model.disconnect(handler);
                state.closed();
            }
        });
    }

    fn on_click(self: &Rc<Self>, button: &gtk::Button, run: impl Fn(&Rc<Self>) + 'static) {
        button.connect_clicked({
            let state = Rc::downgrade(self);
            move |_| {
                if let Some(state) = state.upgrade() {
                    run(&state);
                }
            }
        });
    }

    fn refresh(&self) {
        if !self.open.get() {
            return;
        }
        let Some(change) = self.model.passphrase_change() else {
            self.close();
            return;
        };
        let Some(page) = page_name(&change.stage) else {
            self.close();
            return;
        };
        self.dialog.set_can_close(change.can_close());
        self.show_stage(&change.stage);
        let page_changed = self.stack.visible_child_name().as_deref() != Some(page);
        self.stack.set_visible_child_name(page);

        self.error
            .set_label(change.error.as_deref().unwrap_or_default());
        self.error
            .set_visible(change.error.is_some() && page != WORKING);

        let copy = &self.copy;
        self.continue_button.set_visible(page == FORM);
        self.confirm.set_visible(page == REVIEW);
        self.cancel.set_visible(page == REVIEW);
        self.enable_atomic.set_visible(matches!(
            change.stage,
            PassphraseStage::Setup {
                can_configure: true,
                ..
            }
        ));
        self.check_again.set_visible(page == UNSETTLED);
        self.check_again.set_sensitive(!change.checking);
        self.check_again.set_label(if change.checking {
            &copy.checking_label
        } else {
            &copy.check_again_label
        });
        self.log_out.set_visible(page == UNSETTLED);
        self.log_out.set_sensitive(!change.checking);

        let default = [
            &self.continue_button,
            &self.confirm,
            &self.enable_atomic,
            &self.check_again,
        ]
        .into_iter()
        .find(|button| button.is_visible());
        self.dialog.set_default_widget(default);
        if page_changed && let Some(button) = default {
            button.grab_focus();
        }

        if change.clear_current_requested {
            self.form.current.set_text("");
            self.form.current.grab_focus();
            self.model.acknowledge_clear_current_passphrase();
        }
    }

    fn show_stage(&self, stage: &PassphraseStage) {
        let working = match stage {
            PassphraseStage::Working {
                message,
                done,
                total,
            } => {
                self.working_message.set_label(message);
                Some(fraction(*done, *total))
            }
            PassphraseStage::Review {
                summary,
                carried_over,
                history_warning,
            } => {
                self.summary.set_label(summary);
                self.show_carried_over(carried_over);
                self.history_warning
                    .set_label(history_warning.as_deref().unwrap_or_default());
                self.history_warning.set_visible(history_warning.is_some());
                None
            }
            PassphraseStage::Setup { message, .. } => {
                self.setup_message.set_label(message);
                None
            }
            PassphraseStage::Unsettled { message } => {
                self.unsettled_message.set_label(message);
                None
            }
            PassphraseStage::Form | PassphraseStage::Done => None,
        };
        match working {
            Some(Some(fraction)) => {
                self.stop_pulsing();
                show_fraction(&self.progress, fraction);
            }
            Some(None) => self.start_pulsing(),
            None => self.stop_pulsing(),
        }
    }

    fn show_carried_over(&self, lines: &[String]) {
        while let Some(child) = self.carried_over.first_child() {
            self.carried_over.remove(&child);
        }
        for line in lines {
            self.carried_over.append(&text_label(None, line));
        }
        self.carried_over.set_visible(!lines.is_empty());
    }

    fn start_pulsing(&self) {
        let mut pulse = self.pulse.borrow_mut();
        if pulse.is_some() {
            return;
        }
        show_pulse(&self.progress);
        let progress = self.progress.downgrade();
        *pulse = Some(glib::timeout_add_local(
            PULSE_INTERVAL,
            move || match progress.upgrade() {
                Some(progress) => {
                    progress.pulse();
                    glib::ControlFlow::Continue
                }
                None => glib::ControlFlow::Break,
            },
        ));
    }

    fn stop_pulsing(&self) {
        if let Some(source) = self.pulse.take() {
            source.remove();
        }
    }

    fn submit(self: &Rc<Self>) {
        let form = &self.form;
        let (current, next, repeated) = (
            secret_text(&form.current),
            secret_text(&form.next),
            secret_text(&form.repeat),
        );
        let remove_history = form.remove_history.is_active();
        let model = self.model.clone();
        glib::spawn_future_local(async move {
            model
                .prepare_passphrase_change(current, next, repeated, remove_history)
                .await;
        });
    }

    fn log_out(self: &Rc<Self>) {
        let window = self.window.upgrade();
        self.model.reset_passphrase_change();
        self.close();
        if let Some(window) = window {
            window.activate_action("win.log-out", None).ok();
        }
    }

    fn close(&self) {
        if self.open.replace(false) {
            self.dialog.force_close();
        }
    }

    fn closed(&self) {
        self.open.set(false);
        self.stop_pulsing();
        for entry in [&self.form.current, &self.form.next, &self.form.repeat] {
            entry.set_text("");
        }
        self.model.dismiss_change_passphrase();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_is_a_fraction_only_when_both_counts_are_known() {
        assert_eq!(fraction(Some(1), Some(4)), Some(0.25));
        assert_eq!(fraction(Some(5), Some(4)), Some(1.0));
        assert_eq!(fraction(None, Some(4)), None);
        assert_eq!(fraction(Some(1), None), None);
        assert_eq!(fraction(Some(0), Some(0)), None);
    }

    #[test]
    fn every_stage_but_done_has_a_page() {
        assert_eq!(page_name(&PassphraseStage::Form), Some(FORM));
        assert_eq!(
            page_name(&PassphraseStage::Unsettled {
                message: String::new()
            }),
            Some(UNSETTLED)
        );
        assert_eq!(page_name(&PassphraseStage::Done), None);
    }
}
