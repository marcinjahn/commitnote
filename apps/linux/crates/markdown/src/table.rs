use std::ops::Range;

use crate::scanners::{
    column, find_column, is_blank_line, is_blank_unit, is_space_unit, is_whitespace_unit, line_end,
    line_start, skip_blanks, skip_spaces, slice16,
};
use crate::syntax::{MarkdownDocument, SyntaxKind};

const PIPE: u16 = b'|' as u16;
const BACKSLASH: u16 = b'\\' as u16;
const QUOTE: u16 = b'>' as u16;
const COLON: u16 = b':' as u16;
const DASH: u16 = b'-' as u16;
const EQUALS: u16 = b'=' as u16;

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
            .filter_map(|node| {
                let containers = self.containers(&node.range);
                let table = self.read_table(node.range.clone(), !containers.is_empty());
                forms_table(units, &table, &containers).then_some(table)
            })
            .collect()
    }

    /// The containers around `range`, outermost first.
    fn containers(&self, range: &Range<usize>) -> Vec<Container> {
        self.nodes
            .iter()
            .filter(|node| node.range.start <= range.start && range.end <= node.range.end)
            .filter_map(|node| match node.kind {
                SyntaxKind::Blockquote => Some(Container::Quote),
                SyntaxKind::BulletList => Some(Container::List { bullet: true }),
                SyntaxKind::OrderedList => Some(Container::List { bullet: false }),
                SyntaxKind::ListItem => Some(Container::Item {
                    content_offset: self.list_item_content_offset(&node.range),
                }),
                _ => None,
            })
            .collect()
    }

    /// How many columns past its base column a list item's content starts.
    fn list_item_content_offset(&self, item: &Range<usize>) -> usize {
        let units = self.units();
        let line = line_start(units, item.start);
        let end = line_end(units, item.start);
        let marker_end = self
            .nodes
            .iter()
            .filter(|node| {
                node.kind == SyntaxKind::ListMark && (item.start..end).contains(&node.range.start)
            })
            .min_by_key(|mark| mark.range.start)
            .map_or(item.start, |mark| mark.range.end);
        let after_marker = column(units, line, marker_end);
        let content = skip_spaces(units, marker_end, end);
        let content_column = column(units, line, content);
        let content_start = if content == end || content_column >= after_marker + 5 {
            after_marker + 1
        } else {
            content_column
        };
        content_start - column(units, line, item.start)
    }

    fn read_table(&self, node: Range<usize>, nested: bool) -> MarkdownTable {
        let units = self.units();
        let first_row = node.start.min(units.len());
        let first_line = line_start(units, first_row);
        let last_line = line_start(units, node.end.max(first_row).min(units.len()));
        let quote_levels = units[first_line..first_row]
            .iter()
            .filter(|&&unit| unit == QUOTE)
            .count();
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
            if line >= last_line && !continues_table(units, following, quote_levels) {
                break;
            }
            line = following;
        }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Container {
    Quote,
    List { bullet: bool },
    Item { content_offset: usize },
}

fn forms_table(units: &[u16], table: &MarkdownTable, containers: &[Container]) -> bool {
    let header = row_text(units, table.header());
    let delimiter = row_text(units, table.delimiter());
    !starts_with_list_marker(units, table.delimiter())
        && is_delimiter_row(delimiter)
        && row_cell_count(header) == row_cell_count(delimiter)
        && !becomes_setext_heading(units, table, containers)
}

/// The row as the line holds it after the container prefix, a trailing `\r` included.
fn row_text<'a>(units: &'a [u16], line: &MarkdownTableLine) -> &'a [u16] {
    &units[line.row_start..line.range.end]
}

fn starts_with_list_marker(units: &[u16], line: &MarkdownTableLine) -> bool {
    let at = line.row_start;
    at + 1 < line.range.end && units[at] == DASH && is_blank_unit(units[at + 1])
}

/// `|? (cell |)+ cell?` over the whole row, where a cell is `\s* :? -+ :? \s*`.
fn is_delimiter_row(row: &[u16]) -> bool {
    if !matches!(row.first(), Some(&(DASH | COLON | PIPE))) {
        return false;
    }
    let mut index = usize::from(row[0] == PIPE);
    let mut closed_cells = 0;
    while let Some(cell_end) = delimiter_cell_end(row, index) {
        match row.get(cell_end) {
            None => return closed_cells > 0,
            Some(&PIPE) => {
                closed_cells += 1;
                index = cell_end + 1;
                if index == row.len() {
                    return true;
                }
            }
            Some(_) => return false,
        }
    }
    false
}

