use commitnote_editor_text::{TextEdit, TextSelection, apply, diff};
use commitnote_markdown::{CommandResult, insert_image_references};
use futures_util::future::LocalBoxFuture;

use crate::model::ImageInput;

/// Turns inputs into image references for the note in the editor.
pub trait ImageInserter {
    /// The references for the inputs, in order; empty when nothing was added.
    fn insert_images(&self, inputs: Vec<ImageInput>) -> LocalBoxFuture<'static, Vec<String>>;

    /// `pasted` with its image references pointing at copies the open note may use.
    fn clone_pasted_images(
        &self,
        current: String,
        pasted: String,
    ) -> LocalBoxFuture<'static, String>;
}

/// Where a result that arrives later goes in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InsertAt {
    Caret,
    /// The text and selection when the insertion started.
    Captured {
        text: String,
        selection: TextSelection,
    },
}

/// The selection a late result replaces: the captured one while the text is unchanged, else
/// the caret.
pub(super) fn target_selection(
    at: &InsertAt,
    text: &str,
    selection: TextSelection,
) -> TextSelection {
    match at {
        InsertAt::Captured {
            text: captured,
            selection: captured_selection,
        } if captured == text => *captured_selection,
        _ => TextSelection::new(selection.location + selection.length, 0),
    }
}

/// Replaces `selection` with the references, placed by the shared insertion rule.
pub(super) fn place_images(
    text: &str,
    selection: TextSelection,
    references: &[String],
) -> CommandResult {
    if selection.length == 0 {
        return insert_image_references(text, selection.location, references);
    }
    let from = selection.location;
    let remaining = apply(&[TextEdit::new(from, from + selection.length, "")], text);
    let placed = insert_image_references(&remaining, from, references);
    CommandResult {
        edits: diff(text, &apply(&placed.edits, &remaining)),
        selection: placed.selection,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const REFERENCE: &str = "![](image:aaaaaaaaaaaaaaaaaaaaaaaaaa)";

    fn captured(text: &str, location: usize, length: usize) -> InsertAt {
        InsertAt::Captured {
            text: text.to_owned(),
            selection: TextSelection::new(location, length),
        }
    }

    fn placed(text: &str, selection: TextSelection) -> (String, TextSelection) {
        let result = place_images(text, selection, &[REFERENCE.to_owned()]);
        (apply(&result.edits, text), result.selection)
    }

    #[test]
    fn a_late_result_replaces_the_captured_selection_while_the_text_is_unchanged() {
        let at = captured("one two", 4, 3);

        let selection = target_selection(&at, "one two", TextSelection::new(0, 0));

        assert_eq!(selection, TextSelection::new(4, 3));
    }

    #[test]
    fn a_late_result_goes_to_the_caret_once_the_text_changed() {
        let at = captured("one two", 4, 3);

        let selection = target_selection(&at, "one two!", TextSelection::new(2, 3));

        assert_eq!(selection, TextSelection::new(5, 0));
    }

    #[test]
    fn inserting_at_the_caret_leaves_a_selection_in_place() {
        let selection = target_selection(&InsertAt::Caret, "one two", TextSelection::new(1, 2));

        assert_eq!(selection, TextSelection::new(3, 0));
    }

    #[test]
    fn images_at_a_caret_follow_the_insertion_rule() {
        let expected = insert_image_references("one\ntwo", 3, &[REFERENCE.to_owned()]);

        let result = place_images(
            "one\ntwo",
            TextSelection::new(3, 0),
            &[REFERENCE.to_owned()],
        );

        assert_eq!(result, expected);
    }

    #[test]
    fn images_replace_a_selection() {
        let (text, selection) = placed("one\nselected\ntwo", TextSelection::new(4, 8));

        assert_eq!(text, format!("one\n{REFERENCE}\n\ntwo"));
        assert_eq!(
            selection,
            TextSelection::new(4 + REFERENCE.encode_utf16().count() + 1, 0)
        );
    }
}
