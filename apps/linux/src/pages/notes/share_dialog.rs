use std::cell::{Cell, RefCell};
use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::Secret;
use commitnote_core_api::commands::{MessagePart, ShareCopy, ShareCreateOutcome};
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use super::share_actions::ShareActions;
use super::share_row;
use crate::model::AppModel;
use crate::window::host_dialog_toasts;

const HIDDEN_PASSWORD: &str = "••••••••";
const COPY_LINK: &str = "Copy Link";
const COPY_PASSWORD: &str = "Copy Password";

struct Created {
    link: String,
    password: Option<Secret>,
}

struct Dialog {
    model: AppModel,
    path: Vec<String>,
    copy: ShareCopy,
    dialog: adw::Dialog,
    page: adw::NavigationPage,
    actions: Rc<ShareActions>,
    form: adw::PreferencesGroup,
    password: adw::PasswordEntryRow,
    label: adw::EntryRow,
    error: gtk::Label,
    create: gtk::Button,
    result: adw::PreferencesGroup,
    link_row: adw::ActionRow,
    password_row: adw::ActionRow,
    copy_link: gtk::Button,
    existing: adw::PreferencesGroup,
    existing_list: gtk::ListBox,
    created: RefCell<Option<Created>>,
    closed: Cell<bool>,
}

