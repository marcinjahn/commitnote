const HASH: i32 = b'#' as i32;
const SEMICOLON: i32 = b';' as i32;
const DASH: i32 = b'-' as i32;
const DOT: i32 = b'.' as i32;
const PLUS: i32 = b'+' as i32;
const AT: i32 = b'@' as i32;
const COLON: i32 = b':' as i32;
const SLASH: i32 = b'/' as i32;
const LESS_THAN: i32 = b'<' as i32;
const GREATER_THAN: i32 = b'>' as i32;
const CLOSE_PAREN: i32 = b')' as i32;
const OPEN_PAREN: i32 = b'(' as i32;
const OPEN_BRACKET: i32 = b'[' as i32;
const CLOSE_BRACKET: i32 = b']' as i32;
const AMPERSAND: i32 = b'&' as i32;
const UNDERSCORE: i32 = b'_' as i32;
const TRAILING_PUNCTUATION: [i32; 8] = [
    b'?' as i32,
    b'!' as i32,
    b'.' as i32,
    b',' as i32,
    b':' as i32,
    b'*' as i32,
    b'_' as i32,
    b'~' as i32,
];

/// The unit at `index`, or -1 past the end.
pub(crate) fn code(text: &[u16], index: usize) -> i32 {
    text.get(index).map_or(-1, |&unit| i32::from(unit))
}

/// JavaScript's `\s`.
pub(crate) fn is_whitespace(c: i32) -> bool {
    matches!(
        c,
        9..=13
            | 32
            | 0xA0
            | 0x1680
            | 0x2000..=0x200A
            | 0x2028
            | 0x2029
            | 0x202F
            | 0x205F
            | 0x3000
            | 0xFEFF
    )
}

pub(crate) fn is_word_char(c: i32) -> bool {
    is_alphanumeric(c) || c == UNDERSCORE
}

fn is_digit(c: i32) -> bool {
    (48..=57).contains(&c)
}

fn is_alpha(c: i32) -> bool {
    (65..=90).contains(&c) || (97..=122).contains(&c)
}

fn is_alphanumeric(c: i32) -> bool {
    is_alpha(c) || is_digit(c)
}

fn is_hex_digit(c: i32, case_insensitive: bool) -> bool {
    is_digit(c) || (97..=102).contains(&c) || (case_insensitive && (65..=70).contains(&c))
}

fn is_host_char(c: i32) -> bool {
    is_word_char(c) || c == DASH
}

fn is_email_local_char(c: i32) -> bool {
    is_word_char(c) || c == DOT || c == PLUS || c == DASH
}

fn has_prefix(text: &[u16], prefix: &str, at: usize) -> bool {
    prefix
        .bytes()
        .enumerate()
        .all(|(offset, byte)| code(text, at + offset) == i32::from(byte))
}

/// `(?:#\d+|#x[a-f\d]+|\w+);` at `start`; returns the match length.
pub fn entity_length(text: &[u16], start: usize, hex_case_insensitive: bool) -> Option<usize> {
    if code(text, start) == HASH {
        let mut i = start + 1;
        while is_digit(code(text, i)) {
            i += 1;
        }
        if i > start + 1 && code(text, i) == SEMICOLON {
            return Some(i + 1 - start);
        }
        let x = code(text, start + 1);
        if x == i32::from(b'x') || (hex_case_insensitive && x == i32::from(b'X')) {
            i = start + 2;
            while is_hex_digit(code(text, i), hex_case_insensitive) {
                i += 1;
            }
            if i > start + 2 && code(text, i) == SEMICOLON {
                return Some(i + 1 - start);
            }
        }
        return None;
    }
    let mut i = start;
    while is_word_char(code(text, i)) {
        i += 1;
    }
    (i > start && code(text, i) == SEMICOLON).then(|| i + 1 - start)
}

/// `[\w.+-]{1,100}@` at `start`.
pub fn is_email_prefix(text: &[u16], start: usize) -> bool {
    let mut i = start;
    while i - start <= 100 && is_email_local_char(code(text, i)) {
        i += 1;
    }
    i > start && i - start <= 100 && code(text, i) == AT
}

