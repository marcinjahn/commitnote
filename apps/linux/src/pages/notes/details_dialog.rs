use std::cell::{Cell, RefCell};
use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::commands::DetailItemText;
use commitnote_core_api::shapes::OpenNote;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use crate::a11y::label_loading;
use crate::model::{AppModel, EditorTarget, NoteDetails};

struct Dialog {
    model: AppModel,
    dialog: adw::Dialog,
    stack: gtk::Stack,
    group: adw::PreferencesGroup,
    rows: RefCell<Vec<adw::ActionRow>>,
    shown: RefCell<Option<Vec<String>>>,
    loading: Cell<bool>,
    again: Cell<bool>,
    closed: Cell<bool>,
}

pub fn present(model: &AppModel, anchor: &impl IsA<gtk::Widget>) -> adw::Dialog {
    let spinner = adw::Spinner::builder()
        .width_request(32)
        .height_request(32)
        .halign(gtk::Align::Center)
        .valign(gtk::Align::Center)
        .build();
    label_loading(&spinner);
    let group = adw::PreferencesGroup::new();
    let page = adw::PreferencesPage::new();
    page.add(&group);
    let stack = gtk::Stack::new();
    stack.add_named(&spinner, Some("loading"));
    stack.add_named(&page, Some("details"));

    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&adw::HeaderBar::new());
    toolbar.set_content(Some(&stack));
    let dialog = adw::Dialog::builder()
        .name("details-dialog")
        .title("Details")
        .content_width(400)
        .follows_content_size(true)
        .child(&toolbar)
        .build();

    let state = Rc::new(Dialog {
        model: model.clone(),
        dialog: dialog.clone(),
        stack,
        group,
        rows: RefCell::default(),
        shown: RefCell::default(),
        loading: Cell::new(false),
        again: Cell::new(false),
        closed: Cell::new(false),
    });
    let handler = Rc::new(RefCell::new(Some(model.connect_open_note_changed({
        let state = state.clone();
        move |_| state.load()
    }))));
    dialog.connect_closed({
        let (model, state) = (model.clone(), state.clone());
        move |_| {
            state.closed.set(true);
            if let Some(handler) = handler.take() {
                model.disconnect(handler);
            }
        }
    });

    dialog.present(Some(anchor));
    state.load();
    dialog
}

impl Dialog {
    fn load(self: &Rc<Self>) {
        if self.closed.get() {
            return;
        }
        if self.loading.get() {
            self.again.set(true);
            return;
        }
        let path = match self.model.editor_target() {
            EditorTarget::Note(path) => path,
            _ => {
                self.dialog.close();
                return;
            }
        };
        match self.model.open_note_state() {
            Some(OpenNote::Loaded { path: loaded, .. }) if loaded == path => {}
            Some(
                OpenNote::Missing { path: failed, .. }
                | OpenNote::Trashed { path: failed, .. }
                | OpenNote::Failed { path: failed, .. },
            ) if failed == path => {
                self.dialog.close();
                return;
            }
            _ => {
                self.stack.set_visible_child_name("loading");
                return;
            }
        }
        if self.shown.borrow().as_ref() != Some(&path) {
            self.stack.set_visible_child_name("loading");
        }
        self.loading.set(true);
        self.again.set(false);
        let state = self.clone();
        glib::spawn_future_local(async move {
            let result = state.model.note_details(path.clone()).await;
            state.loading.set(false);
            if state.closed.get() {
                return;
            }
            let current = matches!(
                state.model.open_note_state(),
                Some(OpenNote::Loaded { path: ref loaded, .. }) if *loaded == path
            );
            if state.again.get() || !current {
                state.load();
                return;
            }
            match result {
                Ok(details) => {
                    state.show(&details);
                    state.shown.replace(Some(path));
                }
                Err(error) => {
                    state.dialog.close();
                    state.model.report_error(&error);
                }
            }
        });
    }

    fn show(&self, details: &NoteDetails) {
        let mut rows = self.rows.borrow_mut();
        for row in rows.drain(..) {
            self.group.remove(&row);
        }
        let mut add = |row: adw::ActionRow| {
            self.group.add(&row);
            rows.push(row);
        };
        add(value_row("details-words", &details.words));
        if let Some(tasks) = &details.tasks {
            add(value_row("details-tasks", tasks));
        }
        if details.not_saved {
            let row = adw::ActionRow::builder()
                .name("details-not-saved")
                .title("Not saved yet")
                .use_markup(false)
                .build();
            add(row);
        } else {
            if let Some(created) = &details.created {
                add(value_row("details-created", created));
            }
            if let Some(updated) = &details.updated {
                add(value_row("details-updated", updated));
            }
        }
        add(value_row(
            "details-shared",
            &DetailItemText {
                label: "Shared".to_owned(),
                value: if details.shared { "Yes" } else { "No" }.to_owned(),
            },
        ));
        self.stack.set_visible_child_name("details");
    }
}

fn value_row(name: &str, item: &DetailItemText) -> adw::ActionRow {
    let value = gtk::Label::builder()
        .name(name)
        .label(&item.value)
        .selectable(true)
        .valign(gtk::Align::Center)
        .css_classes(["dim-label"])
        .build();
    let row = adw::ActionRow::builder()
        .title(&item.label)
        .use_markup(false)
        .build();
    row.add_suffix(&value);
    row
}
