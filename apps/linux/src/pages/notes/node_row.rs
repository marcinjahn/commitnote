use std::cell::{Cell, RefCell};

use adw::prelude::*;
use adw::subclass::prelude::*;
use commitnote_core_api::shapes::TreeNode;
use gtk4::{self as gtk, glib, pango};
use libadwaita as adw;

use super::tag_dot::TagDot;
use super::tree_logic::{RenameState, node_path};

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
        pub(super) dot: TagDot,
        pub(super) entry: gtk::Entry,
        pub(super) error_popover: RefCell<Option<gtk::Popover>>,
        pub(super) error_text: gtk::Label,
        pub(super) path: RefCell<Vec<String>>,
        pub(super) focus_pending: Cell<bool>,
        pub(super) error: RefCell<Option<String>>,
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
            self.shared
                .update_property(&[gtk::accessible::Property::Label("Shared")]);

            self.entry.set_widget_name("tree-rename-entry");
            self.entry.set_hexpand(true);
            self.entry.set_visible(false);
            self.entry.set_width_chars(1);
            self.entry.connect_map({
                let row = row.downgrade();
                move |_| {
                    if let Some(row) = row.upgrade() {
                        row.apply_pending();
                    }
                }
            });

            self.error_text.set_widget_name("tree-rename-error-text");
            self.error_text.add_css_class("error");
            self.error_text.set_wrap(true);
            self.error_text.set_max_width_chars(32);
            self.error_text.set_xalign(0.0);

            row.append(&self.icon);
            row.append(&self.name);
            row.append(&self.entry);
            row.append(&self.count);
            row.append(&self.shared);
            row.append(self.dot.widget());
        }

        fn dispose(&self) {
            if let Some(popover) = self.error_popover.take() {
                popover.unparent();
            }
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

    pub fn entry(&self) -> &gtk::Entry {
        &self.imp().entry
    }

    pub fn path(&self) -> Vec<String> {
        self.imp().path.borrow().clone()
    }

    pub fn bind(&self, node: &TreeNode, rename: Option<&RenameState>) {
        let imp = self.imp();
        imp.path.replace(node_path(node).to_vec());
        match node {
            TreeNode::Folder {
                name, note_count, ..
            } => {
                imp.icon.set_icon_name(Some(FOLDER_ICON));
                imp.name.set_label(name);
                imp.count.set_label(&note_count.to_string());
                imp.count.set_visible(true);
                imp.shared.set_visible(false);
                imp.dot.set_tag(None);
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
                imp.dot.set_tag(*color_tag);
            }
        }
        self.sync_rename(rename);
    }

    /// Shows the rename entry when `rename` is for this row, else the name.
    pub fn sync_rename(&self, rename: Option<&RenameState>) {
        let imp = self.imp();
        let Some(state) = rename.filter(|state| state.path == *imp.path.borrow()) else {
            self.hide_entry();
            return;
        };
        if !WidgetExt::is_visible(&imp.entry) {
            imp.name.set_visible(false);
            imp.entry.set_visible(true);
            imp.focus_pending.set(true);
        }
        if imp.entry.text() != state.text {
            imp.entry.set_text(&state.text);
            imp.focus_pending.set(true);
        }
        self.show_error(state.error.as_deref());
        if imp.focus_pending.get() && imp.entry.is_mapped() {
            self.apply_pending();
        }
    }

    pub fn show_error(&self, message: Option<&str>) {
        let imp = self.imp();
        if imp.error.borrow().as_deref() == message {
            return;
        }
        imp.error.replace(message.map(str::to_owned));
        match message {
            Some(message) => {
                imp.entry.add_css_class("error");
                imp.error_text.set_label(message);
                let popover = imp
                    .error_popover
                    .borrow_mut()
                    .get_or_insert_with(|| self.new_error_popover())
                    .clone();
                if imp.entry.is_mapped() {
                    popover.popup();
                }
            }
            None => {
                imp.entry.remove_css_class("error");
                if let Some(popover) = imp.error_popover.borrow().as_ref() {
                    popover.popdown();
                }
            }
        }
    }

    fn new_error_popover(&self) -> gtk::Popover {
        let imp = self.imp();
        let popover = gtk::Popover::builder()
            .name("tree-rename-error")
            .autohide(false)
            .has_arrow(true)
            .position(gtk::PositionType::Bottom)
            .child(&imp.error_text)
            .build();
        popover.set_parent(&imp.entry);
        popover
    }

    fn hide_entry(&self) {
        let imp = self.imp();
        imp.focus_pending.set(false);
        self.show_error(None);
        if WidgetExt::is_visible(&imp.entry) {
            imp.entry.set_visible(false);
            imp.name.set_visible(true);
        }
    }

    fn apply_pending(&self) {
        let imp = self.imp();
        if !imp.focus_pending.replace(false) {
            return;
        }
        let untouched =
            imp.entry.text().as_str() == imp.path.borrow().last().map_or("", String::as_str);
        imp.entry.grab_focus();
        if untouched {
            imp.entry.select_region(0, -1);
        } else {
            imp.entry.set_position(-1);
        }
        if let (Some(popover), Some(_)) = (
            imp.error_popover.borrow().as_ref(),
            imp.error.borrow().as_ref(),
        ) {
            popover.popup();
        }
    }
}

impl Default for NodeRow {
    fn default() -> Self {
        Self::new()
    }
}
