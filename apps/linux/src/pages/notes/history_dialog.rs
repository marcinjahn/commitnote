use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::commands::{
    HistoryPhase, HistoryRow, HistorySection, HistoryVersionView, HistoryView,
};
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use super::version_preview;
use crate::model::AppModel;
use crate::window::host_dialog_toasts;

struct Dialog {
    model: AppModel,
    dialog: adw::Dialog,
    navigation: adw::NavigationView,
    toasts: adw::ToastOverlay,
    stack: gtk::Stack,
    saving: adw::StatusPage,
    unsaved: adw::StatusPage,
    scroller: gtk::ScrolledWindow,
    list: gtk::Box,
    error_row: gtk::Box,
    error_label: gtk::Label,
    end_label: gtk::Label,
    load_more: gtk::Button,
    spinner: adw::Spinner,
    shown: RefCell<Option<Vec<HistorySection>>>,
    expanded: Rc<RefCell<HashSet<String>>>,
    seen_view: Cell<bool>,
}

pub fn present(model: &AppModel, anchor: &impl IsA<gtk::Widget>) -> adw::Dialog {
    let saving = status_page("history-saving");
    saving.set_child(Some(
        &adw::Spinner::builder()
            .width_request(32)
            .height_request(32)
            .build(),
    ));
    let unsaved = status_page("history-unsaved");
    unsaved.set_icon_name(Some("document-open-recent-symbolic"));

    let list = gtk::Box::builder()
        .name("history-list")
        .orientation(gtk::Orientation::Vertical)
        .spacing(18)
        .build();
    let error_label = gtk::Label::builder()
        .name("history-error")
        .wrap(true)
        .xalign(0.0)
        .hexpand(true)
        .valign(gtk::Align::Center)
        .css_classes(["error"])
        .build();
    let retry = gtk::Button::builder()
        .name("history-retry")
        .label("Retry")
        .valign(gtk::Align::Center)
        .build();
    let error_row = gtk::Box::builder()
        .spacing(12)
        .visible(false)
        .valign(gtk::Align::Center)
        .build();
    error_row.append(&error_label);
    error_row.append(&retry);
    let end_label = gtk::Label::builder()
        .name("history-end")
        .wrap(true)
        .justify(gtk::Justification::Center)
        .css_classes(["dim-label"])
        .visible(false)
        .build();
    let load_more = gtk::Button::builder()
        .name("history-load-more")
        .label("Load Older Versions")
        .halign(gtk::Align::Center)
        .css_classes(["flat"])
        .visible(false)
        .build();
    let spinner = adw::Spinner::builder()
        .width_request(24)
        .height_request(24)
        .halign(gtk::Align::Center)
        .visible(false)
        .build();
    let footer = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .build();
    for child in [
        error_row.upcast_ref::<gtk::Widget>(),
        end_label.upcast_ref(),
        load_more.upcast_ref(),
        spinner.upcast_ref(),
    ] {
        footer.append(child);
    }
    let content = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(18)
        .margin_top(12)
        .margin_bottom(12)
        .margin_start(12)
        .margin_end(12)
        .build();
    content.append(&list);
    content.append(&footer);
    let clamp = adw::Clamp::builder()
        .maximum_size(600)
        .child(&content)
        .build();
    let scroller = gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Never)
        .vexpand(true)
        .child(&clamp)
        .build();

    let stack = gtk::Stack::new();
    stack.add_named(&saving, Some("saving"));
    stack.add_named(&unsaved, Some("unsaved"));
    stack.add_named(&scroller, Some("ready"));

    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&adw::HeaderBar::new());
    toolbar.set_content(Some(&stack));
    let page = adw::NavigationPage::builder()
        .title("History")
        .tag("versions")
        .child(&toolbar)
        .build();
    let navigation = adw::NavigationView::new();
    navigation.add(&page);
    let toasts = adw::ToastOverlay::new();
    toasts.set_child(Some(&navigation));

    let dialog = adw::Dialog::builder()
        .name("history-dialog")
        .title("History")
        .content_width(520)
        .content_height(640)
        .child(&toasts)
        .build();

    let state = Rc::new(Dialog {
        model: model.clone(),
        dialog: dialog.clone(),
        navigation,
        toasts,
        stack,
        saving,
        unsaved,
        scroller,
        list,
        error_row,
        error_label,
        end_label,
        load_more: load_more.clone(),
        spinner,
        shown: RefCell::default(),
        expanded: Rc::default(),
        seen_view: Cell::new(false),
    });

    retry.connect_clicked({
        let model = model.clone();
        move |_| {
            let model = model.clone();
            glib::spawn_future_local(async move { model.retry_history().await });
        }
    });
    load_more.connect_clicked({
        let model = model.clone();
        move |_| {
            let model = model.clone();
            glib::spawn_future_local(async move { model.load_more_history().await });
        }
    });

    let handler = Rc::new(RefCell::new(Some(model.connect_history_changed({
        let state = state.clone();
        move |_| state.refresh()
    }))));
    dialog.connect_closed({
        let model = model.clone();
        move |_| {
            if let Some(handler) = handler.take() {
                model.disconnect(handler);
            }
            if model.history().is_some() {
                let model = model.clone();
                glib::spawn_future_local(async move { model.close_history().await });
            }
        }
    });

    host_dialog_toasts(anchor, &dialog, &state.toasts);
    state.refresh();
    dialog.present(Some(anchor));
    dialog
}