/// End of a `www.`/`http(s)://` autolink whose host starts at `from`.
pub fn autolink_url_end(text: &[u16], from: usize) -> Option<usize> {
    let mut i = from;
    while is_host_char(code(text, i)) {
        i += 1;
    }
    if i == from {
        return None;
    }
    let mut previous_label = from..i;
    let mut last_label = from..i;
    let mut groups = 0;
    while code(text, i) == DOT && is_host_char(code(text, i + 1)) {
        let label_start = i + 1;
        i = label_start;
        while is_host_char(code(text, i)) {
            i += 1;
        }
        previous_label = last_label;
        last_label = label_start..i;
        groups += 1;
    }
    if groups == 0 {
        return None;
    }
    if (previous_label.start..last_label.end).any(|index| code(text, index) == UNDERSCORE) {
        return None;
    }
    if code(text, i) == COLON && is_digit(code(text, i + 1)) {
        i += 1;
        while is_digit(code(text, i)) {
            i += 1;
        }
    }
    if code(text, i) == SLASH {
        i += 1;
        while i < text.len() && !is_whitespace(code(text, i)) && code(text, i) != LESS_THAN {
            i += 1;
        }
    }
    let mut end = i;
    while end > from {
        let last = code(text, end - 1);
        let unbalanced_paren = last == CLOSE_PAREN
            && count(text, from, end, CLOSE_PAREN) > count(text, from, end, OPEN_PAREN);
        if TRAILING_PUNCTUATION.contains(&last) || unbalanced_paren {
            end -= 1;
        } else if let Some(entity_start) = (last == SEMICOLON)
            .then(|| trailing_entity_start(text, from, end))
            .flatten()
        {
            end = entity_start;
        } else {
            break;
        }
    }
    Some(end)
}

fn count(text: &[u16], from: usize, to: usize, ch: i32) -> usize {
    text[from..to]
        .iter()
        .filter(|&&unit| i32::from(unit) == ch)
        .count()
}

/// Start of `&(?:#\d+|#x[a-f\d]+|\w+);` ending exactly at `end`.
fn trailing_entity_start(text: &[u16], from: usize, end: usize) -> Option<usize> {
    let ampersand = (from..end.saturating_sub(1))
        .rev()
        .find(|&index| code(text, index) == AMPERSAND)?;
    let length = entity_length(text, ampersand + 1, false)?;
    (ampersand + 1 + length == end).then_some(ampersand)
}

/// Length of `([^\[\]]|\[[^\]]*\])*` over `text[start..end]`.
pub fn bracket_balanced_length(text: &[u16], start: usize, end: usize) -> usize {
    let mut i = start;
    while i < end {
        let c = i32::from(text[i]);
        if c == CLOSE_BRACKET {
            break;
        }
        if c == OPEN_BRACKET {
            let mut j = i + 1;
            while j < end && i32::from(text[j]) != CLOSE_BRACKET {
                j += 1;
            }
            if j >= end {
                break;
            }
            i = j + 1;
        } else {
            i += 1;
        }
    }
    i - start
}

/// End of `[\w.+-]+@[\w-]+(\.[\w.-]+)+` at `from`, without a trailing dot.
pub fn autolink_email_end(text: &[u16], from: usize) -> Option<usize> {
    let mut i = from;
    while is_email_local_char(code(text, i)) {
        i += 1;
    }
    if i == from || code(text, i) != AT {
        return None;
    }
    i += 1;
    let domain = i;
    while is_host_char(code(text, i)) {
        i += 1;
    }
    if i == domain || code(text, i) != DOT {
        return None;
    }
    i += 1;
    let rest = i;
    while is_host_char(code(text, i)) || code(text, i) == DOT {
        i += 1;
    }
    if i == rest {
        return None;
    }
    let last = code(text, i - 1);
    if last == UNDERSCORE || last == DASH {
        return None;
    }
    Some(if last == DOT { i - 1 } else { i })
}

