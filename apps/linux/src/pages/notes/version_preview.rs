use std::cell::{Cell, RefCell};
use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::commands::{
    DiffItemView, DiffLineView, DiffSegment, HistoryVersionView, PreviewBody, RestoreAction,
    VersionPreview,
};
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use crate::a11y::label_loading;
use crate::fonts::follow_note_font;
use crate::model::{AppModel, RestoreResult};

const CHANGED_OPEN: &str = "<span weight=\"bold\" bgcolor=\"#80808059\">";
const CHANGED_OPEN_HIGH_CONTRAST: &str = "<span weight=\"bold\" bgcolor=\"#80808099\">";

struct Preview {
    model: AppModel,
    sha: String,
    dialog: glib::WeakRef<adw::Dialog>,
    toasts: glib::WeakRef<adw::ToastOverlay>,
    toolbar: adw::ToolbarView,
    stack: gtk::Stack,
    status: adw::StatusPage,
    retry: gtk::Button,
    heading: gtk::Label,
    scroller: gtk::ScrolledWindow,
    body: gtk::Box,
    diff: RefCell<Option<gtk::Box>>,
    shown_body: RefCell<Option<PreviewBody>>,
    toggle: adw::SwitchRow,
    toggle_list: gtk::ListBox,
    reason: gtk::Label,
    restore: gtk::Button,
    restore_label: RefCell<String>,
    generation: Cell<u64>,
    allowed: Cell<bool>,
    reloading: Cell<bool>,
    restoring: Cell<bool>,
    toggle_offered: Cell<bool>,
}

pub fn page(
    model: &AppModel,
    version: &HistoryVersionView,
    dialog: &adw::Dialog,
    toasts: &adw::ToastOverlay,
) -> adw::NavigationPage {
    let loading = adw::Spinner::builder()
        .width_request(32)
        .height_request(32)
        .halign(gtk::Align::Center)
        .valign(gtk::Align::Center)
        .build();
    label_loading(&loading);

    let retry = gtk::Button::builder()
        .name("version-retry")
        .label("Retry")
        .halign(gtk::Align::Center)
        .css_classes(["pill"])
        .build();
    let status = adw::StatusPage::builder()
        .name("version-status")
        .child(&retry)
        .build();

    let heading = gtk::Label::builder()
        .name("version-title-change")
        .wrap(true)
        .xalign(0.0)
        .margin_top(12)
        .margin_start(12)
        .margin_end(12)
        .css_classes(["heading"])
        .visible(false)
        .build();
    let body = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .margin_top(12)
        .margin_bottom(12)
        .margin_start(12)
        .margin_end(12)
        .build();
    let scroller = gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Never)
        .vexpand(true)
        .child(&body)
        .build();
    let ready = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .build();
    ready.append(&heading);
    ready.append(&scroller);

    let stack = gtk::Stack::new();
    stack.add_named(&loading, Some("loading"));
    stack.add_named(&status, Some("message"));
    stack.add_named(&ready, Some("ready"));

    let toggle = adw::SwitchRow::builder()
        .name("version-restore-title")
        .use_markup(false)
        .build();
    let toggle_list = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .css_classes(["boxed-list"])
        .visible(false)
        .build();
    toggle_list.append(&toggle);
    let reason = gtk::Label::builder()
        .name("version-restore-reason")
        .wrap(true)
        .xalign(0.0)
        .css_classes(["dim-label"])
        .visible(false)
        .build();
    let restore = gtk::Button::builder()
        .name("version-restore")
        .halign(gtk::Align::Center)
        .css_classes(["suggested-action", "pill"])
        .sensitive(false)
        .build();
    let bar = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .margin_top(12)
        .margin_bottom(12)
        .margin_start(12)
        .margin_end(12)
        .build();
    bar.append(&toggle_list);
    bar.append(&reason);
    bar.append(&restore);

    let toolbar = adw::ToolbarView::builder()
        .content(&stack)
        .reveal_bottom_bars(false)
        .build();
    toolbar.add_top_bar(&adw::HeaderBar::new());
    toolbar.add_bottom_bar(&bar);

    let page = adw::NavigationPage::builder()
        .name("version-preview")
        .title(&version.date_time)
        .child(&toolbar)
        .build();

    let state = Rc::new(Preview {
        model: model.clone(),
        sha: version.sha.clone(),
        dialog: dialog.downgrade(),
        toasts: toasts.downgrade(),
        toolbar,
        stack,
        status,
        retry: retry.clone(),
        heading,
        scroller,
        body,
        diff: RefCell::new(None),
        shown_body: RefCell::new(None),
        toggle: toggle.clone(),
        toggle_list,
        reason,
        restore: restore.clone(),
        restore_label: Default::default(),
        generation: Cell::new(0),
        allowed: Cell::new(false),
        reloading: Cell::new(false),
        restoring: Cell::new(false),
        toggle_offered: Cell::new(false),
    });

    retry.connect_clicked({
        let state = Rc::downgrade(&state);
        move |_| {
            if let Some(state) = state.upgrade() {
                state.load(true);
            }
        }
    });
    toggle.connect_active_notify({
        let state = Rc::downgrade(&state);
        move |_| {
            if let Some(state) = state.upgrade() {
                state.load(false);
            }
        }
    });
    restore.connect_clicked({
        let state = Rc::downgrade(&state);
        move |_| {
            if let Some(state) = state.upgrade() {
                state.restore();
            }
        }
    });
    follow_note_font(model, &page, {
        let state = Rc::downgrade(&state);
        move |font| {
            if let Some(diff) = state
                .upgrade()
                .and_then(|state| state.diff.borrow().clone())
            {
                font.apply_to(&diff);
            }
        }
    });
    let style_manager = adw::StyleManager::default();
    let contrast = RefCell::new(Some(style_manager.connect_high_contrast_notify({
        let state = Rc::downgrade(&state);
        move |_| {
            if let Some(state) = state.upgrade() {
                state.render_shown_body();
            }
        }
    })));
    page.connect_destroy({
        let state = state.clone();
        move |_| {
            state.generation.set(state.generation.get() + 1);
            if let Some(contrast) = contrast.take() {
                style_manager.disconnect(contrast);
            }
        }
    });

    state.load(true);
    page
}

