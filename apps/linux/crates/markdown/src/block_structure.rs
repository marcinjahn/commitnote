mod html_block;
mod link_reference;
mod table_row;

use crate::scanners::{column, find_column, is_space_unit, line_end, skip_spaces};
use html_block::HtmlBlockEnd;
use link_reference::{LinkReference, ReferenceProgress};
use table_row::{has_pipe, is_delimiter_line};
pub(crate) use table_row::{is_delimiter_row, row_cell_count};

const HASH: u16 = b'#' as u16;
const BACKTICK: u16 = b'`' as u16;
const TILDE: u16 = b'~' as u16;
const QUOTE: u16 = b'>' as u16;
const DASH: u16 = b'-' as u16;
const PLUS: u16 = b'+' as u16;
const STAR: u16 = b'*' as u16;
const UNDERSCORE: u16 = b'_' as u16;
const EQUALS: u16 = b'=' as u16;
const DOT: u16 = b'.' as u16;
const CLOSE_PAREN: u16 = b')' as u16;
const ONE: u16 = b'1' as u16;
const SPACE: u16 = b' ' as u16;

/// A block that holds other blocks, as lezer's markdown parser stacks them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Container {
    Quote,
    /// A list, by the unit its item markers end with: the bullet, or the `.` or `)` after a number.
    List {
        marker: u16,
    },
    /// A list item, by how many columns past the base column of its marker line its content starts.
    Item {
        content_offset: usize,
    },
}

impl Container {
    fn is_bullet_list(&self) -> bool {
        matches!(*self, Self::List { marker } if is_bullet_marker(marker))
    }

    fn is_ordered_list(&self) -> bool {
        matches!(*self, Self::List { marker } if !is_bullet_marker(marker))
    }

    /// Whether an item whose marker ends with `marker` goes on in this list rather than starting
    /// another one.
    fn holds_items_like(&self, marker: u16) -> bool {
        matches!(*self, Self::List { marker: list } if is_bullet_marker(list) == is_bullet_marker(marker))
    }
}

fn is_bullet_marker(unit: u16) -> bool {
    matches!(unit, DASH | PLUS | STAR)
}

/// A line read against a stack of containers, as lezer's `readLine` leaves its `Line`.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ContainerMatch {
    line: usize,
    end: usize,
    /// How many containers, outermost first, the line continues.
    depth: usize,
    /// Where the markup of the continued containers ends.
    base: usize,
    base_column: usize,
    /// The first position at or past `base` that is not a space, tab or line break.
    content: usize,
}

impl ContainerMatch {
    fn start(units: &[u16], line: usize) -> Self {
        let end = line_end(units, line);
        Self {
            line,
            end,
            depth: 0,
            base: line,
            base_column: 0,
            content: skip_spaces(units, line, end),
        }
    }

    fn is_blank(&self) -> bool {
        self.content == self.end
    }

    /// Where the line's text starts after the markup of the containers it continues, as lezer's
    /// `Line.pos` leaves it.
    pub(crate) fn text_start(&self) -> usize {
        self.content
    }

    /// Whether the line continues every container rather than leaving one, lazily or not.
    pub(crate) fn continues_all(&self, containers: &[Container]) -> bool {
        self.depth == containers.len()
    }

    /// Indented four or more columns past the base column: indented code, which neither interrupts
    /// nor underlines a paragraph.
    fn is_code_indented(&self, units: &[u16]) -> bool {
        self.indent(units) >= self.base_column + 4
    }

    fn indent(&self, units: &[u16]) -> usize {
        column(units, self.line, self.content)
    }

