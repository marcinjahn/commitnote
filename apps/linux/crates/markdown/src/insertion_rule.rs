use commitnote_editor_text::{TextEdit, TextSelection};

use crate::commands::CommandResult;
use crate::parse;
use crate::scanners::{
    is_blank_line, is_whitespace, is_whitespace_unit, line_end, line_start, slice16,
};
use crate::table::{MarkdownTable, MarkdownTableLine};

struct Insertion {
    at: usize,
    insert: String,
    caret: usize,
}

fn len16(text: &str) -> usize {
    text.encode_utf16().count()
}

fn trim_end_js(text: &str) -> &str {
    text.trim_end_matches(|c: char| i32::try_from(u32::from(c)).is_ok_and(is_whitespace))
}

fn insert_block(
    units: &[u16],
    tables: &[MarkdownTable],
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
            .any(|table| table.range.start <= previous_from && previous_from <= table.range.end);
        if !is_blank_line(units, previous_from, at) && previous_in_table {
            before.push_str(separator);
            before.push('\n');
        }
    }

    let after = !is_blank_line(units, at, to)
        && at == from
        && tables.iter().any(|table| table.range.start == from);

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
    tables: &[MarkdownTable],
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

fn inline_point(
    table: &MarkdownTable,
    line: &MarkdownTableLine,
    line_index: usize,
    position: usize,
) -> usize {
    if line_index == 1 {
        let (_, column) = table.cell_at(position);
        return match table.header().cells.get(column) {
            Some(header) if !header.content_range.is_empty() => header.content_range.end,
            Some(header) => (header.range.start + 1).min(header.range.end),
            None => position,
        };
    }
    let (Some(first), Some(last)) = (line.cells.first(), line.cells.last()) else {
        return position;
    };
    let clamped = position.max(first.range.start).min(last.range.end);
    match line.cells.iter().find(|cell| clamped <= cell.range.end) {
        Some(cell) => clamped.max(cell.range.start),
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
    let document = parse(text);
    let units = document.units();
    let at = position.min(units.len());
    let block = references.join("\n");
    let tables = document.tables();
    let insertion = insert_at(units, &tables, at, &block, references);
    CommandResult {
        edits: vec![TextEdit::new(insertion.at, insertion.at, insertion.insert)],
        selection: TextSelection::new(insertion.caret, 0),
    }
}

fn insert_at(
    units: &[u16],
    tables: &[MarkdownTable],
    at: usize,
    block: &str,
    references: &[String],
) -> Insertion {
    let Some(table) = tables
        .iter()
        .find(|table| table.range.start <= at && at <= table.range.end)
    else {
        return insert_block(units, tables, at, block, "");
    };
    let after = |end: usize| {
        insert_block_after_table(units, tables, end, block, table.container_prefix.as_deref())
    };

    let (line_index, _) = table.cell_at(at);
    let line = &table.lines[line_index];
    let is_last = line_index == table.lines.len() - 1;
    if line_index == 0 && at <= line.row_start {
        return insert_block(
            units,
            tables,
            line.range.start,
            block,
            table.container_prefix.as_deref().unwrap_or(""),
        );
    }
    let Some(last_cell) = line.cells.last() else {
        if is_last && at > line.row_start {
            return after(line.range.end);
        }
        let point = at.max(line.row_start).min(line.range.end);
        return insert_inline(units, point, references);
    };
    if is_last && line.trailing_pipe && at > last_cell.range.end {
        return after(line.range.end);
    }
    insert_inline(units, inline_point(table, line, line_index, at), references)
}
