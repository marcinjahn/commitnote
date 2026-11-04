use std::collections::HashSet;

use commitnote_core_api::shapes::{ColorTag, TagOptionView, TreeNode};

use crate::model::COLOR_TAGS;

pub fn tag_id(tag: ColorTag) -> &'static str {
    match tag {
        ColorTag::Red => "red",
        ColorTag::Orange => "orange",
        ColorTag::Yellow => "yellow",
        ColorTag::Green => "green",
        ColorTag::Blue => "blue",
        ColorTag::Purple => "purple",
    }
}

/// The tag a menu target names: `Some(None)` for the empty id, `None` for an unknown one.
pub fn tag_from_id(id: &str) -> Option<Option<ColorTag>> {
    if id.is_empty() {
        return Some(None);
    }
    COLOR_TAGS
        .into_iter()
        .find(|&tag| tag_id(tag) == id)
        .map(Some)
}

/// The note's current tag when its context menu offers the Color Tag submenu: for notes only, and
/// only while tags can be written.
pub fn menu_tag(node: &TreeNode, tags_writable: bool) -> Option<Option<ColorTag>> {
    match node {
        TreeNode::Note { color_tag, .. } if tags_writable => Some(*color_tag),
        _ => None,
    }
}

pub fn tag_label(tag: ColorTag, options: &[TagOptionView]) -> String {
    if let Some(option) = options.iter().find(|option| option.tag == tag) {
        return option.label.clone();
    }
    let id = tag_id(tag);
    let mut chars = id.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

pub fn node_path(node: &TreeNode) -> &[String] {
    match node {
        TreeNode::Folder { path, .. } | TreeNode::Note { path, .. } => path,
    }
}

pub fn new_folder_parent(selected: Option<(&[String], bool)>) -> Vec<String> {
    match selected {
        Some((path, true)) => path.to_vec(),
        Some((path, false)) => path[..path.len().saturating_sub(1)].to_vec(),
        None => Vec::new(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenameState {
    pub path: Vec<String>,
    pub text: String,
    pub error: Option<String>,
}

impl RenameState {
    pub fn new(path: Vec<String>) -> Self {
        let text = path.last().cloned().unwrap_or_default();
        Self {
            path,
            text,
            error: None,
        }
    }

    pub fn target(&self) -> Option<String> {
        let current = self.path.last().map_or("", String::as_str);
        let name = self.text.trim();
        (!name.is_empty() && name != current).then(|| name.to_owned())
    }

    pub fn edit(&mut self, text: String) {
        if self.text != text {
            self.text = text;
            self.error = None;
        }
    }
}

pub fn note_description(tag_label: Option<&str>, shared: bool) -> String {
    let mut parts = Vec::new();
    if let Some(label) = tag_label {
        parts.push(format!("{label} tag"));
    }
    if shared {
        parts.push("Shared".to_owned());
    }
    parts.join(", ")
}

pub fn folder_description(note_count: u32) -> String {
    if note_count == 1 {
        "1 note".to_owned()
    } else {
        format!("{note_count} notes")
    }
}

pub fn accessible_text(node: &TreeNode, options: &[TagOptionView]) -> (String, String) {
    match node {
        TreeNode::Folder {
            name, note_count, ..
        } => (name.clone(), folder_description(*note_count)),
        TreeNode::Note {
            name,
            color_tag,
            shared,
            ..
        } => {
            let label = color_tag.map(|tag| tag_label(tag, options));
            (name.clone(), note_description(label.as_deref(), *shared))
        }
    }
}

pub fn ancestors(path: &[String]) -> HashSet<Vec<String>> {
    (1..path.len()).map(|len| path[..len].to_vec()).collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RowRef {
    pub path: Vec<String>,
    pub folder: bool,
    pub expanded: bool,
}

pub trait RowList {
    fn count(&self) -> u32;
    fn row(&self, position: u32) -> Option<RowRef>;
    fn expand(&mut self, position: u32);
}

pub fn expanded_paths(rows: &impl RowList) -> HashSet<Vec<String>> {
    (0..rows.count())
        .filter_map(|position| rows.row(position))
        .filter(|row| row.folder && row.expanded)
        .map(|row| row.path)
        .collect()
}

pub fn restore_expanded(rows: &mut impl RowList, paths: &HashSet<Vec<String>>) {
    if paths.is_empty() {
        return;
    }
    let mut position = 0;
    while position < rows.count() {
        if let Some(row) = rows.row(position)
            && row.folder
            && !row.expanded
            && paths.contains(&row.path)
        {
            rows.expand(position);
        }
        position += 1;
    }
}

pub fn position_of(rows: &impl RowList, path: &[String]) -> Option<u32> {
    (0..rows.count()).find(|&position| rows.row(position).is_some_and(|row| row.path == path))
}

pub fn parent_position(position: u32, depth_at: impl Fn(u32) -> Option<u32>) -> Option<u32> {
    let depth = depth_at(position)?;
    if depth == 0 {
        return None;
    }
    (0..position)
        .rev()
        .find(|&candidate| depth_at(candidate).is_some_and(|other| other < depth))
}

pub fn first_child_position(position: u32, depth_at: impl Fn(u32) -> Option<u32>) -> Option<u32> {
    let depth = depth_at(position)?;
    let next = position.checked_add(1)?;
    depth_at(next).filter(|&other| other > depth).map(|_| next)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Siblings {
    pub previous: bool,
    pub next: bool,
}

/// Whether the row at `position` has a sibling before and after it, judged from row depths: a
/// sibling is the nearest row at the same depth that no shallower row separates from it.
pub fn siblings(position: u32, depth_at: impl Fn(u32) -> Option<u32>) -> Siblings {
    let Some(depth) = depth_at(position) else {
        return Siblings {
            previous: false,
            next: false,
        };
    };
    let same_depth = |found: Option<u32>| found == Some(depth);
    let previous = same_depth(
        (0..position)
            .rev()
            .filter_map(&depth_at)
            .find(|&other| other <= depth),
    );
    let next = same_depth(
        (position.saturating_add(1)..)
            .map_while(&depth_at)
            .find(|&other| other <= depth),
    );
    Siblings { previous, next }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyStep {
    Collapse,
    Expand,
    MoveTo(u32),
    Nothing,
}

pub fn left_step(expanded_folder: bool, parent: Option<u32>) -> KeyStep {
    if expanded_folder {
        KeyStep::Collapse
    } else {
        parent.map_or(KeyStep::Nothing, KeyStep::MoveTo)
    }
}

pub fn right_step(expandable: bool, expanded: bool, first_child: Option<u32>) -> KeyStep {
    if expandable && !expanded {
        KeyStep::Expand
    } else if expanded {
        first_child.map_or(KeyStep::Nothing, KeyStep::MoveTo)
    } else {
        KeyStep::Nothing
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DropZone {
    Before,
    After,
    Into,
}

impl DropZone {
    pub fn css_class(self) -> &'static str {
        match self {
            Self::Before => "drop-before",
            Self::After => "drop-after",
            Self::Into => "drop-into",
        }
    }
}

/// Where a dragged node lands: `Into` moves it into `parent`, the other zones place it among the
/// children of `parent`, before the sibling named `before` or at the end when there is none.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DropAction {
    pub zone: DropZone,
    pub parent: Vec<String>,
    pub before: Option<String>,
}

fn drop_zone(folder: bool, y: f64, height: f64) -> DropZone {
    let fraction = if height > 0.0 {
        (y / height).clamp(0.0, 1.0)
    } else {
        0.5
    };
    if folder {
        if fraction < 0.25 {
            DropZone::Before
        } else if fraction > 0.75 {
            DropZone::After
        } else {
            DropZone::Into
        }
    } else if fraction < 0.5 {
        DropZone::Before
    } else {
        DropZone::After
    }
}

pub fn parent_of(path: &[String]) -> &[String] {
    &path[..path.len().saturating_sub(1)]
}

/// What dropping `dragged` at height `y` of a row of `height` does, or `None` when the position
/// is refused: the node itself or its subtree, the folder that already holds it, or a place that
/// leaves it where it is. `siblings` are the names under the target's parent, target included.
pub fn drop_action(
    dragged: &[String],
    target: &[String],
    folder: bool,
    siblings: &[String],
    y: f64,
    height: f64,
) -> Option<DropAction> {
    if dragged.is_empty() || target.is_empty() || target.starts_with(dragged) {
        return None;
    }
    let zone = drop_zone(folder, y, height);
    if zone == DropZone::Into {
        return (parent_of(dragged) != target).then(|| DropAction {
            zone,
            parent: target.to_vec(),
            before: None,
        });
    }
    let parent = parent_of(target);
    let index = siblings
        .iter()
        .position(|name| Some(name) == target.last())?;
    let own = (parent_of(dragged) == parent)
        .then(|| {
            siblings
                .iter()
                .position(|name| Some(name) == dragged.last())
        })
        .flatten();
    if let Some(own) = own {
        let stays = match zone {
            DropZone::Before => index == own + 1,
            _ => index + 1 == own,
        };
        if stays {
            return None;
        }
    }
    let before = match zone {
        DropZone::Before => Some(siblings[index].clone()),
        _ => siblings.get(index + 1).cloned(),
    };
    Some(DropAction {
        zone,
        parent: parent.to_vec(),
        before,
    })
}

/// Dropping `dragged` on the empty area below the rows places it last at the top level, unless it
/// already is.
pub fn drop_at_end(dragged: &[String], top_level: &[String]) -> Option<DropAction> {
    let already_last = dragged.len() == 1 && top_level.last() == dragged.last();
    (!dragged.is_empty() && !already_last).then(|| DropAction {
        zone: DropZone::After,
        parent: Vec::new(),
        before: None,
    })
}

/// The names of the children of the folder at `parent`, or of the top level for an empty path.
pub fn child_names(tree: &[TreeNode], parent: &[String]) -> Option<Vec<String>> {
    let nodes = if parent.is_empty() {
        tree
    } else {
        match find_node(tree, parent)? {
            TreeNode::Folder { children, .. } => children,
            TreeNode::Note { .. } => return None,
        }
    };
    Some(
        nodes
            .iter()
            .map(|node| match node {
                TreeNode::Folder { name, .. } | TreeNode::Note { name, .. } => name.clone(),
            })
            .collect(),
    )
}

pub fn find_node<'a>(nodes: &'a [TreeNode], target: &[String]) -> Option<&'a TreeNode> {
    nodes.iter().find_map(|node| match node {
        TreeNode::Folder { path, .. } | TreeNode::Note { path, .. } if path == target => Some(node),
        TreeNode::Folder { children, .. } => find_node(children, target),
        TreeNode::Note { .. } => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    fn folder(name: &str, parent: &[&str], children: Vec<TreeNode>) -> TreeNode {
        let mut full = path(parent);
        full.push(name.to_owned());
        TreeNode::Folder {
            name: name.to_owned(),
            note_count: children.len() as u32,
            path: full,
            children,
        }
    }

    fn note(name: &str, parent: &[&str]) -> TreeNode {
        let mut full = path(parent);
        full.push(name.to_owned());
        TreeNode::Note {
            name: name.to_owned(),
            path: full,
            color_tag: None,
            shared: false,
        }
    }

    fn sample() -> Vec<TreeNode> {
        vec![
            folder(
                "a",
                &[],
                vec![
                    folder("b", &["a"], vec![note("n1", &["a", "b"])]),
                    note("n2", &["a"]),
                ],
            ),
            folder("c", &[], vec![note("n3", &["c"])]),
            note("n4", &[]),
        ]
    }

    struct FlatRows {
        tree: Vec<TreeNode>,
        expanded: HashSet<Vec<String>>,
    }

    impl FlatRows {
        fn new(tree: Vec<TreeNode>) -> Self {
            Self {
                tree,
                expanded: HashSet::new(),
            }
        }

        fn flatten(&self) -> Vec<(RowRef, u32)> {
            let mut rows = Vec::new();
            self.walk(&self.tree, 0, &mut rows);
            rows
        }

        fn walk(&self, nodes: &[TreeNode], depth: u32, rows: &mut Vec<(RowRef, u32)>) {
            for node in nodes {
                match node {
                    TreeNode::Folder { path, children, .. } => {
                        let expanded = self.expanded.contains(path);
                        rows.push((
                            RowRef {
                                path: path.clone(),
                                folder: true,
                                expanded,
                            },
                            depth,
                        ));
                        if expanded {
                            self.walk(children, depth + 1, rows);
                        }
                    }
                    TreeNode::Note { path, .. } => rows.push((
                        RowRef {
                            path: path.clone(),
                            folder: false,
                            expanded: false,
                        },
                        depth,
                    )),
                }
            }
        }

        fn names(&self) -> Vec<String> {
            self.flatten()
                .into_iter()
                .map(|(row, _)| row.path.join("/"))
                .collect()
        }
    }

    impl RowList for FlatRows {
        fn count(&self) -> u32 {
            self.flatten().len() as u32
        }

        fn row(&self, position: u32) -> Option<RowRef> {
            self.flatten()
                .into_iter()
                .nth(position as usize)
                .map(|(row, _)| row)
        }

        fn expand(&mut self, position: u32) {
            if let Some(row) = self.row(position) {
                self.expanded.insert(row.path);
            }
        }
    }

    fn paths(items: &[&[&str]]) -> HashSet<Vec<String>> {
        items.iter().map(|item| path(item)).collect()
    }

    #[test]
    fn new_folder_parent_is_the_selected_folder_or_the_notes_parent() {
        let folder = path(&["a", "b"]);
        let note = path(&["a", "b", "n"]);
        assert_eq!(new_folder_parent(Some((&folder, true))), folder);
        assert_eq!(new_folder_parent(Some((&note, false))), folder);
        assert_eq!(new_folder_parent(Some((&path(&["n"]), false))), path(&[]));
        assert_eq!(new_folder_parent(None), path(&[]));
    }

    #[test]
    fn tag_from_id_reads_every_tag_id_and_the_empty_id() {
        for tag in COLOR_TAGS {
            assert_eq!(tag_from_id(tag_id(tag)), Some(Some(tag)));
        }
        assert_eq!(tag_from_id(""), Some(None));
        assert_eq!(tag_from_id("teal"), None);
    }

    #[test]
    fn menu_tag_is_offered_for_notes_only_while_tags_are_writable() {
        let tagged = TreeNode::Note {
            name: "n".to_owned(),
            path: path(&["n"]),
            color_tag: Some(ColorTag::Red),
            shared: false,
        };
        assert_eq!(menu_tag(&tagged, true), Some(Some(ColorTag::Red)));
        assert_eq!(menu_tag(&note("n", &[]), true), Some(None));
        assert_eq!(menu_tag(&tagged, false), None);
        assert_eq!(menu_tag(&folder("f", &[], Vec::new()), true), None);
    }

    #[test]
    fn tag_label_prefers_the_configured_label() {
        let options = vec![TagOptionView {
            tag: ColorTag::Blue,
            label: "Work".to_owned(),
        }];
        assert_eq!(tag_label(ColorTag::Blue, &options), "Work");
    }

    #[test]
    fn tag_label_falls_back_to_the_capitalised_id() {
        assert_eq!(tag_label(ColorTag::Purple, &[]), "Purple");
        assert_eq!(tag_label(ColorTag::Red, &[]), "Red");
    }

    #[test]
    fn note_description_joins_tag_and_shared() {
        assert_eq!(note_description(Some("Blue"), true), "Blue tag, Shared");
        assert_eq!(note_description(Some("Blue"), false), "Blue tag");
        assert_eq!(note_description(None, true), "Shared");
        assert_eq!(note_description(None, false), "");
    }

    #[test]
    fn folder_description_uses_singular_and_plural() {
        assert_eq!(folder_description(0), "0 notes");
        assert_eq!(folder_description(1), "1 note");
        assert_eq!(folder_description(12), "12 notes");
    }

    #[test]
    fn accessible_text_describes_notes_and_folders() {
        let options = vec![TagOptionView {
            tag: ColorTag::Green,
            label: "Home".to_owned(),
        }];
        let tagged = TreeNode::Note {
            name: "Groceries".to_owned(),
            path: path(&["Groceries"]),
            color_tag: Some(ColorTag::Green),
            shared: true,
        };
        assert_eq!(
            accessible_text(&tagged, &options),
            ("Groceries".to_owned(), "Home tag, Shared".to_owned())
        );
        assert_eq!(
            accessible_text(&folder("Trips", &[], vec![note("x", &["Trips"])]), &[]),
            ("Trips".to_owned(), "1 note".to_owned())
        );
    }

    #[test]
    fn ancestors_lists_every_proper_prefix() {
        assert_eq!(
            ancestors(&path(&["a", "b", "n"])),
            paths(&[&["a"], &["a", "b"]])
        );
        assert!(ancestors(&path(&["n"])).is_empty());
        assert!(ancestors(&[]).is_empty());
    }

    #[test]
    fn restore_expanded_walks_into_freshly_inserted_children() {
        let mut rows = FlatRows::new(sample());
        restore_expanded(&mut rows, &paths(&[&["a"], &["a", "b"], &["c"]]));
        assert_eq!(
            rows.names(),
            ["a", "a/b", "a/b/n1", "a/n2", "c", "c/n3", "n4"]
        );
    }

    #[test]
    fn restore_expanded_skips_unknown_paths_and_keeps_others_collapsed() {
        let mut rows = FlatRows::new(sample());
        restore_expanded(&mut rows, &paths(&[&["c"], &["gone"], &["a", "b"]]));
        assert_eq!(rows.names(), ["a", "c", "c/n3", "n4"]);
    }

    #[test]
    fn restore_expanded_with_nothing_to_restore_changes_nothing() {
        let mut rows = FlatRows::new(sample());
        restore_expanded(&mut rows, &HashSet::new());
        assert_eq!(rows.names(), ["a", "c", "n4"]);
    }

    #[test]
    fn expanded_paths_round_trips_through_a_rebuild() {
        let mut old = FlatRows::new(sample());
        restore_expanded(&mut old, &paths(&[&["a"], &["a", "b"]]));
        let kept = expanded_paths(&old);
        assert_eq!(kept, paths(&[&["a"], &["a", "b"]]));

        let mut rebuilt = FlatRows::new(sample());
        restore_expanded(&mut rebuilt, &kept);
        assert_eq!(rebuilt.names(), old.names());
    }

    #[test]
    fn position_of_finds_visible_rows_only() {
        let mut rows = FlatRows::new(sample());
        assert_eq!(position_of(&rows, &path(&["a", "b", "n1"])), None);
        restore_expanded(&mut rows, &ancestors(&path(&["a", "b", "n1"])));
        assert_eq!(position_of(&rows, &path(&["a", "b", "n1"])), Some(2));
        assert_eq!(position_of(&rows, &path(&["a"])), Some(0));
        assert_eq!(position_of(&rows, &path(&["zzz"])), None);
        assert_eq!(position_of(&rows, &path(&["n4"])), Some(5));
    }

    fn depths(values: &'static [u32]) -> impl Fn(u32) -> Option<u32> {
        move |position| values.get(position as usize).copied()
    }

    #[test]
    fn parent_position_finds_the_nearest_shallower_row() {
        let depth = depths(&[0, 1, 2, 2, 1, 0]);
        assert_eq!(parent_position(0, &depth), None);
        assert_eq!(parent_position(1, &depth), Some(0));
        assert_eq!(parent_position(2, &depth), Some(1));
        assert_eq!(parent_position(3, &depth), Some(1));
        assert_eq!(parent_position(4, &depth), Some(0));
        assert_eq!(parent_position(5, &depth), None);
        assert_eq!(parent_position(9, &depth), None);
    }

    #[test]
    fn siblings_skip_deeper_rows_and_stop_at_a_shallower_one() {
        let depth = depths(&[0, 1, 2, 2, 1, 0, 1]);
        let at = |position| {
            let found = siblings(position, &depth);
            (found.previous, found.next)
        };
        assert_eq!(at(0), (false, true));
        assert_eq!(at(1), (false, true));
        assert_eq!(at(2), (false, true));
        assert_eq!(at(3), (true, false));
        assert_eq!(at(4), (true, false));
        assert_eq!(at(5), (true, false));
        assert_eq!(at(6), (false, false));
        assert_eq!(at(9), (false, false));
    }

    #[test]
    fn first_child_position_requires_a_deeper_next_row() {
        let depth = depths(&[0, 1, 1, 0, 0]);
        assert_eq!(first_child_position(0, &depth), Some(1));
        assert_eq!(first_child_position(1, &depth), None);
        assert_eq!(first_child_position(2, &depth), None);
        assert_eq!(first_child_position(3, &depth), None);
        assert_eq!(first_child_position(4, &depth), None);
        assert_eq!(first_child_position(7, &depth), None);
    }

    #[test]
    fn left_collapses_an_expanded_folder_else_goes_to_the_parent() {
        assert_eq!(left_step(true, Some(3)), KeyStep::Collapse);
        assert_eq!(left_step(false, Some(3)), KeyStep::MoveTo(3));
        assert_eq!(left_step(false, None), KeyStep::Nothing);
    }

    #[test]
    fn right_expands_a_collapsed_folder_else_goes_to_the_first_child() {
        assert_eq!(right_step(true, false, None), KeyStep::Expand);
        assert_eq!(right_step(true, true, Some(4)), KeyStep::MoveTo(4));
        assert_eq!(right_step(true, true, None), KeyStep::Nothing);
        assert_eq!(right_step(false, false, None), KeyStep::Nothing);
    }

    #[test]
    fn a_rename_starts_from_the_current_name_and_needs_a_real_change() {
        let mut state = RenameState::new(path(&["Projects", "Roadmap"]));
        assert_eq!(state.text, "Roadmap");
        assert_eq!(state.target(), None);

        state.edit("  Roadmap  ".to_owned());
        assert_eq!(state.target(), None);
        state.edit("   ".to_owned());
        assert_eq!(state.target(), None);
        state.edit(" Plan ".to_owned());
        assert_eq!(state.target(), Some("Plan".to_owned()));
    }

    #[test]
    fn editing_the_text_clears_the_error_but_repeating_it_does_not() {
        let mut state = RenameState::new(path(&["Welcome"]));
        state.error = Some("taken".to_owned());

        state.edit("Welcome".to_owned());
        assert_eq!(state.error.as_deref(), Some("taken"));
        state.edit("Welcome 2".to_owned());
        assert_eq!(state.error, None);
        assert_eq!(state.text, "Welcome 2");
    }

    #[test]
    fn child_names_lists_a_folder_or_the_top_level() {
        let tree = sample();
        assert_eq!(child_names(&tree, &[]), Some(path(&["a", "c", "n4"])));
        assert_eq!(child_names(&tree, &path(&["a"])), Some(path(&["b", "n2"])));
        assert_eq!(child_names(&tree, &path(&["a", "b"])), Some(path(&["n1"])));
        assert_eq!(child_names(&tree, &path(&["n4"])), None);
        assert_eq!(child_names(&tree, &path(&["missing"])), None);
    }

    fn drop_at(
        dragged: &[&str],
        target: &[&str],
        folder: bool,
        siblings: &[&str],
        fraction: f64,
    ) -> Option<(DropZone, Vec<String>, Option<String>)> {
        drop_action(
            &path(dragged),
            &path(target),
            folder,
            &path(siblings),
            fraction * 40.0,
            40.0,
        )
        .map(|action| (action.zone, action.parent, action.before))
    }

    #[test]
    fn a_folder_row_splits_into_before_into_and_after() {
        let siblings = ["x", "dir", "y"];
        assert_eq!(
            drop_at(&["n"], &["dir"], true, &siblings, 0.1),
            Some((DropZone::Before, Vec::new(), Some("dir".to_owned())))
        );
        assert_eq!(
            drop_at(&["n"], &["dir"], true, &siblings, 0.5),
            Some((DropZone::Into, path(&["dir"]), None))
        );
        assert_eq!(
            drop_at(&["n"], &["dir"], true, &siblings, 0.9),
            Some((DropZone::After, Vec::new(), Some("y".to_owned())))
        );
        assert_eq!(
            drop_at(&["n"], &["dir"], true, &siblings, 0.25),
            Some((DropZone::Into, path(&["dir"]), None))
        );
        assert_eq!(
            drop_at(&["n"], &["dir"], true, &siblings, 0.75),
            Some((DropZone::Into, path(&["dir"]), None))
        );
    }

    #[test]
    fn a_note_row_splits_into_before_and_after() {
        let siblings = ["x", "note", "y"];
        let target = ["dir", "note"];
        assert_eq!(
            drop_at(&["n"], &target, false, &siblings, 0.0),
            Some((DropZone::Before, path(&["dir"]), Some("note".to_owned())))
        );
        assert_eq!(
            drop_at(&["n"], &target, false, &siblings, 0.49),
            Some((DropZone::Before, path(&["dir"]), Some("note".to_owned())))
        );
        assert_eq!(
            drop_at(&["n"], &target, false, &siblings, 0.5),
            Some((DropZone::After, path(&["dir"]), Some("y".to_owned())))
        );
        assert_eq!(
            drop_at(&["n"], &target, false, &siblings, 1.0),
            Some((DropZone::After, path(&["dir"]), Some("y".to_owned())))
        );
    }

    #[test]
    fn after_the_last_sibling_places_at_the_end() {
        assert_eq!(
            drop_at(&["n"], &["dir", "y"], false, &["x", "y"], 0.9),
            Some((DropZone::After, path(&["dir"]), None))
        );
        assert_eq!(
            drop_at(&["dir", "x"], &["dir", "y"], false, &["x", "y"], 0.9),
            Some((DropZone::After, path(&["dir"]), None))
        );
    }

    #[test]
    fn a_node_cannot_be_dropped_on_itself_or_in_its_own_subtree() {
        for fraction in [0.1, 0.5, 0.9] {
            assert_eq!(drop_at(&["a"], &["a"], true, &["a", "c"], fraction), None);
            assert_eq!(
                drop_at(&["a"], &["a", "b"], true, &["b", "n2"], fraction),
                None
            );
            assert_eq!(
                drop_at(&["a"], &["a", "b", "n1"], false, &["n1"], fraction),
                None
            );
        }
        assert!(drop_at(&["a"], &["ab"], true, &["a", "ab"], 0.5).is_some());
    }

    #[test]
    fn a_folder_cannot_be_dropped_into_the_folder_that_holds_it() {
        assert_eq!(drop_at(&["a", "n2"], &["a"], true, &["a", "c"], 0.5), None);
        assert_eq!(
            drop_at(&["a", "n2"], &["a"], true, &["a", "c"], 0.1),
            Some((DropZone::Before, Vec::new(), Some("a".to_owned())))
        );
    }

    #[test]
    fn a_position_that_keeps_the_node_in_place_is_refused() {
        let siblings = ["w", "x", "y", "z"];
        let dragged = ["dir", "x"];
        let at = |name: &str, fraction: f64| {
            drop_at(&dragged, &["dir", name], false, &siblings, fraction)
        };
        assert_eq!(at("y", 0.1), None);
        assert_eq!(at("w", 0.9), None);
        assert_eq!(
            at("w", 0.1),
            Some((DropZone::Before, path(&["dir"]), Some("w".to_owned())))
        );
        assert_eq!(
            at("y", 0.9),
            Some((DropZone::After, path(&["dir"]), Some("z".to_owned())))
        );
        assert_eq!(
            at("z", 0.1),
            Some((DropZone::Before, path(&["dir"]), Some("z".to_owned())))
        );
        assert_eq!(
            drop_at(&["x"], &["dir", "y"], false, &["y"], 0.1),
            Some((DropZone::Before, path(&["dir"]), Some("y".to_owned())))
        );
    }

    #[test]
    fn the_end_of_the_top_level_refuses_the_node_that_is_already_last() {
        let top = path(&["a", "c", "n4"]);
        assert_eq!(drop_at_end(&path(&["n4"]), &top), None);
        assert_eq!(drop_at_end(&[], &top), None);
        let action = drop_at_end(&path(&["a"]), &top).expect("the top level takes the node");
        assert_eq!(
            (action.zone, action.parent, action.before),
            (DropZone::After, Vec::new(), None)
        );
        assert!(drop_at_end(&path(&["a", "n2"]), &top).is_some());
        assert!(drop_at_end(&path(&["c", "n4"]), &top).is_some());
    }
}