pub fn present(
    model: &AppModel,
    anchor: &impl IsA<gtk::Widget>,
    path: Vec<String>,
    copy: &ShareCopy,
) -> adw::Dialog {
    let password = adw::PasswordEntryRow::builder()
        .name("share-password")
        .title(&copy.password_field)
        .activates_default(true)
        .build();
    let label = adw::EntryRow::builder()
        .name("share-label")
        .title(&copy.label_field)
        .activates_default(true)
        .build();
    let hint = gtk::Label::builder()
        .label(&copy.password_hint)
        .css_classes(["caption", "dim-label"])
        .margin_top(6)
        .xalign(0.0)
        .wrap(true)
        .build();
    let error = gtk::Label::builder()
        .name("share-error")
        .accessible_role(gtk::AccessibleRole::Alert)
        .css_classes(["error"])
        .margin_top(6)
        .xalign(0.0)
        .wrap(true)
        .use_markup(true)
        .visible(false)
        .build();
    let create = gtk::Button::builder()
        .name("share-create")
        .label(&copy.create)
        .margin_top(12)
        .halign(gtk::Align::Center)
        .css_classes(["suggested-action", "pill"])
        .build();
    let form = adw::PreferencesGroup::builder()
        .name("share-form")
        .description(glib::markup_escape_text(&copy.explanation))
        .build();
    form.add(&password);
    form.add(&label);
    form.add(&hint);
    form.add(&error);
    form.add(&create);

    let link_row = adw::ActionRow::builder()
        .name("share-link-row")
        .title(&copy.share_link)
        .subtitle_selectable(true)
        .use_markup(false)
        .build();
    let copy_link = copy_button("share-copy-link", COPY_LINK);
    link_row.add_suffix(&copy_link);
    let password_row = adw::ActionRow::builder()
        .name("share-password-row")
        .title(&copy.share_password)
        .subtitle(HIDDEN_PASSWORD)
        .use_markup(false)
        .build();
    let copy_password = copy_button("share-copy-password", COPY_PASSWORD);
    password_row.add_suffix(&copy_password);
    let create_another = gtk::Button::builder()
        .name("share-create-another")
        .label(&copy.create_another)
        .margin_top(6)
        .halign(gtk::Align::Center)
        .css_classes(["flat"])
        .build();
    let result = adw::PreferencesGroup::builder()
        .name("share-result")
        .visible(false)
        .build();
    result.add(&link_row);
    result.add(&password_row);
    result.add(&create_another);

    let existing_list = gtk::ListBox::builder()
        .name("share-existing-list")
        .selection_mode(gtk::SelectionMode::None)
        .css_classes(["boxed-list"])
        .build();
    let existing = adw::PreferencesGroup::builder()
        .name("share-existing")
        .title(glib::markup_escape_text(&copy.shared_links_title))
        .visible(false)
        .build();
    existing.add(&existing_list);

    let preferences = adw::PreferencesPage::new();
    preferences.add(&form);
    preferences.add(&result);
    preferences.add(&existing);

    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&adw::HeaderBar::new());
    toolbar.set_content(Some(&preferences));
    let page = adw::NavigationPage::builder()
        .tag("share")
        .child(&toolbar)
        .build();
    let navigation = adw::NavigationView::new();
    navigation.add(&page);
    let toasts = adw::ToastOverlay::new();
    toasts.set_child(Some(&navigation));

    let dialog = adw::Dialog::builder()
        .name("share-dialog")
        .content_width(480)
        .content_height(560)
        .child(&toasts)
        .default_widget(&create)
        .focus_widget(&password)
        .build();

    let state = Rc::new(Dialog {
        model: model.clone(),
        path,
        copy: copy.clone(),
        dialog: dialog.clone(),
        page,
        actions: ShareActions::new(model, &dialog, &navigation, &toasts),
        form,
        password,
        label,
        error,
        create: create.clone(),
        result,
        link_row,
        password_row,
        copy_link: copy_link.clone(),
        existing,
        existing_list,
        created: RefCell::new(None),
        closed: Cell::new(false),
    });

    create.connect_clicked({
        let state = Rc::downgrade(&state);
        move |_| {
            if let Some(state) = state.upgrade() {
                state.submit();
            }
        }
    });
    create_another.connect_clicked({
        let state = Rc::downgrade(&state);
        move |_| {
            if let Some(state) = state.upgrade() {
                state.show_form();
            }
        }
    });
    copy_link.connect_clicked({
        let state = Rc::downgrade(&state);
        move |_| {
            if let Some(state) = state.upgrade() {
                state.copy_link();
            }
        }
    });
    copy_password.connect_clicked({
        let state = Rc::downgrade(&state);
        move |_| {
            if let Some(state) = state.upgrade() {
                state.copy_password();
            }
        }
    });

    let handler = Rc::new(RefCell::new(Some(model.connect_shares_changed({
        let state = state.clone();
        move |_| state.refresh_existing()
    }))));
    dialog.connect_closed({
        let state = Rc::downgrade(&state);
        let model = model.clone();
        move |_| {
            if let Some(state) = state.upgrade() {
                state.close();
            }
            if let Some(handler) = handler.take() {
                model.disconnect(handler);
            }
        }
    });

    host_dialog_toasts(anchor, &dialog, &toasts);
    state.refresh_existing();
    dialog.present(Some(anchor));
    glib::spawn_future_local(async move { state.load_title().await });
    dialog
}

fn copy_button(name: &str, label: &str) -> gtk::Button {
    let button = gtk::Button::builder()
        .name(name)
        .icon_name("edit-copy-symbolic")
        .tooltip_text(label)
        .valign(gtk::Align::Center)
        .css_classes(["flat"])
        .build();
    button.update_property(&[gtk::accessible::Property::Label(label)]);
    button
}

fn message_markup(parts: &[MessagePart]) -> String {
    parts
        .iter()
        .map(|part| match part {
            MessagePart::Text { text } => glib::markup_escape_text(text).to_string(),
            MessagePart::Link { text, href } => format!(
                "<a href=\"{}\">{}</a>",
                glib::markup_escape_text(href),
                glib::markup_escape_text(text)
            ),
        })
        .collect()
}

impl Dialog {
    async fn load_title(&self) {
        match self.model.share_title(self.path.clone()).await {
            Ok(title) => {
                self.dialog.set_title(&title);
                self.page.set_title(&title);
            }
            Err(error) => {
                self.dialog.force_close();
                self.model.report_error(&error);
            }
        }
    }

