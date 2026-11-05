use std::ops::Range;

use commitnote_editor_text::{TextEdit, TextSelection};

use crate::commands::CommandResult;
use crate::parse;
use crate::scanners::is_whitespace;
use crate::syntax::SyntaxKind;

const NEWLINE: u16 = b'\n' as u16;
const PIPE: u16 = b'|' as u16;
const BACKSLASH: u16 = b'\\' as u16;
const QUOTE: u16 = b'>' as u16;
const SPACE: u16 = b' ' as u16;
const TAB: u16 = b'\t' as u16;

struct Cell {
    from: usize,
    to: usize,
    content_to: usize,
    has_text: bool,
}

struct SourceLine {
    from: usize,
    to: usize,
    row_from: usize,
    cells: Vec<Cell>,
    trailing_pipe: bool,
}

struct Table {
    prefix: Option<String>,
    column_count: usize,
    lines: Vec<SourceLine>,
    span: Range<usize>,
}

struct Insertion {
    at: usize,
    insert: String,
    caret: usize,
}

fn len16(text: &str) -> usize {
    text.encode_utf16().count()
}

fn is_blank_unit(unit: u16) -> bool {
    unit == SPACE || unit == TAB
}

fn is_whitespace_unit(unit: u16) -> bool {
    is_whitespace(i32::from(unit))
}

fn trim_end_js(text: &str) -> &str {
    text.trim_end_matches(|c: char| i32::try_from(u32::from(c)).is_ok_and(is_whitespace))
}

fn line_start(units: &[u16], position: usize) -> usize {
    let position = position.min(units.len());
    units[..position]
        .iter()
        .rposition(|&unit| unit == NEWLINE)
        .map_or(0, |index| index + 1)
}

fn line_end(units: &[u16], position: usize) -> usize {
    units.get(position..).map_or(units.len(), |rest| {
        rest.iter()
            .position(|&unit| unit == NEWLINE)
            .map_or(units.len(), |index| position + index)
    })
}

fn is_blank_line(units: &[u16], from: usize, to: usize) -> bool {
    units[from..to].iter().all(|&unit| is_whitespace_unit(unit))
}

fn slice16(units: &[u16], from: usize, to: usize) -> String {
    String::from_utf16_lossy(&units[from..to])
}

fn skip_blanks(units: &[u16], from: usize, to: usize) -> usize {
    let mut index = from;
    while index < to && is_blank_unit(units[index]) {
        index += 1;
    }
    index
}

fn source_cell(units: &[u16], from: usize, to: usize) -> Cell {
    let mut content_to = to;
    while content_to > from && is_blank_unit(units[content_to - 1]) {
        content_to -= 1;
    }
    let content_from = skip_blanks(units, from, content_to);
    Cell {
        from,
        to,
        content_to,
        has_text: content_from < content_to,
    }
}

fn pipe_positions(units: &[u16], from: usize, to: usize, delimiter_row: bool) -> Vec<usize> {
    let mut pipes = Vec::new();
    let mut index = from;
    while index < to {
        let unit = units[index];
        if unit == BACKSLASH && !delimiter_row {
            index += 2;
            continue;
        }
        if unit == PIPE {
            pipes.push(index);
        }
        index += 1;
    }
    pipes
}

fn pipe_segments(from: usize, to: usize, pipes: &[usize]) -> Vec<(usize, usize)> {
    let mut segments = Vec::new();
    let mut start = from;
    for &pipe in pipes {
        segments.push((start, pipe));
        start = pipe + 1;
    }
    segments.push((start, to));
    if pipes.first() == Some(&from) {
        segments.remove(0);
    }
    if pipes.last().is_some_and(|&pipe| pipe + 1 == to) {
        segments.pop();
    }
    segments
}

