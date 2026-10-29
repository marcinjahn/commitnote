use std::cell::OnceCell;

use commitnote_core_api::shapes::TreeNode;
use glib::subclass::prelude::*;
use gtk4::glib;

mod imp {
    use super::*;

    #[derive(Debug, Default)]
    pub struct NodeObject {
        pub(super) node: OnceCell<TreeNode>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for NodeObject {
        const NAME: &'static str = "CommitnoteNodeObject";
        type Type = super::NodeObject;
    }

    impl ObjectImpl for NodeObject {}
}

glib::wrapper! {
    pub struct NodeObject(ObjectSubclass<imp::NodeObject>);
}

impl NodeObject {
    pub fn new(node: TreeNode) -> Self {
        let object: Self = glib::Object::new();
        let _ = object.imp().node.set(node);
        object
    }

    pub fn node(&self) -> &TreeNode {
        self.imp()
            .node
            .get()
            .expect("a node object is created with its node")
    }
}
