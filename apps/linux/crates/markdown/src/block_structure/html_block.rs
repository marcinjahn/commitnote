use crate::scanners::{is_blank_unit, is_whitespace_unit};

const LESS_THAN: u16 = b'<' as u16;
const GREATER_THAN: u16 = b'>' as u16;
const SLASH: u16 = b'/' as u16;
const EQUALS: u16 = b'=' as u16;
const DASH: u16 = b'-' as u16;
const DOT: u16 = b'.' as u16;
const COLON: u16 = b':' as u16;
const UNDERSCORE: u16 = b'_' as u16;
const DOUBLE_QUOTE: u16 = b'"' as u16;
const SINGLE_QUOTE: u16 = b'\'' as u16;
const BACKTICK: u16 = b'`' as u16;

const RAW_TAGS: [&str; 3] = ["script", "pre", "style"];

const BLOCK_TAGS: [&str; 62] = [
    "address",
    "article",
    "aside",
    "base",
    "basefont",
    "blockquote",
    "body",
    "caption",
    "center",
    "col",
    "colgroup",
    "dd",
    "details",
    "dialog",
    "dir",
    "div",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "frame",
    "frameset",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hr",
    "html",
    "iframe",
    "legend",
    "li",
    "link",
    "main",
    "menu",
    "menuitem",
    "nav",
    "noframes",
    "ol",
    "optgroup",
    "option",
    "p",
    "param",
    "section",
    "source",
    "summary",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "title",
    "tr",
    "track",
    "ul",
];

/// What ends an HTML block, by the kind of markup that started it, as lezer's `HTMLBlockStyle`
/// pairs them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum HtmlBlockEnd {
    RawTagClose,
    CommentClose,
    ProcessingInstructionClose,
    DeclarationClose,
    CdataClose,
    BlankLine,
}

impl HtmlBlockEnd {
    /// lezer's `isHTMLBlock` on a line's content: how the HTML block it starts ends. A lone tag
    /// starts a block but cannot interrupt a paragraph.
    pub(super) fn starting(line: &[u16], interrupting: bool) -> Option<Self> {
        let rest = line.strip_prefix(&[LESS_THAN])?;
        if is_tag_start(rest, &RAW_TAGS, false) {
            Some(Self::RawTagClose)
        } else if starts_with(rest, "!--") {
            Some(Self::CommentClose)
        } else if starts_with(rest, "?") {
            Some(Self::ProcessingInstructionClose)
        } else if starts_with(rest, "!")
            && rest
                .get(1)
                .is_some_and(|&unit| is_ascii(unit, u8::is_ascii_uppercase))
        {
            Some(Self::DeclarationClose)
        } else if starts_with(rest, "![CDATA[") {
            Some(Self::CdataClose)
        } else if is_tag_start(
            rest.strip_prefix(&[SLASH]).unwrap_or(rest),
            &BLOCK_TAGS,
            true,
        ) || (!interrupting && is_lone_tag(line))
        {
            Some(Self::BlankLine)
        } else {
            None
        }
    }

    /// Whether the whole source line, container markup included, ends the block.
    pub(super) fn is_met(self, line: &[u16]) -> bool {
        match self {
            Self::RawTagClose => (0..line.len()).any(|index| {
                line[index..].starts_with(&[LESS_THAN, SLASH])
                    && is_raw_tag_close(&line[index + 2..])
            }),
            Self::CommentClose => contains(line, "-->"),
            Self::ProcessingInstructionClose => contains(line, "?>"),
            Self::DeclarationClose => line.contains(&GREATER_THAN),
            Self::CdataClose => contains(line, "]]>"),
            Self::BlankLine => line.iter().all(|&unit| is_blank_unit(unit)),
        }
    }
}

fn is_raw_tag_close(after_slash: &[u16]) -> bool {
    RAW_TAGS.iter().any(|tag| {
        after_slash.len() > tag.len()
            && matches_ignoring_case(&after_slash[..tag.len()], tag)
            && after_slash[tag.len()] == GREATER_THAN
    })
}

/// A single complete opening or closing tag and nothing else but whitespace.
fn is_lone_tag(line: &[u16]) -> bool {
    let tag_end = if line.get(1) == Some(&SLASH) {
        closing_tag_end(line)
    } else {
        opening_tag_end(line)
    };
    tag_end.is_some_and(|end| line[end..].iter().all(|&unit| is_whitespace_unit(unit)))
}