fn source_line(units: &[u16], row_from: usize, delimiter_row: bool) -> SourceLine {
    let from = line_start(units, row_from);
    let to = line_end(units, row_from);
    let pipes = pipe_positions(units, row_from, to, delimiter_row);
    let mut segments = pipe_segments(row_from, to, &pipes);
    let mut trailing_pipe = pipes.last().is_some_and(|&pipe| pipe + 1 == to);
    if !trailing_pipe
        && let (Some(&last_pipe), Some(&(start, end))) = (pipes.last(), segments.last())
        && start == last_pipe + 1
        && is_blank_line(units, start, end)
    {
        segments.pop();
        trailing_pipe = true;
    }
    SourceLine {
        from,
        to,
        row_from,
        cells: segments
            .into_iter()
            .map(|(start, end)| source_cell(units, start, end))
            .collect(),
        trailing_pipe,
    }
}

fn row_start(units: &[u16], line: usize, quote_levels: usize) -> usize {
    let end = line_end(units, line);
    let mut remaining = quote_levels;
    let mut index = line;
    loop {
        index = skip_blanks(units, index, end);
        if remaining > 0 && index < end && units[index] == QUOTE {
            remaining -= 1;
            index += 1;
        } else {
            return index;
        }
    }
}

fn starts_block(units: &[u16], from: usize, to: usize) -> bool {
    let Some(&first) = units.get(from).filter(|_| from < to) else {
        return true;
    };
    let char_at = |index: usize| {
        units
            .get(index)
            .filter(|_| index < to)
            .and_then(|&unit| char::from_u32(u32::from(unit)))
    };
    let separated = |index: usize| char_at(index).is_none_or(|c| c == ' ' || c == '\t');
    match char::from_u32(u32::from(first)).unwrap_or(' ') {
        '>' | '#' => true,
        '-' | '*' | '+' => separated(from + 1),
        '`' | '~' => char_at(from + 1) == char_at(from) && char_at(from + 2) == char_at(from),
        '0'..='9' => {
            let digits = (from..to)
                .take_while(|&index| char_at(index).is_some_and(|c| c.is_ascii_digit()))
                .count();
            matches!(char_at(from + digits), Some('.' | ')')) && separated(from + digits + 1)
        }
        _ => false,
    }
}

fn continues_table(units: &[u16], line: usize, quote_levels: usize, first_prefix: &str) -> bool {
    if line >= units.len() {
        return false;
    }
    let end = line_end(units, line);
    let row_from = row_start(units, line, quote_levels);
    if is_blank_line(units, row_from, end) || starts_block(units, row_from, end) {
        return false;
    }
    if quote_levels == 0
        && !first_prefix.is_empty()
        && slice16(units, line, row_from) != first_prefix
    {
        return false;
    }
    !pipe_positions(units, row_from, end, false).is_empty()
}

fn container_prefix(units: &[u16], lines: &[SourceLine], nested: bool) -> Option<String> {
    if !nested {
        return Some(String::new());
    }
    let prefixes: Vec<String> = lines
        .iter()
        .map(|line| slice16(units, line.from, line.row_from))
        .collect();
    let prefix = prefixes.first()?;
    if prefixes.iter().any(|other| other != prefix) {
        return None;
    }
    prefix
        .chars()
        .all(|c| matches!(c, ' ' | '\t' | '>'))
        .then(|| prefix.clone())
}

