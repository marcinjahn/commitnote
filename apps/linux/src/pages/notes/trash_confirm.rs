use adw::prelude::*;
use gtk4 as gtk;
use libadwaita as adw;

use crate::model::{AppModel, TrashResult};

const CANCEL: &str = "cancel";
const CONFIRM: &str = "confirm";

pub async fn ask(
    anchor: &impl IsA<gtk::Widget>,
    name: &str,
    title: &str,
    message: &str,
    confirm_label: &str,
) -> bool {
    let dialog = adw::AlertDialog::new(Some(title), Some(message));
    dialog.set_widget_name(name);
    dialog.add_responses(&[(CANCEL, "_Cancel"), (CONFIRM, confirm_label)]);
    dialog.set_response_appearance(CONFIRM, adw::ResponseAppearance::Destructive);
    dialog.set_default_response(Some(CANCEL));
    dialog.set_close_response(CANCEL);
    dialog.choose_future(Some(anchor)).await == CONFIRM
}

pub async fn move_to_trash(model: AppModel, anchor: gtk::Widget, path: Vec<String>) {
    let mut preview = match model.trash_preview(path.clone()).await {
        Ok(preview) => preview,
        Err(error) => {
            model.report_error(&error);
            return;
        }
    };
    loop {
        let confirmed = ask(
            &anchor,
            "trash-confirm-dialog",
            &preview.title,
            &preview.message,
            &preview.confirm_label,
        )
        .await;
        if !confirmed {
            return;
        }
        match model.trash_node(path.clone(), preview.share_count).await {
            Ok(TrashResult::Trashed | TrashResult::Deleted) => return,
            Ok(TrashResult::Confirm(changed)) => preview = changed,
            Err(error) => {
                model.report_error(&error);
                return;
            }
        }
    }
}