    fn text<'a>(&self, units: &'a [u16]) -> &'a [u16] {
        &units[self.content..self.end]
    }

    /// The line as lezer's `scrub` adds it to a paragraph's text: the number of spaces that stand
    /// for the container markup, and the rest of the line. Outside every container that is the
    /// whole line.
    fn scrub<'a>(&self, units: &'a [u16]) -> (usize, &'a [u16]) {
        if self.base_column == 0 {
            (0, &units[self.line..self.end])
        } else {
            (self.base - self.line, &units[self.base..self.end])
        }
    }

    fn move_base(&mut self, units: &[u16], to: usize) {
        self.base = to;
        self.base_column = column(units, self.line, to);
    }

    fn move_base_column(&mut self, units: &[u16], goal: usize) {
        self.base_column = goal;
        self.base = find_column(units, self.line, self.end, goal);
    }

    fn forward(&mut self, units: &[u16]) {
        if self.base > self.content {
            self.content = skip_spaces(units, self.base, self.end);
        }
    }

    /// lezer's `Blockquote` markup skipping.
    fn skip_quote_mark(&mut self, units: &[u16]) -> bool {
        if self.text(units).first() != Some(&QUOTE) {
            return false;
        }
        let spaced = units[..self.end]
            .get(self.content + 1)
            .is_some_and(|&unit| is_space_unit(unit));
        self.move_base(units, self.content + 1 + usize::from(spaced));
        true
    }

    /// lezer's `ListItem` markup skipping.
    fn skip_item_indent(&mut self, units: &[u16], content_offset: usize) -> bool {
        let goal = self.base_column + content_offset;
        if !self.is_blank() && self.indent(units) < goal {
            return false;
        }
        self.move_base_column(units, goal);
        true
    }

    /// lezer's `skipForList`: whether the line stays in a list, given the list's `item` when it
    /// has one open.
    fn continues_list(&self, units: &[u16], marker: u16, item: Option<&Container>) -> bool {
        if self.is_blank() {
            return true;
        }
        let indent = self.indent(units);
        if let Some(&Container::Item { content_offset }) = item
            && indent >= self.base_column + content_offset
        {
            return true;
        }
        if indent >= self.base_column + 4 {
            return false;
        }
        let text = self.text(units);
        let size = if is_bullet_marker(marker) {
            bullet_item_size(text, None).filter(|_| !is_thematic_break(text, None))
        } else {
            ordered_item_size(text, None)
        };
        size.is_some_and(|size| text[size - 1] == marker)
    }

    /// lezer's `getListIndent`: the column a list item's content starts at, for a marker ending
    /// at `marker_end`.
    fn list_content_column(&self, units: &[u16], marker_end: usize) -> usize {
        let after_marker = column(units, self.line, marker_end);
        let content = skip_spaces(units, marker_end, self.end);
        let content_column = column(units, self.line, content);
        if content_column >= after_marker + 5 || content == self.end {
            after_marker + 1
        } else {
            content_column
        }
    }
}

/// lezer's `readLine`: how far the line at `line` continues `containers`, outermost first.
pub(crate) fn match_containers(
    units: &[u16],
    line: usize,
    containers: &[Container],
) -> ContainerMatch {
    let mut matched = ContainerMatch::start(units, line);
    for (index, container) in containers.iter().enumerate() {
        let continued = match *container {
            Container::Quote => matched.skip_quote_mark(units),
            Container::List { marker } => {
                matched.continues_list(units, marker, containers.get(index + 1))
            }
            Container::Item { content_offset } => matched.skip_item_indent(units, content_offset),
        };
        matched.forward(units);
        if !continued {
            break;
        }
        matched.depth += 1;
    }
    matched
}

/// Whether a line after a paragraph line goes on with the paragraph, lazily too, rather than
/// being blank or starting another block, as lezer's `DefaultEndLeaf` decides it.
pub(crate) fn continues_paragraph(
    units: &[u16],
    line: &ContainerMatch,
    containers: &[Container],
) -> bool {
    !line.is_blank()
        && (line.is_code_indented(units) || !interrupts_paragraph(units, line, containers))
}

/// lezer's `isSetextUnderline`. Only a paragraph line that continues every container can
/// underline the paragraph.
pub(crate) fn is_setext_underline(units: &[u16], line: &ContainerMatch) -> bool {
    let text = line.text(units);
    let Some(&marker) = text.first().filter(|&&unit| unit == DASH || unit == EQUALS) else {
        return false;
    };
    let run = run_length(text, 0, marker);
    !line.is_code_indented(units) && text[run..].iter().all(|&unit| is_space_unit(unit))
}

/// The open paragraph a block start would interrupt, which decides whether it may.
#[derive(Debug, Clone, Copy)]
struct ParagraphContext {
    in_bullet_list: bool,
    in_ordered_list: bool,
    /// The line continues every container, so a dash underline makes a setext heading rather
    /// than a thematic break.
    continues_containers: bool,
}

fn interrupts_paragraph(units: &[u16], line: &ContainerMatch, containers: &[Container]) -> bool {
    let text = line.text(units);
    let paragraph = Some(ParagraphContext {
        in_bullet_list: containers.iter().any(Container::is_bullet_list),
        in_ordered_list: containers.iter().any(Container::is_ordered_list),
        continues_containers: line.continues_all(containers),
    });
    is_atx_heading(text)
        || code_fence_length(text).is_some()
        || text.first() == Some(&QUOTE)
        || bullet_item_size(text, paragraph).is_some()
        || ordered_item_size(text, paragraph).is_some()
        || is_thematic_break(text, paragraph)
        || HtmlBlockEnd::starting(text, true).is_some()
}

