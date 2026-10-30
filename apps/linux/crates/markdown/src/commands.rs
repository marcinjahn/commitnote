use std::ops::Range;

use commitnote_editor_text::{Assoc, TextEdit, TextSelection, map_position, map_selection};

use crate::parse;
use crate::scanners::{is_whitespace, is_word_char};
use crate::syntax::{MarkdownDocument, SyntaxKind, SyntaxNode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandResult {
    pub edits: Vec<TextEdit>,
    pub selection: TextSelection,
}

pub fn toggle_bold(text: &str, selection: TextSelection) -> Option<CommandResult> {
    toggle_marker(text, selection, "**")
}

pub fn toggle_italic(text: &str, selection: TextSelection) -> Option<CommandResult> {
    toggle_marker(text, selection, "*")
}

pub fn toggle_strikethrough(text: &str, selection: TextSelection) -> Option<CommandResult> {
    toggle_marker(text, selection, "~~")
}

pub fn insert_link(text: &str, selection: TextSelection) -> Option<CommandResult> {
    let context = Context::new(text, selection);
    let (from, to) = (context.from, context.to);
    if context.overlaps(is_code_kind) || context.overlaps(is_link_kind) {
        return None;
    }
    if from == to {
        return Some(CommandResult {
            edits: vec![TextEdit::new(from, to, "[]()")],
            selection: TextSelection::new(from + 1, 0),
        });
    }
    if context.spans_lines() {
        return None;
    }
    let label = escape_link_label(&context.slice(from, to));
    let label_length = label.encode_utf16().count();
    Some(CommandResult {
        edits: vec![TextEdit::new(from, to, format!("[{label}]()"))],
        selection: TextSelection::new(from + label_length + 3, 0),
    })
}

pub fn toggle_checkbox(text: &str, marker_range: Range<usize>) -> CommandResult {
    let units: Vec<u16> = text.encode_utf16().collect();
    let lower = marker_range.start.min(units.len());
    let upper = marker_range.end.min(units.len()).max(lower);
    let current = String::from_utf16_lossy(&units[lower..upper]);
    let checked = current == "[x]" || current == "[X]";
    CommandResult {
        edits: vec![TextEdit::new(
            lower,
            upper,
            if checked { "[ ]" } else { "[x]" },
        )],
        selection: TextSelection::new(upper, 0),
    }
}

pub fn toggle_task(text: &str, selection: TextSelection) -> Option<CommandResult> {
    let context = Context::new(text, selection);
    let document = &context.document;
    let first_line = line_index(document, context.from);
    let last_line = line_index(document, context.to);
    let edits: Vec<TextEdit> = (first_line..=last_line)
        .flat_map(|index| task_edits(index, &context))
        .collect();
    if edits.is_empty() {
        return None;
    }
    let mapped = if selection.length == 0 {
        TextSelection::new(map_position(context.from, &edits, Assoc::After), 0)
    } else {
        map_selection(
            TextSelection::new(context.from, context.to - context.from),
            &edits,
        )
    };
    Some(CommandResult {
        edits,
        selection: mapped,
    })
}

pub fn paste_link(text: &str, selection: TextSelection, pasted: &str) -> Option<CommandResult> {
    let context = Context::new(text, selection);
    let (from, to) = (context.from, context.to);
    if from == to || context.spans_lines() {
        return None;
    }
    let token = pasted.trim_matches(char::is_whitespace);
    if token.is_empty() || token.chars().any(|c| is_whitespace(c as i32)) {
        return None;
    }
    let destination = destination_for(token)?;
    if context.overlaps(is_code_kind) || context.overlaps(is_link_kind) {
        return None;
    }
    let label = escape_link_label(&context.slice(from, to));
    let insert = format!("[{label}]({destination})");
    let length = insert.encode_utf16().count();
    Some(CommandResult {
        edits: vec![TextEdit::new(from, to, insert)],
        selection: TextSelection::new(from + length, 0),
    })
}

/// The openable destination of the link, autolink or bare URL at `offset`.
pub fn link_url(document: &MarkdownDocument, offset: usize) -> Option<String> {
    [true, false].into_iter().find_map(|forward| {
        let chain: Vec<&SyntaxNode> = document
            .nodes
            .iter()
            .filter(|node| {
                if forward {
                    node.range.start <= offset && offset < node.range.end
                } else {
                    node.range.start < offset && offset <= node.range.end
                }
            })
            .collect();
        let url = url_node(&chain, document)?;
        let destination = document.slice(url.range.clone());
        openable_url(&unwrap_destination(trim_spaces(&destination)))
    })
}

/// The exact string to hand to a URL parser when `raw` is an http, https or mailto link.
pub fn openable_url(raw: &str) -> Option<String> {
    openable_string(raw)
}

fn is_code_kind(kind: SyntaxKind) -> bool {
    matches!(
        kind,
        SyntaxKind::InlineCode | SyntaxKind::FencedCode | SyntaxKind::IndentedCode
    )
}

fn is_link_kind(kind: SyntaxKind) -> bool {
    matches!(
        kind,
        SyntaxKind::Link | SyntaxKind::Image | SyntaxKind::Autolink | SyntaxKind::Url
    )
}

struct Context {
    document: MarkdownDocument,
    from: usize,
    to: usize,
}

impl Context {
    fn new(text: &str, selection: TextSelection) -> Self {
        let document = parse(text);
        let length = document.length();
        let from = selection.location.min(length);
        let to = selection
            .location
            .saturating_add(selection.length)
            .min(length)
            .max(from);
        Self { document, from, to }
    }

    fn spans_lines(&self) -> bool {
        self.document.line_containing(self.from) != self.document.line_containing(self.to)
    }

    fn slice(&self, lower: usize, upper: usize) -> String {
        self.document.slice(lower..upper)
    }

    fn overlaps(&self, kinds: fn(SyntaxKind) -> bool) -> bool {
        self.document.nodes.iter().any(|node| {
            if !kinds(node.kind) {
                return false;
            }
            if self.from == self.to {
                node.range.start < self.from && node.range.end > self.from
            } else {
                node.range.start < self.to && node.range.end > self.from
            }
        })
    }
}

fn escape_link_label(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    for c in text.chars() {
        if c == '[' || c == ']' {
            result.push('\\');
        }
        result.push(c);
    }
    result
}

fn run_length(units: &[u16], index: isize, step: isize) -> usize {
    let mut count = 0;
    let mut position = index;
    while position >= 0 && (position as usize) < units.len() && units[position as usize] == 42 {
        count += 1;
        position += step;
    }
    count
}

fn has_marker(units: &[u16], marker: &[u16], index: isize) -> bool {
    index >= 0
        && index as usize + marker.len() <= units.len()
        && &units[index as usize..index as usize + marker.len()] == marker
}

fn toggle_marker(text: &str, selection: TextSelection, marker: &str) -> Option<CommandResult> {
    let context = Context::new(text, selection);
    let (from, to) = (context.from, context.to);
    let marker_units: Vec<u16> = marker.encode_utf16().collect();
    let m = marker_units.len();
    if context.overlaps(is_code_kind) {
        return None;
    }
    if from == to {
        return Some(CommandResult {
            edits: vec![TextEdit::new(from, to, format!("{marker}{marker}"))],
            selection: TextSelection::new(from + m, 0),
        });
    }
    if context.spans_lines() {
        return None;
    }

    let units = context.document.units();
    let selected = &units[from..to];
    let is_italic = marker == "*";
    let present = if is_italic {
        run_length(selected, 0, 1) % 2 == 1
            && run_length(selected, selected.len() as isize - 1, -1) % 2 == 1
    } else {
        has_marker(selected, &marker_units, 0)
            && has_marker(
                selected,
                &marker_units,
                selected.len() as isize - m as isize,
            )
    };
    if selected.len() > 2 * m && present {
        return Some(CommandResult {
            edits: vec![
                TextEdit::new(from, from + m, ""),
                TextEdit::new(to - m, to, ""),
            ],
            selection: TextSelection::new(from, to - from - 2 * m),
        });
    }

    let line = context.document.line_containing(from);
    let line_units = &units[line.start..line.end];
    let line_from = from - line.start;
    let line_to = to - line.start;
    let outside = line_from >= m
        && line_to + m <= line_units.len()
        && if is_italic {
            run_length(line_units, line_from as isize - 1, -1) % 2 == 1
                && run_length(line_units, line_to as isize, 1) % 2 == 1
        } else {
            has_marker(line_units, &marker_units, line_from as isize - m as isize)
                && has_marker(line_units, &marker_units, line_to as isize)
        };
    if outside {
        return Some(CommandResult {
            edits: vec![
                TextEdit::new(from - m, from, ""),
                TextEdit::new(to, to + m, ""),
            ],
            selection: TextSelection::new(from - m, to - from),
        });
    }
    Some(CommandResult {
        edits: vec![
            TextEdit::new(from, from, marker),
            TextEdit::new(to, to, marker),
        ],
        selection: TextSelection::new(from + m, to - from),
    })
}

fn line_index(document: &MarkdownDocument, offset: usize) -> usize {
    let start = document.line_containing(offset).start;
    document
        .lines
        .partition_point(|&line_start| line_start <= start)
        .saturating_sub(1)
}

fn task_edits(index: usize, context: &Context) -> Vec<TextEdit> {
    let document = &context.document;
    let units = document.units();
    let line_start = document.lines[index];
    let line = document.line_containing(line_start);
    let mut marker: Option<&SyntaxNode> = None;
    let mut list_mark: Option<&SyntaxNode> = None;
    for node in document
        .nodes
        .iter()
        .filter(|node| line.contains(&node.range.start) || node.range.start == line.end)
    {
        if matches!(node.kind, SyntaxKind::TaskMarker { .. }) {
            marker = Some(node);
        } else if node.kind == SyntaxKind::ListMark {
            list_mark = Some(node);
        }
    }

    if let Some(marker) = marker
        && let SyntaxKind::TaskMarker { checked } = marker.kind
    {
        let at = marker.range.start + 1;
        return vec![TextEdit::new(at, at + 1, if checked { " " } else { "x" })];
    }
    if let Some(list_mark) = list_mark {
        let end = list_mark.range.end;
        if units.get(end) == Some(&32) {
            return vec![TextEdit::new(end + 1, end + 1, "[ ] ")];
        }
        return vec![TextEdit::new(end, end, " [ ] ")];
    }

    let mut indent = 0;
    while line.start + indent < line.end && is_whitespace(i32::from(units[line.start + indent])) {
        indent += 1;
    }
    let length = line.len();
    if length > 0 && indent == length {
        return Vec::new();
    }
    let position = line.start + indent;
    let top = top_level_node(position, document);
    let insert = || vec![TextEdit::new(position, position, "- [ ] ")];
    if length == 0 {
        return if top.is_none() { insert() } else { Vec::new() };
    }
    if top.is_some_and(|node| node.kind == SyntaxKind::Paragraph) {
        insert()
    } else {
        Vec::new()
    }
}

fn top_level_node(position: usize, document: &MarkdownDocument) -> Option<&SyntaxNode> {
    let mut end = 0;
    for node in &document.nodes {
        if node.range.start < end {
            continue;
        }
        end = node.range.end;
        if node.range.start <= position && position < node.range.end {
            return Some(node);
        }
    }
    None
}

fn is_space_separator(c: char) -> bool {
    c == '\t'
        || matches!(
            c,
            ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
                ..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}'
        )
}

