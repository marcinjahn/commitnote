use unicode_segmentation::UnicodeSegmentation;

/// Modifier state of a key press. GTK modifiers map as Ctrl to `control`, Alt to `option`,
/// Super and Meta to `command`, and Shift to `shift`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct KeyModifiers {
    pub command: bool,
    pub control: bool,
    pub option: bool,
    pub shift: bool,
}

impl KeyModifiers {
    pub const NONE: Self = Self {
        command: false,
        control: false,
        option: false,
        shift: false,
    };
    pub const COMMAND: Self = Self {
        command: true,
        ..Self::NONE
    };
    pub const CONTROL: Self = Self {
        control: true,
        ..Self::NONE
    };
    pub const OPTION: Self = Self {
        option: true,
        ..Self::NONE
    };
    pub const SHIFT: Self = Self {
        shift: true,
        ..Self::NONE
    };

    fn has_shortcut_modifier(self) -> bool {
        self.command || self.control || self.option
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TypeToStartContext {
    pub enabled: bool,
    pub tree_loaded: bool,
    pub editor_open: bool,
    pub placeholder_visible: bool,
    pub modal_presented: bool,
    pub search_active: bool,
    pub text_input_focused: bool,
}

const FUNCTION_KEY_RANGE: std::ops::RangeInclusive<u32> = 0xF700..=0xF8FF;

pub fn should_start(
    characters: &str,
    modifiers: KeyModifiers,
    is_repeat: bool,
    context: &TypeToStartContext,
) -> bool {
    if !context.enabled
        || !context.tree_loaded
        || context.editor_open
        || !context.placeholder_visible
        || context.modal_presented
        || context.search_active
        || context.text_input_focused
        || is_repeat
        || modifiers.has_shortcut_modifier()
    {
        return false;
    }
    let mut chars = characters.chars();
    let (Some(ch), None) = (chars.next(), chars.next()) else {
        return false;
    };
    !(ch.is_whitespace() || ch.is_control() || FUNCTION_KEY_RANGE.contains(&(ch as u32)))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TypeToStartInput {
    Text(String),
    Enter,
    Backspace,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TypeToStartBuffer {
    text: String,
}

impl TypeToStartBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn text(&self) -> &str {
        &self.text
    }

    pub fn append(&mut self, input: TypeToStartInput) {
        match input {
            TypeToStartInput::Text(value) => self.text.push_str(&value),
            TypeToStartInput::Enter => self.text.push('\n'),
            TypeToStartInput::Backspace => {
                if let Some(last) = self.text.graphemes(true).next_back() {
                    let keep = self.text.len() - last.len();
                    self.text.truncate(keep);
                }
            }
            TypeToStartInput::Other => {}
        }
    }

    pub fn drain(&mut self) -> String {
        std::mem::take(&mut self.text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const READY: TypeToStartContext = TypeToStartContext {
        enabled: true,
        tree_loaded: true,
        editor_open: false,
        placeholder_visible: true,
        modal_presented: false,
        search_active: false,
        text_input_focused: false,
    };

    fn start(characters: &str) -> bool {
        should_start(characters, KeyModifiers::NONE, false, &READY)
    }

    fn start_with(characters: &str, modifiers: KeyModifiers) -> bool {
        should_start(characters, modifiers, false, &READY)
    }

    #[test]
    fn accepts_printable_characters() {
        for characters in ["a", "Z", "7", ".", "#", "é", "ł", "😀"] {
            assert!(start(characters), "{characters}");
        }
        assert!(start_with("A", KeyModifiers::SHIFT));
    }

    #[test]
    fn rejects_non_printable_input() {
        for characters in [
            "", " ", "\t", "\n", "\r", "ab", "e\u{301}", "\u{1B}", "\u{7F}", "\u{F700}", "\u{F8FF}",
        ] {
            assert!(!start(characters), "{characters:?}");
        }
    }

    #[test]
    fn rejects_unicode_whitespace_and_control_scalars() {
        for characters in [
            "\u{A0}", "\u{2003}", "\u{3000}", "\u{85}", "\u{2028}", "\u{0}", "\u{9F}",
        ] {
            assert!(!start(characters), "{characters:?}");
        }
    }

    #[test]
    fn rejects_multi_scalar_input() {
        for characters in ["👍🏽", "e\u{301}", "ab", "a ", "🇵🇱"] {
            assert!(!start(characters), "{characters:?}");
        }
    }

    #[test]
    fn accepts_function_key_range_boundaries_outside_the_range() {
        assert!(start("\u{F6FF}"));
        assert!(start("\u{F900}"));
        assert!(!start("\u{F700}"));
        assert!(!start("\u{F8FF}"));
    }

    #[test]
    fn rejects_command_control_option() {
        assert!(!start_with("a", KeyModifiers::COMMAND));
        assert!(!start_with("a", KeyModifiers::CONTROL));
        assert!(!start_with("a", KeyModifiers::OPTION));
        assert!(!start_with(
            "a",
            KeyModifiers {
                shift: true,
                command: true,
                ..KeyModifiers::NONE
            }
        ));
    }

    #[test]
    fn rejects_repeats() {
        assert!(!should_start("a", KeyModifiers::NONE, true, &READY));
    }

    #[test]
    fn each_context_flag_blocks() {
        let blocked: [fn(&mut TypeToStartContext); 7] = [
            |c| c.enabled = false,
            |c| c.tree_loaded = false,
            |c| c.editor_open = true,
            |c| c.placeholder_visible = false,
            |c| c.modal_presented = true,
            |c| c.search_active = true,
            |c| c.text_input_focused = true,
        ];
        for (index, block) in blocked.iter().enumerate() {
            let mut context = READY;
            block(&mut context);
            assert!(
                !should_start("a", KeyModifiers::NONE, false, &context),
                "flag {index}"
            );
        }
    }

    #[test]
    fn buffer_appends_and_drains() {
        let mut buffer = TypeToStartBuffer::new();
        buffer.append(TypeToStartInput::Text("h".into()));
        buffer.append(TypeToStartInput::Text("i".into()));
        buffer.append(TypeToStartInput::Enter);
        buffer.append(TypeToStartInput::Text("x".into()));
        assert_eq!(buffer.text(), "hi\nx");
        assert_eq!(buffer.drain(), "hi\nx");
        assert_eq!(buffer.text(), "");
        assert_eq!(buffer.drain(), "");
    }

    #[test]
    fn backspace_removes_last_character() {
        let mut buffer = TypeToStartBuffer::new();
        buffer.append(TypeToStartInput::Backspace);
        assert_eq!(buffer.text(), "");
        buffer.append(TypeToStartInput::Text("ae\u{301}".into()));
        buffer.append(TypeToStartInput::Backspace);
        assert_eq!(buffer.text(), "a");
        buffer.append(TypeToStartInput::Other);
        assert_eq!(buffer.text(), "a");
    }

    #[test]
    fn backspace_removes_whole_grapheme_clusters() {
        for cluster in ["👍🏽", "e\u{301}", "🇵🇱", "👨‍👩‍👧", "\r\n"] {
            let mut buffer = TypeToStartBuffer::new();
            buffer.append(TypeToStartInput::Text(format!("x{cluster}")));
            buffer.append(TypeToStartInput::Backspace);
            assert_eq!(buffer.text(), "x", "{cluster:?}");
            buffer.append(TypeToStartInput::Backspace);
            assert_eq!(buffer.text(), "");
        }
    }

    #[test]
    fn enter_then_backspace_removes_the_newline() {
        let mut buffer = TypeToStartBuffer::new();
        buffer.append(TypeToStartInput::Text("a".into()));
        buffer.append(TypeToStartInput::Enter);
        buffer.append(TypeToStartInput::Backspace);
        assert_eq!(buffer.text(), "a");
    }
}
