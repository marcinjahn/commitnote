use std::rc::Rc;

use adw::prelude::*;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use super::target_picker;
use crate::model::AppModel;

pub fn present(
    model: &AppModel,
    anchor: &impl IsA<gtk::Widget>,
    path: Vec<String>,
    on_moved: impl Fn(Vec<String>) + 'static,
) {
    let on_moved = Rc::new(on_moved);
    target_picker::present(
        model,
        anchor,
        target_picker::Picker {
            name: "move-to",
            title: "Move To",
        },
        {
            let (model, path) = (model.clone(), path.clone());
            async move { model.move_targets(path).await }
        },
        {
            let model = model.clone();
            move |parent| {
                let (model, path, on_moved) = (model.clone(), path.clone(), on_moved.clone());
                glib::spawn_future_local(async move {
                    match model.move_node(path, parent).await {
                        Ok(moved) => on_moved(moved),
                        Err(error) => model.report_error(&error),
                    }
                });
            }
        },
    );
}
