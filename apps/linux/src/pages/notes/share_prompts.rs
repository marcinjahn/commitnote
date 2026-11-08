use adw::prelude::*;
use commitnote_core_api::commands::{ShareCopy, ShareRenameCopy, ShareRowView};
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use super::trash_confirm;
use crate::model::AppModel;

const CANCEL: &str = "cancel";
const CONFIRM: &str = "confirm";

pub fn revoke(
    anchor: &impl IsA<gtk::Widget>,
    model: &AppModel,
    share: &ShareRowView,
    copy: &ShareCopy,
) {
    let (anchor, model, id) = (anchor.clone().upcast(), model.clone(), share.id.clone());
    let (title, message, confirm) = (
        copy.revoke.title.clone(),
        copy.revoke.message.clone(),
        copy.revoke.confirm_label.clone(),
    );
    glib::spawn_future_local(async move {
        if trash_confirm::ask(&anchor, "share-revoke-dialog", &title, &message, &confirm).await {
            model.revoke_share(id).await;
        }
    });
}

pub fn rename(
    anchor: &impl IsA<gtk::Widget>,
    model: &AppModel,
    share: &ShareRowView,
    copy: &ShareCopy,
) {
    let initial = share.label.clone().unwrap_or_default();
    prompt_rename(
        anchor.clone().upcast(),
        model.clone(),
        share.id.clone(),
        copy.rename.clone(),
        initial,
        None,
    );
}

fn prompt_rename(
    anchor: gtk::Widget,
    model: AppModel,
    id: String,
    copy: ShareRenameCopy,
    text: String,
    failure: Option<String>,
) {
    let entry = adw::EntryRow::builder()
        .name("share-rename-entry")
        .title(&copy.field_label)
        .text(&text)
        .activates_default(true)
        .build();
    let fields = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .css_classes(["boxed-list"])
        .build();
    fields.append(&entry);
    let error = gtk::Label::builder()
        .name("share-rename-error")
        .accessible_role(gtk::AccessibleRole::Alert)
        .css_classes(["error"])
        .xalign(0.0)
        .wrap(true)
        .label(failure.as_deref().unwrap_or_default())
        .visible(failure.is_some())
        .build();
    let body = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .build();
    body.append(&fields);
    body.append(&error);

    let dialog = adw::AlertDialog::builder()
        .heading(&copy.title)
        .extra_child(&body)
        .build();
    dialog.set_widget_name("share-rename-dialog");
    dialog.add_responses(&[(CANCEL, "_Cancel"), (CONFIRM, &copy.confirm_label)]);
    dialog.set_response_appearance(CONFIRM, adw::ResponseAppearance::Suggested);
    dialog.set_default_response(Some(CONFIRM));
    dialog.set_close_response(CANCEL);
    dialog.set_focus(Some(&entry));

    entry.connect_changed({
        let error = error.downgrade();
        move |_| {
            if let Some(error) = error.upgrade() {
                error.set_visible(false);
            }
        }
    });
    dialog.connect_response(Some(CONFIRM), {
        let anchor = anchor.clone();
        move |_, _| {
            let (anchor, model, id, copy) =
                (anchor.clone(), model.clone(), id.clone(), copy.clone());
            let label = entry.text().to_string();
            glib::spawn_future_local(async move {
                if let Err(message) = model.rename_share(id.clone(), label.clone()).await {
                    prompt_rename(anchor, model, id, copy, label, Some(message));
                }
            });
        }
    });
    dialog.present(Some(&anchor));
}
