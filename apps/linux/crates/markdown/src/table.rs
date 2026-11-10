use std::ops::Range;

use crate::scanners::{is_blank_line, is_blank_unit, line_end, line_start, skip_blanks, slice16};
use crate::syntax::{MarkdownDocument, SyntaxKind};

const PIPE: u16 = b'|' as u16;
const BACKSLASH: u16 = b'\\' as u16;
const QUOTE: u16 = b'>' as u16;
const COLON: u16 = b':' as u16;
const DASH: u16 = b'-' as u16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum TableAlignment {
    #[default]
    Unspecified,
    Left,
    Center,
    Right,
}

/// Ranges are in UTF-16 code units.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkdownTableCell {
    pub range: Range<usize>,
    /// `range` without leading and trailing spaces and tabs; empty at `range.start` for a blank cell.
    pub content_range: Range<usize>,
}

/// Ranges and offsets are in UTF-16 code units.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkdownTableLine {
    /// The whole line, container prefix included, line break excluded.
    pub range: Range<usize>,
    /// Where the row starts after the container prefix.
    pub row_start: usize,
    pub cells: Vec<MarkdownTableCell>,
    pub trailing_pipe: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkdownTable {
    /// From the header line's start to the last line's end, in UTF-16 code units.
    pub range: Range<usize>,
    /// Repeated on every line: empty at top level, `None` when the line prefixes are irregular.
    pub container_prefix: Option<String>,
    pub column_count: usize,
    pub alignments: Vec<TableAlignment>,
    pub lines: Vec<MarkdownTableLine>,
}

impl MarkdownTable {
    pub fn header(&self) -> &MarkdownTableLine {
        &self.lines[0]
    }

    pub fn delimiter(&self) -> &MarkdownTableLine {
        &self.lines[1]
    }

    pub fn rows(&self) -> &[MarkdownTableLine] {
        &self.lines[2..]
    }

    /// The (line index, column) at a UTF-16 `position`, clamped to the last line and column.
    pub fn cell_at(&self, position: usize) -> (usize, usize) {
        let line = self
            .lines
            .iter()
            .position(|candidate| position <= candidate.range.end)
            .unwrap_or(self.lines.len() - 1);
        let cells = &self.lines[line].cells;
        let column = cells
            .iter()
            .position(|cell| position <= cell.range.end)
            .unwrap_or(cells.len().saturating_sub(1));
        (line, column.min(self.column_count.saturating_sub(1)))
    }

    /// The line index of a display row, which counts the header and body rows but not the
    /// delimiter; clamped to the last line.
    pub fn line_for_row(&self, row: usize) -> usize {
        let line = if row == 0 { 0 } else { row + 1 };
        line.min(self.lines.len() - 1)
    }
}

impl MarkdownDocument {
    /// The tables in document order.
    pub fn tables(&self) -> Vec<MarkdownTable> {
        let units = self.units();
        self.nodes
            .iter()
            .filter(|node| node.kind == SyntaxKind::Table)
            .map(|node| self.read_table(node.range.clone()))
            .filter(|table| !starts_with_list_marker(units, table.delimiter()))
            .collect()
    }

    fn read_table(&self, node: Range<usize>) -> MarkdownTable {
        let units = self.units();
        let first_row = node.start.min(units.len());
        let first_line = line_start(units, first_row);
        let last_line = line_start(units, node.end.max(first_row).min(units.len()));
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
        let nested = self.nodes.iter().any(|other| {
            matches!(
                other.kind,
                SyntaxKind::Blockquote
                    | SyntaxKind::ListItem
                    | SyntaxKind::BulletList
                    | SyntaxKind::OrderedList
            ) && other.range.start <= node.start
                && node.end <= other.range.end
        });
        let column_count = lines[0].cells.len();
        MarkdownTable {
            range: lines[0].range.start..lines[lines.len() - 1].range.end,
            container_prefix: container_prefix(units, &lines, nested),
            column_count,
            alignments: alignments(units, &lines[1], column_count),
            lines,
        }
    }
}

fn starts_with_list_marker(units: &[u16], line: &MarkdownTableLine) -> bool {
    let at = line.row_start;
    at + 1 < line.range.end && units[at] == DASH && is_blank_unit(units[at + 1])
}

fn alignments(
    units: &[u16],
    delimiter: &MarkdownTableLine,
    column_count: usize,
) -> Vec<TableAlignment> {
    let mut alignments: Vec<TableAlignment> = delimiter
        .cells
        .iter()
        .map(|cell| alignment(&units[cell.content_range.clone()]))
        .collect();
    alignments.resize(column_count, TableAlignment::Unspecified);
    alignments
}

fn alignment(content: &[u16]) -> TableAlignment {
    match (
        content.first() == Some(&COLON),
        content.last() == Some(&COLON),
    ) {
        (true, true) => TableAlignment::Center,
        (false, true) => TableAlignment::Right,
        (true, false) => TableAlignment::Left,
        (false, false) => TableAlignment::Unspecified,
    }
}

fn source_cell(units: &[u16], from: usize, to: usize) -> MarkdownTableCell {
    let mut content_to = to;
    while content_to > from && is_blank_unit(units[content_to - 1]) {
        content_to -= 1;
    }
    MarkdownTableCell {
        range: from..to,
        content_range: skip_blanks(units, from, content_to)..content_to,
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

fn source_line(units: &[u16], row_from: usize, delimiter_row: bool) -> MarkdownTableLine {
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
    MarkdownTableLine {
        range: from..to,
        row_start: row_from,
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

fn container_prefix(units: &[u16], lines: &[MarkdownTableLine], nested: bool) -> Option<String> {
    if !nested {
        return Some(String::new());
    }
    let prefixes: Vec<String> = lines
        .iter()
        .map(|line| slice16(units, line.range.start, line.row_start))
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