/// `<scheme:…>` or `<email>` after the `<` at `start`; returns the length including `>`.
pub fn autolink_length(text: &[u16], start: usize) -> Option<usize> {
    if is_alpha(code(text, start)) {
        let mut i = start + 1;
        while is_word_char(code(text, i)) || [DASH, PLUS, DOT].contains(&code(text, i)) {
            i += 1;
        }
        if i > start + 1 && code(text, i) == COLON {
            let body = i + 1;
            i = body;
            while i < text.len() && !is_whitespace(code(text, i)) && code(text, i) != GREATER_THAN {
                i += 1;
            }
            if i > body && code(text, i) == GREATER_THAN {
                return Some(i + 1 - start);
            }
        }
    }
    let mut i = start;
    while is_email_autolink_local_char(code(text, i)) {
        i += 1;
    }
    if i == start || code(text, i) != AT {
        return None;
    }
    i += 1;
    loop {
        let label = i;
        while is_alphanumeric(code(text, i)) || code(text, i) == DASH {
            i += 1;
        }
        let length = i - label;
        if length == 0
            || length > 63
            || !is_alphanumeric(code(text, label))
            || !is_alphanumeric(code(text, i - 1))
        {
            return None;
        }
        if code(text, i) == DOT {
            i += 1;
            continue;
        }
        return (code(text, i) == GREATER_THAN).then(|| i + 1 - start);
    }
}

fn is_email_autolink_local_char(c: i32) -> bool {
    is_alphanumeric(c) || u8::try_from(c).is_ok_and(|byte| b".!#$%&'*+/=?^_`{|}~-".contains(&byte))
}

