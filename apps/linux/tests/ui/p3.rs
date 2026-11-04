use adw::prelude::*;
use commitnote::editor::NoteEditor;
use commitnote::model::{AppModel, DraftFocus, EditorTarget};
use commitnote::pages::notes::NotesTree;
use commitnote_core_api::commands::NoteDraftOutcome;
use commitnote_core_api::shapes::{OpenNote, TreeNode};
use gtk4::{self as gtk, gdk, glib};
use libadwaita as adw;

use crate::flows::{choose_repository, ensure, launch_and_log_in, submit_token, unlock, wait_tree};
use crate::support::{ALL_VARIANTS, Case, Harness};

pub const CASES: &[Case] = &[
    ("p3-new-folder-shortcut", new_folder_shortcut),
    ("p3-new-folder-error", new_folder_error),
    ("p3-move-to", move_to),
    ("p3-trash-confirm", trash_confirm),
    ("p3-trash-dialog", trash_dialog),
    ("p3-rename-inline", rename_inline),
    ("p3-rename-error", rename_error),
    ("p3-rename-escape", rename_escape),
    ("p3-rename-rebuild", rename_rebuild),
    ("p3-rename-focus-loss", rename_focus_loss),
    ("p3-context-menu-keys", context_menu_keys),
    ("p3-context-menu-click", context_menu_click),
    ("p3-move-sibling-keys", move_sibling_keys),
    ("p3-delete-key", delete_key),
    ("p3-color-tag-menu", color_tag_menu),
    ("p3-drop-into-folder", drop_into_folder),
    ("p3-drop-reorder", drop_reorder),
    ("p3-drop-refused", drop_refused),
    ("p3-drop-end", drop_end),
    ("p3-drop-indicator", drop_indicator),
    ("p3-tag-filter", tag_filter),
    ("p3-note-menu-organise", note_menu_organise),
    ("p3-undo-move", undo_move),
    ("p3-open-note-follows-move", open_note_follows_move),
    ("p3-trash-share-warning", trash_share_warning),
    ("p3-trash-restore-undo", trash_restore_undo),
    ("p3-filter-then-tag", filter_then_tag),
    ("p3-shot-tree-context-menu", shot_tree_context_menu),
    ("p3-shot-trash-dialog", shot_trash_dialog),
];

const TREE_LIST: &str = "notes-tree-list";
const NAME_ROW: &str = "new-folder-name";
const NAME_ERROR: &str = "new-folder-error";
const MOVE_LIST: &str = "move-to-list";
const TRASH_URL: &str = "https://github.com/sample/trash";
const TRASH_CONFIRM: &str = "trash-confirm-dialog";
const TRASH_DIALOG: &str = "trash-dialog";
const RESTORE_LIST: &str = "restore-to-list";
const RENAME_ENTRY: &str = "tree-rename-entry";
const RENAME_ERROR: &str = "tree-rename-error";
const RENAME_ERROR_TEXT: &str = "tree-rename-error-text";
const MENU: &str = "tree-context-menu";
const COMMITNOTE: &[&str] = &["Projects", "commitnote"];
const ROADMAP: &[&str] = &["Projects", "commitnote", "Roadmap"];
const IDEAS: &[&str] = &["Projects", "commitnote", "Ideas"];

fn path(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_owned()).collect()
}

fn find<'a>(nodes: &'a [TreeNode], target: &[String]) -> Option<&'a TreeNode> {
    nodes.iter().find_map(|node| match node {
        TreeNode::Folder { path, .. } | TreeNode::Note { path, .. } if path == target => Some(node),
        TreeNode::Folder { children, .. } => find(children, target),
        TreeNode::Note { .. } => None,
    })
}

fn has_node(h: &Harness, target: &[String]) -> bool {
    h.model()
        .ok()
        .and_then(|model| model.tree())
        .is_some_and(|tree| find(&tree, target).is_some())
}

fn selected_path(h: &Harness) -> Option<Vec<String>> {
    h.widget_as::<NotesTree>("notes-tree")
        .ok()
        .and_then(|tree| tree.selected_path())
}

fn select_top_level(h: &Harness, name: &str) -> Result<(), String> {
    let tree = h.model()?.tree().ok_or("the tree has not loaded")?;
    let position = tree
        .iter()
        .position(|node| match node {
            TreeNode::Folder { path, .. } | TreeNode::Note { path, .. } => {
                path.as_slice() == [name.to_owned()]
            }
        })
        .ok_or_else(|| "the sample repository lacks a top-level item".to_owned())?;
    h.widget_as::<gtk::ListView>(TREE_LIST)?.scroll_to(
        u32::try_from(position).map_err(|error| error.to_string())?,
        gtk::ListScrollFlags::FOCUS | gtk::ListScrollFlags::SELECT,
        None,
    );
    let expected = path(&[name]);
    h.wait("the item to be selected", || {
        selected_path(h).as_ref() == Some(&expected)
    })
}

fn open_new_folder_dialog(h: &Harness) -> Result<(), String> {
    h.press_keys("<Control><Shift>n")?;
    h.wait_shown(NAME_ROW)?;
    h.wait("the name field to take focus", || {
        h.widget(NAME_ROW)
            .is_ok_and(|row| row.focus_child().is_some())
    })
}

fn enter_name(h: &Harness, name: &str) -> Result<(), String> {
    h.type_keys(name)?;
    h.wait("the typed name", || {
        h.text(NAME_ROW).is_ok_and(|text| text == name)
    })?;
    h.type_keys("\n")
}

fn new_folder_shortcut(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    select_top_level(h, "Projects")?;

    open_new_folder_dialog(h)?;
    ensure(
        h.widget("new-folder-create")
            .is_ok_and(|button| !button.is_sensitive()),
        || "Create is sensitive with an empty name".to_owned(),
    )?;
    ensure(!h.shown(NAME_ERROR), || {
        "the error is shown before any attempt".to_owned()
    })?;
    enter_name(h, "Notes Archive")?;

    let created = path(&["Projects", "Notes Archive"]);
    h.wait("the new folder to appear selected", || {
        has_node(h, &created) && selected_path(h).as_ref() == Some(&created)
    })?;
    h.wait("the dialog to close", || !h.shown(NAME_ROW))?;
    ensure(has_node(h, &path(&["Projects", "commitnote"])), || {
        "the existing folder vanished".to_owned()
    })
}

fn new_folder_error(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    select_top_level(h, "Projects")?;

    open_new_folder_dialog(h)?;
    enter_name(h, "commitnote")?;
    h.wait("the duplicate name error", || {
        h.shown(NAME_ERROR) && h.label(NAME_ERROR).is_ok_and(|text| !text.is_empty())
    })?;
    ensure(h.shown(NAME_ROW), || {
        "the dialog closed on an error".to_owned()
    })?;
    ensure(
        h.widget(NAME_ROW)
            .is_ok_and(|row| row.focus_child().is_some()),
        || "the name field lost focus after the error".to_owned(),
    )?;

    h.type_keys("2")?;
    h.wait("the error to clear while editing", || !h.shown(NAME_ERROR))?;
    h.press_keys("Escape")?;
    h.wait("the dialog to close", || !h.shown(NAME_ROW))?;
    ensure(!has_node(h, &path(&["Projects", "commitnote2"])), || {
        "a folder was created after the dialog was cancelled".to_owned()
    })
}

fn move_rows(h: &Harness) -> Result<Vec<(String, bool)>, String> {
    let list = h.widget_as::<gtk::ListBox>(MOVE_LIST)?;
    Ok((0..)
        .map_while(|index| list.row_at_index(index))
        .map(|row| {
            let label = row
                .child()
                .and_downcast::<gtk::Label>()
                .map(|label| label.label().to_string())
                .unwrap_or_default();
            (label, row.is_sensitive())
        })
        .collect())
}

fn open_move_dialog(h: &Harness, target: &[&str]) -> Result<Vec<(String, bool)>, String> {
    let list = h.widget(TREE_LIST)?;
    WidgetExt::activate_action(&list, "tree.move-to", Some(&path(target).to_variant()))
        .map_err(|error| format!("cannot activate tree.move-to: {error}"))?;
    h.wait_shown(MOVE_LIST)?;
    h.wait("the move targets", || {
        move_rows(h).is_ok_and(|rows| !rows.is_empty())
    })?;
    move_rows(h)
}