/// `</[a-z][\w-]*\s*>`, ending past the `>`.
fn closing_tag_end(line: &[u16]) -> Option<usize> {
    let name_end = tag_name_end(line, 2)?;
    let close = skip_whitespace(line, name_end);
    (line.get(close) == Some(&GREATER_THAN)).then_some(close + 1)
}

/// `<[a-z][\w-]*(\s+attribute)*\s*>`, ending past the `>`.
fn opening_tag_end(line: &[u16]) -> Option<usize> {
    let mut index = tag_name_end(line, 1)?;
    loop {
        let next = skip_whitespace(line, index);
        match line.get(next) {
            Some(&GREATER_THAN) => return Some(next + 1),
            Some(&unit) if next > index && is_attribute_name_start(unit) => {
                index = attribute_end(line, next)?;
            }
            _ => return None,
        }
    }
}

fn tag_name_end(line: &[u16], from: usize) -> Option<usize> {
    line.get(from)
        .is_some_and(|&unit| is_ascii(unit, u8::is_ascii_alphabetic))
        .then(|| skip_while(line, from + 1, |unit| is_word(unit) || unit == DASH))
}

/// `[a-z:_][\w-.]*(\s*=\s*value)?` from the name's first unit.
fn attribute_end(line: &[u16], name: usize) -> Option<usize> {
    let name_end = skip_while(line, name + 1, |unit| {
        is_word(unit) || unit == DASH || unit == DOT
    });
    let equals = skip_whitespace(line, name_end);
    if line.get(equals) != Some(&EQUALS) {
        return Some(name_end);
    }
    attribute_value_end(line, skip_whitespace(line, equals + 1))
}

/// `[^\s"'=<>\`]+`, `'[^']*'` or `"[^"]*"`.
fn attribute_value_end(line: &[u16], from: usize) -> Option<usize> {
    match *line.get(from)? {
        quote @ (SINGLE_QUOTE | DOUBLE_QUOTE) => line[from + 1..]
            .iter()
            .position(|&unit| unit == quote)
            .map(|offset| from + offset + 2),
        _ => {
            let end = skip_while(line, from, |unit| {
                !is_whitespace_unit(unit)
                    && !matches!(
                        unit,
                        DOUBLE_QUOTE | SINGLE_QUOTE | EQUALS | LESS_THAN | GREATER_THAN | BACKTICK
                    )
            });
            (end > from).then_some(end)
        }
    }
}

fn is_attribute_name_start(unit: u16) -> bool {
    is_ascii(unit, u8::is_ascii_alphabetic) || unit == COLON || unit == UNDERSCORE
}

fn is_word(unit: u16) -> bool {
    is_ascii(unit, u8::is_ascii_alphanumeric) || unit == UNDERSCORE
}

fn is_ascii(unit: u16, test: fn(&u8) -> bool) -> bool {
    u8::try_from(unit).is_ok_and(|byte| test(&byte))
}

fn skip_whitespace(line: &[u16], from: usize) -> usize {
    skip_while(line, from, is_whitespace_unit)
}

fn skip_while(line: &[u16], from: usize, accepts: impl Fn(u16) -> bool) -> usize {
    from + line[from.min(line.len())..]
        .iter()
        .take_while(|&&unit| accepts(unit))
        .count()
}

fn starts_with(units: &[u16], prefix: &str) -> bool {
    units.len() >= prefix.len()
        && prefix
            .bytes()
            .zip(units)
            .all(|(byte, &unit)| unit == u16::from(byte))
}

fn contains(units: &[u16], needle: &str) -> bool {
    (0..units.len()).any(|index| starts_with(&units[index..], needle))
}

fn matches_ignoring_case(units: &[u16], tag: &str) -> bool {
    tag.len() == units.len()
        && tag.bytes().zip(units).all(|(byte, &unit)| {
            u8::try_from(unit).is_ok_and(|unit| unit.to_ascii_lowercase() == byte)
        })
}

/// A tag name from `tags`, in any ASCII case, ended by whitespace, `>`, the line end, or `/>` when
/// `self_closing` allows it.
fn is_tag_start(units: &[u16], tags: &[&str], self_closing: bool) -> bool {
    let name_length = units
        .iter()
        .take_while(|&&unit| is_ascii(unit, u8::is_ascii_alphanumeric))
        .count();
    let known = tags
        .iter()
        .any(|tag| matches_ignoring_case(&units[..name_length], tag));
    let after = &units[name_length..];
    known
        && match after.first() {
            None | Some(&GREATER_THAN) => true,
            Some(&unit) if is_whitespace_unit(unit) => true,
            Some(&SLASH) => self_closing && after.get(1) == Some(&GREATER_THAN),
            Some(_) => false,
        }
}
