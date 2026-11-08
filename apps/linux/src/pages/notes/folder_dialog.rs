use std::cell::Cell;
use std::rc::Rc;

use adw::prelude::*;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use crate::model::AppModel;

pub fn present(
    model: &AppModel,
    anchor: &impl IsA<gtk::Widget>,
    parent: Vec<String>,
    on_created: impl Fn(Vec<String>) + 'static,
) {
    let name_row = adw::EntryRow::builder()
        .name("new-folder-name")
        .title("Name")
        .build();
    let create = gtk::Button::builder()
        .name("new-folder-create")
        .label("Create")
        .css_classes(["suggested-action"])
        .sensitive(false)
        .build();
    let cancel = gtk::Button::builder().label("Cancel").build();
    let error = gtk::Label::builder()
        .name("new-folder-error")
        .accessible_role(gtk::AccessibleRole::Alert)
        .css_classes(["error"])
        .xalign(0.0)
        .wrap(true)
        .visible(false)
        .build();

    let names = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .css_classes(["boxed-list"])
        .build();
    names.append(&name_row);
    let body = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .margin_top(12)
        .margin_bottom(24)
        .margin_start(12)
        .margin_end(12)
        .build();
    body.append(&names);
    body.append(&error);

    let header = adw::HeaderBar::new();
    header.pack_start(&cancel);
    header.pack_end(&create);
    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&header);
    toolbar.set_content(Some(&body));

    let dialog = adw::Dialog::builder()
        .title("New Folder")
        .content_width(360)
        .child(&toolbar)
        .default_widget(&create)
        .build();
    dialog.set_focus(Some(&name_row));

    let busy = Rc::new(Cell::new(false));
    let on_created = Rc::new(on_created);
    let submit = Rc::new(glib::clone!(
        #[weak]
        dialog,
        #[weak]
        name_row,
        #[weak]
        create,
        #[weak]
        error,
        #[strong]
        model,
        #[strong]
        busy,
        #[strong]
        on_created,
        move || {
            let name = name_row.text().trim().to_owned();
            if name.is_empty() || busy.replace(true) {
                return;
            }
            create.set_sensitive(false);
            dialog.set_can_close(false);
            let model = model.clone();
            let parent = parent.clone();
            let busy = busy.clone();
            let on_created = on_created.clone();
            glib::spawn_future_local(async move {
                let result = model.create_folder(parent, name).await;
                busy.set(false);
                dialog.set_can_close(true);
                match result {
                    Ok(path) => {
                        dialog.close();
                        on_created(path);
                    }
                    Err(failure) => {
                        error.set_label(&failure.message);
                        error.set_visible(true);
                        create.set_sensitive(!name_row.text().trim().is_empty());
                        name_row.grab_focus();
                    }
                }
            });
        }
    ));

    name_row.connect_changed(glib::clone!(
        #[weak]
        create,
        #[weak]
        error,
        #[strong]
        busy,
        move |row| {
            error.set_visible(false);
            create.set_sensitive(!busy.get() && !row.text().trim().is_empty());
        }
    ));
    name_row.connect_entry_activated({
        let submit = submit.clone();
        move |_| submit()
    });
    create.connect_clicked(move |_| submit());
    cancel.connect_clicked(glib::clone!(
        #[weak]
        dialog,
        move |_| {
            dialog.close();
        }
    ));

    dialog.present(Some(anchor));
}
