use std::cell::{Cell, OnceCell, RefCell};
use std::collections::HashSet;
use std::rc::Rc;

use adw::subclass::prelude::*;
use commitnote_core_api::shapes::TreeNode;
use gtk4::prelude::*;
use gtk4::{self as gtk, gdk, gio, glib, graphene};
use libadwaita as adw;

use super::node_object::NodeObject;
use super::node_row::NodeRow;
use super::row_menu;
use super::tree_logic::{
    DropAction, DropZone, KeyStep, RenameState, RowList, RowRef, accessible_text, ancestors,
    child_names, drop_action, drop_at_end, expanded_folders, expanded_paths, first_child_position,
    left_step, menu_tag, node_path, parent_of, parent_position, position_of, restore_expanded,
    right_step, siblings,
};
use crate::model::{AppModel, UserError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RowCommand {
    Rename,
    Trash,
    MoveUp,
    MoveDown,
    Menu,
}

fn row_command(key: gdk::Key, modifiers: gdk::ModifierType) -> Option<RowCommand> {
    let plain = modifiers.is_empty();
    let alt = modifiers == gdk::ModifierType::ALT_MASK;
    match key {
        gdk::Key::F2 if plain => Some(RowCommand::Rename),
        gdk::Key::Delete | gdk::Key::KP_Delete if plain => Some(RowCommand::Trash),
        gdk::Key::Up | gdk::Key::KP_Up if alt => Some(RowCommand::MoveUp),
        gdk::Key::Down | gdk::Key::KP_Down if alt => Some(RowCommand::MoveDown),
        gdk::Key::Menu if plain => Some(RowCommand::Menu),
        gdk::Key::F10 if modifiers == gdk::ModifierType::SHIFT_MASK => Some(RowCommand::Menu),
        _ => None,
    }
}

#[derive(Debug)]
struct PendingReveal {
    path: Vec<String>,
    missed: bool,
}

mod imp {
    use super::*;

    #[derive(Debug, Default, gtk::CompositeTemplate)]
    #[template(resource = "/io/github/marcinjahn/commitnote/ui/tree-view.ui")]
    pub struct NotesTree {
        #[template_child]
        pub(super) stack: TemplateChild<gtk::Stack>,
        #[template_child]
        pub(super) scrolled: TemplateChild<gtk::ScrolledWindow>,
        #[template_child]
        pub(super) list_view: TemplateChild<gtk::ListView>,
        pub(super) selection: gtk::SingleSelection,
        pub(super) tree_model: RefCell<Option<gtk::TreeListModel>>,
        pub(super) synced_path: RefCell<Option<Vec<String>>>,
        pub(super) pending_reveal: RefCell<Option<PendingReveal>>,
        pub(super) rename: RefCell<Option<RenameState>>,
        pub(super) committing: Cell<bool>,
        pub(super) menu: OnceCell<gtk::PopoverMenu>,
        pub(super) dragged: RefCell<Option<NodeObject>>,
        pub(super) drop_mark: RefCell<Option<(glib::WeakRef<gtk::Widget>, DropZone)>>,
        pub(super) model: OnceCell<AppModel>,
        pub(super) handlers: RefCell<Vec<glib::SignalHandlerId>>,
        pub(super) restored_folders: RefCell<Option<HashSet<Vec<String>>>>,
        pub(super) reported_folders: RefCell<Option<Vec<Vec<String>>>>,
        pub(super) report_queued: Cell<bool>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for NotesTree {
        const NAME: &'static str = "CommitnoteNotesTree";
        type Type = super::NotesTree;
        type ParentType = adw::Bin;

        fn class_init(klass: &mut Self::Class) {
            klass.bind_template();
        }

        fn instance_init(obj: &glib::subclass::InitializingObject<Self>) {
            obj.init_template();
        }
    }

    impl ObjectImpl for NotesTree {
        fn constructed(&self) {
            self.parent_constructed();
            let tree = self.obj();
            let menu = row_menu::popover();
            menu.set_parent(&*tree);
            menu.connect_closed({
                let tree = tree.downgrade();
                move |menu| {
                    let (tree, menu) = (tree.clone(), menu.downgrade());
                    glib::idle_add_local_once(move || {
                        if let (Some(tree), Some(menu)) = (tree.upgrade(), menu.upgrade())
                            && !menu.is_visible()
                            && menu.parent().as_ref() != Some(tree.upcast_ref())
                        {
                            menu.unparent();
                            menu.set_parent(&tree);
                        }
                    });
                }
            });
            let _ = self.menu.set(menu);
            self.obj().setup_list();
        }

        fn dispose(&self) {
            if let Some(menu) = self.menu.get() {
                menu.unparent();
            }
            if let Some(model) = self.model.get() {
                for id in self.handlers.take() {
                    model.disconnect(id);
                }
            }
        }
    }

    impl WidgetImpl for NotesTree {}
    impl BinImpl for NotesTree {}
}

glib::wrapper! {
    pub struct NotesTree(ObjectSubclass<imp::NotesTree>)
        @extends adw::Bin, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl NotesTree {
    pub fn new(model: &AppModel) -> Self {
        let widget: Self = glib::Object::new();
        let _ = widget.imp().model.set(model.clone());
        widget.rebuild();
        let handlers = vec![
            model.connect_tree_changed({
                let widget = widget.downgrade();
                move |_| {
                    if let Some(widget) = widget.upgrade() {
                        widget.rebuild();
                    }
                }
            }),
            model.connect_open_note_changed({
                let widget = widget.downgrade();
                move |_| {
                    if let Some(widget) = widget.upgrade() {
                        widget.sync_open_note();
                    }
                }
            }),
            model.connect_last_view_restored({
                let widget = widget.downgrade();
                move |_| {
                    if let Some(widget) = widget.upgrade() {
                        widget.restore_folders();
                    }
                }
            }),
        ];
        widget.imp().handlers.replace(handlers);
        widget.restore_folders();
        widget
    }

    fn model(&self) -> &AppModel {
        self.imp()
            .model
            .get()
            .expect("the tree is created with a model")
    }

    fn setup_list(&self) {
        let imp = self.imp();
        imp.selection.set_autoselect(false);
        imp.selection.set_can_unselect(true);

        let factory = gtk::SignalListItemFactory::new();
        factory.connect_setup({
            let tree = self.downgrade();
            move |_, item| {
                let (Some(tree), Some(item)) =
                    (tree.upgrade(), item.downcast_ref::<gtk::ListItem>())
                else {
                    return;
                };
                let row = NodeRow::new();
                tree.connect_rename_entry(&row);
                let expander = gtk::TreeExpander::new();
                expander.set_child(Some(&row));
                tree.watch_expanded(&expander);
                tree.connect_menu_gestures(&expander);
                tree.connect_drag_source(&expander);
                tree.connect_drop_target(&expander);
                item.set_child(Some(&expander));
            }
        });
        factory.connect_bind({
            let tree = self.downgrade();
            move |_, item| {
                let (Some(tree), Some(item)) =
                    (tree.upgrade(), item.downcast_ref::<gtk::ListItem>())
                else {
                    return;
                };
                tree.bind_item(item);
            }
        });
        factory.connect_unbind(|_, item| {
            if let Some(expander) = item
                .downcast_ref::<gtk::ListItem>()
                .and_then(gtk::ListItem::child)
                .and_downcast::<gtk::TreeExpander>()
            {
                expander.set_list_row(None);
            }
        });
        imp.list_view.set_factory(Some(&factory));
        imp.list_view.set_model(Some(&imp.selection));

        imp.list_view.connect_activate({
            let tree = self.downgrade();
            move |_, position| {
                if let Some(tree) = tree.upgrade() {
                    tree.activate(position);
                }
            }
        });

        let keys = gtk::EventControllerKey::new();
        keys.set_propagation_phase(gtk::PropagationPhase::Capture);
        keys.connect_key_pressed({
            let tree = self.downgrade();
            move |_, key, _, state| {
                tree.upgrade().map_or(glib::Propagation::Proceed, |tree| {
                    tree.key_pressed(key, state)
                })
            }
        });
        imp.list_view.add_controller(keys);
        self.connect_background_drop_target();
    }

    fn bind_item(&self, item: &gtk::ListItem) {
        let Some(row) = item.item().and_downcast::<gtk::TreeListRow>() else {
            return;
        };
        let Some(node) = row.item().and_downcast::<NodeObject>() else {
            return;
        };
        let Some(expander) = item.child().and_downcast::<gtk::TreeExpander>() else {
            return;
        };
        expander.set_list_row(Some(&row));
        for zone in [DropZone::Before, DropZone::After, DropZone::Into] {
            expander.remove_css_class(zone.css_class());
        }
        if let Some(node_row) = expander.child().and_downcast::<NodeRow>() {
            let rename = self.imp().rename.borrow().clone();
            node_row.bind(node.node(), rename.as_ref());
        }
        let (label, description) = accessible_text(node.node(), &self.model().tag_options());
        item.set_accessible_label(&label);
        item.set_accessible_description(&description);
    }

    fn activate(&self, position: u32) {
        let Some(row) = self
            .imp()
            .selection
            .item(position)
            .and_downcast::<gtk::TreeListRow>()
        else {
            return;
        };
        let Some(node) = row.item().and_downcast::<NodeObject>() else {
            return;
        };
        match node.node() {
            TreeNode::Folder { .. } => row.set_expanded(!row.is_expanded()),
            TreeNode::Note { path, .. } => self.model().open_note(Some(path.clone())),
        }
    }

    fn focused_row(&self) -> Option<gtk::TreeListRow> {
        let imp = self.imp();
        let mut widget = imp.list_view.focus_child();
        while let Some(current) = widget {
            if let Some(expander) = current.downcast_ref::<gtk::TreeExpander>() {
                return expander.list_row();
            }
            widget = current.first_child();
        }
        imp.selection
            .selected_item()
            .and_downcast::<gtk::TreeListRow>()
    }

    fn key_pressed(&self, key: gdk::Key, state: gdk::ModifierType) -> glib::Propagation {
        if self.imp().rename.borrow().is_some() || self.menu_open() {
            return glib::Propagation::Proceed;
        }
        let modifiers = state & gtk::accelerator_get_default_mod_mask();
        if let Some(command) = row_command(key, modifiers) {
            return match self.selected_path() {
                Some(path) => {
                    self.run_row_command(command, path);
                    glib::Propagation::Stop
                }
                None => glib::Propagation::Proceed,
            };
        }
        if !modifiers.is_empty() {
            return glib::Propagation::Proceed;
        }
        let rtl = self.direction() == gtk::TextDirection::Rtl;
        let backward = match key {
            gdk::Key::Left | gdk::Key::KP_Left => !rtl,
            gdk::Key::Right | gdk::Key::KP_Right => rtl,
            _ => return glib::Propagation::Proceed,
        };
        let imp = self.imp();
        let (Some(row), Some(tree_model)) = (self.focused_row(), imp.tree_model.borrow().clone())
        else {
            return glib::Propagation::Stop;
        };
        let position = row.position();
        let depth_at = |position: u32| tree_model.row(position).map(|row| row.depth());
        let step = if backward {
            left_step(
                row.is_expandable() && row.is_expanded(),
                parent_position(position, depth_at),
            )
        } else {
            right_step(
                row.is_expandable(),
                row.is_expanded(),
                first_child_position(position, depth_at),
            )
        };
        match step {
            KeyStep::Collapse => row.set_expanded(false),
            KeyStep::Expand => row.set_expanded(true),
            KeyStep::MoveTo(target) => imp.list_view.scroll_to(
                target,
                gtk::ListScrollFlags::FOCUS | gtk::ListScrollFlags::SELECT,
                None,
            ),
            KeyStep::Nothing => {}
        }
        glib::Propagation::Stop
    }

    fn run_row_command(&self, command: RowCommand, path: Vec<String>) {
        let action = match command {
            RowCommand::Rename => return self.start_rename(path),
            RowCommand::Menu => return self.open_selected_menu(),
            RowCommand::Trash => "tree.trash",
            RowCommand::MoveUp => "tree.move-up",
            RowCommand::MoveDown => "tree.move-down",
        };
        let _ = self.activate_action(action, Some(&path.to_variant()));
    }

    fn menu_open(&self) -> bool {
        self.imp().menu.get().is_some_and(|menu| menu.is_visible())
    }

    fn connect_menu_gestures(&self, expander: &gtk::TreeExpander) {
        let click = gtk::GestureClick::new();
        click.set_button(gdk::BUTTON_SECONDARY);
        click.connect_pressed({
            let (tree, expander) = (self.downgrade(), expander.downgrade());
            move |gesture, _, x, y| {
                if let (Some(tree), Some(expander)) = (tree.upgrade(), expander.upgrade()) {
                    gesture.set_state(gtk::EventSequenceState::Claimed);
                    tree.open_menu(&expander, Some((x, y)));
                }
            }
        });
        expander.add_controller(click);

        let press = gtk::GestureLongPress::new();
        press.set_touch_only(true);
        press.connect_pressed({
            let (tree, expander) = (self.downgrade(), expander.downgrade());
            move |gesture, x, y| {
                if let (Some(tree), Some(expander)) = (tree.upgrade(), expander.upgrade()) {
                    gesture.set_state(gtk::EventSequenceState::Claimed);
                    tree.open_menu(&expander, Some((x, y)));
                }
            }
        });
        expander.add_controller(press);
    }

    /// Stands in for a pointer drag that has started on the node at `path`, which the harness
    /// cannot start through the compositor.
    #[cfg(feature = "testing")]
    pub fn testing_set_dragged(&self, path: Option<&[String]>) {
        let node = path.and_then(|path| {
            let tree = self.model().tree()?;
            super::tree_logic::find_node(&tree, path)
                .cloned()
                .map(NodeObject::new)
        });
        self.imp().dragged.replace(node);
        if path.is_none() {
            self.set_drop_mark(None);
        }
    }

    fn connect_drag_source(&self, expander: &gtk::TreeExpander) {
        let source = gtk::DragSource::new();
        source.set_actions(gdk::DragAction::MOVE);
        let hotspot = Rc::new(Cell::new((0.0, 0.0)));
        source.connect_prepare({
            let (tree, expander, hotspot) =
                (self.downgrade(), expander.downgrade(), hotspot.clone());
            move |_, x, y| {
                let (tree, expander) = (tree.upgrade()?, expander.upgrade()?);
                if tree.imp().rename.borrow().is_some() {
                    return None;
                }
                let node = expander.list_row()?.item().and_downcast::<NodeObject>()?;
                hotspot.set((x, y));
                Some(gdk::ContentProvider::for_value(&node.to_value()))
            }
        });
        source.connect_drag_begin({
            let (tree, expander) = (self.downgrade(), expander.downgrade());
            let hotspot = hotspot.clone();
            move |source, _| {
                let (Some(tree), Some(expander)) = (tree.upgrade(), expander.upgrade()) else {
                    return;
                };
                let (x, y) = hotspot.get();
                source.set_icon(
                    Some(&gtk::WidgetPaintable::new(Some(&expander))),
                    x as i32,
                    y as i32,
                );
                let node = expander.list_row().and_then(|row| row.item());
                tree.imp()
                    .dragged
                    .replace(node.and_downcast::<NodeObject>());
            }
        });
        source.connect_drag_end({
            let tree = self.downgrade();
            move |_, _, _| {
                if let Some(tree) = tree.upgrade() {
                    tree.imp().dragged.take();
                    tree.set_drop_mark(None);
                }
            }
        });
        expander.add_controller(source);
    }

    fn node_drop_target() -> gtk::DropTarget {
        let target = gtk::DropTarget::new(glib::Type::INVALID, gdk::DragAction::MOVE);
        target.set_types(&[NodeObject::static_type()]);
        target
    }

    fn connect_drop_target(&self, expander: &gtk::TreeExpander) {
        let target = Self::node_drop_target();
        let hover = Rc::new({
            let (tree, expander) = (self.downgrade(), expander.downgrade());
            move |y: f64| {
                let (Some(tree), Some(expander)) = (tree.upgrade(), expander.upgrade()) else {
                    return gdk::DragAction::empty();
                };
                let dragged = tree.imp().dragged.borrow().clone();
                match dragged.and_then(|node| tree.row_drop(&expander, &node, y)) {
                    Some(action) => {
                        tree.set_drop_mark(Some((expander.upcast_ref(), action.zone)));
                        gdk::DragAction::MOVE
                    }
                    None => {
                        tree.set_drop_mark(None);
                        gdk::DragAction::empty()
                    }
                }
            }
        });
        target.connect_enter({
            let hover = hover.clone();
            move |_, _, y| hover(y)
        });
        target.connect_motion(move |_, _, y| hover(y));
        target.connect_leave({
            let tree = self.downgrade();
            move |_| {
                if let Some(tree) = tree.upgrade() {
                    tree.set_drop_mark(None);
                }
            }
        });
        target.connect_drop({
            let (tree, expander) = (self.downgrade(), expander.downgrade());
            move |_, value, _, y| {
                let (Some(tree), Some(expander)) = (tree.upgrade(), expander.upgrade()) else {
                    return false;
                };
                tree.set_drop_mark(None);
                let Ok(dragged) = value.get::<NodeObject>() else {
                    return false;
                };
                let Some(action) = tree.row_drop(&expander, &dragged, y) else {
                    return false;
                };
                tree.drop_node(&dragged, action);
                true
            }
        });
        expander.add_controller(target);
    }

    fn connect_background_drop_target(&self) {
        let target = Self::node_drop_target();
        let hover = Rc::new({
            let tree = self.downgrade();
            move |y: f64| {
                let Some(tree) = tree.upgrade() else {
                    return gdk::DragAction::empty();
                };
                let dragged = tree.imp().dragged.borrow().clone();
                match dragged.and_then(|node| tree.end_drop(&node, y)) {
                    Some((_, last)) => {
                        tree.set_drop_mark(Some((last.upcast_ref(), DropZone::After)));
                        gdk::DragAction::MOVE
                    }
                    None => {
                        tree.set_drop_mark(None);
                        gdk::DragAction::empty()
                    }
                }
            }
        });
        target.connect_enter({
            let hover = hover.clone();
            move |_, _, y| hover(y)
        });
        target.connect_motion(move |_, _, y| hover(y));
        target.connect_leave({
            let tree = self.downgrade();
            move |_| {
                if let Some(tree) = tree.upgrade() {
                    tree.set_drop_mark(None);
                }
            }
        });
        target.connect_drop({
            let tree = self.downgrade();
            move |_, value, _, y| {
                let Some(tree) = tree.upgrade() else {
                    return false;
                };
                tree.set_drop_mark(None);
                let Ok(dragged) = value.get::<NodeObject>() else {
                    return false;
                };
                let Some((action, _)) = tree.end_drop(&dragged, y) else {
                    return false;
                };
                tree.drop_node(&dragged, action);
                true
            }
        });
        self.imp().scrolled.add_controller(target);
    }

    /// What dropping `dragged` at height `y` of the row shown by `expander` does.
    fn row_drop(
        &self,
        expander: &gtk::TreeExpander,
        dragged: &NodeObject,
        y: f64,
    ) -> Option<DropAction> {
        if self.imp().rename.borrow().is_some() {
            return None;
        }
        let target = expander.list_row()?.item().and_downcast::<NodeObject>()?;
        let tree = self.model().tree()?;
        let path = node_path(target.node());
        let siblings = child_names(&tree, parent_of(path))?;
        drop_action(
            node_path(dragged.node()),
            path,
            matches!(target.node(), TreeNode::Folder { .. }),
            &siblings,
            y,
            f64::from(expander.height()),
        )
    }

    /// What dropping `dragged` at height `y` of the scrolled window does when `y` is below the
    /// rows, with the last row, which shows the drop line.
    fn end_drop(&self, dragged: &NodeObject, y: f64) -> Option<(DropAction, gtk::TreeExpander)> {
        let imp = self.imp();
        if imp.rename.borrow().is_some() {
            return None;
        }
        let last = imp.tree_model.borrow().as_ref()?.n_items().checked_sub(1)?;
        let expander = self.expanders().into_iter().find(|expander| {
            expander
                .list_row()
                .is_some_and(|row| row.position() == last)
        })?;
        let bottom = expander
            .compute_bounds(&*imp.scrolled)
            .map(|bounds| bounds.y() + bounds.height())?;
        if y < f64::from(bottom) {
            return None;
        }
        let top_level = child_names(&self.model().tree()?, &[])?;
        let action = drop_at_end(node_path(dragged.node()), &top_level)?;
        Some((action, expander))
    }

    fn expanders(&self) -> Vec<gtk::TreeExpander> {
        let mut found = Vec::new();
        let mut pending: Vec<gtk::Widget> =
            self.imp().list_view.first_child().into_iter().collect();
        while let Some(widget) = pending.pop() {
            pending.extend(widget.first_child());
            pending.extend(widget.next_sibling());
            if let Ok(expander) = widget.downcast::<gtk::TreeExpander>() {
                found.push(expander);
            }
        }
        found
    }

    fn set_drop_mark(&self, mark: Option<(&gtk::Widget, DropZone)>) {
        let imp = self.imp();
        let unchanged = match (imp.drop_mark.borrow().as_ref(), mark) {
            (Some((weak, zone)), Some((widget, next))) => {
                *zone == next && weak.upgrade().as_ref() == Some(widget)
            }
            (None, None) => true,
            _ => false,
        };
        if unchanged {
            return;
        }
        let previous = imp.drop_mark.take();
        if let Some((widget, zone)) =
            previous.and_then(|(weak, zone)| Some((weak.upgrade()?, zone)))
        {
            widget.remove_css_class(zone.css_class());
        }
        if let Some((widget, zone)) = mark {
            widget.add_css_class(zone.css_class());
            imp.drop_mark.replace(Some((widget.downgrade(), zone)));
        }
    }

    fn drop_node(&self, dragged: &NodeObject, action: DropAction) {
        let path = node_path(dragged.node()).to_vec();
        let (tree, model) = (self.downgrade(), self.model().clone());
        glib::spawn_future_local(async move {
            let DropAction {
                zone,
                parent,
                before,
            } = action;
            let result = match zone {
                DropZone::Into => model.move_node(path, parent).await,
                DropZone::Before | DropZone::After => model.place_node(path, parent, before).await,
            };
            match result {
                Ok(moved) => {
                    if let Some(tree) = tree.upgrade() {
                        tree.reveal(moved);
                    }
                }
                Err(error) => model.report_error(&error),
            }
        });
    }

    fn open_selected_menu(&self) {
        let Some(selected) = self.imp().selection.selected_item() else {
            return;
        };
        let mut pending: Vec<gtk::Widget> =
            self.imp().list_view.first_child().into_iter().collect();
        while let Some(widget) = pending.pop() {
            pending.extend(widget.first_child());
            pending.extend(widget.next_sibling());
            if let Some(expander) = widget.downcast_ref::<gtk::TreeExpander>()
                && expander
                    .list_row()
                    .is_some_and(|row| row.upcast::<glib::Object>() == selected)
            {
                self.open_menu(expander, None);
                return;
            }
        }
    }

    /// Selects the row shown by `expander` and opens its context menu at `at`, in expander
    /// coordinates, or at the whole row.
    fn open_menu(&self, expander: &gtk::TreeExpander, at: Option<(f64, f64)>) {
        let imp = self.imp();
        let (Some(list_row), Some(row), Some(tree_model)) = (
            expander.list_row(),
            expander.child().and_downcast::<NodeRow>(),
            imp.tree_model.borrow().clone(),
        ) else {
            return;
        };
        let Some(node) = list_row.item().and_downcast::<NodeObject>() else {
            return;
        };
        let position = list_row.position();
        imp.list_view.scroll_to(
            position,
            gtk::ListScrollFlags::FOCUS | gtk::ListScrollFlags::SELECT,
            None,
        );

        let model = self.model();
        let node = node.node();
        let path = node_path(node).to_vec();
        let tag = menu_tag(node, model.tags_writable());
        let options = model.tag_options();
        let menu = row_menu::menu(
            &path,
            matches!(node, TreeNode::Folder { .. }),
            tag.map(|_| options.as_slice()),
        );
        let depth_at = |position: u32| tree_model.row(position).map(|row| row.depth());
        let actions = row_menu::actions(
            self.upcast_ref(),
            path,
            siblings(position, depth_at),
            tag.flatten(),
        );
        let at = at.and_then(|(x, y)| {
            let point = expander.compute_point(&row, &graphene::Point::new(x as f32, y as f32))?;
            Some((f64::from(point.x()), f64::from(point.y())))
        });
        if let Some(popover) = imp.menu.get() {
            row_menu::popup(popover, row.upcast_ref(), &menu, &actions, at);
        }
    }

    fn rebuild(&self) {
        let imp = self.imp();
        let tree = self.model().tree();
        let page = match &tree {
            None => "loading",
            Some(nodes) if nodes.is_empty() => "empty",
            Some(_) => "tree",
        };
        imp.stack.set_visible_child_name(page);

        let previous = imp.tree_model.take().map(TreeRows);
        let first = previous.is_none();
        let keep = previous.as_ref().map(expanded_paths).unwrap_or_default();
        let selected = self.selected_path();
        let refocus = imp.rename.borrow().is_none()
            && !self.menu_open()
            && self
                .root()
                .and_then(|root| root.focus())
                .is_some_and(|focus| focus.is_ancestor(&*imp.list_view));
        let adjustment = imp.scrolled.vadjustment();
        let scroll = adjustment.value();

        let Some(nodes) = tree else {
            imp.selection.set_model(None::<&gio::ListModel>);
            imp.synced_path.replace(None);
            imp.rename.replace(None);
            imp.restored_folders.replace(None);
            imp.reported_folders.replace(None);
            return;
        };
        let tree_model = gtk::TreeListModel::new(build_store(&nodes), false, false, |item| {
            match item.downcast_ref::<NodeObject>()?.node() {
                TreeNode::Folder { children, .. } => Some(build_store(children).upcast()),
                TreeNode::Note { .. } => None,
            }
        });
        tree_model.connect_items_changed({
            let tree = self.downgrade();
            move |_, _, _, _| {
                if let Some(tree) = tree.upgrade() {
                    tree.queue_expanded_report();
                }
            }
        });
        imp.selection.set_model(Some(&tree_model));
        imp.tree_model.replace(Some(tree_model.clone()));

        let mut rows = TreeRows(tree_model);
        restore_expanded(&mut rows, &keep);
        self.apply_restored_folders(&mut rows);
        self.keep_rename_row(&mut rows);
        self.queue_expanded_report();

        if first {
            imp.synced_path.replace(None);
            self.sync_open_note();
            self.reveal_pending(&mut rows);
            return;
        }
        let synced = imp.synced_path.borrow().clone();
        let position = selected
            .as_deref()
            .and_then(|path| position_of(&rows, path))
            .or_else(|| {
                let path = synced?;
                restore_expanded(&mut rows, &ancestors(&path));
                position_of(&rows, &path)
            })
            .unwrap_or(gtk::INVALID_LIST_POSITION);
        imp.selection.set_selected(position);
        if !self.reveal_pending(&mut rows) {
            if refocus && position != gtk::INVALID_LIST_POSITION {
                imp.list_view
                    .scroll_to(position, gtk::ListScrollFlags::FOCUS, None);
            }
            glib::idle_add_local_once(move || adjustment.set_value(scroll));
        }
    }

    /// Expands the folders of the restored view, now or, before the list exists, at the next
    /// rebuild.
    fn restore_folders(&self) {
        let folders = self.model().take_restored_folders();
        if folders.is_empty() {
            return;
        }
        let imp = self.imp();
        imp.restored_folders
            .replace(Some(folders.into_iter().collect()));
        let tree_model = imp.tree_model.borrow().clone();
        if let Some(tree_model) = tree_model {
            self.apply_restored_folders(&mut TreeRows(tree_model));
        }
    }

    fn apply_restored_folders(&self, rows: &mut TreeRows) {
        let Some(folders) = self.imp().restored_folders.take() else {
            return;
        };
        restore_expanded(rows, &folders);
        self.imp().reported_folders.replace(None);
        self.queue_expanded_report();
    }

    /// Notices a folder expanding or collapsing even when that adds or removes no rows, as for
    /// an empty folder.
    fn watch_expanded(&self, expander: &gtk::TreeExpander) {
        let group = glib::SignalGroup::new::<gtk::TreeListRow>();
        group.connect_notify_local(Some("expanded"), {
            let tree = self.downgrade();
            move |_, _| {
                if let Some(tree) = tree.upgrade() {
                    tree.queue_expanded_report();
                }
            }
        });
        expander.connect_list_row_notify(move |expander| {
            group.set_target(expander.list_row().as_ref());
        });
    }

    /// Reports the expanded folders once the current changes are done, so a rebuild that
    /// restores the same folders reports nothing.
    fn queue_expanded_report(&self) {
        let imp = self.imp();
        if imp.report_queued.replace(true) {
            return;
        }
        let tree = self.downgrade();
        glib::idle_add_local_once(move || {
            if let Some(tree) = tree.upgrade() {
                tree.imp().report_queued.set(false);
                tree.report_expanded();
            }
        });
    }

    fn report_expanded(&self) {
        let imp = self.imp();
        let Some(tree_model) = imp.tree_model.borrow().clone() else {
            return;
        };
        let folders = expanded_folders(&TreeRows(tree_model));
        if imp.reported_folders.borrow().as_ref() == Some(&folders) {
            return;
        }
        imp.reported_folders.replace(Some(folders.clone()));
        self.model().record_expanded_folders(folders);
    }

    fn selected_node(&self) -> Option<NodeObject> {
        self.imp()
            .selection
            .selected_item()
            .and_downcast::<gtk::TreeListRow>()?
            .item()
            .and_downcast::<NodeObject>()
    }

    pub fn selected_path(&self) -> Option<Vec<String>> {
        let node = self.selected_node()?;
        Some(node_path(node.node()).to_vec())
    }

    pub fn selected_target(&self) -> Option<(Vec<String>, bool)> {
        let node = self.selected_node()?;
        let folder = matches!(node.node(), TreeNode::Folder { .. });
        Some((node_path(node.node()).to_vec(), folder))
    }

    /// Expands the folders above `path`, selects its row and focuses it. A path that is not in the
    /// tree yet is revealed by the next rebuild that contains it.
    pub fn reveal(&self, path: Vec<String>) {
        let imp = self.imp();
        let tree_model = imp.tree_model.borrow().clone();
        let found = tree_model.is_some_and(|model| self.reveal_now(&mut TreeRows(model), &path));
        imp.pending_reveal.replace(if found {
            None
        } else {
            Some(PendingReveal {
                path,
                missed: false,
            })
        });
    }

    fn reveal_now(&self, rows: &mut TreeRows, path: &[String]) -> bool {
        restore_expanded(rows, &ancestors(path));
        let Some(position) = position_of(rows, path) else {
            return false;
        };
        self.imp().list_view.scroll_to(
            position,
            gtk::ListScrollFlags::FOCUS | gtk::ListScrollFlags::SELECT,
            None,
        );
        true
    }

    fn reveal_pending(&self, rows: &mut TreeRows) -> bool {
        let Some(pending) = self.imp().pending_reveal.take() else {
            return false;
        };
        if self.reveal_now(rows, &pending.path) {
            return true;
        }
        if !pending.missed {
            self.imp().pending_reveal.replace(Some(PendingReveal {
                missed: true,
                ..pending
            }));
        }
        false
    }

    /// Replaces the name of the row at `path` with an entry. A path that is not in the tree is
    /// ignored.
    pub fn start_rename(&self, path: Vec<String>) {
        let imp = self.imp();
        if imp.committing.get() {
            return;
        }
        let Some(tree_model) = imp.tree_model.borrow().clone() else {
            return;
        };
        if !self.reveal_now(&mut TreeRows(tree_model), &path) {
            return;
        }
        imp.pending_reveal.replace(None);
        imp.rename.replace(Some(RenameState::new(path)));
        self.sync_rename_rows();
    }

    fn node_rows(&self) -> Vec<NodeRow> {
        let mut found = Vec::new();
        let mut pending: Vec<gtk::Widget> =
            self.imp().list_view.first_child().into_iter().collect();
        while let Some(widget) = pending.pop() {
            pending.extend(widget.first_child());
            pending.extend(widget.next_sibling());
            if let Ok(row) = widget.downcast::<NodeRow>() {
                found.push(row);
            }
        }
        found
    }

    fn sync_rename_rows(&self) {
        let rename = self.imp().rename.borrow().clone();
        for row in self.node_rows() {
            row.sync_rename(rename.as_ref());
        }
    }

    fn keep_rename_row(&self, rows: &mut TreeRows) {
        let Some(path) = self
            .imp()
            .rename
            .borrow()
            .as_ref()
            .map(|state| state.path.clone())
        else {
            return;
        };
        restore_expanded(rows, &ancestors(&path));
        if position_of(rows, &path).is_none() {
            self.imp().rename.replace(None);
        }
    }

    fn connect_rename_entry(&self, row: &NodeRow) {
        let entry = row.entry();
        entry.connect_changed({
            let (tree, row) = (self.downgrade(), row.downgrade());
            move |entry| {
                if let (Some(tree), Some(row)) = (tree.upgrade(), row.upgrade()) {
                    tree.rename_text_changed(&row, entry.text().as_str());
                }
            }
        });
        entry.connect_activate({
            let (tree, row) = (self.downgrade(), row.downgrade());
            move |_| {
                if let (Some(tree), Some(row)) = (tree.upgrade(), row.upgrade())
                    && tree.renaming(&row)
                {
                    tree.commit_rename(false);
                }
            }
        });

        let keys = gtk::EventControllerKey::new();
        keys.connect_key_pressed({
            let (tree, row) = (self.downgrade(), row.downgrade());
            move |_, key, _, _| match key {
                gdk::Key::Tab | gdk::Key::ISO_Left_Tab => glib::Propagation::Proceed,
                gdk::Key::Escape => {
                    if let (Some(tree), Some(row)) = (tree.upgrade(), row.upgrade())
                        && tree.renaming(&row)
                        && !tree.imp().committing.get()
                    {
                        tree.end_rename(true);
                    }
                    glib::Propagation::Stop
                }
                _ => glib::Propagation::Stop,
            }
        });
        entry.add_controller(keys);

        let focus = gtk::EventControllerFocus::new();
        focus.connect_leave({
            let (tree, row) = (self.downgrade(), row.downgrade());
            move |_| {
                let (tree, row) = (tree.clone(), row.clone());
                glib::idle_add_local_once(move || {
                    if let (Some(tree), Some(row)) = (tree.upgrade(), row.upgrade()) {
                        tree.rename_focus_left(&row);
                    }
                });
            }
        });
        entry.add_controller(focus);
    }

    fn renaming(&self, row: &NodeRow) -> bool {
        self.imp()
            .rename
            .borrow()
            .as_ref()
            .is_some_and(|state| state.path == row.path())
    }

    fn rename_text_changed(&self, row: &NodeRow, text: &str) {
        if !self.renaming(row) {
            return;
        }
        let cleared = self
            .imp()
            .rename
            .borrow_mut()
            .as_mut()
            .is_some_and(|state| {
                let had_error = state.error.is_some();
                state.edit(text.to_owned());
                had_error && state.error.is_none()
            });
        if cleared {
            row.show_error(None);
        }
    }

    fn rename_focus_left(&self, row: &NodeRow) {
        let entry = row.entry();
        if !self.renaming(row) || self.imp().committing.get() || !entry.is_mapped() {
            return;
        }
        let Some(root) = entry.root() else {
            return;
        };
        let window_active = root
            .downcast_ref::<gtk::Window>()
            .is_some_and(gtk::Window::is_active);
        let focus_inside = root.focus().is_some_and(|focus| {
            focus == *entry.upcast_ref::<gtk::Widget>() || focus.is_ancestor(entry)
        });
        if window_active && !focus_inside {
            self.commit_rename(true);
        }
    }

    fn end_rename(&self, restore_focus: bool) {
        let Some(state) = self.imp().rename.take() else {
            return;
        };
        self.sync_rename_rows();
        if restore_focus && let Some(tree_model) = self.imp().tree_model.borrow().clone() {
            self.reveal_now(&mut TreeRows(tree_model), &state.path);
        }
    }

    fn commit_rename(&self, focus_lost: bool) {
        let imp = self.imp();
        if imp.committing.get() {
            return;
        }
        let Some(state) = imp.rename.borrow().clone() else {
            return;
        };
        let Some(name) = state.target() else {
            self.end_rename(!focus_lost);
            return;
        };
        imp.committing.set(true);
        let (tree, model) = (self.downgrade(), self.model().clone());
        glib::spawn_future_local(async move {
            let result = model.rename_node(state.path.clone(), name).await;
            if let Some(tree) = tree.upgrade() {
                tree.imp().committing.set(false);
                tree.rename_finished(&state.path, result, focus_lost);
            }
        });
    }

    fn rename_finished(
        &self,
        path: &[String],
        result: Result<Vec<String>, UserError>,
        focus_lost: bool,
    ) {
        let imp = self.imp();
        let active = imp
            .rename
            .borrow()
            .as_ref()
            .is_some_and(|state| state.path == path);
        match result {
            Ok(renamed) => {
                if active {
                    self.end_rename(false);
                }
                if !focus_lost {
                    self.reveal(renamed);
                }
            }
            Err(error) if active && !focus_lost => {
                if let Some(state) = imp.rename.borrow_mut().as_mut() {
                    state.error = Some(error.message);
                }
                self.sync_rename_rows();
            }
            Err(error) => {
                if active {
                    self.end_rename(false);
                }
                self.model().report_error(&error);
            }
        }
    }

    fn sync_open_note(&self) {
        let imp = self.imp();
        if self.model().editor_target().is_draft() {
            imp.synced_path.replace(None);
            imp.selection.set_selected(gtk::INVALID_LIST_POSITION);
            return;
        }
        let path = self.model().open_note_path();
        if *imp.synced_path.borrow() == path {
            return;
        }
        imp.synced_path.replace(path.clone());
        let Some(tree_model) = imp.tree_model.borrow().clone() else {
            return;
        };
        let mut rows = TreeRows(tree_model);
        let position = path.as_deref().and_then(|path| {
            restore_expanded(&mut rows, &ancestors(path));
            position_of(&rows, path)
        });
        match position {
            Some(position) => imp
                .list_view
                .scroll_to(position, gtk::ListScrollFlags::SELECT, None),
            None => imp.selection.set_selected(gtk::INVALID_LIST_POSITION),
        }
    }
}

fn build_store(nodes: &[TreeNode]) -> gio::ListStore {
    let mut store = gio::ListStore::new::<NodeObject>();
    store.extend(nodes.iter().cloned().map(NodeObject::new));
    store
}

struct TreeRows(gtk::TreeListModel);

impl RowList for TreeRows {
    fn count(&self) -> u32 {
        self.0.n_items()
    }

    fn row(&self, position: u32) -> Option<RowRef> {
        let row = self.0.row(position)?;
        let node = row.item().and_downcast::<NodeObject>()?;
        Some(RowRef {
            path: node_path(node.node()).to_vec(),
            folder: matches!(node.node(), TreeNode::Folder { .. }),
            expanded: row.is_expanded(),
        })
    }

    fn expand(&mut self, position: u32) {
        if let Some(row) = self.0.row(position) {
            row.set_expanded(true);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_commands_need_exactly_their_modifiers() {
        let none = gdk::ModifierType::empty();
        let alt = gdk::ModifierType::ALT_MASK;
        let shift = gdk::ModifierType::SHIFT_MASK;
        assert_eq!(row_command(gdk::Key::F2, none), Some(RowCommand::Rename));
        assert_eq!(row_command(gdk::Key::Delete, none), Some(RowCommand::Trash));
        assert_eq!(row_command(gdk::Key::Delete, shift), None);
        assert_eq!(row_command(gdk::Key::Up, alt), Some(RowCommand::MoveUp));
        assert_eq!(
            row_command(gdk::Key::KP_Down, alt),
            Some(RowCommand::MoveDown)
        );
        assert_eq!(row_command(gdk::Key::Up, none), None);
        assert_eq!(row_command(gdk::Key::Down, alt | shift), None);
        assert_eq!(row_command(gdk::Key::Menu, none), Some(RowCommand::Menu));
        assert_eq!(row_command(gdk::Key::F10, shift), Some(RowCommand::Menu));
        assert_eq!(row_command(gdk::Key::F10, none), None);
    }
}