impl Preview {
    fn restore_title(&self) -> bool {
        self.toggle_offered.get() && self.toggle.is_active()
    }

    fn load(self: &Rc<Self>, show_loading: bool) {
        let generation = self.generation.get() + 1;
        self.generation.set(generation);
        if show_loading {
            self.toolbar.set_reveal_bottom_bars(false);
            self.stack.set_visible_child_name("loading");
        } else {
            self.reloading.set(true);
            self.update_restore();
        }
        let this = self.clone();
        glib::spawn_future_local(async move {
            let result = this
                .model
                .preview_version(this.sha.clone(), this.restore_title())
                .await;
            if this.generation.get() != generation {
                return;
            }
            this.reloading.set(false);
            match result {
                Ok(preview) => this.show(preview),
                Err(error) => this.show_message(&error.message, true),
            }
        });
    }

    fn show(&self, preview: VersionPreview) {
        match preview {
            VersionPreview::Failed { message } => self.show_message(&message, true),
            VersionPreview::Undecryptable { message } | VersionPreview::Closed { message } => {
                self.show_message(&message, false)
            }
            VersionPreview::Version {
                title_change,
                body,
                restore_title,
                restore,
            } => self.show_version(title_change, &body, restore_title, &restore),
        }
    }

    fn show_message(&self, message: &str, retryable: bool) {
        self.status.set_description(Some(message));
        self.retry.set_visible(retryable);
        self.toolbar.set_reveal_bottom_bars(false);
        self.stack.set_visible_child_name("message");
    }