/// lezer's Table `endLeaf`: whether a line of a paragraph that has no table ends it to start
/// one, the delimiter line after it having as many cells as the line from its base on.
fn starts_table(units: &[u16], line: &ContainerMatch) -> bool {
    let row = &units[line.base..line.end];
    if !has_pipe(row) {
        return false;
    }
    let next = if line.end < units.len() {
        &units[line.end + 1..line_end(units, line.end + 1)]
    } else {
        &[]
    };
    let next_row = &next[(line.base - line.line).min(next.len())..];
    is_delimiter_line(next) && row_cell_count(row) == row_cell_count(next_row)
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

// The block start rules below read a line's content from its first non-space unit on. Where
// they take an `interrupting` paragraph, `None` asks whether the block starts at all and
// `Some` whether it interrupts that paragraph, like the `breaking` flag of lezer's rules.

fn is_atx_heading(line: &[u16]) -> bool {
    if line.first() != Some(&HASH) {
        return false;
    }
    let size = run_length(line, 0, HASH);
    size <= 6 && line.get(size).is_none_or(|&unit| is_space_unit(unit))
}

/// lezer's `isFencedCode`: the length of the opening fence.
fn code_fence_length(line: &[u16]) -> Option<usize> {
    let &marker = line
        .first()
        .filter(|&&unit| unit == BACKTICK || unit == TILDE)?;
    let size = run_length(line, 0, marker);
    (size >= 3 && (marker == TILDE || !line[size..].contains(&BACKTICK))).then_some(size)
}

/// lezer's `isBulletList`: the marker's length.
fn bullet_item_size(line: &[u16], interrupting: Option<ParagraphContext>) -> Option<usize> {
    let starts = line.first().is_some_and(|&unit| is_bullet_marker(unit))
        && (line.len() == 1 || is_space_at(line, 1))
        && interrupting
            .is_none_or(|paragraph| paragraph.in_bullet_list || has_content_from(line, 2));
    starts.then_some(1)
}

/// lezer's `isOrderedList`: the marker's length. Outside an ordered list only a non-empty item
/// numbered `1` interrupts a paragraph.
fn ordered_item_size(line: &[u16], interrupting: Option<ParagraphContext>) -> Option<usize> {
    let digits = line
        .iter()
        .take_while(|&&unit| is_ascii(unit, u8::is_ascii_digit))
        .count();
    if digits == 0 || digits > 9 || !matches!(line.get(digits), Some(&(DOT | CLOSE_PAREN))) {
        return None;
    }
    let after = digits + 1;
    if after < line.len() && !is_space_at(line, after) {
        return None;
    }
    let starts = interrupting.is_none_or(|paragraph| {
        paragraph.in_ordered_list
            || (digits == 1 && line[0] == ONE && has_content_from(line, after))
    });
    starts.then_some(after)
}

fn is_thematic_break(line: &[u16], interrupting: Option<ParagraphContext>) -> bool {
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
    if setext_underline && interrupting.is_some_and(|paragraph| paragraph.continues_containers) {
        return false;
    }
    line.iter().filter(|&&unit| unit == marker).count() >= 3
}

/// A line of a paragraph, the leaf block lezer's markdown parser starts tables in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ParagraphLine {
    /// The containers around the paragraph, outermost first.
    pub containers: Vec<Container>,
    pub paragraph_start: usize,
    /// Where the paragraph's text on this line starts, after the container markup.
    pub text_start: usize,
}

/// For each of the ascending line starts in `lines`, the paragraph it is a line of, if any. The
/// document's blocks are read once, as lezer's markdown parser reads them, up to the last of
/// those lines.
pub(crate) fn paragraph_lines(units: &[u16], lines: &[usize]) -> Vec<Option<ParagraphLine>> {
    let mut walk = BlockWalk {
        units,
        stack: Vec::new(),
        line: match_containers(units, 0, &[]),
        targets: lines,
        found: Vec::with_capacity(lines.len()),
        at_end: false,
    };
    while walk.found.len() < lines.len() && !walk.at_end {
        walk.advance();
    }
    let mut found = walk.found;
    found.resize(lines.len(), None);
    found
}

#[derive(Debug, Clone, Copy)]
enum LineRole {
    Block,
    Paragraph { start: usize },
}

enum BlockStart {
    Container,
    Leaf,
}

/// lezer's `BlockContext`, keeping of the blocks only what `paragraph_lines` reports.
struct BlockWalk<'a> {
    units: &'a [u16],
    stack: Vec<Container>,
    line: ContainerMatch,
    targets: &'a [usize],
    found: Vec<Option<ParagraphLine>>,
    at_end: bool,
}

