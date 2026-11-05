use std::cell::{OnceCell, RefCell};

use adw::subclass::prelude::*;
use commitnote_core_api::shapes::TreeNode;
use gtk4::prelude::*;
use gtk4::{self as gtk, gdk, gio, glib};
use libadwaita as adw;

use super::node_object::NodeObject;
use super::node_row::NodeRow;
use super::tree_logic::{
    KeyStep, RowList, RowRef, accessible_text, ancestors, expanded_paths, first_child_position,
    left_step, node_path, parent_position, position_of, restore_expanded, right_step,
};
use crate::model::AppModel;

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
        pub(super) model: OnceCell<AppModel>,
        pub(super) handlers: RefCell<Vec<glib::SignalHandlerId>>,
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
            self.obj().setup_list();
        }

        fn dispose(&self) {
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
        ];
        widget.imp().handlers.replace(handlers);
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
        factory.connect_setup(|_, item| {
            let Some(item) = item.downcast_ref::<gtk::ListItem>() else {
                return;
            };
            let expander = gtk::TreeExpander::new();
            expander.set_child(Some(&NodeRow::new()));
            item.set_child(Some(&expander));
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
        if let Some(node_row) = expander.child().and_downcast::<NodeRow>() {
            node_row.bind(node.node());
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
        if state.intersects(gtk::accelerator_get_default_mod_mask()) {
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
        let adjustment = imp.scrolled.vadjustment();
        let scroll = adjustment.value();

        let Some(nodes) = tree else {
            imp.selection.set_model(None::<&gio::ListModel>);
            imp.synced_path.replace(None);
            return;
        };
        let tree_model = gtk::TreeListModel::new(build_store(&nodes), false, false, |item| {
            match item.downcast_ref::<NodeObject>()?.node() {
                TreeNode::Folder { children, .. } => Some(build_store(children).upcast()),
                TreeNode::Note { .. } => None,
            }
        });
        imp.selection.set_model(Some(&tree_model));
        imp.tree_model.replace(Some(tree_model.clone()));

        let mut rows = TreeRows(tree_model);
        restore_expanded(&mut rows, &keep);

        if first {
            imp.synced_path.replace(None);
            self.sync_open_note();
            return;
        }
        let position = selected
            .as_deref()
            .and_then(|path| position_of(&rows, path))
            .unwrap_or(gtk::INVALID_LIST_POSITION);
        imp.selection.set_selected(position);
        glib::idle_add_local_once(move || adjustment.set_value(scroll));
    }

    fn selected_path(&self) -> Option<Vec<String>> {
        let node = self
            .imp()
            .selection
            .selected_item()
            .and_downcast::<gtk::TreeListRow>()?
            .item()
            .and_downcast::<NodeObject>()?;
        Some(node_path(node.node()).to_vec())
    }

    fn sync_open_note(&self) {
        let imp = self.imp();
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