    fn show_version(
        &self,
        title_change: Option<String>,
        body: &PreviewBody,
        restore_title: Option<String>,
        restore: &RestoreAction,
    ) {
        self.heading.set_visible(title_change.is_some());
        self.heading
            .set_label(title_change.as_deref().unwrap_or_default());

        self.shown_body.replace(Some(body.clone()));
        self.render_shown_body();

        self.toggle_offered.set(restore_title.is_some());
        if let Some(label) = &restore_title {
            self.toggle.set_title(label);
        }
        self.toggle_list.set_visible(restore_title.is_some());

        self.reason.set_visible(restore.reason.is_some());
        self.reason
            .set_label(restore.reason.as_deref().unwrap_or_default());
        self.allowed.set(restore.enabled);
        self.restore_label.replace(restore.label.clone());
        self.update_restore();

        self.toolbar.set_reveal_bottom_bars(true);
        self.stack.set_visible_child_name("ready");
    }

    fn render_shown_body(&self) {
        let Some(body) = self.shown_body.borrow().clone() else {
            return;
        };
        let scroll = self.scroller.vadjustment();
        let position = scroll.value();
        while let Some(child) = self.body.first_child() {
            self.body.remove(&child);
        }
        let (widget, diff) = body_widget(&body, adw::StyleManager::default().is_high_contrast());
        if let Some(diff) = &diff {
            self.model.note_font().apply_to(diff);
        }
        self.body.append(&widget);
        self.diff.replace(diff);
        scroll.set_value(position);
        glib::idle_add_local_once(move || scroll.set_value(position));
    }

    fn update_restore(&self) {
        if self.restoring.get() {
            let spinner = adw::Spinner::new();
            label_loading(&spinner);
            self.restore.set_child(Some(&spinner));
        } else {
            self.restore.set_label(&self.restore_label.borrow());
        }
        self.restore
            .set_sensitive(self.allowed.get() && !self.reloading.get() && !self.restoring.get());
    }

    fn restore(self: &Rc<Self>) {
        if self.restoring.get() {
            return;
        }
        self.restoring.set(true);
        self.update_restore();
        let this = self.clone();
        glib::spawn_future_local(async move {
            let result = this
                .model
                .restore_version(this.sha.clone(), this.restore_title())
                .await;
            this.restoring.set(false);
            this.update_restore();
            match result {
                RestoreResult::Done => {
                    if let Some(dialog) = this.dialog.upgrade() {
                        dialog.close();
                    }
                }
                RestoreResult::Failed(message) => {
                    if let Some(toasts) = this.toasts.upgrade() {
                        toasts.add_toast(
                            adw::Toast::builder()
                                .title(message)
                                .use_markup(false)
                                .build(),
                        );
                    }
                }
            }
        });
    }
}

/// The widget for the version's body and, when it is a diff of note text, that diff for the
/// caller to put in the note font.
fn body_widget(body: &PreviewBody, high_contrast: bool) -> (gtk::Widget, Option<gtk::Box>) {
    match body {
        PreviewBody::TooLarge { message } | PreviewBody::Unchanged { message } => (
            gtk::Label::builder()
                .name("version-body-message")
                .label(message)
                .wrap(true)
                .xalign(0.0)
                .css_classes(["dim-label"])
                .build()
                .upcast(),
            None,
        ),
        PreviewBody::Diff {
            items,
            final_newline,
        } => {
            let lines = gtk::Box::builder()
                .name("version-diff")
                .orientation(gtk::Orientation::Vertical)
                .build();
            for item in items {
                match item {
                    DiffItemView::Line { line } => lines.append(&line_widget(line, high_contrast)),
                    DiffItemView::Fold {
                        label,
                        lines: folded,
                    } => {
                        let inner = gtk::Box::builder()
                            .orientation(gtk::Orientation::Vertical)
                            .build();
                        for line in folded {
                            inner.append(&line_widget(line, high_contrast));
                        }
                        lines.append(
                            &gtk::Expander::builder()
                                .label(label)
                                .use_markup(false)
                                .child(&inner)
                                .build(),
                        );
                    }
                }
            }
            if let Some(note) = final_newline {
                lines.append(
                    &gtk::Label::builder()
                        .label(note)
                        .wrap(true)
                        .xalign(0.0)
                        .margin_top(8)
                        .css_classes(["dim-label", "caption"])
                        .build(),
                );
            }
            (lines.clone().upcast(), Some(lines))
        }
    }
}

