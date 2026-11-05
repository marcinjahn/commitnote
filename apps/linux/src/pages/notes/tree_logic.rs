use std::collections::HashSet;

use commitnote_core_api::shapes::{ColorTag, TagOptionView, TreeNode};

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
}
