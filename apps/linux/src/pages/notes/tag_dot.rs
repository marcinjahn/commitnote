use std::cell::RefCell;

use commitnote_core_api::shapes::ColorTag;
use gtk4::{self as gtk, prelude::*};

use super::tree_logic::tag_id;

const SIZE: i32 = 10;

#[derive(Debug)]
pub struct TagDot {
    widget: gtk::Box,
    class: RefCell<Option<String>>,
}

impl TagDot {
    pub fn new() -> Self {
        let widget = gtk::Box::builder()
            .accessible_role(gtk::AccessibleRole::Presentation)
            .css_classes(["tag-dot"])
            .width_request(SIZE)
            .height_request(SIZE)
            .valign(gtk::Align::Center)
            .visible(false)
            .build();
        Self {
            widget,
            class: RefCell::new(None),
        }
    }

    pub fn widget(&self) -> &gtk::Box {
        &self.widget
    }

    pub fn set_tag(&self, tag: Option<ColorTag>) {
        if let Some(class) = self.class.take() {
            self.widget.remove_css_class(&class);
        }
        if let Some(tag) = tag {
            let class = format!("tag-{}", tag_id(tag));
            self.widget.add_css_class(&class);
            self.class.replace(Some(class));
        }
        self.widget.set_visible(tag.is_some());
    }
}

impl Default for TagDot {
    fn default() -> Self {
        Self::new()
    }
}