fn line_widget(line: &DiffLineView, high_contrast: bool) -> gtk::Widget {
    let row = gtk::Box::builder().spacing(6).build();
    match line {
        DiffLineView::Added { .. } => row.add_css_class("diff-added"),
        DiffLineView::Removed { .. } => row.add_css_class("diff-removed"),
        DiffLineView::Same { .. } => {}
    }
    row.append(
        &gtk::Label::builder()
            .label(gutter(line))
            .width_chars(1)
            .xalign(0.5)
            .yalign(0.0)
            .margin_start(4)
            .build(),
    );
    row.append(
        &gtk::Label::builder()
            .use_markup(true)
            .label(line_markup(line, high_contrast))
            .wrap(true)
            .wrap_mode(gtk::pango::WrapMode::WordChar)
            .xalign(0.0)
            .hexpand(true)
            .build(),
    );
    row.upcast()
}

fn gutter(line: &DiffLineView) -> &'static str {
    match line {
        DiffLineView::Same { .. } => " ",
        DiffLineView::Added { .. } => "+",
        DiffLineView::Removed { .. } => "\u{2212}",
    }
}

fn line_markup(line: &DiffLineView, high_contrast: bool) -> String {
    match line {
        DiffLineView::Same { text } => glib::markup_escape_text(text).to_string(),
        DiffLineView::Added { segments } | DiffLineView::Removed { segments } => {
            segment_markup(segments, high_contrast)
        }
    }
}

fn changed_open(high_contrast: bool) -> &'static str {
    if high_contrast {
        CHANGED_OPEN_HIGH_CONTRAST
    } else {
        CHANGED_OPEN
    }
}

fn segment_markup(segments: &[DiffSegment], high_contrast: bool) -> String {
    let mut markup = String::new();
    for segment in segments {
        let text = glib::markup_escape_text(&segment.text);
        if segment.changed {
            markup.push_str(changed_open(high_contrast));
            markup.push_str(&text);
            markup.push_str("</span>");
        } else {
            markup.push_str(&text);
        }
    }
    markup
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(text: &str, changed: bool) -> DiffSegment {
        DiffSegment {
            text: text.to_owned(),
            changed,
        }
    }

    #[test]
    fn segment_text_is_escaped_so_markup_characters_show_literally() {
        let markup = segment_markup(
            &[segment("a <b>&", false), segment("x</span>", true)],
            false,
        );

        assert_eq!(
            markup,
            format!("a &lt;b&gt;&amp;{CHANGED_OPEN}x&lt;/span&gt;</span>")
        );
    }

    #[test]
    fn only_changed_segments_are_emphasised() {
        let markup = segment_markup(&[segment("same ", false), segment("new", true)], false);

        assert_eq!(markup, format!("same {CHANGED_OPEN}new</span>"));
        assert_eq!(segment_markup(&[], false), "");
    }

    #[test]
    fn changed_segments_get_a_stronger_background_in_high_contrast() {
        let markup = segment_markup(&[segment("new", true)], true);

        assert_eq!(markup, format!("{CHANGED_OPEN_HIGH_CONTRAST}new</span>"));
        assert!(markup.contains("#80808099"));
        assert!(CHANGED_OPEN.contains("#80808059"));
    }

    #[test]
    fn unchanged_lines_are_escaped_too() {
        let line = DiffLineView::Same {
            text: "1 < 2 & \"3\"".to_owned(),
        };

        assert_eq!(line_markup(&line, false), "1 &lt; 2 &amp; &quot;3&quot;");
    }

    #[test]
    fn gutter_marks_added_and_removed_lines() {
        let same = DiffLineView::Same {
            text: String::new(),
        };
        let added = DiffLineView::Added {
            segments: Vec::new(),
        };
        let removed = DiffLineView::Removed {
            segments: Vec::new(),
        };

        assert_eq!(gutter(&same), " ");
        assert_eq!(gutter(&added), "+");
        assert_eq!(gutter(&removed), "\u{2212}");
    }
}
