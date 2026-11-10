use adw::prelude::*;
use commitnote_core_api::commands::MoveTargetView;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use crate::a11y::label_loading;
use crate::model::{AppModel, UserError};

const INDENT_PER_LEVEL: i32 = 12;
const BASE_MARGIN: i32 = 12;

pub struct Picker {
    pub name: &'static str,
    pub title: &'static str,
}

pub fn present(
    model: &AppModel,
    anchor: &impl IsA<gtk::Widget>,
    picker: Picker,
    targets: impl Future<Output = Result<Vec<MoveTargetView>, UserError>> + 'static,
    on_pick: impl Fn(Vec<String>) + 'static,
) {
    let list = gtk::ListBox::builder()
        .name(format!("{}-list", picker.name))
        .selection_mode(gtk::SelectionMode::None)
        .css_classes(["navigation-sidebar"])
        .build();
    let spinner = adw::Spinner::builder()
        .width_request(32)
        .height_request(32)
        .halign(gtk::Align::Center)
        .valign(gtk::Align::Center)
        .build();
    label_loading(&spinner);
    let stack = gtk::Stack::new();
    stack.add_named(&spinner, Some("loading"));
    stack.add_named(
        &gtk::ScrolledWindow::builder()
            .hscrollbar_policy(gtk::PolicyType::Never)
            .vexpand(true)
            .child(&list)
            .build(),
        Some("targets"),
    );

    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&adw::HeaderBar::new());
    toolbar.set_content(Some(&stack));
    let dialog = adw::Dialog::builder()
        .title(picker.title)
        .content_width(360)
        .content_height(420)
        .child(&toolbar)
        .build();

    let model = model.clone();
    glib::spawn_future_local({
        let dialog = dialog.clone();
        async move {
            let targets = match targets.await {
                Ok(targets) => targets,
                Err(error) => {
                    dialog.close();
                    model.report_error(&error);
                    return;
                }
            };
            fill(&list, picker.name, &targets);
            list.connect_row_activated(glib::clone!(
                #[weak]
                dialog,
                move |_, row| {
                    let Some(target) = usize::try_from(row.index())
                        .ok()
                        .and_then(|index| targets.get(index))
                    else {
                        return;
                    };
                    dialog.close();
                    on_pick(target.path.clone());
                }
            ));
            stack.set_visible_child_name("targets");
            if let Some(first) = (0..)
                .map_while(|index| list.row_at_index(index))
                .find(|row| row.is_sensitive())
            {
                dialog.set_focus(Some(&first));
            }
        }
    });

    dialog.present(Some(anchor));
}

fn fill(list: &gtk::ListBox, name: &str, targets: &[MoveTargetView]) {
    for (index, target) in targets.iter().enumerate() {
        let depth = i32::try_from(target.depth).unwrap_or(0);
        let label = gtk::Label::builder()
            .label(&target.label)
            .xalign(0.0)
            .ellipsize(gtk::pango::EllipsizeMode::End)
            .margin_top(8)
            .margin_bottom(8)
            .margin_start(BASE_MARGIN + depth * INDENT_PER_LEVEL)
            .margin_end(BASE_MARGIN)
            .build();
        let row = gtk::ListBoxRow::builder()
            .name(format!("{name}-row-{index}"))
            .child(&label)
            .activatable(!target.disabled)
            .sensitive(!target.disabled)
            .build();
        list.append(&row);
    }
}
