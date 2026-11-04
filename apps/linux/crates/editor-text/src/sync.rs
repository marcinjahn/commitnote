use std::collections::VecDeque;

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
        echo: bool,
    ) -> Self {
        if note_switch != applied_switch {
            return Self::Set;
        }
        if text == doc || echo {
            return Self::Accept;
        }
        if doc == base {
            return Self::Update;
        }
        Self::Skip
    }
}

/// The texts the editor sent on that the engine has not reported back yet, so a late report
/// of one is told apart from a change made elsewhere.
#[derive(Debug, Default)]
pub struct SentTexts {
    texts: VecDeque<String>,
}

impl SentTexts {
    const LIMIT: usize = 64;

    pub fn record(&mut self, text: &str) {
        if self.texts.len() == Self::LIMIT {
            self.texts.pop_front();
        }
        self.texts.push_back(text.to_owned());
    }

    /// Whether `text` is one of the sent texts. The engine reports sends in order, and may
    /// skip texts that were replaced before being sent, so this also forgets every earlier one.
    pub fn take_echo(&mut self, text: &str) -> bool {
        let Some(index) = self.texts.iter().position(|sent| sent == text) else {
            return false;
        };
        self.texts.drain(..=index);
        true
    }

    pub fn clear(&mut self) {
        self.texts.clear();
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
        echo: bool,
    }

    impl Default for Args {
        fn default() -> Self {
            Self {
                note_switch: 1,
                applied_switch: 1,
                text: "b",
                doc: "a",
                base: "a",
                echo: false,
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
            args.echo,
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

    #[test]
    fn accepts_a_late_echo_even_when_the_document_is_back_at_the_engine_text() {
        assert_eq!(
            decide(Args {
                echo: true,
                ..Args::default()
            }),
            EditorTextSync::Accept
        );
    }

    #[test]
    fn replaces_the_document_on_a_note_switch_even_for_an_echo() {
        assert_eq!(
            decide(Args {
                note_switch: 2,
                echo: true,
                ..Args::default()
            }),
            EditorTextSync::Set
        );
    }

    #[test]
    fn a_sent_text_reported_back_is_an_echo_and_earlier_sends_are_forgotten() {
        let mut sent = SentTexts::default();
        for text in ["a", "b", "c", "b"] {
            sent.record(text);
        }

        assert!(!sent.take_echo("never sent"));
        assert!(sent.take_echo("c"));
        assert!(!sent.take_echo("a"));
        assert!(sent.take_echo("b"));
        assert!(!sent.take_echo("b"));
    }

    #[test]
    fn only_the_latest_sends_are_remembered() {
        let mut sent = SentTexts::default();
        for index in 0..=SentTexts::LIMIT {
            sent.record(&index.to_string());
        }

        assert!(!sent.take_echo("0"));
        assert!(sent.take_echo("1"));
    }

    #[test]
    fn nothing_is_an_echo_after_clearing() {
        let mut sent = SentTexts::default();
        sent.record("a");
        sent.clear();

        assert!(!sent.take_echo("a"));
    }
}