fn move_to(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;

    let rows = open_move_dialog(h, &["Projects"])?;
    ensure(rows.iter().any(|(_, sensitive)| !sensitive), || {
        "no target is disabled when moving a folder".to_owned()
    })?;
    ensure(
        rows.iter()
            .all(|(label, _)| label != "Projects" && label != "commitnote"),
        || "the folder's own subtree is offered as a target".to_owned(),
    )?;
    h.press_keys("Escape")?;
    h.wait("the picker to close", || !h.shown(MOVE_LIST))?;

    let rows = open_move_dialog(h, &["Welcome"])?;
    let index = rows
        .iter()
        .position(|(label, sensitive)| label == "Journal" && *sensitive)
        .ok_or("Journal is not an enabled target")?;
    h.activate_row(&format!("move-to-row-{index}"))?;

    let moved = path(&["Journal", "Welcome"]);
    h.wait("the note to move and be selected", || {
        has_node(h, &moved)
            && !has_node(h, &path(&["Welcome"]))
            && selected_path(h).as_ref() == Some(&moved)
    })?;
    h.wait("the picker to close", || !h.shown(MOVE_LIST))
}

fn button_labelled(root: &gtk::Widget, label: &str) -> Option<gtk::Button> {
    let mut child = root.first_child();
    while let Some(widget) = child {
        if let Some(button) = widget.downcast_ref::<gtk::Button>()
            && button.label().as_deref() == Some(label)
            && button.is_mapped()
        {
            return Some(button.clone());
        }
        if let Some(found) = button_labelled(&widget, label) {
            return Some(found);
        }
        child = widget.next_sibling();
    }
    None
}

fn find_labelled(h: &Harness, label: &str) -> Option<gtk::Button> {
    let window = h.window().ok()?;
    button_labelled(window.upcast_ref(), label)
}

fn click_labelled(h: &Harness, label: &str) -> Result<(), String> {
    h.wait(&format!("the {label} button"), || {
        find_labelled(h, label).is_some()
    })?;
    find_labelled(h, label)
        .ok_or_else(|| format!("no button is labelled {label}"))?
        .emit_clicked();
    Ok(())
}

fn trash_node_action(h: &Harness, target: &[&str]) -> Result<(), String> {
    let list = h.widget(TREE_LIST)?;
    WidgetExt::activate_action(&list, "tree.trash", Some(&path(target).to_variant()))
        .map_err(|error| format!("cannot activate tree.trash: {error}"))
}

fn trash_confirm(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let welcome = path(&["Welcome"]);
    let model = h.model()?;
    let preview = h
        .run("the trash preview", {
            let (model, welcome) = (model.clone(), welcome.clone());
            async move { model.trash_preview(welcome).await }
        })?
        .map_err(|error| error.message)?;

    trash_node_action(h, &["Welcome"])?;
    h.wait_shown(TRASH_CONFIRM)?;
    let alert = h.widget_as::<adw::AlertDialog>(TRASH_CONFIRM)?;
    ensure(!preview.title.is_empty(), || {
        "the core gave an empty title".to_owned()
    })?;
    ensure(
        alert.heading().as_deref() == Some(preview.title.as_str()),
        || "the heading is not the core's title".to_owned(),
    )?;
    ensure(alert.body() == preview.message, || {
        "the body is not the core's message".to_owned()
    })?;
    ensure(
        alert.response_label("confirm") == preview.confirm_label,
        || "the confirm label is not the core's".to_owned(),
    )?;
    ensure(
        alert.response_appearance("confirm") == adw::ResponseAppearance::Destructive,
        || "the confirm response is not destructive".to_owned(),
    )?;
    ensure(
        alert.default_response().as_deref() == Some("cancel"),
        || "Cancel is not the default response".to_owned(),
    )?;

    click_labelled(h, "_Cancel")?;
    h.wait("the alert to close", || !h.shown(TRASH_CONFIRM))?;
    ensure(has_node(h, &welcome), || {
        "the note was trashed after Cancel".to_owned()
    })?;

    h.wait("the alert to appear again", || {
        trash_node_action(h, &["Welcome"]).is_ok() && h.shown(TRASH_CONFIRM)
    })?;
    click_labelled(h, &preview.confirm_label)?;
    h.wait("the note to leave the tree", || !has_node(h, &welcome))?;
    click_labelled(h, "Undo")?;
    h.wait("the note to come back", || has_node(h, &welcome))
}

fn trash_entry(h: &Harness, name: &str) -> Option<commitnote_core_api::shapes::TrashEntryView> {
    h.model()
        .ok()?
        .trash()?
        .entries
        .into_iter()
        .find(|entry| entry.name == name)
}

fn click_in_row(h: &Harness, title: &str, button: &str) -> Result<(), String> {
    let row = h.row_titled(title)?;
    let button = h.widget_in(row.upcast_ref(), button)?;
    let button = button
        .downcast::<gtk::Button>()
        .map_err(|_| "not a button".to_owned())?;
    ensure(button.is_sensitive() && button.is_mapped(), || {
        format!("a button in the {title} row cannot be clicked")
    })?;
    button.emit_clicked();
    Ok(())
}

fn restore_to(
    h: &Harness,
    title: &str,
    entry: &str,
    sub_path: Vec<String>,
    destination: &[String],
) -> Result<(), String> {
    let id = trash_entry(h, entry)
        .ok_or_else(|| format!("{entry} is not in the trash"))?
        .id;
    let targets = h
        .run("the restore targets", {
            let model = h.model()?;
            async move { model.restore_targets(id, sub_path).await }
        })?
        .map_err(|error| error.message)?;
    let index = targets
        .iter()
        .position(|target| target.path == destination && !target.disabled)
        .ok_or("the destination is not a restore target")?;

    click_in_row(h, title, "trash-restore-button")?;
    h.wait_shown(RESTORE_LIST)?;
    h.wait("the restore targets", || {
        h.widget(&format!("restore-to-row-{index}")).is_ok()
    })?;
    h.activate_row(&format!("restore-to-row-{index}"))?;
    h.wait("the picker to close", || !h.shown(RESTORE_LIST))
}

async fn create_note(model: &AppModel, parent: Vec<String>, name: &str) -> Result<(), String> {
    model
        .start_draft(parent, DraftFocus::Name)
        .await
        .map_err(|error| error.message)?;
    model.set_draft_name(name.to_owned());
    match model.commit_draft_name().await {
        NoteDraftOutcome::Created { .. } => Ok(()),
        _ => Err("the note was not created".to_owned()),
    }
}

