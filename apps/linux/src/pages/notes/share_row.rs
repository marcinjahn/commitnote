use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::commands::{ShareActionId, ShareCopy, ShareRowView};
use gtk4::{self as gtk, gio};
use libadwaita as adw;

use crate::a11y::label_loading;

pub const ACTION_GROUP: &str = "share";

pub type ActionHandler = Rc<dyn Fn(&ShareRowView, ShareActionId)>;

pub fn action_name(id: ShareActionId) -> &'static str {
    match id {
        ShareActionId::CopyLink => "copy-link",
        ShareActionId::CopyPassword => "copy-password",
        ShareActionId::Update => "update",
        ShareActionId::View => "view",
        ShareActionId::Open => "open",
        ShareActionId::Rename => "rename",
        ShareActionId::Revoke => "revoke",
    }
}

pub fn row(
    share: &ShareRowView,
    copy: &ShareCopy,
    updating: bool,
    on_action: ActionHandler,
) -> adw::ActionRow {
    let row = adw::ActionRow::builder()
        .name(format!("share-row-{}", share.id))
        .title(&share.title)
        .subtitle(subtitle(
            share.label.as_deref(),
            share.note_path.as_deref(),
            &share.date,
        ))
        .use_markup(false)
        .build();
    if share.password_protected {
        let lock = gtk::Image::builder()
            .icon_name("channel-secure-symbolic")
            .tooltip_text(&copy.password_protected)
            .build();
        lock.update_property(&[gtk::accessible::Property::Label("Password Protected")]);
        row.add_prefix(&lock);
    }
    if updating {
        let spinner = adw::Spinner::builder()
            .name("share-updating")
            .valign(gtk::Align::Center)
            .tooltip_text(&copy.updating)
            .build();
        label_loading(&spinner);
        row.add_suffix(&spinner);
    }
    let button = gtk::MenuButton::builder()
        .name("share-menu-button")
        .icon_name("view-more-symbolic")
        .valign(gtk::Align::Center)
        .css_classes(["flat"])
        .tooltip_text(&share.menu_label)
        .menu_model(&menu(share))
        .build();
    button.update_property(&[gtk::accessible::Property::Label(&share.menu_label)]);
    row.add_suffix(&button);
    row.insert_action_group(ACTION_GROUP, Some(&actions(share, on_action)));
    row
}

fn actions(share: &ShareRowView, on_action: ActionHandler) -> gio::SimpleActionGroup {
    let group = gio::SimpleActionGroup::new();
    for view in &share.actions {
        let action = gio::SimpleAction::new(action_name(view.id), None);
        action.set_enabled(!view.disabled);
        action.connect_activate({
            let share = share.clone();
            let on_action = on_action.clone();
            let id = view.id;
            move |_, _| on_action(&share, id)
        });
        group.add_action(&action);
    }
    group
}

fn subtitle(label: Option<&str>, note_path: Option<&[String]>, date: &str) -> String {
    let note_name = note_path.and_then(<[String]>::last);
    match (label.filter(|label| !label.is_empty()), note_name) {
        (Some(label), Some(note_name)) if label != note_name => format!("{note_name} · {date}"),
        _ => date.to_owned(),
    }
}

fn menu(share: &ShareRowView) -> gio::Menu {
    let menu = gio::Menu::new();
    let regular = gio::Menu::new();
    let destructive = gio::Menu::new();
    for action in &share.actions {
        let item = gio::MenuItem::new(
            Some(&action.label),
            Some(&format!("{ACTION_GROUP}.{}", action_name(action.id))),
        );
        if action.destructive {
            destructive.append_item(&item);
        } else {
            regular.append_item(&item);
        }
    }
    menu.append_section(None, &regular);
    menu.append_section(None, &destructive);
    menu
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(segments: &[&str]) -> Vec<String> {
        segments
            .iter()
            .map(|segment| (*segment).to_owned())
            .collect()
    }

    #[test]
    fn the_subtitle_names_the_note_under_a_different_label() {
        assert_eq!(
            subtitle(
                Some("For Sam"),
                Some(&path(&["Projects", "commitnote", "Ideas"])),
                "1 May 2026"
            ),
            "Ideas · 1 May 2026"
        );
    }

    #[test]
    fn the_subtitle_is_the_date_when_the_title_already_names_the_note() {
        let ideas = path(&["Projects", "Ideas"]);
        assert_eq!(
            subtitle(Some("Ideas"), Some(&ideas), "1 May 2026"),
            "1 May 2026"
        );
        assert_eq!(subtitle(None, Some(&ideas), "1 May 2026"), "1 May 2026");
        assert_eq!(subtitle(Some(""), Some(&ideas), "1 May 2026"), "1 May 2026");
    }

    #[test]
    fn the_subtitle_is_the_date_when_the_note_is_gone() {
        assert_eq!(subtitle(Some("For Sam"), None, "1 May 2026"), "1 May 2026");
        assert_eq!(
            subtitle(Some("For Sam"), Some(&[]), "1 May 2026"),
            "1 May 2026"
        );
    }
}
