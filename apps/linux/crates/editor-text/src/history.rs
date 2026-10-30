use crate::text_edits::{TextEdit, TextSelection, map_selection};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryStep {
    pub edits: Vec<TextEdit>,
    pub selection: TextSelection,
}

#[derive(Debug, Clone)]
struct Change {
    edit: TextEdit,
    removed: String,
}

impl Change {
    fn inverse(&self) -> TextEdit {
        TextEdit::new(
            self.edit.from,
            self.edit.from + self.edit.insert_length(),
            self.removed.clone(),
        )
    }
}

#[derive(Debug, Clone)]
struct Group {
    changes: Vec<Change>,
    selection_before: TextSelection,
    selection_after: TextSelection,
}

#[derive(Debug, Clone)]
pub struct EditorHistory {
    grouping_interval: f64,
    undo_stack: Vec<Group>,
    redo_stack: Vec<Group>,
    last_time: f64,
    can_join: bool,
}

impl EditorHistory {
    pub fn new(grouping_interval: f64) -> Self {
        Self {
            grouping_interval,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            last_time: 0.0,
            can_join: false,
        }
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn record_local(
        &mut self,
        edit: &TextEdit,
        old_text: &str,
        selection_before: TextSelection,
        selection_after: TextSelection,
        now: f64,
        join_current_group: bool,
    ) {
        if edit.from == edit.to && edit.insert.is_empty() {
            return;
        }
        let units: Vec<u16> = old_text.encode_utf16().collect();
        let from = edit.from.min(units.len());
        let to = from.max(edit.to.min(units.len()));
        let change = Change {
            edit: TextEdit::new(from, to, edit.insert.clone()),
            removed: String::from_utf16_lossy(&units[from..to]),
        };

        self.redo_stack.clear();
        let joins = self.can_join
            && self
                .undo_stack
                .last()
                .is_some_and(|group| self.should_join(group, &change, now, join_current_group));
        if joins {
            if let Some(group) = self.undo_stack.last_mut() {
                group.changes.push(change);
                group.selection_after = selection_after;
            }
        } else {
            self.undo_stack.push(Group {
                changes: vec![change],
                selection_before,
                selection_after,
            });
        }
        self.last_time = now;
        self.can_join = true;
    }

    fn should_join(
        &self,
        group: &Group,
        change: &Change,
        now: f64,
        join_current_group: bool,
    ) -> bool {
        if join_current_group {
            return true;
        }
        let Some(last) = group.changes.last().map(|c| &c.edit) else {
            return false;
        };
        now - self.last_time <= self.grouping_interval
            && change.edit.from == last.from + last.insert_length()
    }

    pub fn break_group(&mut self) {
        self.can_join = false;
    }

    pub fn undo(&mut self) -> Option<HistoryStep> {
        let group = self.undo_stack.pop()?;
        let step = HistoryStep {
            edits: group.changes.iter().rev().map(Change::inverse).collect(),
            selection: group.selection_before,
        };
        self.redo_stack.push(group);
        self.can_join = false;
        Some(step)
    }

    pub fn redo(&mut self) -> Option<HistoryStep> {
        let group = self.redo_stack.pop()?;
        let step = HistoryStep {
            edits: group.changes.iter().map(|c| c.edit.clone()).collect(),
            selection: group.selection_after,
        };
        self.undo_stack.push(group);
        self.can_join = false;
        Some(step)
    }

    pub fn reset(&mut self) {
        self.undo_stack.clear();
        self.redo_stack.clear();
        self.can_join = false;
    }

    pub fn map_through_remote(&mut self, edits: &[TextEdit]) {
        if edits.is_empty() {
            return;
        }

        let mut remote = edits.to_vec();
        for index in (0..self.undo_stack.len()).rev() {
            match map_backward(&self.undo_stack[index], &mut remote) {
                Some(mapped) => self.undo_stack[index] = mapped,
                None => {
                    self.undo_stack.drain(0..=index);
                    break;
                }
            }
        }

        let mut remote = edits.to_vec();
        for index in (0..self.redo_stack.len()).rev() {
            match map_forward(&self.redo_stack[index], &mut remote) {
                Some(mapped) => self.redo_stack[index] = mapped,
                None => {
                    self.redo_stack.drain(0..=index);
                    break;
                }
            }
        }
    }
}

fn shift_edit(edit: &TextEdit, delta: isize) -> TextEdit {
    TextEdit::new(
        edit.from.saturating_add_signed(delta),
        edit.to.saturating_add_signed(delta),
        edit.insert.clone(),
    )
}

/// `remote` arrives in the coordinates of the text after `group` and leaves in the
/// coordinates of the text before it.
fn map_backward(group: &Group, remote: &mut Vec<TextEdit>) -> Option<Group> {
    let mut mapped = group.clone();
    mapped.selection_after = map_selection(group.selection_after, remote);
    for index in (0..group.changes.len()).rev() {
        let edit = &group.changes[index].edit;
        let insert_end = edit.from + edit.insert_length();
        let length_change = edit.length_change();
        let mut shift: isize = 0;
        let mut previous: Vec<TextEdit> = Vec::new();
        for r in remote.iter() {
            if r.to <= edit.from {
                previous.push(r.clone());
                shift += r.length_change();
            } else if r.from >= insert_end {
                previous.push(shift_edit(r, -length_change));
            } else {
                return None;
            }
        }
        mapped.changes[index].edit = shift_edit(edit, shift);
        *remote = previous;
    }
    mapped.selection_before = map_selection(group.selection_before, remote);
    Some(mapped)
}

/// `remote` arrives in the coordinates of the text before `group` and leaves in the
/// coordinates of the text after it.
fn map_forward(group: &Group, remote: &mut Vec<TextEdit>) -> Option<Group> {
    let mut mapped = group.clone();
    mapped.selection_before = map_selection(group.selection_before, remote);
    for index in 0..group.changes.len() {
        let edit = &group.changes[index].edit;
        let length_change = edit.length_change();
        let mut shift: isize = 0;
        let mut next: Vec<TextEdit> = Vec::new();
        for r in remote.iter() {
            if r.to <= edit.from {
                next.push(r.clone());
                shift += r.length_change();
            } else if r.from >= edit.to {
                next.push(shift_edit(r, length_change));
            } else {
                return None;
            }
        }
        mapped.changes[index].edit = shift_edit(edit, shift);
        *remote = next;
    }
    mapped.selection_after = map_selection(group.selection_after, remote);
    Some(mapped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text_edits::apply;

    struct Editor {
        text: String,
        selection: TextSelection,
        history: EditorHistory,
    }

    impl Editor {
        fn new(text: &str) -> Self {
            Self {
                text: text.to_owned(),
                selection: TextSelection::new(text.encode_utf16().count(), 0),
                history: EditorHistory::new(1.0),
            }
        }

        fn replace(&mut self, from: usize, to: usize, insert: &str, at: f64, join: bool) {
            let edit = TextEdit::new(from, to, insert);
            let after = TextSelection::new(from + insert.encode_utf16().count(), 0);
            self.history
                .record_local(&edit, &self.text, self.selection, after, at, join);
            self.text = apply(&[edit], &self.text);
            self.selection = after;
        }

        fn type_text(&mut self, insert: &str, at: f64) {
            let from = self.selection.location;
            self.replace(from, from + self.selection.length, insert, at, false);
        }

        fn remote(&mut self, edits: &[TextEdit]) {
            self.text = apply(edits, &self.text);
            self.selection = map_selection(self.selection, edits);
            self.history.map_through_remote(edits);
        }

        fn undo(&mut self) -> bool {
            let step = self.history.undo();
            self.perform(step)
        }

        fn redo(&mut self) -> bool {
            let step = self.history.redo();
            self.perform(step)
        }

        fn perform(&mut self, step: Option<HistoryStep>) -> bool {
            let Some(step) = step else {
                return false;
            };
            for edit in step.edits {
                self.text = apply(&[edit], &self.text);
            }
            self.selection = step.selection;
            true
        }
    }

    fn caret(location: usize) -> TextSelection {
        TextSelection::new(location, 0)
    }

    #[test]
    fn typing_within_the_grouping_interval_forms_one_group() {
        let mut editor = Editor::new("");
        editor.type_text("a", 0.0);
        editor.type_text("b", 0.5);
        editor.type_text("c", 1.4);
        assert_eq!(editor.text, "abc");

        editor.undo();
        assert_eq!(editor.text, "");
        assert_eq!(editor.selection, caret(0));
        assert!(!editor.history.can_undo());
    }

    #[test]
    fn a_pause_starts_a_new_group() {
        let mut editor = Editor::new("");
        editor.type_text("a", 0.0);
        editor.type_text("b", 2.5);

        editor.undo();
        assert_eq!(editor.text, "a");
        assert!(editor.history.can_undo());
    }

    #[test]
    fn break_group_starts_a_new_group() {
        let mut editor = Editor::new("");
        editor.type_text("a", 0.0);
        editor.history.break_group();
        editor.type_text("b", 0.1);

        editor.undo();
        assert_eq!(editor.text, "a");
    }

    #[test]
    fn a_non_adjacent_edit_starts_a_new_group() {
        let mut editor = Editor::new("hello");
        editor.type_text("X", 0.0);
        editor.selection = caret(0);
        editor.type_text("Y", 0.1);
        assert_eq!(editor.text, "YhelloX");

        editor.undo();
        assert_eq!(editor.text, "helloX");
    }

    #[test]
    fn join_current_group_joins_a_composition_replacing_its_marked_range() {
        let mut editor = Editor::new("ab");
        editor.type_text("n", 0.0);
        editor.replace(2, 3, "に", 5.0, true);
        editor.replace(2, 3, "日", 10.0, true);
        assert_eq!(editor.text, "ab日");

        editor.undo();
        assert_eq!(editor.text, "ab");
        assert!(!editor.history.can_undo());
    }

    #[test]
    fn undo_and_redo_restore_text_and_selections() {
        let mut editor = Editor::new("hello world");
        editor.selection = TextSelection::new(0, 5);
        editor.type_text("bye", 0.0);
        assert_eq!(editor.text, "bye world");

        assert!(editor.undo());
        assert_eq!(editor.text, "hello world");
        assert_eq!(editor.selection, TextSelection::new(0, 5));
        assert!(!editor.undo());

        assert!(editor.redo());
        assert_eq!(editor.text, "bye world");
        assert_eq!(editor.selection, caret(3));
        assert!(!editor.redo());
    }

    #[test]
    fn undo_reverts_a_multi_edit_group_in_reverse_order() {
        let mut editor = Editor::new("abc");
        editor.replace(1, 2, "😀", 0.0, false);
        editor.replace(3, 4, "", 0.0, true);
        editor.replace(0, 1, "xyz", 0.0, true);
        assert_eq!(editor.text, "xyz😀");

        editor.undo();
        assert_eq!(editor.text, "abc");
        editor.redo();
        assert_eq!(editor.text, "xyz😀");
    }

    #[test]
    fn a_new_edit_clears_redo() {
        let mut editor = Editor::new("");
        editor.type_text("a", 0.0);
        editor.undo();
        assert!(editor.history.can_redo());

        editor.type_text("b", 5.0);
        assert!(!editor.history.can_redo());
    }

    #[test]
    fn undo_after_a_remote_edit_elsewhere_keeps_the_remote_edit() {
        let mut editor = Editor::new("hello");
        editor.type_text(" world", 0.0);
        editor.remote(&[TextEdit::new(0, 0, "X")]);
        assert_eq!(editor.text, "Xhello world");

        editor.undo();
        assert_eq!(editor.text, "Xhello");
        assert_eq!(editor.selection, caret(6));

        editor.redo();
        assert_eq!(editor.text, "Xhello world");
        assert_eq!(editor.selection, caret(12));
    }

    #[test]
    fn remote_text_adjacent_to_a_local_edit_survives_undo() {
        let mut editor = Editor::new("hello");
        editor.type_text(" world", 0.0);
        editor.remote(&[TextEdit::new(5, 5, ","), TextEdit::new(11, 11, "!")]);
        assert_eq!(editor.text, "hello, world!");

        editor.undo();
        assert_eq!(editor.text, "hello,!");
    }

    #[test]
    fn remote_edit_between_groups_keeps_both_groups() {
        let mut editor = Editor::new("--------");
        editor.selection = caret(0);
        editor.type_text("A", 0.0);
        editor.selection = caret(9);
        editor.type_text("B", 5.0);
        editor.remote(&[TextEdit::new(5, 5, "R")]);
        assert_eq!(editor.text, "A----R----B");

        editor.undo();
        assert_eq!(editor.text, "A----R----");
        editor.undo();
        assert_eq!(editor.text, "----R----");
        assert_eq!(editor.selection, caret(0));
    }

    #[test]
    fn remote_edit_overlapping_a_group_drops_it_and_older_groups() {
        let mut editor = Editor::new("0123456789");
        editor.replace(0, 1, "A", 0.0, false);
        editor.replace(5, 5, "B", 5.0, false);
        editor.replace(11, 11, "C", 10.0, false);
        assert_eq!(editor.text, "A1234B56789C");

        editor.remote(&[TextEdit::new(4, 7, "z")]);
        assert_eq!(editor.text, "A123z6789C");

        assert!(editor.undo());
        assert_eq!(editor.text, "A123z6789");
        assert!(!editor.history.can_undo());
    }

    #[test]
    fn remote_edit_deleting_around_a_local_deletion_drops_it() {
        let mut editor = Editor::new("abcdef");
        editor.replace(2, 4, "", 0.0, false);
        editor.remote(&[TextEdit::new(1, 3, "")]);
        assert_eq!(editor.text, "af");
        assert!(!editor.history.can_undo());
    }

    #[test]
    fn redo_is_mapped_through_remote_edits() {
        let mut editor = Editor::new("hello");
        editor.type_text(" world", 0.0);
        editor.undo();
        editor.remote(&[TextEdit::new(0, 1, "J")]);
        assert_eq!(editor.text, "Jello");

        editor.redo();
        assert_eq!(editor.text, "Jello world");
        editor.undo();
        assert_eq!(editor.text, "Jello");
    }

    #[test]
    fn remote_edit_overlapping_a_redo_group_drops_it() {
        let mut editor = Editor::new("hello");
        editor.replace(0, 5, "bye", 0.0, false);
        editor.undo();
        editor.remote(&[TextEdit::new(1, 2, "a")]);
        assert_eq!(editor.text, "hallo");
        assert!(!editor.history.can_redo());
    }

    #[test]
    fn reset_empties_both_stacks() {
        let mut editor = Editor::new("");
        editor.type_text("a", 0.0);
        editor.type_text("b", 5.0);
        editor.undo();
        editor.history.reset();
        assert!(!editor.history.can_undo());
        assert!(!editor.history.can_redo());
        assert!(editor.history.undo().is_none());
    }
}