/// End of a GFM autolink literal (`www.`, `http(s)://`, email, `mailto:`, `xmpp:`) at `pos`.
pub fn autolink_literal_end(text: &[u16], pos: usize, has_open_link: bool) -> Option<usize> {
    if pos > 0 && is_word_char(code(text, pos - 1)) {
        return None;
    }
    let end = if has_prefix(text, "www.", pos)
        || has_prefix(text, "http://", pos)
        || has_prefix(text, "https://", pos)
    {
        let prefix = if has_prefix(text, "www.", pos) {
            4
        } else if has_prefix(text, "http://", pos) {
            7
        } else {
            8
        };
        let end = autolink_url_end(text, pos + prefix)?;
        if has_open_link {
            pos + bracket_balanced_length(text, pos, end)
        } else {
            end
        }
    } else if is_email_prefix(text, pos) {
        autolink_email_end(text, pos)?
    } else if has_prefix(text, "mailto:", pos) || has_prefix(text, "xmpp:", pos) {
        let xmpp = has_prefix(text, "xmpp:", pos);
        let mut end = autolink_email_end(text, pos + if xmpp { 5 } else { 7 })?;
        if xmpp && code(text, end) == SLASH {
            let mut i = end + 1;
            while is_alphanumeric(code(text, i)) || code(text, i) == AT || code(text, i) == DOT {
                i += 1;
            }
            if i > end + 1 {
                end = i;
            }
        }
        end
    } else {
        return None;
    };
    (end > pos).then_some(end)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn units(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    fn literal(text: &str) -> Option<String> {
        let text = units(text);
        let end = autolink_literal_end(&text, 0, false)?;
        Some(String::from_utf16_lossy(&text[..end]))
    }

    #[test]
    fn url_trailing_punctuation_is_trimmed() {
        assert_eq!(
            literal("www.example.com.").as_deref(),
            Some("www.example.com")
        );
        assert_eq!(literal("https://a.b/c?").as_deref(), Some("https://a.b/c"));
        assert_eq!(
            literal("https://a.b/c?!.,:*_~").as_deref(),
            Some("https://a.b/c")
        );
        assert_eq!(
            literal("https://a.b/c?d=1").as_deref(),
            Some("https://a.b/c?d=1")
        );
        assert_eq!(literal("www.a.com/x&amp;").as_deref(), Some("www.a.com/x"));
        assert_eq!(
            literal("www.a.com/x&amp").as_deref(),
            Some("www.a.com/x&amp")
        );
        assert_eq!(
            literal("www.a.com:8080/x").as_deref(),
            Some("www.a.com:8080/x")
        );
    }

    #[test]
    fn url_keeps_balanced_parentheses() {
        assert_eq!(literal("www.a.com/b(c)").as_deref(), Some("www.a.com/b(c)"));
        assert_eq!(
            literal("www.a.com/b(c))").as_deref(),
            Some("www.a.com/b(c)")
        );
        assert_eq!(literal("www.a.com/b)").as_deref(), Some("www.a.com/b"));
        assert_eq!(
            literal("www.a.com/b((c))").as_deref(),
            Some("www.a.com/b((c))")
        );
    }

    #[test]
    fn url_ends_at_whitespace_and_less_than() {
        assert_eq!(literal("https://a.b/c d").as_deref(), Some("https://a.b/c"));
        assert_eq!(literal("https://a.b/c<d").as_deref(), Some("https://a.b/c"));
    }

    #[test]
    fn url_host_needs_a_dot_and_no_underscore_in_the_last_labels() {
        assert_eq!(literal("www.localhost"), None);
        assert_eq!(literal("https://localhost"), None);
        assert_eq!(
            literal("https://localhost.x").as_deref(),
            Some("https://localhost.x")
        );
        assert_eq!(literal("www.a_b.com"), None);
        assert_eq!(literal("www.a.b_c"), None);
        assert_eq!(literal("www.a_b.c.d").as_deref(), Some("www.a_b.c.d"));
    }

    #[test]
    fn url_after_a_word_character_is_not_a_link() {
        let text = units("xwww.a.com");
        assert_eq!(autolink_literal_end(&text, 1, false), None);
        let text = units(" www.a.com");
        assert_eq!(autolink_literal_end(&text, 1, false), Some(10));
    }

    #[test]
    fn url_inside_an_open_link_stops_at_an_unbalanced_bracket() {
        let text = units("www.a.com/b]c");
        assert_eq!(autolink_literal_end(&text, 0, false), Some(13));
        assert_eq!(autolink_literal_end(&text, 0, true), Some(11));
        let text = units("www.a.com/[b]c");
        assert_eq!(autolink_literal_end(&text, 0, true), Some(14));
    }

    #[test]
    fn bracket_balanced_length_skips_closed_groups() {
        let text = units("ab[cd]e]f");
        assert_eq!(bracket_balanced_length(&text, 0, text.len()), 7);
        let text = units("ab[cd");
        assert_eq!(bracket_balanced_length(&text, 0, text.len()), 2);
    }

    #[test]
    fn email_domains() {
        assert_eq!(literal("a@b.co").as_deref(), Some("a@b.co"));
        assert_eq!(literal("a.b+c-d@x.y.z.").as_deref(), Some("a.b+c-d@x.y.z"));
        assert_eq!(literal("a@b.c_"), None);
        assert_eq!(literal("a@b.c-"), None);
        assert_eq!(literal("a@b"), None);
        assert_eq!(literal("a@.b"), None);
        assert_eq!(literal("a@b."), None);
        assert_eq!(literal("@b.c"), None);
    }

    #[test]
    fn email_prefix_is_limited_to_one_hundred_characters() {
        let long = format!("{}@b.c", "a".repeat(100));
        assert!(is_email_prefix(&units(&long), 0));
        let too_long = format!("{}@b.c", "a".repeat(101));
        assert!(!is_email_prefix(&units(&too_long), 0));
    }

    #[test]
    fn mailto_and_xmpp() {
        assert_eq!(literal("mailto:a@b.c").as_deref(), Some("mailto:a@b.c"));
        assert_eq!(
            literal("xmpp:a@b.c/res.1").as_deref(),
            Some("xmpp:a@b.c/res.1")
        );
        assert_eq!(literal("xmpp:a@b.c/").as_deref(), Some("xmpp:a@b.c"));
        assert_eq!(literal("mailto:"), None);
    }

    #[test]
    fn angle_autolinks() {
        assert_eq!(autolink_length(&units("https://a.b>"), 0), Some(12));
        assert_eq!(autolink_length(&units("a:>"), 0), None);
        assert_eq!(autolink_length(&units("a b:c>"), 0), None);
        assert_eq!(autolink_length(&units("x@a-b.c>"), 0), Some(8));
        assert_eq!(autolink_length(&units("x@-a.c>"), 0), None);
        assert_eq!(autolink_length(&units("x@a.c"), 0), None);
    }

    #[test]
    fn entities() {
        assert_eq!(entity_length(&units("amp;"), 0, false), Some(4));
        assert_eq!(entity_length(&units("#123;"), 0, false), Some(5));
        assert_eq!(entity_length(&units("#x1f;"), 0, false), Some(5));
        assert_eq!(entity_length(&units("#X1F;"), 0, false), None);
        assert_eq!(entity_length(&units("#X1F;"), 0, true), Some(5));
        assert_eq!(entity_length(&units("amp"), 0, false), None);
    }
}