fn tables(text: &str, units: &[u16]) -> Vec<Table> {
    let document = parse(text);
    let mut tables = Vec::new();
    for node in &document.nodes {
        if node.kind != SyntaxKind::Table {
            continue;
        }
        let first_row = node.range.start.min(units.len());
        let first_line = line_start(units, first_row);
        let last_line = line_start(units, node.range.end.max(first_row).min(units.len()));
        let quote_levels = units[first_line..first_row]
            .iter()
            .filter(|&&unit| unit == QUOTE)
            .count();
        let first_prefix = slice16(units, first_line, first_row);
        let mut lines = Vec::new();
        let mut line = first_line;
        loop {
            let row_from = if line == first_line {
                first_row
            } else {
                row_start(units, line, quote_levels)
            };
            lines.push(source_line(units, row_from, lines.len() == 1));
            let following = line_end(units, line) + 1;
            if line >= last_line && !continues_table(units, following, quote_levels, &first_prefix)
            {
                break;
            }
            line = following;
        }
        let nested = document.nodes.iter().any(|other| {
            matches!(
                other.kind,
                SyntaxKind::Blockquote
                    | SyntaxKind::ListItem
                    | SyntaxKind::BulletList
                    | SyntaxKind::OrderedList
            ) && other.range.start <= node.range.start
                && node.range.end <= other.range.end
        });
        let span = lines[0].from..lines[lines.len() - 1].to;
        tables.push(Table {
            prefix: container_prefix(units, &lines, nested),
            column_count: lines[0].cells.len(),
            lines,
            span,
        });
    }
    tables
}

fn cell_at(table: &Table, position: usize) -> (usize, usize) {
    let line = table
        .lines
        .iter()
        .position(|candidate| position <= candidate.to)
        .unwrap_or(table.lines.len() - 1);
    let cells = &table.lines[line].cells;
    let column = cells
        .iter()
        .position(|cell| position <= cell.to)
        .unwrap_or(cells.len().saturating_sub(1));
    (line, column.min(table.column_count.saturating_sub(1)))
}

fn insert_block(
    units: &[u16],
    tables: &[Table],
    position: usize,
    block: &str,
    prefix: &str,
) -> Insertion {
    let separator = prefix.trim_end_matches([' ', '\t']);
    let mut at = position.min(units.len());
    let mut from = line_start(units, at);
    let mut to = line_end(units, at);
    if at == to && at != from && to < units.len() {
        let next_to = line_end(units, to + 1);
        if is_blank_line(units, to + 1, next_to) {
            at = to + 1;
            from = at;
            to = next_to;
        }
    }

    let mut before = String::new();
    if at != from {
        before.push('\n');
    }
    if at > 0 {
        let previous_from = line_start(units, at - 1);
        let previous_in_table = tables
            .iter()
            .any(|table| table.span.start <= previous_from && previous_from <= table.span.end);
        if !is_blank_line(units, previous_from, at) && previous_in_table {
            before.push_str(separator);
            before.push('\n');
        }
    }

    let after = !is_blank_line(units, at, to)
        && at == from
        && tables.iter().any(|table| table.span.start == from);

    let prefixed = prefix_lines(block, prefix);
    let mut insert = format!("{before}{prefixed}\n");
    let mut caret = at + len16(&before) + len16(&prefixed) + 1;
    if after {
        insert.push_str(separator);
        insert.push('\n');
        caret += len16(separator);
    }
    Insertion { at, insert, caret }
}

fn prefix_lines(block: &str, prefix: &str) -> String {
    if prefix.is_empty() {
        return block.to_owned();
    }
    block
        .split('\n')
        .map(|line| format!("{prefix}{line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn is_container_separator(line: &str, separator: &str) -> bool {
    let trimmed = trim_end_js(line);
    trimmed.is_empty() || (trimmed.ends_with('>') && separator.starts_with(trimmed))
}

fn closing_separator<'a>(line: &str, separator: &'a str) -> &'a str {
    let mut closing = "";
    for (index, marker) in separator.char_indices() {
        let candidate = &separator[..index + marker.len_utf8()];
        if marker == '>' && line.starts_with(candidate) {
            closing = candidate;
        }
    }
    closing
}