    fn refresh_existing(self: &Rc<Self>) {
        let Some(view) = self.model.shares_view() else {
            return;
        };
        let shares = self.model.shares_for(&self.path);
        self.existing_list.remove_all();
        let on_action = self.actions.handler();
        for share in &shares {
            let updating = view.updating_id.as_deref() == Some(share.id.as_str());
            self.existing_list.append(&share_row::row(
                share,
                &view.copy,
                updating,
                on_action.clone(),
            ));
        }
        self.existing.set_visible(!shares.is_empty());
    }

    fn submit(self: &Rc<Self>) {
        if !self.create.is_sensitive() {
            return;
        }
        self.set_creating(true);
        let password = Secret::new(self.password.text());
        let label = self.label.text().to_string();
        let this = self.clone();
        glib::spawn_future_local(async move {
            let outcome = this
                .model
                .create_share(this.path.clone(), password, label)
                .await;
            if this.closed.get() {
                return;
            }
            this.set_creating(false);
            match outcome {
                Ok(ShareCreateOutcome::Created { link, password }) => {
                    this.show_created(Created { link, password });
                }
                Ok(ShareCreateOutcome::Error { parts }) => this.show_error(&message_markup(&parts)),
                Err(error) => this.show_error(&message_markup(&[MessagePart::Text {
                    text: error.message,
                }])),
            }
        });
    }

    fn set_creating(&self, creating: bool) {
        self.error.set_visible(false);
        self.create.set_sensitive(!creating);
        self.create.set_label(if creating {
            &self.copy.creating
        } else {
            &self.copy.create
        });
        self.password.set_sensitive(!creating);
        self.label.set_sensitive(!creating);
    }

    fn show_error(&self, markup: &str) {
        self.error.set_markup(markup);
        self.error.set_visible(true);
        self.password.grab_focus();
    }

    fn show_created(&self, created: Created) {
        self.clear_fields();
        self.link_row.set_subtitle(&created.link);
        self.password_row.set_visible(created.password.is_some());
        *self.created.borrow_mut() = Some(created);
        self.form.set_visible(false);
        self.result.set_visible(true);
        self.copy_link.grab_focus();
    }

    fn show_form(&self) {
        self.created.take();
        self.clear_fields();
        self.result.set_visible(false);
        self.form.set_visible(true);
        self.password.grab_focus();
    }

    fn clear_fields(&self) {
        self.password.set_text("");
        self.label.set_text("");
    }

    fn copy_link(&self) {
        if let Some(created) = &*self.created.borrow() {
            self.dialog.clipboard().set_text(&created.link);
            self.actions.toast(&self.copy.link_copied);
        }
    }

    fn copy_password(&self) {
        if let Some(Created {
            password: Some(password),
            ..
        }) = &*self.created.borrow()
        {
            self.dialog.clipboard().set_text(password.expose());
            self.actions.toast(&self.copy.password_copied);
        }
    }

    fn close(&self) {
        self.closed.set(true);
        self.created.take();
        self.clear_fields();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(text: &str) -> MessagePart {
        MessagePart::Text {
            text: text.to_owned(),
        }
    }

    fn link(text: &str, href: &str) -> MessagePart {
        MessagePart::Link {
            text: text.to_owned(),
            href: href.to_owned(),
        }
    }

    #[test]
    fn text_parts_are_escaped_and_joined() {
        assert_eq!(
            message_markup(&[text("Use <b> & \"quotes\" "), text("it's fine")]),
            "Use &lt;b&gt; &amp; &quot;quotes&quot; it&apos;s fine"
        );
    }

    #[test]
    fn a_link_part_becomes_an_anchor_with_escaped_text_and_target() {
        assert_eq!(
            message_markup(&[
                text("Open "),
                link("Settings <now>", "https://example.com/a?b=1&c=\"2\""),
                text("."),
            ]),
            "Open <a href=\"https://example.com/a?b=1&amp;c=&quot;2&quot;\">Settings &lt;now&gt;</a>."
        );
    }

    #[test]
    fn no_parts_give_no_markup() {
        assert_eq!(message_markup(&[]), "");
    }
}
