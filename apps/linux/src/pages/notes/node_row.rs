use std::cell::RefCell;

use adw::prelude::*;
use adw::subclass::prelude::*;
use commitnote_core_api::shapes::TreeNode;
use gtk4::{self as gtk, glib, pango};
use libadwaita as adw;

use super::tree_logic::tag_id;

const FOLDER_ICON: &str = "folder-symbolic";
const NOTE_ICON: &str = "text-x-generic-symbolic";

mod imp {
    use super::*;

    #[derive(Debug, Default)]
    pub struct NodeRow {
        pub(super) icon: gtk::Image,
        pub(super) name: gtk::Label,
        pub(super) count: gtk::Label,
        pub(super) shared: gtk::Image,
        pub(super) dot: gtk::Box,
        pub(super) dot_class: RefCell<Option<String>>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for NodeRow {
        const NAME: &'static str = "CommitnoteNodeRow";
        type Type = super::NodeRow;
        type ParentType = gtk::Box;
    }

    impl ObjectImpl for NodeRow {
        fn constructed(&self) {
            self.parent_constructed();
            let row = self.obj();
            row.set_spacing(8);

            self.name.set_xalign(0.0);
            self.name.set_hexpand(true);
            self.name.set_ellipsize(pango::EllipsizeMode::End);

            self.count.add_css_class("dim-label");
            self.count.add_css_class("numeric");

            self.shared.set_icon_name(Some("emblem-shared-symbolic"));
            self.shared.set_tooltip_text(Some("Shared"));

            self.dot.add_css_class("tag-dot");
            self.dot.set_size_request(10, 10);
            self.dot.set_valign(gtk::Align::Center);

            row.append(&self.icon);
            row.append(&self.name);
            row.append(&self.count);
            row.append(&self.shared);
            row.append(&self.dot);
        }
    }

    impl WidgetImpl for NodeRow {}
    impl BoxImpl for NodeRow {}
}

glib::wrapper! {
    pub struct NodeRow(ObjectSubclass<imp::NodeRow>)
        @extends gtk::Box, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget, gtk::Orientable;
}

impl NodeRow {
    pub fn new() -> Self {
        glib::Object::new()
    }

    pub fn bind(&self, node: &TreeNode) {
        let imp = self.imp();
        if let Some(class) = imp.dot_class.take() {
            imp.dot.remove_css_class(&class);
        }
        match node {
            TreeNode::Folder {
                name, note_count, ..
            } => {
                imp.icon.set_icon_name(Some(FOLDER_ICON));
                imp.name.set_label(name);
                imp.count.set_label(&note_count.to_string());
                imp.count.set_visible(true);
                imp.shared.set_visible(false);
                imp.dot.set_visible(false);
            }
            TreeNode::Note {
                name,
                color_tag,
                shared,
                ..
            } => {
                imp.icon.set_icon_name(Some(NOTE_ICON));
                imp.name.set_label(name);
                imp.count.set_visible(false);
                imp.shared.set_visible(*shared);
                match color_tag {
                    Some(tag) => {
                        let class = format!("tag-{}", tag_id(*tag));
                        imp.dot.add_css_class(&class);
                        imp.dot_class.replace(Some(class));
                        imp.dot.set_visible(true);
                    }
                    None => imp.dot.set_visible(false),
                }
            }
        }
    }
}

impl Default for NodeRow {
    fn default() -> Self {
        Self::new()
    }
}