fn delimiter_cell_end(row: &[u16], from: usize) -> Option<usize> {
    let skip = |from: usize, accepts: fn(u16) -> bool| {
        from + row[from..]
            .iter()
            .take_while(|&&unit| accepts(unit))
            .count()
    };
    let colon = |at: usize| at + usize::from(row.get(at) == Some(&COLON));
    let dashes = colon(skip(from, is_whitespace_unit));
    let dashes_end = skip(dashes, |unit| unit == DASH);
    (dashes_end > dashes).then(|| skip(colon(dashes_end), is_whitespace_unit))
}

/// The cells of a row: every unescaped pipe closes one, unless it is a leading pipe, and content
/// after the last pipe adds one. Only spaces and tabs are blank.
fn row_cell_count(row: &[u16]) -> usize {
    let mut count = 0;
    let mut leading = true;
    let mut in_cell = false;
    let mut escaped = false;
    for &unit in row {
        if unit == PIPE && !escaped {
            if !leading || in_cell {
                count += 1;
            }
            leading = false;
            in_cell = false;
        } else if escaped || !is_blank_unit(unit) {
            in_cell = true;
        }
        escaped = !escaped && unit == BACKSLASH;
    }
    count + usize::from(in_cell)
}

/// Whether a body row or the line after the table underlines the block as a setext heading.
fn becomes_setext_heading(units: &[u16], table: &MarkdownTable, containers: &[Container]) -> bool {
    let following = (table.range.end < units.len()).then_some(table.range.end + 1);
    table
        .rows()
        .iter()
        .map(|row| row.range.start)
        .chain(following)
        .any(|line| is_setext_underline(units, line, containers))
}

/// Only a line that continues every container can underline the block; a lone `-` inside a
/// bullet list starts an item instead.
fn is_setext_underline(units: &[u16], line: usize, containers: &[Container]) -> bool {
    let Some((base, base_column)) = container_content(units, line, containers) else {
        return false;
    };
    let end = line_end(units, line);
    let start = skip_spaces(units, base, end);
    let Some(&marker) = units[..end].get(start) else {
        return false;
    };
    if !matches!(marker, DASH | EQUALS) || column(units, line, start) >= base_column + 4 {
        return false;
    }
    let run = units[start..end]
        .iter()
        .take_while(|&&unit| unit == marker)
        .count();
    let starts_bullet_item =
        marker == DASH && run == 1 && containers.contains(&Container::List { bullet: true });
    let only_spaces_after = units[start + run..end]
        .iter()
        .all(|&unit| is_space_unit(unit));
    only_spaces_after && !starts_bullet_item
}

/// Where `line`'s content starts once it has continued every container, with the column the
/// innermost container measures indentation from; `None` when the line leaves a container.
fn container_content(
    units: &[u16],
    line: usize,
    containers: &[Container],
) -> Option<(usize, usize)> {
    let end = line_end(units, line);
    let mut position = line;
    let mut base_column = 0;
    for container in containers {
        match *container {
            Container::Quote => {
                let mark = skip_spaces(units, position, end);
                if units[..end].get(mark) != Some(&QUOTE) {
                    return None;
                }
                position = mark + 1;
                if units[..end]
                    .get(position)
                    .is_some_and(|&unit| is_space_unit(unit))
                {
                    position += 1;
                }
                base_column = column(units, line, position);
            }
            Container::Item { content_offset } => {
                let target = base_column + content_offset;
                let content = skip_spaces(units, position, end);
                if content < end && column(units, line, content) < target {
                    return None;
                }
                base_column = target;
                position = find_column(units, line, end, target);
            }
            Container::List { .. } => {}
        }
    }
    Some((position, base_column))
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

/// A following pipe line continues the table, lazily too, unless it is blank or starts a block.
fn continues_table(units: &[u16], line: usize, quote_levels: usize) -> bool {
    if line >= units.len() {
        return false;
    }
    let end = line_end(units, line);
    let row_from = row_start(units, line, quote_levels);
    if is_blank_line(units, row_from, end) || starts_block(units, row_from, end) {
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