fn insert_block_after_table(
    units: &[u16],
    tables: &[Table],
    table_end: usize,
    block: &str,
    prefix: Option<&str>,
) -> Insertion {
    let Some(prefix) = prefix.filter(|prefix| !prefix.is_empty()) else {
        return insert_block(units, tables, table_end, block, "");
    };
    let separator = prefix.trim_end_matches([' ', '\t']);
    let head = format!("\n{separator}\n{}", prefix_lines(block, prefix));
    if table_end >= units.len() {
        let insert = format!("{head}\n");
        let caret = table_end + len16(&insert);
        return Insertion {
            at: table_end,
            insert,
            caret,
        };
    }
    let next_from = table_end + 1;
    let next = slice16(units, next_from, line_end(units, next_from));
    if is_container_separator(&next, separator) {
        let caret = table_end + len16(&head) + 1 + len16(trim_end_js(&next));
        Insertion {
            at: table_end,
            insert: head,
            caret,
        }
    } else {
        let insert = format!("{head}\n{}", closing_separator(&next, separator));
        let caret = table_end + len16(&insert);
        Insertion {
            at: table_end,
            insert,
            caret,
        }
    }
}

fn insert_inline(units: &[u16], position: usize, references: &[String]) -> Insertion {
    let joined = references.join(" ");
    let lead = position > 0 && !is_whitespace_unit(units[position - 1]);
    let trail = position < units.len() && !is_whitespace_unit(units[position]);
    let caret = position + usize::from(lead) + len16(&joined);
    Insertion {
        at: position,
        insert: format!(
            "{}{joined}{}",
            if lead { " " } else { "" },
            if trail { " " } else { "" }
        ),
        caret,
    }
}

fn inline_point(table: &Table, line: &SourceLine, line_index: usize, position: usize) -> usize {
    if line_index == 1 {
        let (_, column) = cell_at(table, position);
        return match table.lines[0].cells.get(column) {
            Some(header) if header.has_text => header.content_to,
            Some(header) => (header.from + 1).min(header.to),
            None => position,
        };
    }
    let (Some(first), Some(last)) = (line.cells.first(), line.cells.last()) else {
        return position;
    };
    let clamped = position.max(first.from).min(last.to);
    match line.cells.iter().find(|cell| clamped <= cell.to) {
        Some(cell) => clamped.max(cell.from),
        None => clamped,
    }
}

/// Inserts image references at a UTF-16 `position` the way the web and iOS clients do: as blocks
/// on their own lines, inline inside table cells, and after a table when the position is at the
/// end of its last row.
pub fn insert_image_references(
    text: &str,
    position: usize,
    references: &[String],
) -> CommandResult {
    let units: Vec<u16> = text.encode_utf16().collect();
    let at = position.min(units.len());
    let block = references.join("\n");
    let tables = tables(text, &units);
    let insertion = insert_at(&units, &tables, at, &block, references);
    CommandResult {
        edits: vec![TextEdit::new(insertion.at, insertion.at, insertion.insert)],
        selection: TextSelection::new(insertion.caret, 0),
    }
}

fn insert_at(
    units: &[u16],
    tables: &[Table],
    at: usize,
    block: &str,
    references: &[String],
) -> Insertion {
    let Some(table) = tables
        .iter()
        .find(|table| table.span.start <= at && at <= table.span.end)
    else {
        return insert_block(units, tables, at, block, "");
    };
    let after =
        |end: usize| insert_block_after_table(units, tables, end, block, table.prefix.as_deref());

    let (line_index, _) = cell_at(table, at);
    let line = &table.lines[line_index];
    let is_last = line_index == table.lines.len() - 1;
    if line_index == 0 && at <= line.row_from {
        return insert_block(
            units,
            tables,
            line.from,
            block,
            table.prefix.as_deref().unwrap_or(""),
        );
    }
    let Some(last_cell) = line.cells.last() else {
        if is_last && at > line.row_from {
            return after(line.to);
        }
        let point = at.max(line.row_from).min(line.to);
        return insert_inline(units, point, references);
    };
    if is_last && line.trailing_pipe && at > last_cell.to {
        return after(line.to);
    }
    insert_inline(units, inline_point(table, line, line_index, at), references)
}
