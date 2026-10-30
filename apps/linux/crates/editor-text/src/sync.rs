#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditorTextSync {
    Set,
    Update,
    Accept,
    Skip,
}

impl EditorTextSync {
    pub fn decide(
        note_switch: u64,
        applied_switch: u64,
        text: &str,
        doc: &str,
        base: &str,
    ) -> Self {
        if note_switch != applied_switch {
            return Self::Set;
        }
        if text == doc {
            return Self::Accept;
        }
        if doc == base {
            return Self::Update;
        }
        Self::Skip
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Args {
        note_switch: u64,
        applied_switch: u64,
        text: &'static str,
        doc: &'static str,
        base: &'static str,
    }

    impl Default for Args {
        fn default() -> Self {
            Self {
                note_switch: 1,
                applied_switch: 1,
                text: "b",
                doc: "a",
                base: "a",
            }
        }
    }

    fn decide(args: Args) -> EditorTextSync {
        EditorTextSync::decide(
            args.note_switch,
            args.applied_switch,
            args.text,
            args.doc,
            args.base,
        )
    }

    #[test]
    fn replaces_the_document_on_a_note_switch_even_over_typed_text() {
        assert_eq!(
            decide(Args {
                note_switch: 2,
                doc: "typed",
                ..Args::default()
            }),
            EditorTextSync::Set
        );
    }

    #[test]
    fn accepts_the_text_when_the_engine_caught_up_with_the_document() {
        assert_eq!(
            decide(Args {
                text: "a",
                doc: "a",
                base: "x",
                ..Args::default()
            }),
            EditorTextSync::Accept
        );
    }

    #[test]
    fn updates_in_place_when_the_document_is_untouched_since_the_last_engine_text() {
        assert_eq!(decide(Args::default()), EditorTextSync::Update);
    }

    #[test]
    fn skips_when_the_user_typed_since_the_last_engine_text() {
        assert_eq!(
            decide(Args {
                doc: "a!",
                ..Args::default()
            }),
            EditorTextSync::Skip
        );
    }
}
