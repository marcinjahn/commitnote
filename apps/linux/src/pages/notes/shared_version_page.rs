use std::cell::RefCell;
use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::commands::{ShareCopy, SharedVersionOutcome};
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use super::note_view::ModelImages;
use crate::editor::MarkdownView;
use crate::model::AppModel;

pub const PAGE_NAME: &str = "shared-version";

struct Page {
    stack: gtk::Stack,
    status: adw::StatusPage,
    heading: gtk::Label,
    date: gtk::Label,
    text: MarkdownView,
    title: String,
}

pub fn page(
    model: &AppModel,
    share_id: String,
    title: &str,
    copy: &ShareCopy,
) -> adw::NavigationPage {
    let loading = gtk::Box::builder()
        .name("shared-version-loading")
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .halign(gtk::Align::Center)
        .valign(gtk::Align::Center)
        .build();
    loading.append(
        &adw::Spinner::builder()
            .width_request(32)
            .height_request(32)
            .build(),
    );
    loading.append(&gtk::Label::new(Some(&copy.loading_shared_version)));

    let status = adw::StatusPage::builder()
        .name("shared-version-message")
        .build();

    let heading = gtk::Label::builder()
        .name("shared-version-name")
        .wrap(true)
        .xalign(0.0)
        .css_classes(["title-3"])
        .build();
    let date = gtk::Label::builder()
        .name("shared-version-date")
        .xalign(0.0)
        .css_classes(["caption", "dim-label"])
        .build();
    let text = MarkdownView::new();
    text.set_widget_name("shared-version-text");
    text.set_image_source(Some(Rc::new(ModelImages(model.downgrade()))));
    let scroller = gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Never)
        .vexpand(true)
        .child(&text)
        .build();
    let header = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(2)
        .margin_top(12)
        .margin_start(12)
        .margin_end(12)
        .build();
    header.append(&heading);
    header.append(&date);
    let ready = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .build();
    ready.append(&header);
    ready.append(&scroller);

    let stack = gtk::Stack::new();
    stack.add_named(&loading, Some("loading"));
    stack.add_named(&status, Some("message"));
    stack.add_named(&ready, Some("ready"));

    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&adw::HeaderBar::new());
    toolbar.set_content(Some(&stack));
    let page = adw::NavigationPage::builder()
        .name(PAGE_NAME)
        .title(&copy.shared_version_title)
        .child(&toolbar)
        .build();

    let state = Page {
        stack,
        status,
        heading,
        date,
        text: text.clone(),
        title: title.to_owned(),
    };

    let image_handler = Rc::new(RefCell::new(Some(model.connect_image_changed({
        let text = text.downgrade();
        move |_, image_id| {
            if let Some(text) = text.upgrade() {
                text.image_changed(image_id);
            }
        }
    }))));
    page.connect_destroy({
        let model = model.downgrade();
        move |_| {
            if let (Some(model), Some(handler)) = (model.upgrade(), image_handler.take()) {
                model.disconnect(handler);
            }
        }
    });

    let model = model.clone();
    glib::spawn_future_local(async move {
        let outcome = model.shared_version(share_id).await;
        match outcome {
            Ok(outcome) => state.show(outcome),
            Err(error) => state.show_message(&error.message),
        }
    });
    page
}

impl Page {
    fn show(&self, outcome: SharedVersionOutcome) {
        match outcome {
            SharedVersionOutcome::Readable {
                name,
                content,
                date,
            } => {
                self.heading
                    .set_label(name.as_deref().unwrap_or(&self.title));
                self.date.set_label(&date);
                self.text.buffer().set_text(&content);
                self.stack.set_visible_child_name("ready");
            }
            SharedVersionOutcome::Message { message }
            | SharedVersionOutcome::Failed { message } => self.show_message(&message),
        }
    }

    fn show_message(&self, message: &str) {
        self.status.set_description(Some(message));
        self.stack.set_visible_child_name("message");
    }
}
