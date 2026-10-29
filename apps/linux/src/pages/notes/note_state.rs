use commitnote_core_api::shapes::OpenNote;

#[derive(Debug, PartialEq, Eq)]
pub enum NoteDisplay<'a> {
    Empty,
    Loading(&'a [String]),
    Loaded {
        path: &'a [String],
        content: &'a str,
    },
    Problem(&'a str),
}

fn state_path(state: &OpenNote) -> &[String] {
    match state {
        OpenNote::Loading { path }
        | OpenNote::Loaded { path, .. }
        | OpenNote::Missing { path, .. }
        | OpenNote::Trashed { path, .. }
        | OpenNote::Failed { path, .. } => path,
    }
}

pub fn display_state<'a>(
    open_path: Option<&'a [String]>,
    state: Option<&'a OpenNote>,
) -> NoteDisplay<'a> {
    let Some(open_path) = open_path else {
        return NoteDisplay::Empty;
    };
    match state {
        Some(state) if state_path(state) == open_path => match state {
            OpenNote::Loading { path } => NoteDisplay::Loading(path),
            OpenNote::Loaded { path, content, .. } => NoteDisplay::Loaded { path, content },
            OpenNote::Missing { message, .. }
            | OpenNote::Trashed { message, .. }
            | OpenNote::Failed { message, .. } => NoteDisplay::Problem(message),
        },
        _ => NoteDisplay::Loading(open_path),
    }
}

pub fn note_title(path: &[String]) -> &str {
    path.last().map_or("", String::as_str)
}

#[derive(Debug, PartialEq, Eq)]
pub struct TextEdit<'a> {
    pub start: i32,
    pub end: i32,
    pub insert: &'a str,
}

pub fn text_edit<'a>(old: &str, new: &'a str) -> Option<TextEdit<'a>> {
    if old == new {
        return None;
    }
    let prefix_bytes = old
        .chars()
        .zip(new.chars())
        .take_while(|(a, b)| a == b)
        .map(|(a, _)| a.len_utf8())
        .sum::<usize>();
    let old_rest = &old[prefix_bytes..];
    let new_rest = &new[prefix_bytes..];
    let suffix_bytes = old_rest
        .chars()
        .rev()
        .zip(new_rest.chars().rev())
        .take_while(|(a, b)| a == b)
        .map(|(a, _)| a.len_utf8())
        .sum::<usize>();
    let start = old[..prefix_bytes].chars().count() as i32;
    let removed = &old_rest[..old_rest.len() - suffix_bytes];
    let insert = &new_rest[..new_rest.len() - suffix_bytes];
    Some(TextEdit {
        start,
        end: start + removed.chars().count() as i32,
        insert,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    fn loaded(parts: &[&str], content: &str) -> OpenNote {
        OpenNote::Loaded {
            path: path(parts),
            content: content.to_owned(),
            conflict: None,
            color_tag: None,
            shared: false,
        }
    }

    #[test]
    fn no_open_path_is_empty_even_with_a_stale_state() {
        let state = loaded(&["a"], "text");
        assert_eq!(display_state(None, Some(&state)), NoteDisplay::Empty);
        assert_eq!(display_state(None, None), NoteDisplay::Empty);
    }

    #[test]
    fn a_matching_loaded_state_shows_the_content() {
        let open = path(&["f", "a"]);
        let state = loaded(&["f", "a"], "# text");
        assert_eq!(
            display_state(Some(&open), Some(&state)),
            NoteDisplay::Loaded {
                path: &open,
                content: "# text"
            }
        );
    }

    #[test]
    fn a_state_for_another_note_counts_as_loading() {
        let open = path(&["b"]);
        let state = loaded(&["a"], "old");
        assert_eq!(
            display_state(Some(&open), Some(&state)),
            NoteDisplay::Loading(&open)
        );
        assert_eq!(
            display_state(Some(&open), None),
            NoteDisplay::Loading(&open)
        );
    }

    #[test]
    fn problem_states_expose_the_message() {
        let open = path(&["a"]);
        for state in [
            OpenNote::Missing {
                path: open.clone(),
                message: "gone".to_owned(),
            },
            OpenNote::Trashed {
                path: open.clone(),
                message: "gone".to_owned(),
            },
        ] {
            assert_eq!(
                display_state(Some(&open), Some(&state)),
                NoteDisplay::Problem("gone")
            );
        }
    }

    #[test]
    fn the_title_is_the_last_path_element() {
        assert_eq!(note_title(&path(&["f", "Plan"])), "Plan");
        assert_eq!(note_title(&[]), "");
    }

    #[test]
    fn text_edit_is_none_for_equal_text() {
        assert_eq!(text_edit("same", "same"), None);
    }

    #[test]
    fn text_edit_replaces_only_the_changed_middle() {
        assert_eq!(
            text_edit("hello world", "hello brave world"),
            Some(TextEdit {
                start: 6,
                end: 6,
                insert: "brave "
            })
        );
        assert_eq!(
            text_edit("one two three", "one three"),
            Some(TextEdit {
                start: 5,
                end: 9,
                insert: ""
            })
        );
        assert_eq!(
            text_edit("abc", "axc"),
            Some(TextEdit {
                start: 1,
                end: 2,
                insert: "x"
            })
        );
    }

    #[test]
    fn text_edit_counts_characters_not_bytes() {
        assert_eq!(
            text_edit("zażółć gęślą", "zażółć jaźń gęślą"),
            Some(TextEdit {
                start: 7,
                end: 7,
                insert: "jaźń "
            })
        );
    }

    #[test]
    fn text_edit_handles_full_replacement_and_empty_sides() {
        assert_eq!(
            text_edit("", "new"),
            Some(TextEdit {
                start: 0,
                end: 0,
                insert: "new"
            })
        );
        assert_eq!(
            text_edit("old", ""),
            Some(TextEdit {
                start: 0,
                end: 3,
                insert: ""
            })
        );
        assert_eq!(
            text_edit("aaa", "aa"),
            Some(TextEdit {
                start: 2,
                end: 3,
                insert: ""
            })
        );
    }
}
