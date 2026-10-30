use commitnote_core_api::shapes::OpenNote;

use crate::model::{EditorTarget, NoteContentUpdate};

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

pub fn editor_update(
    target: &EditorTarget,
    update: Option<NoteContentUpdate>,
) -> Option<NoteContentUpdate> {
    let path = target.note_path()?;
    update.filter(|update| update.path == path)
}

/// The update the editor takes: only one for the note on display, and only once it is loaded.
pub fn loaded_update(
    display: &NoteDisplay,
    target: &EditorTarget,
    update: Option<NoteContentUpdate>,
) -> Option<NoteContentUpdate> {
    let NoteDisplay::Loaded { path, .. } = display else {
        return None;
    };
    editor_update(target, update).filter(|update| update.path.as_slice() == *path)
}

pub fn note_title(path: &[String]) -> &str {
    path.last().map_or("", String::as_str)
}

#[cfg(test)]
mod tests {
    use commitnote_core_api::commands::NoteDraft;

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

    fn update(parts: &[&str]) -> NoteContentUpdate {
        NoteContentUpdate {
            serial: 1,
            path: path(parts),
            content: "text".to_owned(),
            edits: None,
        }
    }

    #[test]
    fn an_update_for_the_editor_target_reaches_the_editor() {
        let target = EditorTarget::Note(path(&["f", "a"]));
        assert_eq!(
            editor_update(&target, Some(update(&["f", "a"]))),
            Some(update(&["f", "a"]))
        );
    }

    #[test]
    fn an_update_for_another_note_never_reaches_the_editor() {
        let target = EditorTarget::Note(path(&["a"]));
        assert_eq!(editor_update(&target, Some(update(&["b"]))), None);
        assert_eq!(editor_update(&target, None), None);
    }

    #[test]
    fn a_draft_or_no_target_takes_no_update() {
        let draft = EditorTarget::Draft(NoteDraft {
            parent: Vec::new(),
            name: String::new(),
        });
        assert_eq!(editor_update(&draft, Some(update(&["a"]))), None);
        assert_eq!(
            editor_update(&EditorTarget::None, Some(update(&["a"]))),
            None
        );
    }

    #[test]
    fn the_title_is_the_last_path_element() {
        assert_eq!(note_title(&path(&["f", "Plan"])), "Plan");
        assert_eq!(note_title(&[]), "");
    }
}
