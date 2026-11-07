#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextEdit {
    pub from: usize,
    pub to: usize,
    pub insert: String,
}

impl TextEdit {
    pub fn new(from: usize, to: usize, insert: impl Into<String>) -> Self {
        Self {
            from,
            to,
            insert: insert.into(),
        }
    }

    pub fn insert_length(&self) -> usize {
        self.insert.encode_utf16().count()
    }

    pub fn length_change(&self) -> isize {
        self.insert_length() as isize - self.to.saturating_sub(self.from) as isize
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TextSelection {
    pub location: usize,
    pub length: usize,
}

impl TextSelection {
    pub fn new(location: usize, length: usize) -> Self {
        Self { location, length }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Assoc {
    Before,
    After,
}

fn shifted(value: usize, delta: isize) -> usize {
    value.saturating_add_signed(delta)
}

pub fn apply(edits: &[TextEdit], text: &str) -> String {
    if edits.is_empty() {
        return text.to_owned();
    }
    let units: Vec<u16> = text.encode_utf16().collect();
    let mut result: Vec<u16> = Vec::with_capacity(units.len());
    let mut cursor = 0;
    for edit in edits {
        let from = cursor.max(edit.from.min(units.len()));
        let to = from.max(edit.to.min(units.len()));
        result.extend_from_slice(&units[cursor..from]);
        result.extend(edit.insert.encode_utf16());
        cursor = to;
    }
    result.extend_from_slice(&units[cursor..]);
    String::from_utf16_lossy(&result)
}

pub fn map_position(position: usize, edits: &[TextEdit], assoc: Assoc) -> usize {
    let mut delta: isize = 0;
    for edit in edits {
        if edit.from == edit.to {
            if position < edit.from || (position == edit.from && assoc == Assoc::Before) {
                break;
            }
            delta += edit.insert_length() as isize;
            continue;
        }
        if position <= edit.from {
            break;
        }
        if position < edit.to {
            let inserted = if assoc == Assoc::Before {
                0
            } else {
                edit.insert_length() as isize
            };
            return shifted(edit.from, delta + inserted);
        }
        delta += edit.length_change();
    }
    shifted(position, delta)
}

pub fn map_selection(selection: TextSelection, edits: &[TextEdit]) -> TextSelection {
    if selection.length == 0 {
        return TextSelection::new(map_position(selection.location, edits, Assoc::Before), 0);
    }
    let start = map_position(selection.location, edits, Assoc::After);
    let end = start.max(map_position(
        selection.location + selection.length,
        edits,
        Assoc::Before,
    ));
    TextSelection::new(start, end - start)
}

fn is_lead_surrogate(unit: u16) -> bool {
    (0xD800..0xDC00).contains(&unit)
}

fn is_trail_surrogate(unit: u16) -> bool {
    (0xDC00..0xE000).contains(&unit)
}

pub fn diff(old: &str, new: &str) -> Vec<TextEdit> {
    if old == new {
        return Vec::new();
    }
    let a: Vec<u16> = old.encode_utf16().collect();
    let b: Vec<u16> = new.encode_utf16().collect();

    let mut prefix = 0;
    let max_prefix = a.len().min(b.len());
    while prefix < max_prefix && a[prefix] == b[prefix] {
        prefix += 1;
    }
    if prefix > 0 && is_lead_surrogate(a[prefix - 1]) {
        prefix -= 1;
    }

    let mut suffix = 0;
    let max_suffix = a.len().min(b.len()) - prefix;
    while suffix < max_suffix && a[a.len() - 1 - suffix] == b[b.len() - 1 - suffix] {
        suffix += 1;
    }
    if suffix > 0 && is_trail_surrogate(a[a.len() - suffix]) {
        suffix -= 1;
    }

    let insert = String::from_utf16_lossy(&b[prefix..b.len() - suffix]);
    vec![TextEdit::new(prefix, a.len() - suffix, insert)]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edit(from: usize, to: usize, insert: &str) -> TextEdit {
        TextEdit::new(from, to, insert)
    }

    fn selection(location: usize, length: usize) -> TextSelection {
        TextSelection::new(location, length)
    }

    #[test]
    fn apply_uses_utf16_offsets() {
        let text = "héllo 😀 世界";
        let edits = [
            edit(1, 2, "e"),
            edit(6, 8, "🙂"),
            edit(9, 11, "中文"),
            edit(11, 11, "!"),
        ];
        assert_eq!(apply(&edits, text), "hello 🙂 中文!");
    }

    #[test]
    fn apply_with_no_edits_keeps_the_text() {
        assert_eq!(apply(&[], "same"), "same");
    }

    #[test]
    fn apply_matches_type_script_minimal_changes() {
        let cases: Vec<(&str, &str, Vec<TextEdit>)> = vec![
            ("a\nc\n", "a\nb\nc\n", vec![edit(2, 2, "b\n")]),
            ("a\nb\nc\n", "a\nc\n", vec![edit(2, 4, "")]),
            (
                "hello world\nx\n",
                "hello brave world\nx\n",
                vec![edit(6, 6, "brave ")],
            ),
            (
                "a\nb\nc\nd\ne\nf\ng\n",
                "a\nB\nB2\nc\nd\ne\nF\ng\nh\n",
                vec![edit(2, 4, "B\nB2\n"), edit(10, 13, "F\ng\nh")],
            ),
            ("abcdef\nxyz\n", "abXYef\nxyz\n", vec![edit(2, 4, "XY")]),
        ];
        for (old, new, edits) in cases {
            assert_eq!(apply(&edits, old), new);
        }
    }

    #[test]
    fn map_position_around_a_replacement() {
        let edits = [edit(2, 4, "XYZ")];
        assert_eq!(map_position(1, &edits, Assoc::After), 1);
        assert_eq!(map_position(2, &edits, Assoc::After), 2);
        assert_eq!(map_position(3, &edits, Assoc::Before), 2);
        assert_eq!(map_position(3, &edits, Assoc::After), 5);
        assert_eq!(map_position(4, &edits, Assoc::Before), 5);
        assert_eq!(map_position(6, &edits, Assoc::Before), 7);
    }

    #[test]
    fn map_position_at_an_insertion_point() {
        let edits = [edit(3, 3, "ab")];
        assert_eq!(map_position(3, &edits, Assoc::Before), 3);
        assert_eq!(map_position(3, &edits, Assoc::After), 5);
    }

    #[test]
    fn map_position_through_several_edits() {
        let edits = [edit(0, 0, "😀"), edit(2, 5, ""), edit(8, 8, "xyz")];
        assert_eq!(map_position(6, &edits, Assoc::Before), 5);
        assert_eq!(map_position(9, &edits, Assoc::Before), 11);
    }

    #[test]
    fn caret_stays_before_remote_text_inserted_at_it() {
        assert_eq!(
            map_selection(selection(3, 0), &[edit(3, 3, "ab")]),
            selection(3, 0)
        );
    }

    #[test]
    fn caret_after_an_edit_shifts() {
        assert_eq!(
            map_selection(selection(6, 0), &[edit(0, 2, "abcd")]),
            selection(8, 0)
        );
    }

    #[test]
    fn selection_spanning_a_replaced_range_grows() {
        assert_eq!(
            map_selection(selection(1, 4), &[edit(2, 4, "XYZ")]),
            selection(1, 5)
        );
    }

    #[test]
    fn selection_excludes_text_inserted_at_its_edges() {
        let edits = [edit(2, 2, "x"), edit(4, 4, "y")];
        assert_eq!(map_selection(selection(2, 2), &edits), selection(3, 2));
    }

    #[test]
    fn selection_inside_a_replaced_range_collapses() {
        assert_eq!(
            map_selection(selection(2, 2), &[edit(1, 5, "Q")]),
            selection(2, 0)
        );
    }

    #[test]
    fn diff_of_equal_texts_is_empty() {
        assert_eq!(diff("same", "same"), vec![]);
        assert_eq!(diff("", ""), vec![]);
    }

    #[test]
    fn diff_trims_common_prefix_and_suffix() {
        assert_eq!(diff("abc", "abXc"), vec![edit(2, 2, "X")]);
        assert_eq!(diff("abXc", "abc"), vec![edit(2, 3, "")]);
        assert_eq!(
            diff("hello world", "hello there"),
            vec![edit(6, 11, "there")]
        );
        assert_eq!(diff("", "new"), vec![edit(0, 0, "new")]);
        assert_eq!(diff("old", ""), vec![edit(0, 3, "")]);
    }

    #[test]
    fn diff_suffix_never_overlaps_the_prefix() {
        assert_eq!(diff("aaa", "aaaa"), vec![edit(3, 3, "a")]);
        assert_eq!(diff("abab", "ab"), vec![edit(2, 4, "")]);
    }

    #[test]
    fn diff_never_splits_a_surrogate_pair() {
        assert_eq!(diff("😀", "😁"), vec![edit(0, 2, "😁")]);
        assert_eq!(diff("a😀x", "a🙂x"), vec![edit(1, 3, "🙂")]);
        assert_eq!(diff("x😀", "x\u{10600}"), vec![edit(1, 3, "\u{10600}")]);
    }

    #[test]
    fn diff_round_trips() {
        let pairs = [
            ("", "a"),
            ("a", ""),
            ("abc", "abc!"),
            ("abc", "!abc"),
            ("aaa", "aaaa"),
            ("aaaa", "aa"),
            ("héllo", "hello"),
            ("😀😀", "😀😁😀"),
            ("x😀y", "x\u{10600}y"),
            ("世界", "世間界"),
            ("line 1\nline 2\n", "line 1\nline 1.5\nline 2\n"),
        ];
        for (old, new) in pairs {
            assert_eq!(apply(&diff(old, new), old), new, "{old} -> {new}");
        }
    }
}
