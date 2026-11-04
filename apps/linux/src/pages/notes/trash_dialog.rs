use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::shapes::{ColorTag, TrashEntryView, TrashItemKind, TrashItemView};
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use super::target_picker::{self, Picker};
use super::trash_confirm;
use super::tree_logic::tag_id;
use crate::model::AppModel;

type ExpandedRows = Rc<RefCell<HashSet<(String, Vec<String>)>>>;

#[derive(Clone)]
struct Env {
    model: AppModel,
    on_restored: Rc<dyn Fn(Vec<String>)>,
    expanded: ExpandedRows,
}

pub fn present(
    model: &AppModel,
    anchor: &impl IsA<gtk::Widget>,
    on_restored: impl Fn(Vec<String>) + 'static,
) -> adw::Dialog {
    let env = Env {
        model: model.clone(),
        on_restored: Rc::new(on_restored),
        expanded: ExpandedRows::default(),
    };

    let spinner = adw::Spinner::builder()
        .width_request(32)
        .height_request(32)
        .halign(gtk::Align::Center)
        .valign(gtk::Align::Center)
        .build();
    let empty = adw::StatusPage::builder()
        .icon_name("user-trash-symbolic")
        .title("Trash Is Empty")
        .build();
    let list = gtk::ListBox::builder()
        .name("trash-list")
        .selection_mode(gtk::SelectionMode::None)
        .css_classes(["boxed-list"])
        .valign(gtk::Align::Start)
        .margin_top(12)
        .margin_bottom(12)
        .margin_start(12)
        .margin_end(12)
        .build();
    let stack = gtk::Stack::new();
    stack.add_named(&spinner, Some("loading"));
    stack.add_named(&empty, Some("empty"));
    stack.add_named(
        &gtk::ScrolledWindow::builder()
            .hscrollbar_policy(gtk::PolicyType::Never)
            .vexpand(true)
            .child(&list)
            .build(),
        Some("list"),
    );

    let empty_button = gtk::Button::builder()
        .name("trash-empty-button")
        .label("Empty Trash")
        .css_classes(["destructive-action"])
        .sensitive(false)
        .build();
    let header = adw::HeaderBar::new();
    header.pack_end(&empty_button);
    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&header);
    toolbar.set_content(Some(&stack));

    let dialog = adw::Dialog::builder()
        .name("trash-dialog")
        .title("Trash")
        .content_width(520)
        .content_height(520)
        .child(&toolbar)
        .build();

    empty_button.connect_clicked({
        let model = model.clone();
        move |button| {
            let (model, button) = (model.clone(), button.clone());
            glib::spawn_future_local(async move { empty_trash(&model, &button).await });
        }
    });

    let refresh = glib::clone!(
        #[weak]
        list,
        #[weak]
        stack,
        #[weak]
        empty_button,
        #[strong]
        env,
        move || rebuild(&env, &list, &stack, &empty_button)
    );
    refresh();
    let handler = Rc::new(RefCell::new(Some(
        model.connect_trash_changed(move |_| refresh()),
    )));
    dialog.connect_closed({
        let model = model.clone();
        move |_| {
            if let Some(handler) = handler.take() {
                model.disconnect(handler);
            }
        }
    });

    dialog.present(Some(anchor));
    dialog
}

fn rebuild(env: &Env, list: &gtk::ListBox, stack: &gtk::Stack, empty_button: &gtk::Button) {
    let Some(trash) = env.model.trash() else {
        empty_button.set_sensitive(false);
        stack.set_visible_child_name("loading");
        return;
    };
    list.remove_all();
    for entry in &trash.entries {
        list.append(&entry_row(env, entry));
    }
    let is_empty = trash.entries.is_empty();
    empty_button.set_sensitive(!is_empty);
    stack.set_visible_child_name(if is_empty { "empty" } else { "list" });
}

struct RowSpec<'a> {
    entry_id: &'a str,
    sub_path: &'a [String],
    kind: TrashItemKind,
    name: &'a str,
    subtitle: &'a str,
    children: &'a [TrashItemView],
    color_tag: Option<ColorTag>,
    top_level: bool,
}

fn entry_row(env: &Env, entry: &TrashEntryView) -> gtk::Widget {
    row(
        env,
        &RowSpec {
            entry_id: &entry.id,
            sub_path: &[],
            kind: entry.kind,
            name: &entry.name,
            subtitle: &subtitle(entry),
            children: &entry.children,
            color_tag: entry.color_tag,
            top_level: true,
        },
    )
}

fn item_row(env: &Env, entry_id: &str, item: &TrashItemView) -> gtk::Widget {
    row(
        env,
        &RowSpec {
            entry_id,
            sub_path: &item.sub_path,
            kind: item.kind,
            name: &item.name,
            subtitle: "",
            children: &item.children,
            color_tag: None,
            top_level: false,
        },
    )
}

fn subtitle(entry: &TrashEntryView) -> String {
    match (entry.original_folder.is_empty(), entry.days_left.is_empty()) {
        (_, true) => entry.original_folder.clone(),
        (true, false) => entry.days_left.clone(),
        (false, false) => format!("{} · {}", entry.original_folder, entry.days_left),
    }
}