fn trim_spaces(text: &str) -> &str {
    text.trim_matches(is_space_separator)
}

fn has_prefix_ignoring_case(string: &str, prefix: &str) -> bool {
    string.to_lowercase().starts_with(prefix)
}

fn openable_string(raw: &str) -> Option<String> {
    let url = if has_prefix_ignoring_case(raw, "www.") {
        format!("https://{raw}")
    } else if is_email(raw) {
        format!("mailto:{raw}")
    } else {
        raw.to_owned()
    };
    let scheme = scheme_of(&url)?;
    (["http", "https", "mailto"].contains(&scheme.as_str()) && parses_as_url(&url)).then_some(url)
}

fn scheme_of(url: &str) -> Option<String> {
    let mut result = String::new();
    for (index, c) in url.chars().enumerate() {
        if c == ':' {
            return (index > 0).then(|| result.to_lowercase());
        }
        let is_letter = c.is_ascii_alphabetic();
        let is_digit = c.is_ascii_digit();
        let is_mark = matches!(c, '+' | '-' | '.');
        let valid = if index == 0 {
            is_letter
        } else {
            is_letter || is_digit || is_mark
        };
        if !valid {
            return None;
        }
        result.push(c);
    }
    None
}

fn is_email(string: &str) -> bool {
    let units: Vec<i32> = string.encode_utf16().map(i32::from).collect();
    let Some(at) = units.iter().position(|&unit| unit == 64) else {
        return false;
    };
    let local = &units[..at];
    let domain = &units[at + 1..];
    if local.is_empty()
        || !local
            .iter()
            .all(|&c| is_word_char(c) || c == 46 || c == 43 || c == 45)
    {
        return false;
    }
    let labels: Vec<&[i32]> = domain.split(|&unit| unit == 46).collect();
    labels.len() >= 2
        && labels
            .iter()
            .all(|label| !label.is_empty() && label.iter().all(|&c| is_word_char(c) || c == 45))
}

