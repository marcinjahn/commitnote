use crate::scanners::{is_space_unit, is_whitespace_unit, skip_spaces};

const HASH: u16 = b'#' as u16;
const BACKTICK: u16 = b'`' as u16;
const TILDE: u16 = b'~' as u16;
const QUOTE: u16 = b'>' as u16;
const DASH: u16 = b'-' as u16;
const PLUS: u16 = b'+' as u16;
const STAR: u16 = b'*' as u16;
const UNDERSCORE: u16 = b'_' as u16;
const DOT: u16 = b'.' as u16;
const CLOSE_PAREN: u16 = b')' as u16;
const ONE: u16 = b'1' as u16;
const LESS_THAN: u16 = b'<' as u16;
const GREATER_THAN: u16 = b'>' as u16;
const SLASH: u16 = b'/' as u16;

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

/// The block structure around a paragraph line that decides which block starts interrupt it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ParagraphContext {
    pub in_bullet_list: bool,
    pub in_ordered_list: bool,
    /// The line continues every container, so a dash underline makes a setext heading rather
    /// than a thematic break.
    pub continues_containers: bool,
}

/// Whether the paragraph line whose content starts at `from`, indented less than four columns
/// past its container, ends the paragraph by starting another block, as lezer's markdown parser
/// decides it.
pub(crate) fn interrupts_paragraph(
    units: &[u16],
    from: usize,
    end: usize,
    context: ParagraphContext,
) -> bool {
    let line = &units[from..end];
    is_atx_heading(line)
        || is_code_fence(line)
        || line.first() == Some(&QUOTE)
        || is_bullet_item(line, context)
        || is_ordered_item(line, context)
        || is_thematic_break(line, context)
        || is_html_block_start(line)
}

fn is_ascii(unit: u16, test: fn(&u8) -> bool) -> bool {
    u8::try_from(unit).is_ok_and(|byte| test(&byte))
}

fn is_space_at(line: &[u16], index: usize) -> bool {
    line.get(index).is_some_and(|&unit| is_space_unit(unit))
}

fn has_content_from(line: &[u16], index: usize) -> bool {
    index < line.len() && skip_spaces(line, index, line.len()) < line.len()
}

fn run_length(line: &[u16], from: usize, unit: u16) -> usize {
    line[from..]
        .iter()
        .take_while(|&&candidate| candidate == unit)
        .count()
}

fn is_atx_heading(line: &[u16]) -> bool {
    if line.first() != Some(&HASH) {
        return false;
    }
    let size = run_length(line, 0, HASH);
    size <= 6 && line.get(size).is_none_or(|&unit| unit == u16::from(b' '))
}

fn is_code_fence(line: &[u16]) -> bool {
    let Some(&marker) = line
        .first()
        .filter(|&&unit| unit == BACKTICK || unit == TILDE)
    else {
        return false;
    };
    let size = run_length(line, 0, marker);
    size >= 3 && (marker == TILDE || !line[size..].contains(&BACKTICK))
}

fn is_bullet_item(line: &[u16], context: ParagraphContext) -> bool {
    matches!(line.first(), Some(&(DASH | PLUS | STAR)))
        && (line.len() == 1 || is_space_at(line, 1))
        && (context.in_bullet_list || has_content_from(line, 2))
}

/// Outside an ordered list only a non-empty item numbered `1` interrupts.
fn is_ordered_item(line: &[u16], context: ParagraphContext) -> bool {
    let digits = line
        .iter()
        .take_while(|&&unit| is_ascii(unit, u8::is_ascii_digit))
        .count();
    if digits == 0 || digits > 9 || !matches!(line.get(digits), Some(&(DOT | CLOSE_PAREN))) {
        return false;
    }
    let after = digits + 1;
    if after < line.len() && !is_space_at(line, after) {
        return false;
    }
    context.in_ordered_list || (digits == 1 && line[0] == ONE && has_content_from(line, after))
}

fn is_thematic_break(line: &[u16], context: ParagraphContext) -> bool {
    let Some(&marker) = line
        .first()
        .filter(|&&unit| matches!(unit, DASH | STAR | UNDERSCORE))
    else {
        return false;
    };
    if !line
        .iter()
        .all(|&unit| unit == marker || is_space_unit(unit))
    {
        return false;
    }
    let run = run_length(line, 0, marker);
    let setext_underline = marker == DASH && line[run..].iter().all(|&unit| is_space_unit(unit));
    if setext_underline && context.continues_containers {
        return false;
    }
    line.iter().filter(|&&unit| unit == marker).count() >= 3
}

/// HTML block starts of CommonMark types 1 to 6; type 7 cannot interrupt a paragraph.
fn is_html_block_start(line: &[u16]) -> bool {
    if line.first() != Some(&LESS_THAN) {
        return false;
    }
    let rest = &line[1..];
    starts_with(rest, "!--")
        || starts_with(rest, "?")
        || (starts_with(rest, "!")
            && rest
                .get(1)
                .is_some_and(|&unit| is_ascii(unit, u8::is_ascii_uppercase)))
        || starts_with(rest, "![CDATA[")
        || is_tag_start(rest, &RAW_TAGS, false)
        || is_tag_start(
            rest.strip_prefix(&[SLASH]).unwrap_or(rest),
            &BLOCK_TAGS,
            true,
        )
}

fn starts_with(units: &[u16], prefix: &str) -> bool {
    units.len() >= prefix.len()
        && prefix
            .bytes()
            .zip(units)
            .all(|(byte, &unit)| unit == u16::from(byte))
}

/// A tag name from `tags`, in any ASCII case, ended by whitespace, `>`, the line end, or `/>` when
/// `self_closing` allows it.
fn is_tag_start(units: &[u16], tags: &[&str], self_closing: bool) -> bool {
    let name_length = units
        .iter()
        .take_while(|&&unit| is_ascii(unit, u8::is_ascii_alphanumeric))
        .count();
    let name = &units[..name_length];
    let known = tags.iter().any(|tag| {
        tag.len() == name.len()
            && tag
                .bytes()
                .zip(name)
                .all(|(byte, &unit)| u16::from(byte) == unit | 0x20)
    });
    let after = &units[name_length..];
    known
        && match after.first() {
            None => true,
            Some(&GREATER_THAN) => true,
            Some(&unit) if is_whitespace_unit(unit) => true,
            Some(&SLASH) => self_closing && after.get(1) == Some(&GREATER_THAN),
            Some(_) => false,
        }
}