fn trash_dialog(h: &mut Harness) -> Result<(), String> {
    h.launch()?;
    submit_token(h)?;
    choose_repository(h, TRASH_URL)?;
    unlock(h, false)?;
    wait_tree(h)?;
    let model = h.model()?;
    h.wait("the trash state", || model.trash().is_some())?;
    let welcome = path(&["Welcome"]);
    let sketches = path(&["Sketches"]);

    h.run("creating notes", {
        let model = model.clone();
        async move {
            create_note(&model, path(&["Archive"]), "Extra").await?;
            create_note(&model, Vec::new(), "Sketches").await
        }
    })??;
    h.wait("the new notes", || {
        has_node(h, &path(&["Archive", "Extra"])) && has_node(h, &sketches)
    })?;
    for target in [&welcome, &sketches, &path(&["Archive"])] {
        let name = target.last().cloned().unwrap_or_default();
        h.run("trashing an item", {
            let (model, target) = (model.clone(), target.clone());
            async move {
                let preview = model.trash_preview(target.clone()).await?;
                model.trash_node(target, preview.share_count).await
            }
        })?
        .map_err(|error| error.message)?;
        h.wait("the item in the trash", || trash_entry(h, &name).is_some())?;
    }
    h.wait("the trashed items to leave the tree", || {
        !has_node(h, &path(&["Archive"])) && !has_node(h, &welcome) && !has_node(h, &sketches)
    })?;

    let list = h.widget(TREE_LIST)?;
    WidgetExt::activate_action(&list, "notes.show-trash", None)
        .map_err(|error| format!("cannot activate notes.show-trash: {error}"))?;
    h.wait_shown(TRASH_DIALOG)?;
    h.wait("the trash rows", || {
        ["Welcome", "Archive", "Sketches"]
            .iter()
            .all(|title| h.row_titled(title).is_ok_and(|row| row.is_mapped()))
    })?;
    ensure(
        h.widget("trash-empty-button")
            .is_ok_and(|button| button.is_sensitive()),
        || "Empty Trash is insensitive with entries".to_owned(),
    )?;

    restore_to(h, "Welcome", "Welcome", Vec::new(), &[])?;
    h.wait("Welcome to be restored and selected", || {
        has_node(h, &welcome)
            && selected_path(h).as_ref() == Some(&welcome)
            && trash_entry(h, "Welcome").is_none()
            && h.row_titled("Welcome").is_err()
    })?;
    ensure(h.shown(TRASH_DIALOG), || {
        "the trash dialog closed after a restore".to_owned()
    })?;

    let archive = h
        .row_titled("Archive")?
        .downcast::<adw::ExpanderRow>()
        .map_err(|_| "the Archive row is not an expander".to_owned())?;
    archive.set_expanded(true);
    h.wait("the nested rows", || {
        ["Kept note", "Extra"]
            .iter()
            .all(|title| h.row_titled(title).is_ok_and(|row| row.is_mapped()))
    })?;
    let sub_path = trash_entry(h, "Archive")
        .and_then(|entry| {
            entry
                .children
                .iter()
                .find(|item| item.name == "Kept note")
                .map(|item| item.sub_path.clone())
        })
        .ok_or("Archive has no Kept note")?;
    restore_to(h, "Kept note", "Archive", sub_path, &[])?;
    let kept = path(&["Kept note"]);
    h.wait("Kept note to be restored and selected", || {
        has_node(h, &kept) && selected_path(h).as_ref() == Some(&kept)
    })?;
    h.wait("Kept note to leave the trash", || {
        trash_entry(h, "Archive")
            .is_some_and(|entry| entry.children.iter().all(|item| item.name != "Kept note"))
            && h.row_titled("Kept note").is_err()
    })?;
    ensure(
        h.row_titled("Extra").is_ok_and(|row| row.is_mapped()),
        || "Extra is not shown under the expanded Archive".to_owned(),
    )?;

    click_in_row(h, "Sketches", "trash-delete-button")?;
    h.wait_shown("trash-delete-dialog")?;
    let expected = model
        .trash()
        .ok_or("the trash state is missing")?
        .delete_confirmation;
    let alert = h.widget_as::<adw::AlertDialog>("trash-delete-dialog")?;
    ensure(
        alert.heading().as_deref() == Some(expected.title.as_str())
            && alert.body() == expected.message,
        || "the delete alert is not the core's text".to_owned(),
    )?;
    ensure(
        alert.response_appearance("confirm") == adw::ResponseAppearance::Destructive,
        || "Delete is not destructive".to_owned(),
    )?;
    click_labelled(h, "_Cancel")?;
    h.wait("the alert to close", || !h.shown("trash-delete-dialog"))?;
    ensure(trash_entry(h, "Sketches").is_some(), || {
        "Sketches was deleted after Cancel".to_owned()
    })?;
    click_in_row(h, "Sketches", "trash-delete-button")?;
    h.wait_shown("trash-delete-dialog")?;
    click_labelled(h, "_Delete")?;
    h.wait("Sketches to be deleted", || {
        trash_entry(h, "Sketches").is_none() && h.row_titled("Sketches").is_err()
    })?;

    h.click("trash-empty-button")?;
    h.wait_shown("trash-empty-dialog")?;
    let expected = model
        .trash()
        .ok_or("the trash state is missing")?
        .empty_confirmation;
    let alert = h.widget_as::<adw::AlertDialog>("trash-empty-dialog")?;
    ensure(
        alert.heading().as_deref() == Some(expected.title.as_str())
            && alert.body() == expected.message,
        || "the empty alert is not the core's text".to_owned(),
    )?;
    click_labelled(h, "_Empty Trash")?;
    h.wait("the trash to empty", || {
        model.trash().is_some_and(|trash| trash.entries.is_empty())
            && h.label_shown_with("Trash Is Empty")
    })?;
    ensure(
        h.widget("trash-empty-button")
            .is_ok_and(|button| !button.is_sensitive()),
        || "Empty Trash is sensitive with an empty trash".to_owned(),
    )?;
    ensure(has_node(h, &welcome) && has_node(h, &kept), || {
        "restored notes vanished with the empty trash".to_owned()
    })
}

fn rename_entry_focused(h: &Harness) -> bool {
    h.shown(RENAME_ENTRY)
        && h.widget(RENAME_ENTRY)
            .is_ok_and(|entry| entry.focus_child().is_some())
}

fn tree_focused(h: &Harness) -> bool {
    let (Ok(window), Ok(list)) = (h.window(), h.widget(TREE_LIST)) else {
        return false;
    };
    GtkWindowExt::focus(&window).is_some_and(|focus| {
        (focus == list || focus.is_ancestor(&list))
            && focus.ancestor(gtk::Popover::static_type()).is_none()
    })
}

fn start_rename(h: &Harness, name: &str) -> Result<(), String> {
    select_top_level(h, name)?;
    h.widget(TREE_LIST)?.grab_focus();
    h.wait("the tree to have focus", || tree_focused(h))?;
    h.press_keys("F2")?;
    h.wait("the rename entry to take focus", || rename_entry_focused(h))?;
    ensure(h.text(RENAME_ENTRY)? == name, || {
        "the entry does not start with the current name".to_owned()
    })
}

fn type_into_rename(h: &Harness, text: &str, expected: &str) -> Result<(), String> {
    h.type_keys(text)?;
    h.wait("the typed name", || {
        h.text(RENAME_ENTRY).is_ok_and(|text| text == expected)
    })
}

fn rename_has_error(h: &Harness) -> bool {
    h.widget(RENAME_ENTRY)
        .is_ok_and(|entry| entry.has_css_class("error"))
}

fn rename_inline(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    start_rename(h, "Welcome")?;
    type_into_rename(h, "Hello", "Hello")?;
    h.type_keys("\n")?;

    let renamed = path(&["Hello"]);
    h.wait("the renamed note to appear selected", || {
        has_node(h, &renamed)
            && !has_node(h, &path(&["Welcome"]))
            && selected_path(h).as_ref() == Some(&renamed)
    })?;
    h.wait("the entry to give way to the name", || {
        !h.shown(RENAME_ENTRY) && h.label_shown_with("Hello")
    })?;
    h.wait("the tree to have focus", || tree_focused(h))
}

fn rename_error(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let welcome = path(&["Welcome"]);
    let expected = h
        .run("the core's message", {
            let model = h.model()?;
            let welcome = welcome.clone();
            async move { model.rename_node(welcome, "Journal".to_owned()).await }
        })?
        .err()
        .ok_or("the core accepted a duplicate name")?
        .message;

    start_rename(h, "Welcome")?;
    type_into_rename(h, "Journal", "Journal")?;
    h.type_keys("\n")?;
    h.wait("the error to show", || h.shown(RENAME_ERROR))?;
    ensure(h.label(RENAME_ERROR_TEXT)? == expected, || {
        "the error is not the core's message".to_owned()
    })?;
    ensure(rename_has_error(h), || {
        "the entry lacks the error class".to_owned()
    })?;
    ensure(rename_entry_focused(h), || {
        "the entry lost focus after the error".to_owned()
    })?;

    type_into_rename(h, "x", "Journalx")?;
    h.wait("the error to clear while typing", || {
        !h.shown(RENAME_ERROR) && !rename_has_error(h)
    })?;
    h.press_keys("BackSpace")?;
    h.wait("the text without the extra letter", || {
        h.text(RENAME_ENTRY).is_ok_and(|text| text == "Journal")
    })?;
    h.type_keys("\n")?;
    h.wait("the error to show again", || {
        h.shown(RENAME_ERROR) && rename_has_error(h)
    })?;

    h.press_keys("Escape")?;
    h.wait("the entry and the error to go away", || {
        !h.shown(RENAME_ENTRY) && !h.shown(RENAME_ERROR)
    })?;
    h.wait("the tree to have focus", || tree_focused(h))?;
    ensure(
        has_node(h, &welcome) && has_node(h, &path(&["Journal"])),
        || "Escape changed the tree".to_owned(),
    )?;
    ensure(selected_path(h).as_ref() == Some(&welcome), || {
        "the row is not selected after Escape".to_owned()
    })?;
    ensure(h.label_shown_with("Welcome"), || {
        "the old name is not shown".to_owned()
    })
}

fn rename_escape(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let projects = path(&["Projects"]);
    start_rename(h, "Projects")?;
    type_into_rename(h, "Other", "Other")?;
    h.press_keys("Escape")?;

    h.wait("the entry to go away", || !h.shown(RENAME_ENTRY))?;
    h.wait("the tree to have focus", || tree_focused(h))?;
    ensure(
        has_node(h, &projects) && !has_node(h, &path(&["Other"])),
        || "Escape renamed the folder".to_owned(),
    )?;
    ensure(selected_path(h).as_ref() == Some(&projects), || {
        "the folder is not selected after Escape".to_owned()
    })?;
    ensure(h.label_shown_with("Projects"), || {
        "the old name is not shown".to_owned()
    })
}

