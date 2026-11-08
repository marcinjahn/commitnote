use commitnote_core_api::shapes::{ColorTag, TagOptionView};
use gtk4::prelude::*;
use gtk4::{self as gtk, gdk, gio, glib};

use super::tree_logic::{Siblings, new_folder_parent, tag_id, tag_label};
use crate::model::COLOR_TAGS;

pub const MENU_NAME: &str = "tree-context-menu";

/// The context menu of the row at `path`. `tags` holds the label options when the row offers a
/// color tag submenu.
pub fn menu(path: &[String], folder: bool, tags: Option<&[TagOptionView]>) -> gio::Menu {
    let parent = new_folder_parent(Some((path, folder))).to_variant();
    let target = path.to_vec().to_variant();

    let create = gio::Menu::new();
    create.append_item(&item("New Note", "tree.new-note", Some(&parent)));
    create.append_item(&item("New Folder…", "tree.new-folder", Some(&parent)));

    let organise = gio::Menu::new();
    organise.append_item(&item("Rename", "tree.rename", Some(&target)));
    organise.append_item(&item("Move To…", "tree.move-to", Some(&target)));
    organise.append_item(&item("Move Up", "row.move-up", None));
    organise.append_item(&item("Move Down", "row.move-down", None));

    let menu = gio::Menu::new();
    menu.append_section(None, &create);
    menu.append_section(None, &organise);
    if let Some(options) = tags {
        let choices = gio::Menu::new();
        choices.append_item(&item("None", "row.color-tag", Some(&"".to_variant())));
        for tag in COLOR_TAGS {
            choices.append_item(&item(
                &tag_label(tag, options),
                "row.color-tag",
                Some(&tag_id(tag).to_variant()),
            ));
        }
        let section = gio::Menu::new();
        section.append_submenu(Some("Color Tag"), &choices);
        menu.append_section(None, &section);
    }
    let trash = gio::Menu::new();
    trash.append_item(&item("Move to Trash", "tree.trash", Some(&target)));
    menu.append_section(None, &trash);
    menu
}

/// The `row` actions behind the menu: Move Up and Move Down, enabled only where the row has a
/// sibling to pass, and the color tag radio whose state is the note's tag id (empty for none).
/// They forward to the `tree` actions through `tree`.
pub fn actions(
    tree: &gtk::Widget,
    path: Vec<String>,
    siblings: Siblings,
    tag: Option<ColorTag>,
) -> gio::SimpleActionGroup {
    let group = gio::SimpleActionGroup::new();
    for (name, enabled, forward) in [
        ("move-up", siblings.previous, "tree.move-up"),
        ("move-down", siblings.next, "tree.move-down"),
    ] {
        let action = gio::SimpleAction::new(name, None);
        action.set_enabled(enabled);
        action.connect_activate({
            let (tree, path) = (tree.downgrade(), path.clone());
            move |_, _| {
                if let Some(tree) = tree.upgrade() {
                    let _ = tree.activate_action(forward, Some(&path.to_variant()));
                }
            }
        });
        group.add_action(&action);
    }

    let color = gio::SimpleAction::new_stateful(
        "color-tag",
        Some(glib::VariantTy::STRING),
        &tag.map_or("", tag_id).to_variant(),
    );
    color.connect_change_state({
        let tree = tree.downgrade();
        move |action, value| {
            let (Some(tree), Some(value)) = (tree.upgrade(), value) else {
                return;
            };
            let (Some(id), Some(current)) = (value.str(), action.state()) else {
                return;
            };
            if current.str() == Some(id) {
                return;
            }
            action.set_state(value);
            let parameter = (path.clone(), id.to_owned()).to_variant();
            let _ = tree.activate_action("tree.set-color-tag", Some(&parameter));
        }
    });
    group.add_action(&color);
    group
}

/// The one context menu the tree moves to whichever row it opens on. When it closes with the
/// keyboard focus still inside, the focus goes back to the list.
pub fn popover() -> gtk::PopoverMenu {
    let menu = gtk::PopoverMenu::builder()
        .name(MENU_NAME)
        .has_arrow(false)
        .halign(gtk::Align::Start)
        .position(gtk::PositionType::Bottom)
        .build();
    menu.connect_closed(|menu| {
        let stranded = menu
            .root()
            .and_then(|root| root.focus())
            .is_none_or(|focus| focus.is_ancestor(menu));
        if stranded && let Some(list) = menu.ancestor(gtk::ListView::static_type()) {
            list.grab_focus();
        }
    });
    menu
}

/// Shows `model` with the `row` actions in `menu`, pointing at `at` in `row` coordinates or at
/// the whole row.
pub fn popup(
    menu: &gtk::PopoverMenu,
    row: &gtk::Widget,
    model: &gio::Menu,
    actions: &gio::SimpleActionGroup,
    at: Option<(f64, f64)>,
) {
    if menu.parent().as_ref() != Some(row) {
        menu.unparent();
        menu.set_parent(row);
    }
    menu.set_menu_model(Some(model));
    menu.insert_action_group("row", Some(actions));
    let target = match at {
        Some((x, y)) => gdk::Rectangle::new(x as i32, y as i32, 1, 1),
        None => gdk::Rectangle::new(0, 0, row.width(), row.height()),
    };
    menu.set_pointing_to(Some(&target));
    menu.popup();
}

fn item(label: &str, action: &str, target: Option<&glib::Variant>) -> gio::MenuItem {
    let item = gio::MenuItem::new(Some(label), None);
    item.set_action_and_target_value(Some(action), target);
    item
}