/// Whether Foundation's `URL(string:)` accepts the string: it percent-encodes most characters
/// and rejects only an unusable host or port.
fn parses_as_url(url: &str) -> bool {
    let Some((_, rest)) = url.split_once(':') else {
        return false;
    };
    let Some(after_slashes) = rest.strip_prefix("//") else {
        return true;
    };
    let authority_end = after_slashes
        .find(['/', '?', '#'])
        .unwrap_or(after_slashes.len());
    let authority = &after_slashes[..authority_end];
    let host_and_port = authority
        .rsplit_once('@')
        .map_or(authority, |(_, rest)| rest);
    if let Some(bracketed) = host_and_port.strip_prefix('[') {
        let Some((address, port)) = bracketed.split_once(']') else {
            return false;
        };
        return address.chars().all(|c| c == '%' || is_host_char(c))
            && port.strip_prefix(':').map_or(port.is_empty(), is_port);
    }
    let (host, port) = match host_and_port.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (host_and_port, None),
    };
    port.is_none_or(is_port) && is_host(host)
}

fn is_port(port: &str) -> bool {
    port.chars().all(|c| c.is_ascii_digit())
}

fn is_host(host: &str) -> bool {
    let chars: Vec<char> = host.chars().collect();
    chars.iter().enumerate().all(|(index, &c)| {
        if c == '%' {
            chars
                .get(index + 1..index + 3)
                .is_some_and(|digits| digits.iter().all(char::is_ascii_hexdigit))
        } else {
            is_host_char(c)
        }
    })
}