fn rename_rebuild(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    start_rename(h, "Welcome")?;
    type_into_rename(h, "Hel", "Hel")?;

    let extra = path(&["Extra"]);
    h.run("creating a folder", {
        let model = h.model()?;
        async move { model.create_folder(Vec::new(), "Extra".to_owned()).await }
    })?
    .map_err(|error| error.message)?;
    h.wait("the tree to rebuild", || has_node(h, &extra))?;
    h.wait("the entry to keep its text and focus", || {
        rename_entry_focused(h) && h.text(RENAME_ENTRY).is_ok_and(|text| text == "Hel")
    })?;
    ensure(
        h.widget_as::<gtk::Entry>(RENAME_ENTRY)?.position() == 3,
        || "the caret is not at the end of the text".to_owned(),
    )?;

    type_into_rename(h, "lo", "Hello")?;
    h.type_keys("\n")?;
    let renamed = path(&["Hello"]);
    h.wait("the renamed note to appear selected", || {
        has_node(h, &renamed)
            && !has_node(h, &path(&["Welcome"]))
            && selected_path(h).as_ref() == Some(&renamed)
    })
}

fn rename_focus_loss(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    start_rename(h, "Welcome")?;
    type_into_rename(h, "Hello", "Hello")?;
    h.widget(TREE_LIST)?.grab_focus();
    h.wait("the note to be renamed", || {
        has_node(h, &path(&["Hello"])) && !has_node(h, &path(&["Welcome"]))
    })?;
    h.wait("the entry to go away", || !h.shown(RENAME_ENTRY))?;

    let journal = path(&["Journal"]);
    let message = h
        .run("the core's message", {
            let model = h.model()?;
            let journal = journal.clone();
            async move { model.rename_node(journal, "Hello".to_owned()).await }
        })?
        .err()
        .ok_or("the core accepted a duplicate name")?
        .message;
    start_rename(h, "Journal")?;
    type_into_rename(h, "Hello", "Hello")?;
    h.widget(TREE_LIST)?.grab_focus();
    h.wait("the failure to show as a toast", || {
        h.label_shown_with(&message)
    })?;
    h.wait("the entry to go away", || {
        !h.shown(RENAME_ENTRY) && !h.shown(RENAME_ERROR)
    })?;
    ensure(has_node(h, &journal), || {
        "the folder vanished after a failed rename".to_owned()
    })
}

fn node_name(node: &TreeNode) -> String {
    match node {
        TreeNode::Folder { name, .. } | TreeNode::Note { name, .. } => name.clone(),
    }
}

fn child_names(h: &Harness, parent: &[&str]) -> Vec<String> {
    let Some(tree) = h.model().ok().and_then(|model| model.tree()) else {
        return Vec::new();
    };
    if parent.is_empty() {
        return tree.iter().map(node_name).collect();
    }
    match find(&tree, &path(parent)) {
        Some(TreeNode::Folder { children, .. }) => children.iter().map(node_name).collect(),
        _ => Vec::new(),
    }
}

fn select_path(h: &Harness, target: &[&str]) -> Result<(), String> {
    let expected = path(target);
    h.widget_as::<NotesTree>("notes-tree")?
        .reveal(expected.clone());
    h.wait("the item to be selected", || {
        selected_path(h).as_ref() == Some(&expected)
    })?;
    h.widget(TREE_LIST)?.grab_focus();
    h.wait("the tree to have focus", || tree_focused(h))
}

fn widgets_under(root: &gtk::Widget) -> Vec<gtk::Widget> {
    let mut found = Vec::new();
    let mut pending = vec![root.clone()];
    while let Some(widget) = pending.pop() {
        let mut child = widget.first_child();
        while let Some(current) = child {
            child = current.next_sibling();
            pending.push(current.clone());
            found.push(current);
        }
    }
    found
}

fn row_expander(h: &Harness, name: &str) -> Result<gtk::TreeExpander, String> {
    widgets_under(&h.widget(TREE_LIST)?)
        .into_iter()
        .filter_map(|widget| widget.downcast::<gtk::Label>().ok())
        .find(|label| label.is_mapped() && label.label() == name)
        .and_then(|label| label.ancestor(gtk::TreeExpander::static_type()))
        .and_then(|widget| widget.downcast::<gtk::TreeExpander>().ok())
        .ok_or_else(|| format!("no row shows {name}"))
}

fn right_click(expander: &gtk::TreeExpander) -> Result<(), String> {
    let controllers = expander.observe_controllers();
    let gesture = (0..controllers.n_items())
        .filter_map(|index| controllers.item(index))
        .filter_map(|controller| controller.downcast::<gtk::GestureClick>().ok())
        .find(|gesture| gesture.button() == gdk::BUTTON_SECONDARY)
        .ok_or("the row has no secondary click gesture")?;
    let y = f64::from(expander.height()) / 2.0;
    gesture.emit_by_name::<()>("pressed", &[&1i32, &8f64, &y]);
    Ok(())
}

/// Opens the menu of the row showing `row` with `open`. The session has no pointer, so the
/// compositor refuses the grab an autohiding menu needs and dismisses it, and a grab taken on a
/// key press leaves the harness keyboard without a window: the menu opens with autohide off.
fn open_menu(
    h: &Harness,
    row: &str,
    open: impl Fn(&Harness) -> Result<(), String>,
) -> Result<gtk::PopoverMenu, String> {
    let expander = row_expander(h, row)?;
    h.wait("the context menu to be in the window", || {
        h.widget(MENU).is_ok()
    })?;
    let menu = h.widget_as::<gtk::PopoverMenu>(MENU)?;
    menu.set_autohide(false);
    open(h)?;
    h.wait(&format!("the {row} menu to show"), || {
        menu.is_mapped()
            && menu
                .parent()
                .and_then(|row| row.parent())
                .is_some_and(|parent| parent == *expander.upcast_ref::<gtk::Widget>())
    })?;
    Ok(menu)
}

fn close_menu(h: &Harness, menu: &gtk::PopoverMenu) -> Result<(), String> {
    menu.popdown();
    h.wait("the menu to close", || !h.shown(MENU))
}

fn press_menu_keys(keys: &'static str) -> impl Fn(&Harness) -> Result<(), String> {
    move |h| {
        h.wait("the tree to have focus", || tree_focused(h))?;
        h.press_keys(keys)
    }
}

fn string_attribute(model: &gtk::gio::MenuModel, index: i32, name: &str) -> Option<String> {
    model
        .item_attribute_value(index, name, Some(glib::VariantTy::STRING))
        .and_then(|value| value.get::<String>())
}

fn menu_sections(menu: &gtk::PopoverMenu) -> Vec<Vec<String>> {
    let Some(model) = menu.menu_model() else {
        return Vec::new();
    };
    (0..model.n_items())
        .map(|index| {
            model
                .item_link(index, "section")
                .map(|section| {
                    (0..section.n_items())
                        .filter_map(|item| string_attribute(&section, item, "label"))
                        .collect()
                })
                .unwrap_or_default()
        })
        .collect()
}

