use std::ops::Range;

use crate::paragraph::{ParagraphContext, interrupts_paragraph};
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
        let mut tables = Vec::new();
        for node in self
            .nodes
            .iter()
            .filter(|node| node.kind == SyntaxKind::Table)
        {
            let containers = self.containers(&node.range);
            let table = self.read_table(node.range.start, &containers);
            let paragraph_start = self.paragraph_start(node.range.start, &tables);
            if forms_table(units, &table, &containers, paragraph_start) {
                tables.push(table);
            }
        }
        tables
    }

    /// Where the paragraph holding the line at `from` starts. pulldown-cmark lets a table
    /// interrupt any paragraph, so this follows its paragraph nodes back across those splits,
    /// staying in the container around `from` or reaching out of it lazily; it stops at a table,
    /// whose header always starts with a pipe line.
    fn paragraph_start(&self, from: usize, tables: &[MarkdownTable]) -> usize {
        let mut start = from;
        loop {
            let line = self.line_index_containing(start);
            if line == 0 {
                return start;
            }
            let previous = self.line_range(line - 1);
            let container_start = self.innermost_container_start(start);
            let continued = |range: &Range<usize>| {
                container_start <= range.start
                    && range.start <= previous.end
                    && previous.start <= range.end
            };
            if let Some(table) = tables.iter().rev().find(|table| continued(&table.range)) {
                return table.header().row_start;
            }
            let Some(block) = self.nodes.iter().rev().find(|node| {
                matches!(
                    node.kind,
                    SyntaxKind::Paragraph | SyntaxKind::Task | SyntaxKind::Table
                ) && continued(&node.range)
            }) else {
                return start;
            };
            if block.kind == SyntaxKind::Table {
                return block.range.start;
            }
            start = block.range.start;
        }
    }

    fn innermost_container_start(&self, position: usize) -> usize {
        self.nodes
            .iter()
            .rev()
            .find(|node| {
                matches!(node.kind, SyntaxKind::Blockquote | SyntaxKind::ListItem)
                    && node.range.start <= position
                    && position <= node.range.end
            })
            .map_or(0, |node| node.range.start)
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

    /// Reads the table from its header through the delimiter line, then on to where lezer ends the
    /// paragraph, which can be before or after the end of pulldown-cmark's table node.
    fn read_table(&self, header: usize, containers: &[Container]) -> MarkdownTable {
        let units = self.units();
        let first_row = header.min(units.len());
        let first_line = line_start(units, first_row);
        let quote_levels = units[first_line..first_row]
            .iter()
            .filter(|&&unit| unit == QUOTE)
            .count();
        let mut lines = vec![source_line(units, first_row, false)];
        let mut line = first_line;
        loop {
            let following = line_end(units, line) + 1;
            if following > units.len()
                || (lines.len() > 1 && !continues_table(units, following, containers))
            {
                break;
            }
            line = following;
            lines.push(source_line(
                units,
                row_start(units, line, quote_levels),
                lines.len() == 1,
            ));
        }
        let column_count = lines[0].cells.len();
        MarkdownTable {
            range: lines[0].range.start..lines[lines.len() - 1].range.end,
            container_prefix: container_prefix(units, &lines, !containers.is_empty()),
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

fn forms_table(
    units: &[u16],
    table: &MarkdownTable,
    containers: &[Container],
    paragraph_start: usize,
) -> bool {
    let header = row_text(units, table.header());
    let delimiter = row_text(units, table.delimiter());
    !continues_pipe_paragraph(units, table, paragraph_start)
        && !starts_with_list_marker(units, table.delimiter())
        && is_delimiter_row(delimiter)
        && row_cell_count(header) == row_cell_count(delimiter)
        && !becomes_setext_heading(units, table, containers)
}

/// A table can only start the paragraph it is in when that paragraph's first line has an
/// unescaped pipe, even one inside a code span; the rest of such a paragraph is never a table.
fn continues_pipe_paragraph(units: &[u16], table: &MarkdownTable, paragraph_start: usize) -> bool {
    paragraph_start < table.header().row_start
        && !pipe_positions(
            units,
            paragraph_start,
            line_end(units, paragraph_start),
            false,
        )
        .is_empty()
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
    let matched = match_containers(units, line, containers);
    if !matched.complete {
        return false;
    }
    let (base, base_column) = (matched.position, matched.base_column);
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

/// How far a line continues the containers around a table, outermost first.
struct ContainerMatch {
    /// Where the line goes on after the markup of the containers it continues.
    position: usize,
    /// The column the innermost continued container measures indentation from.
    base_column: usize,
    /// Whether the line continues every container rather than leaving one, lazily or not.
    complete: bool,
}

fn match_containers(units: &[u16], line: usize, containers: &[Container]) -> ContainerMatch {
    let end = line_end(units, line);
    let mut position = line;
    let mut base_column = 0;
    let left = |position, base_column| ContainerMatch {
        position,
        base_column,
        complete: false,
    };
    for container in containers {
        match *container {
            Container::Quote => {
                let mark = skip_spaces(units, position, end);
                if units[..end].get(mark) != Some(&QUOTE) {
                    return left(position, base_column);
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
                    return left(position, base_column);
                }
                base_column = target;
                position = find_column(units, line, end, target);
            }
            Container::List { .. } => {}
        }
    }
    ContainerMatch {
        position,
        base_column,
        complete: true,
    }
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

/// A following line continues the table, lazily too, until a blank line or a line that
/// interrupts the paragraph; a line indented four or more columns cannot interrupt it.
fn continues_table(units: &[u16], line: usize, containers: &[Container]) -> bool {
    let end = line_end(units, line);
    let matched = match_containers(units, line, containers);
    let content = skip_spaces(units, matched.position, end);
    if content == end {
        return false;
    }
    let context = ParagraphContext {
        in_bullet_list: containers.contains(&Container::List { bullet: true }),
        in_ordered_list: containers.contains(&Container::List { bullet: false }),
        continues_containers: matched.complete,
    };
    column(units, line, content) >= matched.base_column + 4
        || !interrupts_paragraph(units, content, end, context)
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