fn status_page(name: &str) -> adw::StatusPage {
    adw::StatusPage::builder().name(name).build()
}

impl Dialog {
    fn refresh(&self) {
        let Some(view) = self.model.history() else {
            if self.seen_view.get() {
                self.dialog.close();
            }
            return;
        };
        self.seen_view.set(true);
        match view.phase {
            HistoryPhase::Saving => {
                self.saving
                    .set_description(Some(view.message.as_deref().unwrap_or_default()));
                self.stack.set_visible_child_name("saving");
            }
            HistoryPhase::Unsaved => {
                self.unsaved
                    .set_description(Some(view.message.as_deref().unwrap_or_default()));
                self.stack.set_visible_child_name("unsaved");
            }
            HistoryPhase::Ready => {
                self.show_ready(&view);
                self.stack.set_visible_child_name("ready");
            }
        }
    }

    fn show_ready(&self, view: &HistoryView) {
        if self.shown.borrow().as_ref() != Some(&view.sections) {
            self.rebuild(&view.sections);
            self.shown.replace(Some(view.sections.clone()));
        }
        self.error_row.set_visible(view.error.is_some());
        self.error_label
            .set_label(view.error.as_deref().unwrap_or_default());
        self.end_label.set_visible(view.end.is_some());
        self.end_label
            .set_label(view.end.as_deref().unwrap_or_default());
        self.load_more
            .set_visible(view.can_load_more && !view.loading);
        self.spinner.set_visible(view.loading);
    }

    fn rebuild(&self, sections: &[HistorySection]) {
        let scroll = self.scroller.vadjustment();
        let position = scroll.value();
        while let Some(child) = self.list.first_child() {
            self.list.remove(&child);
        }
        let mut index = 0;
        for section in sections {
            let group = adw::PreferencesGroup::builder()
                .title(&section.title)
                .build();
            for row in &section.rows {
                group.add(&self.row(row, &mut index));
            }
            self.list.append(&group);
        }
        scroll.set_value(position);
        glib::idle_add_local_once(move || scroll.set_value(position));
    }

    fn row(&self, row: &HistoryRow, index: &mut usize) -> gtk::Widget {
        match row {
            HistoryRow::Single { version } => self.version_row(version, index).upcast(),
            HistoryRow::Session {
                title,
                shared,
                versions,
            } => {
                let expander = adw::ExpanderRow::builder()
                    .title(title)
                    .use_markup(false)
                    .build();
                if *shared {
                    expander.add_suffix(&shared_mark());
                }
                for version in versions {
                    expander.add_row(&self.version_row(version, index));
                }
                let key = session_key(title, versions);
                expander.set_expanded(self.expanded.borrow().contains(&key));
                expander.connect_expanded_notify({
                    let expanded = self.expanded.clone();
                    move |expander| {
                        if expander.is_expanded() {
                            expanded.borrow_mut().insert(key.clone());
                        } else {
                            expanded.borrow_mut().remove(&key);
                        }
                    }
                });
                expander.upcast()
            }
        }
    }