fn is_host_char(c: char) -> bool {
    !(c.is_control()
        || c.is_whitespace()
        || matches!(
            c,
            '"' | '<' | '>' | '[' | '\\' | ']' | '^' | '`' | '{' | '|' | '}' | '\u{FFFD}'
        )
        || ('\u{E000}'..='\u{F8FF}').contains(&c)
        || c as u32 >= 0xF0000)
}

fn destination_for(token: &str) -> Option<String> {
    let openable = openable_string(token)?;
    let mut destination = token.to_owned();
    if has_prefix_ignoring_case(token, "www.") {
        destination = format!("https://{token}");
    } else if has_prefix_ignoring_case(&openable, "mailto:")
        && !has_prefix_ignoring_case(token, "mailto:")
    {
        destination = format!("mailto:{token}");
    }
    if destination.contains(['<', '>']) {
        return None;
    }
    Some(if destination.contains(['(', ')']) {
        format!("<{destination}>")
    } else {
        destination
    })
}

fn unwrap_destination(raw: &str) -> String {
    if raw.chars().count() >= 2 && raw.starts_with('<') && raw.ends_with('>') {
        raw[1..raw.len() - 1].to_owned()
    } else {
        raw.to_owned()
    }
}

fn url_node<'a>(
    chain: &[&'a SyntaxNode],
    document: &'a MarkdownDocument,
) -> Option<&'a SyntaxNode> {
    let ordered: Vec<&SyntaxNode> = chain.iter().rev().copied().collect();
    for (index, node) in ordered.iter().enumerate() {
        match node.kind {
            SyntaxKind::Link => return destination_of(node, document),
            SyntaxKind::Autolink => {
                return document.nodes.iter().find(|inner| {
                    inner.kind == SyntaxKind::Url && node.range.contains(&inner.range.start)
                });
            }
            SyntaxKind::Url => {
                let parent = ordered.get(index + 1);
                if parent.is_some_and(|parent| parent.kind == SyntaxKind::Link) {
                    return Some(node);
                }
                if parent.is_some_and(|parent| parent.kind == SyntaxKind::LinkLabel) {
                    continue;
                }
                return Some(node);
            }
            _ => continue,
        }
    }
    None
}

fn destination_of<'a>(link: &SyntaxNode, document: &'a MarkdownDocument) -> Option<&'a SyntaxNode> {
    let units = document.units();
    document.nodes.iter().find(|node| {
        node.kind == SyntaxKind::Url
            && link.range.contains(&node.range.start)
            && node.range.start > 0
            && units[node.range.start - 1] == 40
            && !document.nodes.iter().any(|label| {
                label.kind == SyntaxKind::LinkLabel
                    && label.range.contains(&node.range.start)
                    && link.range.contains(&label.range.start)
            })
    })
}