impl BlockWalk<'_> {
    /// lezer's `nextLine`, recording first the role of the line it leaves when that line is the
    /// next of the targets. Returns false at the end of the document.
    fn consume(&mut self, role: LineRole) -> bool {
        if self.at_end {
            return false;
        }
        if self.targets.get(self.found.len()) == Some(&self.line.line) {
            self.found.push(match role {
                LineRole::Block => None,
                LineRole::Paragraph { start } => Some(ParagraphLine {
                    containers: self.stack.clone(),
                    paragraph_start: start,
                    text_start: self.line.text_start(),
                }),
            });
        }
        if self.line.end == self.units.len() {
            self.at_end = true;
            return false;
        }
        self.line = match_containers(self.units, self.line.end + 1, &self.stack);
        true
    }

    /// lezer's `advance`: reads the block that starts at the current line, after closing the
    /// containers it leaves.
    fn advance(&mut self) {
        loop {
            self.stack.truncate(self.line.depth);
            if !self.line.is_blank() {
                break;
            }
            if !self.consume(LineRole::Block) {
                return;
            }
        }
        loop {
            match self.start_block() {
                Some(BlockStart::Container) => self.line.forward(self.units),
                Some(BlockStart::Leaf) => return,
                None => break,
            }
        }
        if self.line.is_blank() {
            self.consume(LineRole::Block);
        } else {
            self.paragraph();
        }
    }

    /// lezer's default block parsers, in their order.
    fn start_block(&mut self) -> Option<BlockStart> {
        let units = self.units;
        let line = self.line;
        let text = line.text(units);
        if line.is_code_indented(units) {
            self.indented_code();
        } else if let Some(length) = code_fence_length(text) {
            self.fenced_code(text[0], length);
        } else if text.first() == Some(&QUOTE) {
            self.stack.push(Container::Quote);
            let size = 1 + usize::from(text.get(1) == Some(&SPACE));
            self.line.move_base(units, line.content + size);
            return Some(BlockStart::Container);
        } else if is_thematic_break(text, None) || is_atx_heading(text) {
            self.consume(LineRole::Block);
        } else if let Some(size) =
            bullet_item_size(text, None).or_else(|| ordered_item_size(text, None))
        {
            self.open_list_item(size);
            return Some(BlockStart::Container);
        } else {
            self.html_block(HtmlBlockEnd::starting(text, false)?);
        }
        Some(BlockStart::Leaf)
    }

    fn indented_code(&mut self) {
        let base = self.line.base_column + 4;
        while self.consume(LineRole::Block) && self.line.depth >= self.stack.len() {
            if !self.line.is_blank() && self.line.indent(self.units) < base {
                break;
            }
        }
    }

    fn fenced_code(&mut self, fence: u16, length: usize) {
        let units = self.units;
        while self.consume(LineRole::Block) && self.line.depth >= self.stack.len() {
            let line = self.line;
            let run = if line.is_code_indented(units) {
                0
            } else {
                run_length(line.text(units), 0, fence)
            };
            if run >= length && skip_spaces(units, line.content + run, line.end) == line.end {
                self.consume(LineRole::Block);
                return;
            }
        }
    }

    fn open_list_item(&mut self, marker_size: usize) {
        let units = self.units;
        let marker_end = self.line.content + marker_size;
        let marker = units[marker_end - 1];
        if !self
            .stack
            .last()
            .is_some_and(|top| top.holds_items_like(marker))
        {
            self.stack.push(Container::List { marker });
        }
        let content_column = self.line.list_content_column(units, marker_end);
        self.stack.push(Container::Item {
            content_offset: content_column - self.line.base_column,
        });
        self.line.move_base_column(units, content_column);
    }

    fn html_block(&mut self, end: HtmlBlockEnd) {
        let mut trailing = end != HtmlBlockEnd::BlankLine;
        while !end.is_met(&self.units[self.line.line..self.line.end])
            && self.consume(LineRole::Block)
        {
            if self.line.depth < self.stack.len() {
                trailing = false;
                break;
            }
        }
        if trailing {
            self.consume(LineRole::Block);
        }
    }

    /// lezer's leaf block loop for a paragraph from the current line on. The paragraph's lines
    /// are reported as such unless it turns out to be a link reference definition.
    fn paragraph(&mut self) {
        let units = self.units;
        let start = self.line.content;
        let first_line = self.line.text(units);
        let opens_table = has_pipe(first_line);
        let mut reference = LinkReference::start(first_line);
        let first_found = self.found.len();
        let mut more = self.consume(LineRole::Paragraph { start });
        while more {
            let line = self.line;
            if !continues_paragraph(units, &line, &self.stack)
                || (!opens_table && !line.is_code_indented(units) && starts_table(units, &line))
            {
                break;
            }
            if let Some(definition) = &mut reference {
                let (indent, text) = line.scrub(units);
                match definition.next_line(indent, text) {
                    ReferenceProgress::Complete => {
                        self.found[first_found..].fill(None);
                        return;
                    }
                    ReferenceProgress::Failed => reference = None,
                    ReferenceProgress::Pending => {}
                }
            }
            if line.continues_all(&self.stack) && is_setext_underline(units, &line) {
                self.consume(LineRole::Block);
                return;
            }
            more = self.consume(LineRole::Paragraph { start });
        }
        if reference.is_some_and(|definition| definition.is_complete()) {
            self.found[first_found..].fill(None);
        }
    }
}