    fn version_row(&self, version: &HistoryVersionView, index: &mut usize) -> adw::ActionRow {
        let row = adw::ActionRow::builder()
            .name(format!("history-version-{index}"))
            .title(&version.time)
            .subtitle(version_subtitle(&version.events, version.name.as_deref()))
            .use_markup(false)
            .activatable(true)
            .build();
        *index += 1;
        if version.current {
            row.add_suffix(&current_mark());
        }
        if version.shared {
            row.add_suffix(&shared_mark());
        }
        row.add_suffix(&gtk::Image::from_icon_name("go-next-symbolic"));
        row.connect_activated({
            let version = version.clone();
            let model = self.model.clone();
            let navigation = self.navigation.downgrade();
            let dialog = self.dialog.downgrade();
            let toasts = self.toasts.downgrade();
            move |_| {
                if let (Some(navigation), Some(dialog), Some(toasts)) =
                    (navigation.upgrade(), dialog.upgrade(), toasts.upgrade())
                {
                    open_version(&model, &navigation, &dialog, &toasts, &version);
                }
            }
        });
        row
    }
}

fn open_version(
    model: &AppModel,
    navigation: &adw::NavigationView,
    dialog: &adw::Dialog,
    toasts: &adw::ToastOverlay,
    version: &HistoryVersionView,
) {
    if navigation
        .visible_page()
        .is_some_and(|page| page.widget_name() == "version-preview")
    {
        return;
    }
    navigation.push(&version_preview::page(model, version, dialog, toasts));
}

fn current_mark() -> gtk::Box {
    mark(None, "Current", "accent")
}

fn shared_mark() -> gtk::Box {
    mark(Some("emblem-shared-symbolic"), "Shared", "dim-label")
}

fn mark(icon: Option<&str>, text: &str, tone: &str) -> gtk::Box {
    let mark = gtk::Box::builder()
        .spacing(4)
        .valign(gtk::Align::Center)
        .css_classes(["history-mark", "pill", tone])
        .build();
    if let Some(icon) = icon {
        mark.append(&gtk::Image::from_icon_name(icon));
    }
    mark.append(&gtk::Label::new(Some(text)));
    mark
}

fn version_subtitle(events: &[String], name: Option<&str>) -> String {
    let events = events.join(", ");
    [Some(events.as_str()), name]
        .into_iter()
        .flatten()
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn session_key(title: &str, versions: &[HistoryVersionView]) -> String {
    versions
        .first()
        .map_or_else(|| title.to_owned(), |version| version.sha.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(sha: &str) -> HistoryVersionView {
        HistoryVersionView {
            sha: sha.to_owned(),
            time: "10:00".to_owned(),
            date_time: "1 May 2026, 10:00".to_owned(),
            current: false,
            shared: false,
            events: Vec::new(),
            name: None,
        }
    }

    #[test]
    fn subtitle_joins_events_and_puts_the_name_on_its_own_line() {
        let events = ["Edited".to_owned(), "Renamed".to_owned()];

        assert_eq!(version_subtitle(&events, None), "Edited, Renamed");
        assert_eq!(
            version_subtitle(&events, Some("Old name")),
            "Edited, Renamed\nOld name"
        );
        assert_eq!(version_subtitle(&[], Some("Old name")), "Old name");
        assert_eq!(version_subtitle(&[], None), "");
        assert_eq!(version_subtitle(&[], Some("")), "");
    }

    #[test]
    fn a_session_is_keyed_by_its_newest_version() {
        assert_eq!(
            session_key("Session", &[version("abc"), version("def")]),
            "abc"
        );
        assert_eq!(session_key("Session", &[]), "Session");
    }
}