/// The (label, target) pairs of the Color Tag submenu.
fn color_choices(menu: &gtk::PopoverMenu) -> Vec<(String, String)> {
    let Some(model) = menu.menu_model() else {
        return Vec::new();
    };
    (0..model.n_items())
        .filter_map(|index| model.item_link(index, "section"))
        .filter_map(|section| {
            (0..section.n_items()).find_map(|item| section.item_link(item, "submenu"))
        })
        .flat_map(|submenu| {
            (0..submenu.n_items())
                .filter_map(|item| {
                    Some((
                        string_attribute(&submenu, item, "label")?,
                        string_attribute(&submenu, item, "target")?,
                    ))
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn sections(groups: &[&[&str]]) -> Vec<Vec<String>> {
    groups.iter().map(|group| path(group)).collect()
}

fn note_sections() -> Vec<Vec<String>> {
    sections(&[
        &["New Note", "New Folder…"],
        &["Rename", "Move To…", "Move Up", "Move Down"],
        &["Color Tag"],
        &["Move to Trash"],
    ])
}

fn folder_sections() -> Vec<Vec<String>> {
    sections(&[
        &["New Note", "New Folder…"],
        &["Rename", "Move To…", "Move Up", "Move Down"],
        &["Move to Trash"],
    ])
}

fn menu_button(menu: &gtk::PopoverMenu, label: &str) -> Option<gtk::Widget> {
    widgets_under(menu.upcast_ref()).into_iter().find(|widget| {
        widget.type_().name() == "GtkModelButton"
            && widget.property::<Option<String>>("text").as_deref() == Some(label)
    })
}

fn ensure_move_buttons(menu: &gtk::PopoverMenu, up: bool, down: bool) -> Result<(), String> {
    for (label, enabled) in [("Move Up", up), ("Move Down", down)] {
        let button = menu_button(menu, label).ok_or_else(|| format!("the menu lacks {label}"))?;
        ensure(button.is_sensitive() == enabled, || {
            format!(
                "{label} is not {}",
                if enabled { "enabled" } else { "disabled" }
            )
        })?;
    }
    Ok(())
}

fn context_menu_keys(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    select_path(h, ROADMAP)?;
    let menu = open_menu(h, "Roadmap", press_menu_keys("Menu"))?;
    ensure(menu_sections(&menu) == note_sections(), || {
        format!("the note menu has the sections {:?}", menu_sections(&menu))
    })?;
    ensure_move_buttons(&menu, false, true)?;
    ensure(selected_path(h) == Some(path(ROADMAP)), || {
        "the menu row is not selected".to_owned()
    })?;

    close_menu(h, &menu)?;
    h.wait("the tree to keep focus", || tree_focused(h))?;
    let menu = open_menu(h, "Roadmap", press_menu_keys("<Shift>F10"))?;
    ensure(menu_sections(&menu) == note_sections(), || {
        "Shift+F10 opened another menu".to_owned()
    })?;
    close_menu(h, &menu)
}

fn context_menu_click(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    select_path(h, ROADMAP)?;
    h.wait("the Ideas row", || row_expander(h, "Ideas").is_ok())?;
    let ideas_row = row_expander(h, "Ideas")?;
    let menu = open_menu(h, "Ideas", |_| right_click(&ideas_row))?;
    ensure(
        menu.parent()
            .and_then(|row| row.parent())
            .is_some_and(|expander| expander == *ideas_row.upcast_ref::<gtk::Widget>()),
        || "the menu does not point at the Ideas row".to_owned(),
    )?;
    h.wait("Ideas to be selected", || {
        selected_path(h) == Some(path(IDEAS))
    })?;
    ensure_move_buttons(&menu, true, false)?;

    WidgetExt::activate_action(&menu, "row.move-up", None)
        .map_err(|error| format!("cannot activate row.move-up: {error}"))?;
    menu.popdown();
    h.wait("Ideas to move above Roadmap and stay selected", || {
        child_names(h, COMMITNOTE) == path(&["Ideas", "Roadmap"])
            && selected_path(h) == Some(path(IDEAS))
    })
}

fn move_sibling_keys(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    select_path(h, IDEAS)?;
    h.press_keys("<Alt>Up")?;
    h.wait("Ideas to move above Roadmap and stay selected", || {
        child_names(h, COMMITNOTE) == path(&["Ideas", "Roadmap"])
            && selected_path(h) == Some(path(IDEAS))
    })?;
    h.wait("the tree to keep focus", || tree_focused(h))?;
    h.press_keys("<Alt>Down")?;
    h.wait("Ideas to move back below Roadmap", || {
        child_names(h, COMMITNOTE) == path(&["Roadmap", "Ideas"])
            && selected_path(h) == Some(path(IDEAS))
    })
}

fn delete_key(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let welcome = path(&["Welcome"]);
    select_path(h, &["Welcome"])?;
    h.press_keys("Delete")?;
    h.wait_shown(TRASH_CONFIRM)?;
    h.wait("the alert to take focus", || {
        h.widget(TRASH_CONFIRM)
            .is_ok_and(|alert| alert.focus_child().is_some())
    })?;
    h.press_keys("Escape")?;
    h.wait("the alert to close", || !h.shown(TRASH_CONFIRM))?;
    ensure(has_node(h, &welcome), || {
        "the note was trashed after Escape".to_owned()
    })?;

    let top_level = child_names(h, &[]);
    let split = crate::flows::split_view(h)?;
    let layout = (split.is_collapsed(), split.shows_content());
    start_rename(h, "Welcome")?;
    h.press_keys("Home")?;
    h.press_keys("Delete")?;
    h.wait("Delete to remove a character", || {
        h.text(RENAME_ENTRY).is_ok_and(|text| text == "elcome")
    })?;
    for keys in ["<Alt>Down", "<Alt>Up", "F9", "<Control><Shift>n"] {
        h.press_keys(keys)?;
    }
    type_into_rename(h, "x", "xelcome")?;
    ensure(!h.shown(TRASH_CONFIRM), || {
        "Delete in the rename entry opened the trash alert".to_owned()
    })?;
    ensure(!h.shown(NAME_ROW), || {
        "Ctrl+Shift+N fired while renaming".to_owned()
    })?;
    ensure(
        (split.is_collapsed(), split.shows_content()) == layout,
        || "F9 fired while renaming".to_owned(),
    )?;
    ensure(rename_entry_focused(h), || {
        "the rename entry lost focus".to_owned()
    })?;
    ensure(child_names(h, &[]) == top_level, || {
        "Alt+Up or Alt+Down moved the note while renaming".to_owned()
    })?;

    h.press_keys("Escape")?;
    h.wait("the entry to go away", || !h.shown(RENAME_ENTRY))?;
    ensure(has_node(h, &welcome), || {
        "the note changed after the rename was cancelled".to_owned()
    })
}

fn dot_shows(h: &Harness, name: &str, class: Option<&str>) -> bool {
    row_expander(h, name)
        .ok()
        .and_then(|row| {
            widgets_under(row.upcast_ref())
                .into_iter()
                .find(|widget| widget.has_css_class("tag-dot"))
        })
        .is_some_and(|dot| match class {
            Some(class) => dot.is_visible() && dot.has_css_class(class),
            None => !dot.is_visible(),
        })
}

fn color_of(h: &Harness, target: &[String]) -> Option<commitnote_core_api::shapes::ColorTag> {
    let tree = h.model().ok()?.tree()?;
    match find(&tree, target)? {
        TreeNode::Note { color_tag, .. } => *color_tag,
        TreeNode::Folder { .. } => None,
    }
}

fn open_welcome_menu(h: &Harness) -> Result<gtk::PopoverMenu, String> {
    select_path(h, &["Welcome"])?;
    open_menu(h, "Welcome", press_menu_keys("Menu"))
}

fn color_tag_menu(h: &mut Harness) -> Result<(), String> {
    use commitnote_core_api::shapes::ColorTag;

    launch_and_log_in(h, false)?;
    let welcome = path(&["Welcome"]);
    let menu = open_welcome_menu(h)?;
    ensure(menu_sections(&menu) == note_sections(), || {
        "the note menu lacks the Color Tag submenu".to_owned()
    })?;
    let choices = color_choices(&menu);
    let targets: Vec<&str> = choices.iter().map(|(_, target)| target.as_str()).collect();
    ensure(
        targets == ["", "red", "orange", "yellow", "green", "blue", "purple"],
        || format!("the Color Tag submenu offers {targets:?}"),
    )?;
    ensure(choices[0].0 == "None", || {
        "the first choice is not None".to_owned()
    })?;

    WidgetExt::activate_action(&menu, "row.color-tag", Some(&"red".to_variant()))
        .map_err(|error| format!("cannot activate row.color-tag: {error}"))?;
    menu.popdown();
    h.wait("the red dot", || {
        color_of(h, &welcome) == Some(ColorTag::Red) && dot_shows(h, "Welcome", Some("tag-red"))
    })?;

    let menu = open_welcome_menu(h)?;
    let red = choices
        .iter()
        .find(|(_, target)| target == "red")
        .map(|(label, _)| label.clone())
        .ok_or("the submenu has no red choice")?;
    ensure(
        menu_button(&menu, &red).is_some_and(|button| button.property::<bool>("active")),
        || "the red choice is not checked".to_owned(),
    )?;
    WidgetExt::activate_action(&menu, "row.color-tag", Some(&"".to_variant()))
        .map_err(|error| format!("cannot activate row.color-tag: {error}"))?;
    menu.popdown();
    h.wait("the dot to go away", || {
        color_of(h, &welcome).is_none() && dot_shows(h, "Welcome", None)
    })?;

    select_path(h, &["Journal"])?;
    let menu = open_menu(h, "Journal", press_menu_keys("Menu"))?;
    ensure(menu_sections(&menu) == folder_sections(), || {
        format!(
            "the folder menu has the sections {:?}",
            menu_sections(&menu)
        )
    })?;
    close_menu(h, &menu)
}

fn node_drop_target(widget: &impl IsA<gtk::Widget>) -> Result<gtk::DropTarget, String> {
    let controllers = widget.observe_controllers();
    (0..controllers.n_items())
        .filter_map(|index| controllers.item(index))
        .filter_map(|controller| controller.downcast::<gtk::DropTarget>().ok())
        .next()
        .ok_or_else(|| "the widget has no drop target".to_owned())
}

fn row_node_value(expander: &gtk::TreeExpander) -> Result<glib::Value, String> {
    expander
        .list_row()
        .and_then(|row| row.item())
        .map(|node| node.to_value())
        .ok_or_else(|| "the row has no node".to_owned())
}

/// Drops the node shown by `dragged` on the row shown by `target`, at `fraction` of its height,
/// through the row's drop target, and returns whether the drop was accepted.
fn drop_on_row(h: &Harness, dragged: &str, target: &str, fraction: f64) -> Result<bool, String> {
    let value = row_node_value(&row_expander(h, dragged)?)?;
    let row = laid_out_row(h, target)?;
    let y = f64::from(row.height()) * fraction;
    Ok(emit_drop(&node_drop_target(&row)?, value, y))
}

fn laid_out_row(h: &Harness, name: &str) -> Result<gtk::TreeExpander, String> {
    h.settle()?;
    let row = row_expander(h, name)?;
    ensure(row.height() > 0, || format!("the {name} row has no height"))?;
    Ok(row)
}

fn emit_drop(target: &gtk::DropTarget, value: glib::Value, y: f64) -> bool {
    target.emit_by_name::<bool>("drop", &[&glib::value::BoxedValue(value), &8f64, &y])
}

fn tree_snapshot(h: &Harness) -> Result<Vec<TreeNode>, String> {
    h.model()?
        .tree()
        .ok_or_else(|| "the tree has not loaded".to_owned())
}

fn drop_into_folder(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    select_path(h, &["Welcome"])?;
    let accepted = drop_on_row(h, "Welcome", "Journal", 0.5)?;
    ensure(accepted, || {
        "the drop in the middle of a folder was refused".to_owned()
    })?;
    let moved = path(&["Journal", "Welcome"]);
    h.wait("Welcome to be inside Journal and selected", || {
        has_node(h, &moved)
            && !has_node(h, &path(&["Welcome"]))
            && selected_path(h).as_ref() == Some(&moved)
    })
}

fn drop_reorder(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    select_path(h, ROADMAP)?;
    select_path(h, IDEAS)?;
    ensure(
        child_names(h, COMMITNOTE) == path(&["Roadmap", "Ideas"]),
        || "the sample folder is not in its custom order".to_owned(),
    )?;
    let accepted = drop_on_row(h, "Ideas", "Roadmap", 0.25)?;
    ensure(accepted, || {
        "the drop on the top half of a note was refused".to_owned()
    })?;
    h.wait("Ideas to be first and selected", || {
        child_names(h, COMMITNOTE) == path(&["Ideas", "Roadmap"])
            && selected_path(h) == Some(path(IDEAS))
    })?;
    ensure(has_node(h, &path(IDEAS)), || {
        "Ideas left its folder".to_owned()
    })
}

fn drop_refused(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    select_path(h, ROADMAP)?;
    let before = tree_snapshot(h)?;
    for fraction in [0.1, 0.5, 0.9] {
        let accepted = drop_on_row(h, "Projects", "commitnote", fraction)?;
        ensure(!accepted, || {
            format!("a folder was dropped into its own subtree at {fraction}")
        })?;
    }
    ensure(!drop_on_row(h, "commitnote", "commitnote", 0.5)?, || {
        "a folder was dropped on itself".to_owned()
    })?;
    ensure(!drop_on_row(h, "Roadmap", "commitnote", 0.5)?, || {
        "a note was dropped into the folder that holds it".to_owned()
    })?;
    ensure(!drop_on_row(h, "Roadmap", "Ideas", 0.1)?, || {
        "a note was dropped where it already is".to_owned()
    })?;
    h.settle()?;
    ensure(tree_snapshot(h)? == before, || {
        "a refused drop changed the tree".to_owned()
    })
}

fn drop_end(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let top = child_names(h, &[]);
    let last = top.last().cloned().ok_or("the tree has no rows")?;
    let list = h.widget_as::<gtk::ListView>(TREE_LIST)?;
    let scrolled = list
        .ancestor(gtk::ScrolledWindow::static_type())
        .ok_or("the tree has no scrolled window")?;
    let background = node_drop_target(&scrolled)?;
    let drop_below = |name: &str| -> Result<bool, String> {
        h.settle()?;
        let value = row_node_value(&row_expander(h, name)?)?;
        let y = f64::from(scrolled.height()) - 1.0;
        Ok(emit_drop(&background, value, y))
    };
    ensure(!drop_below(&last)?, || {
        "the last top-level item was dropped at the end again".to_owned()
    })?;
    ensure(drop_below("Projects")?, || {
        "the drop below the rows was refused".to_owned()
    })?;
    h.wait("Projects to be last and selected", || {
        child_names(h, &[]).last().map(String::as_str) == Some("Projects")
            && selected_path(h) == Some(path(&["Projects"]))
    })
}

fn drop_indicator(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    select_path(h, &["Welcome"])?;
    let tree = h.widget_as::<NotesTree>("notes-tree")?;
    let classes = |name: &str| -> Result<Vec<&'static str>, String> {
        let row = row_expander(h, name)?;
        Ok(["drop-before", "drop-after", "drop-into"]
            .into_iter()
            .filter(|class| row.has_css_class(class))
            .collect())
    };
    let hover = |name: &str, fraction: f64| -> Result<gdk::DragAction, String> {
        let row = laid_out_row(h, name)?;
        let y = f64::from(row.height()) * fraction;
        Ok(node_drop_target(&row)?.emit_by_name::<gdk::DragAction>("motion", &[&8f64, &y]))
    };
    tree.testing_set_dragged(Some(&path(&["Welcome"])));
    for (fraction, expected) in [
        (0.1, "drop-before"),
        (0.5, "drop-into"),
        (0.9, "drop-after"),
    ] {
        ensure(hover("Journal", fraction)? == gdk::DragAction::MOVE, || {
            format!("a folder refused a drag at {fraction}")
        })?;
        ensure(classes("Journal")? == [expected], || {
            format!("a folder at {fraction} shows {:?}", classes("Journal"))
        })?;
    }
    ensure(
        hover("Zażółć gęślą jaźń", 0.8)? == gdk::DragAction::MOVE,
        || "a note refused a drag on its bottom half".to_owned(),
    )?;
    ensure(
        classes("Journal")?.is_empty() && classes("Zażółć gęślą jaźń")? == ["drop-after"],
        || "the indicator stayed on the previous row".to_owned(),
    )?;
    ensure(
        hover("Welcome", 0.5)? == gdk::DragAction::empty() && classes("Welcome")?.is_empty(),
        || "a note accepted a drag over itself".to_owned(),
    )?;
    node_drop_target(&row_expander(h, "Journal")?)?.emit_by_name::<()>("leave", &[]);
    tree.testing_set_dragged(None);
    ensure(classes("Journal")?.is_empty(), || {
        "the indicator stayed after the drag ended".to_owned()
    })
}

const TAG_BANNER: &str = "tag-filter-banner";
const NOTE_ACTIONS: [&str; 4] = [
    "notes.rename-note",
    "notes.move-note",
    "notes.color-tag",
    "notes.trash-note",
];

fn note_paths(nodes: &[TreeNode]) -> Vec<Vec<String>> {
    nodes
        .iter()
        .flat_map(|node| match node {
            TreeNode::Note { path, .. } => vec![path.clone()],
            TreeNode::Folder { children, .. } => note_paths(children),
        })
        .collect()
}

fn menu_item_attributes(model: &gtk::gio::MenuModel, link: &str) -> Vec<(String, String)> {
    (0..model.n_items())
        .filter_map(|index| model.item_link(index, link))
        .flat_map(|section| {
            (0..section.n_items())
                .map(|item| {
                    (
                        string_attribute(&section, item, "label").unwrap_or_default(),
                        section
                            .item_attribute_value(item, "target", Some(glib::VariantTy::STRING))
                            .and_then(|value| value.get::<String>())
                            .unwrap_or_default(),
                    )
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn filter_choices(h: &Harness) -> Result<Vec<(String, String)>, String> {
    let menu = h
        .widget_as::<gtk::MenuButton>("notes-main-menu-button")?
        .menu_model()
        .ok_or("the main menu has no model")?;
    let filter = menu
        .item_link(1, "section")
        .ok_or("the main menu has no filter section")?;
    Ok(menu_item_attributes(&filter, "submenu"))
}

fn tag_filter(h: &mut Harness) -> Result<(), String> {
    use commitnote_core_api::shapes::ColorTag;

    launch_and_log_in(h, false)?;
    let banner = h.widget_as::<adw::Banner>(TAG_BANNER)?;
    ensure(!banner.is_revealed(), || {
        "the filter banner shows without a filter".to_owned()
    })?;
    let all_tags = ["", "orange", "green", "blue", "purple"];
    let expect_choices = |h: &Harness, when: &str| -> Result<(), String> {
        let choices = filter_choices(h)?;
        let targets: Vec<&str> = choices.iter().map(|(_, target)| target.as_str()).collect();
        ensure(targets == all_tags, || {
            format!("the filter offers {targets:?} {when}")
        })?;
        ensure(choices[0].0 == "All Notes", || {
            format!("the first filter choice is {:?}", choices[0].0)
        })
    };
    expect_choices(h, "before filtering")?;

    let tree = h.widget("notes-tree")?;
    WidgetExt::activate_action(&tree, "notes.tag-filter", Some(&"green".to_variant()))
        .map_err(|error| format!("cannot activate notes.tag-filter: {error}"))?;
    let model = h.model()?;
    h.wait("the green filter", || {
        model.tag_filter() == Some(ColorTag::Green)
            && model
                .tree()
                .is_some_and(|tree| note_paths(&tree) == [path(IDEAS)])
    })?;
    h.wait("the filter banner", || banner.is_revealed())?;
    ensure(banner.title().starts_with("Showing notes tagged "), || {
        format!("the banner says {:?}", banner.title())
    })?;
    ensure(banner.button_label().as_deref() == Some("Show All"), || {
        "the banner button is not Show All".to_owned()
    })?;
    h.widget_as::<NotesTree>("notes-tree")?.reveal(path(IDEAS));
    h.wait("the Ideas row", || row_expander(h, "Ideas").is_ok())?;
    ensure(row_expander(h, "Welcome").is_err(), || {
        "the tree still shows Welcome".to_owned()
    })?;
    expect_choices(h, "while filtering")?;

    banner.emit_by_name::<()>("button-clicked", &[]);
    h.wait("the full tree", || {
        model.tag_filter().is_none() && model.tree().is_some_and(|tree| note_paths(&tree).len() > 1)
    })?;
    h.wait("the banner to hide", || !banner.is_revealed())?;
    h.wait("the Welcome row", || row_expander(h, "Welcome").is_ok())?;
    expect_choices(h, "after filtering")
}

fn action_enabled(h: &Harness, action: &str) -> Result<bool, String> {
    let anchor = h.widget("notes-tree")?;
    let probe = gtk::Button::new();
    probe.set_action_name(Some(action));
    if action == "notes.color-tag" {
        probe.set_action_target_value(Some(&"yellow".to_variant()));
    }
    probe.set_parent(&anchor);
    let enabled = probe.is_sensitive();
    probe.unparent();
    Ok(enabled)
}

fn note_menu_organise(h: &mut Harness) -> Result<(), String> {
    use commitnote_core_api::shapes::ColorTag;

    launch_and_log_in(h, false)?;
    for action in NOTE_ACTIONS {
        ensure(!action_enabled(h, action)?, || {
            format!("{action} is enabled with no note open")
        })?;
    }

    let welcome = path(&["Welcome"]);
    let model = h.model()?;
    model.open_note(Some(welcome.clone()));
    h.wait("the note to open", || {
        model.editor_target() == EditorTarget::Note(welcome.clone())
            && h.text("note-title-entry")
                .is_ok_and(|title| title == "Welcome")
    })?;
    h.wait_shown("note-menu-button")?;
    h.wait("the note actions to be enabled", || {
        NOTE_ACTIONS
            .iter()
            .all(|action| action_enabled(h, action).unwrap_or(false))
    })?;
    let menu = h
        .widget_as::<gtk::MenuButton>("note-menu-button")?
        .menu_model()
        .ok_or("the note menu has no model")?;
    let organise = menu
        .item_link(0, "section")
        .ok_or("the note menu has no organise section")?;
    let labels: Vec<String> = (0..organise.n_items())
        .filter_map(|item| string_attribute(&organise, item, "label"))
        .collect();
    ensure(
        labels == ["Rename", "Move To…", "Color Tag", "Move to Trash"],
        || format!("the organise section holds {labels:?}"),
    )?;
    let targets: Vec<String> = menu_item_attributes(&organise, "submenu")
        .into_iter()
        .map(|(_, target)| target)
        .collect();
    ensure(
        targets == ["", "red", "orange", "yellow", "green", "blue", "purple"],
        || format!("the Color Tag submenu offers {targets:?}"),
    )?;

    let tree = h.widget("notes-tree")?;
    WidgetExt::activate_action(&tree, "notes.color-tag", Some(&"yellow".to_variant()))
        .map_err(|error| format!("cannot activate notes.color-tag: {error}"))?;
    h.wait("the yellow dot", || {
        color_of(h, &welcome) == Some(ColorTag::Yellow)
            && dot_shows(h, "Welcome", Some("tag-yellow"))
    })?;

    WidgetExt::activate_action(&tree, "notes.rename-note", None)
        .map_err(|error| format!("cannot activate notes.rename-note: {error}"))?;
    let title = h.widget_as::<gtk::Entry>("note-title-entry")?;
    h.wait("the title to be focused and selected", || {
        title.focus_child().is_some() && title.selection_bounds() == Some((0, 7))
    })?;

    model.open_note(None);
    h.wait("the note actions to be disabled", || {
        NOTE_ACTIONS
            .iter()
            .all(|action| action_enabled(h, action).is_ok_and(|enabled| !enabled))
    })
}

fn move_node_to(h: &Harness, source: &[&str], destination: &[String]) -> Result<(), String> {
    let targets = h
        .run("the move targets", {
            let model = h.model()?;
            let source = path(source);
            async move { model.move_targets(source).await }
        })?
        .map_err(|error| error.message)?;
    let index = targets
        .iter()
        .position(|target| target.path == destination && !target.disabled)
        .ok_or("the destination is not a move target")?;
    open_move_dialog(h, source)?;
    h.activate_row(&format!("move-to-row-{index}"))?;
    h.wait("the picker to close", || !h.shown(MOVE_LIST))
}

fn undo_move(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let welcome = path(&["Welcome"]);
    let placed = path(&["Projects", "commitnote", "Welcome"]);

    select_path(h, ROADMAP)?;
    ensure(drop_on_row(h, "Welcome", "Roadmap", 0.25)?, || {
        "the drop before Roadmap was refused".to_owned()
    })?;
    h.wait("the note to move into the folder", || {
        has_node(h, &placed) && !has_node(h, &welcome)
    })?;
    click_labelled(h, "Undo")?;
    h.wait("the note to return to the top level", || {
        has_node(h, &welcome) && !has_node(h, &placed)
    })?;
    ensure(
        child_names(h, COMMITNOTE) == path(&["Roadmap", "Ideas"]),
        || "the folder lost its order".to_owned(),
    )?;

    select_path(h, IDEAS)?;
    h.press_keys("<Alt>Up")?;
    h.wait("Ideas to move above Roadmap", || {
        child_names(h, COMMITNOTE) == path(&["Ideas", "Roadmap"])
    })?;
    h.wait("the moved up notice", || {
        h.label_shown_with("\u{201c}Ideas\u{201d} moved up")
    })?;
    click_labelled(h, "Undo")?;
    h.wait("Ideas to move back below Roadmap", || {
        child_names(h, COMMITNOTE) == path(&["Roadmap", "Ideas"])
    })
}

fn focus_editor(h: &Harness, editor: &NoteEditor) -> Result<(), String> {
    let view = editor.view();
    view.grab_focus();
    h.wait("the editor to take focus", || {
        h.window()
            .ok()
            .and_then(|window| GtkWindowExt::focus(&window))
            .is_some_and(|focus| focus == view || focus.is_ancestor(&view))
    })
}

fn loaded_content(model: &AppModel, target: &[String]) -> Option<String> {
    match model.open_note_state() {
        Some(OpenNote::Loaded { path, content, .. }) if path == target => Some(content),
        _ => None,
    }
}

fn open_note_follows_move(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let model = h.model()?;
    let ideas = path(IDEAS);
    let moved = path(&["Ideas"]);

    model.open_note(Some(ideas.clone()));
    h.wait("the note to open", || {
        model.editor_target() == EditorTarget::Note(ideas.clone())
            && loaded_content(&model, &ideas).is_some()
            && h.text("note-title-entry")
                .is_ok_and(|title| title == "Ideas")
    })?;

    move_node_to(h, IDEAS, &[])?;
    h.wait("the note to reach the top level", || {
        has_node(h, &moved) && !has_node(h, &ideas)
    })?;
    h.wait("the editor to follow the note", || {
        model.editor_target() == EditorTarget::Note(moved.clone())
            && loaded_content(&model, &moved).is_some()
    })?;
    ensure(
        h.text("note-title-entry")
            .is_ok_and(|title| title == "Ideas"),
        || "the title changed with the move".to_owned(),
    )?;

    let editor = h.widget_as::<NoteEditor>("note-editor")?;
    focus_editor(h, &editor)?;
    let typed = "typed after the move ";
    h.type_keys(typed)?;
    h.wait("the typed text in the editor", || {
        editor.text().contains(typed)
    })?;
    let text = editor.text();

    h.run("flushing the edit", {
        let model = model.clone();
        async move { model.flush_edits().await }
    })?;
    model.open_note(None);
    h.wait("the note to close", || {
        model.editor_target() == EditorTarget::None
    })?;
    model.open_note(Some(moved.clone()));
    h.wait("the saved text at the new path", || {
        loaded_content(&model, &moved).is_some_and(|content| content == text)
    })?;
    ensure(!has_node(h, &ideas), || {
        "the note still exists at the old path".to_owned()
    })
}

fn create_share(h: &Harness, target: &[&str]) -> Result<(), String> {
    let model = h.model()?;
    let params = serde_json::json!({ "path": target, "password": "", "label": "" });
    let response = h
        .run(
            "creating a share",
            model.testing_send("share.create", params),
        )?
        .map_err(|error| error.message)?;
    ensure(
        response
            .pointer("/outcome/kind")
            .and_then(|kind| kind.as_str())
            == Some("created"),
        || "the share was not created".to_owned(),
    )
}

fn is_shared(h: &Harness, target: &[String]) -> bool {
    h.model()
        .ok()
        .and_then(|model| model.tree())
        .is_some_and(|tree| {
            matches!(
                find(&tree, target),
                Some(TreeNode::Note { shared: true, .. })
            )
        })
}

fn trash_share_warning(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let roadmap = path(ROADMAP);
    let commitnote = path(COMMITNOTE);

    create_share(h, ROADMAP)?;
    h.wait("the note to be marked shared", || is_shared(h, &roadmap))?;

    let preview = h
        .run("the trash preview", {
            let (model, commitnote) = (h.model()?, commitnote.clone());
            async move { model.trash_preview(commitnote).await }
        })?
        .map_err(|error| error.message)?;
    ensure(preview.share_count == 1, || {
        format!("the preview counts {} shares", preview.share_count)
    })?;
    ensure(!preview.message.is_empty(), || {
        "the preview has no message".to_owned()
    })?;

    trash_node_action(h, COMMITNOTE)?;
    h.wait_shown(TRASH_CONFIRM)?;
    let alert = h.widget_as::<adw::AlertDialog>(TRASH_CONFIRM)?;
    ensure(alert.body() == preview.message, || {
        "the body is not the core's share warning".to_owned()
    })?;
    ensure(
        alert.heading().as_deref() == Some(preview.title.as_str()),
        || "the heading is not the core's title".to_owned(),
    )?;

    click_labelled(h, &preview.confirm_label)?;
    h.wait("the folder to leave the tree", || !has_node(h, &commitnote))?;
    click_labelled(h, "Undo")?;
    h.wait("the folder to come back", || {
        has_node(h, &commitnote) && has_node(h, &roadmap)
    })
}

fn trash_restore_undo(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let welcome = path(&["Welcome"]);
    let restored = path(&["Projects", "Welcome"]);

    trash_node_action(h, &["Welcome"])?;
    h.wait_shown(TRASH_CONFIRM)?;
    let confirm = h
        .widget_as::<adw::AlertDialog>(TRASH_CONFIRM)?
        .response_label("confirm");
    click_labelled(h, &confirm)?;
    h.wait("the note to leave the tree", || !has_node(h, &welcome))?;
    h.wait("the note in the trash", || {
        trash_entry(h, "Welcome").is_some()
    })?;

    let list = h.widget(TREE_LIST)?;
    WidgetExt::activate_action(&list, "notes.show-trash", None)
        .map_err(|error| format!("cannot activate notes.show-trash: {error}"))?;
    h.wait_shown(TRASH_DIALOG)?;
    h.wait("the Welcome trash row", || {
        h.row_titled("Welcome").is_ok_and(|row| row.is_mapped())
    })?;

    restore_to(h, "Welcome", "Welcome", Vec::new(), &path(&["Projects"]))?;
    h.wait("the note to appear under Projects", || {
        has_node(h, &restored)
            && !has_node(h, &welcome)
            && selected_path(h).as_ref() == Some(&restored)
            && trash_entry(h, "Welcome").is_none()
    })
}

fn filter_then_tag(h: &mut Harness) -> Result<(), String> {
    use commitnote_core_api::shapes::ColorTag;

    launch_and_log_in(h, false)?;
    let model = h.model()?;
    let welcome = path(&["Welcome"]);
    h.run("tagging Welcome green", {
        let (model, welcome) = (model.clone(), welcome.clone());
        async move { model.set_color_tag(welcome, Some(ColorTag::Green)).await }
    })?
    .map_err(|error| error.message)?;
    h.wait("the green tag", || {
        color_of(h, &welcome) == Some(ColorTag::Green)
    })?;

    let tree = h.widget("notes-tree")?;
    WidgetExt::activate_action(&tree, "notes.tag-filter", Some(&"green".to_variant()))
        .map_err(|error| format!("cannot activate notes.tag-filter: {error}"))?;
    h.wait("the green filter", || {
        model.tag_filter() == Some(ColorTag::Green)
            && model
                .tree()
                .is_some_and(|tree| note_paths(&tree) == [path(IDEAS), welcome.clone()])
    })?;

    select_path(h, IDEAS)?;
    h.wait("the Ideas row", || row_expander(h, "Ideas").is_ok())?;
    let menu = open_menu(h, "Ideas", press_menu_keys("Menu"))?;
    WidgetExt::activate_action(&menu, "row.color-tag", Some(&"blue".to_variant()))
        .map_err(|error| format!("cannot activate row.color-tag: {error}"))?;
    menu.popdown();

    h.wait("Ideas to leave the filtered tree", || {
        model.tag_filter() == Some(ColorTag::Green)
            && model
                .tree()
                .is_some_and(|tree| note_paths(&tree) == [welcome.clone()])
    })?;
    let choices = filter_choices(h)?;
    ensure(choices.iter().any(|(_, target)| target == "green"), || {
        "the filter menu dropped green while a green note remains".to_owned()
    })?;
    ensure(
        h.widget_as::<adw::Banner>(TAG_BANNER)?.is_revealed(),
        || "the filter banner went away while a green note remains".to_owned(),
    )
}

fn shot_tree_context_menu(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    select_path(h, ROADMAP)?;
    for &(width, theme) in ALL_VARIANTS {
        h.show_variant(width, theme)?;
        h.wait("the Roadmap row", || row_expander(h, "Roadmap").is_ok())?;
        h.wait("the tree to have focus", || tree_focused(h))?;
        let menu = open_menu(h, "Roadmap", press_menu_keys("Menu"))?;
        h.wait("the menu entries", || {
            menu_button(&menu, "Move Up").is_some()
        })?;
        h.capture_variant_with_popover("tree-context-menu", width, theme, menu.upcast_ref())?;
        close_menu(h, &menu)?;
        h.wait("the tree to keep focus", || tree_focused(h))?;
    }
    Ok(())
}

fn shot_trash_dialog(h: &mut Harness) -> Result<(), String> {
    h.launch()?;
    submit_token(h)?;
    choose_repository(h, TRASH_URL)?;
    unlock(h, false)?;
    wait_tree(h)?;
    let model = h.model()?;
    h.wait("the trash state", || model.trash().is_some())?;

    for target in [path(&["Welcome"]), path(&["Archive"])] {
        let name = target.last().cloned().unwrap_or_default();
        h.run("trashing an item", {
            let model = model.clone();
            async move {
                let preview = model.trash_preview(target.clone()).await?;
                model.trash_node(target, preview.share_count).await
            }
        })?
        .map_err(|error| error.message)?;
        h.wait("the item in the trash", || trash_entry(h, &name).is_some())?;
    }

    let list = h.widget(TREE_LIST)?;
    WidgetExt::activate_action(&list, "notes.show-trash", None)
        .map_err(|error| format!("cannot activate notes.show-trash: {error}"))?;
    h.wait_shown(TRASH_DIALOG)?;
    let archive = {
        h.wait("the Archive trash row", || {
            h.row_titled("Archive").is_ok_and(|row| row.is_mapped())
        })?;
        h.row_titled("Archive")?
            .downcast::<adw::ExpanderRow>()
            .map_err(|_| "the Archive row is not an expander".to_owned())?
    };
    archive.set_expanded(true);
    h.wait("the trash rows", || {
        ["Welcome", "Archive", "Kept note"]
            .iter()
            .all(|title| h.row_titled(title).is_ok_and(|row| row.is_mapped()))
    })?;
    h.session_screenshots("trash-dialog", ALL_VARIANTS)
}