fn row(env: &Env, spec: &RowSpec) -> gtk::Widget {
    let icon = gtk::Image::from_icon_name(match spec.kind {
        TrashItemKind::Folder => "folder-symbolic",
        TrashItemKind::Note => "text-x-generic-symbolic",
    });
    let suffix = suffix(env, spec);
    if spec.children.is_empty() {
        let row = adw::ActionRow::builder()
            .title(spec.name)
            .subtitle(spec.subtitle)
            .use_markup(false)
            .build();
        row.add_prefix(&icon);
        row.add_suffix(&suffix);
        return row.upcast();
    }

    let row = adw::ExpanderRow::builder()
        .title(spec.name)
        .subtitle(spec.subtitle)
        .use_markup(false)
        .build();
    row.add_prefix(&icon);
    row.add_suffix(&suffix);
    for child in spec.children {
        row.add_row(&item_row(env, spec.entry_id, child));
    }
    let key = (spec.entry_id.to_owned(), spec.sub_path.to_vec());
    row.set_expanded(env.expanded.borrow().contains(&key));
    let expanded = env.expanded.clone();
    row.connect_expanded_notify(move |row| {
        if row.is_expanded() {
            expanded.borrow_mut().insert(key.clone());
        } else {
            expanded.borrow_mut().remove(&key);
        }
    });
    row.upcast()
}

fn suffix(env: &Env, spec: &RowSpec) -> gtk::Box {
    let suffix = gtk::Box::builder()
        .spacing(6)
        .valign(gtk::Align::Center)
        .build();
    if let Some(tag) = spec.color_tag {
        suffix.append(
            &gtk::Box::builder()
                .css_classes(["tag-dot".to_owned(), format!("tag-{}", tag_id(tag))])
                .width_request(10)
                .height_request(10)
                .valign(gtk::Align::Center)
                .build(),
        );
    }

    let restore = gtk::Button::builder()
        .name("trash-restore-button")
        .label("Restore To…")
        .valign(gtk::Align::Center)
        .build();
    restore.update_property(&[gtk::accessible::Property::Label(&format!(
        "Restore {} To…",
        spec.name
    ))]);
    restore.connect_clicked({
        let env = env.clone();
        let (entry_id, sub_path) = (spec.entry_id.to_owned(), spec.sub_path.to_vec());
        move |button| restore_to(&env, button, entry_id.clone(), sub_path.clone())
    });
    suffix.append(&restore);

    if spec.top_level {
        let delete = gtk::Button::builder()
            .name("trash-delete-button")
            .icon_name("edit-delete-symbolic")
            .tooltip_text("Delete Permanently")
            .css_classes(["flat"])
            .valign(gtk::Align::Center)
            .build();
        delete.update_property(&[gtk::accessible::Property::Label(&format!(
            "Delete {} Permanently",
            spec.name
        ))]);
        delete.connect_clicked({
            let model = env.model.clone();
            let entry_id = spec.entry_id.to_owned();
            move |button| {
                let (model, button, entry_id) = (model.clone(), button.clone(), entry_id.clone());
                glib::spawn_future_local(
                    async move { delete_entry(&model, &button, entry_id).await },
                );
            }
        });
        suffix.append(&delete);
    }
    suffix
}

fn restore_to(env: &Env, anchor: &gtk::Button, entry_id: String, sub_path: Vec<String>) {
    let model = env.model.clone();
    let on_restored = env.on_restored.clone();
    target_picker::present(
        &model,
        anchor,
        Picker {
            name: "restore-to",
            title: "Restore To",
        },
        {
            let (model, entry_id, sub_path) = (model.clone(), entry_id.clone(), sub_path.clone());
            async move { model.restore_targets(entry_id, sub_path).await }
        },
        {
            let model = model.clone();
            move |parent| {
                let (model, entry_id, sub_path, on_restored) = (
                    model.clone(),
                    entry_id.clone(),
                    sub_path.clone(),
                    on_restored.clone(),
                );
                glib::spawn_future_local(async move {
                    match model.restore(entry_id, sub_path, parent).await {
                        Ok(path) => on_restored(path),
                        Err(error) => model.report_error(&error),
                    }
                });
            }
        },
    );
}

async fn delete_entry(model: &AppModel, anchor: &gtk::Button, entry_id: String) {
    let Some(trash) = model.trash() else {
        return;
    };
    let text = trash.delete_confirmation;
    if !trash_confirm::ask(
        anchor,
        "trash-delete-dialog",
        &text.title,
        &text.message,
        "_Delete",
    )
    .await
    {
        return;
    }
    if let Err(error) = model.delete_trash_entry(entry_id).await {
        model.report_error(&error);
    }
}

async fn empty_trash(model: &AppModel, anchor: &gtk::Button) {
    let Some(trash) = model.trash() else {
        return;
    };
    let text = trash.empty_confirmation;
    if !trash_confirm::ask(
        anchor,
        "trash-empty-dialog",
        &text.title,
        &text.message,
        "_Empty Trash",
    )
    .await
    {
        return;
    }
    if let Err(error) = model.empty_trash().await {
        model.report_error(&error);
    }
}
