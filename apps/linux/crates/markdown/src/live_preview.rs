use std::ops::Range;

use commitnote_editor_text::TextSelection;

use crate::image_reference::ImageReference;
use crate::rendered_table::{RenderedTable, rendered_table};
use crate::syntax::{MarkdownDocument, SyntaxKind, SyntaxNode};
use crate::table::MarkdownTable;

const PIPE: u16 = 124;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewStyle {
    Heading { level: u8 },
    Emphasis,
    Strong,
    Strikethrough,
    InlineCode,
    CodeBlockLine,
    TableSourceLine,
    QuoteLine,
    Link,
    Url,
    ListMark,
    MutedMarker,
    Hidden,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StyleRun {
    pub range: Range<usize>,
    pub style: PreviewStyle,
}

impl StyleRun {
    pub fn new(range: Range<usize>, style: PreviewStyle) -> Self {
        Self { range, style }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Placement {
    Checkbox {
        range: Range<usize>,
        checked: bool,
    },
    Rule {
        line_range: Range<usize>,
    },
    Image {
        reference: ImageReference,
        line_range: Range<usize>,
        source_visible: bool,
    },
    Table {
        table: RenderedTable,
    },
}

/// Whether the text can be edited, which decides if a selection reveals a table's source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderMode {
    Editable,
    ReadOnly,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderOutput {
    pub runs: Vec<StyleRun>,
    pub placements: Vec<Placement>,
}

/// Runs may overlap: apply block line styles first, inline styles next and `Hidden` last.
/// Placements come in document order.
pub fn render(
    document: &MarkdownDocument,
    selection: &[TextSelection],
    mode: RenderMode,
) -> RenderOutput {
    let mut renderer = Renderer {
        document,
        selection,
        mode,
        block: Vec::new(),
        inline: Vec::new(),
        hidden: Vec::new(),
        placements: Vec::new(),
    };
    renderer.run();
    let mut runs = renderer.block;
    runs.extend(renderer.inline);
    runs.extend(renderer.hidden);
    renderer.placements.sort_by_key(|(start, _)| *start);
    RenderOutput {
        runs,
        placements: renderer
            .placements
            .into_iter()
            .map(|(_, placement)| placement)
            .collect(),
    }
}

struct Renderer<'a> {
    document: &'a MarkdownDocument,
    selection: &'a [TextSelection],
    mode: RenderMode,
    block: Vec<StyleRun>,
    inline: Vec<StyleRun>,
    hidden: Vec<StyleRun>,
    placements: Vec<(usize, Placement)>,
}

impl Renderer<'_> {
    fn lines_active(&self, range: &Range<usize>) -> bool {
        let line_start = self.document.line_containing(range.start).start;
        let line_end = self.document.line_containing(range.end).end;
        self.selection.iter().any(|selection| {
            selection.location <= line_end && selection.location + selection.length >= line_start
        })
    }

    fn with_trailing_space(&self, range: &Range<usize>) -> Range<usize> {
        let next = range.end;
        if self.document.units().get(next) == Some(&32) {
            range.start..next + 1
        } else {
            range.clone()
        }
    }

    fn add_lines(&mut self, range: &Range<usize>, style: PreviewStyle) {
        let first = self.document.line_containing(range.start);
        let last = self
            .document
            .line_containing(range.start.max(range.end.saturating_sub(1)));
        let mut start = first.start;
        while start <= last.start {
            let line = self.document.line_containing(start);
            let at_end = line.end >= self.document.length();
            let next = line.end + 1;
            self.block.push(StyleRun::new(line, style));
            if at_end {
                break;
            }
            start = next;
        }
    }

    fn hide_unless_active(&mut self, range: &Range<usize>, extending_space: bool) {
        if self.lines_active(range) {
            self.inline
                .push(StyleRun::new(range.clone(), PreviewStyle::MutedMarker));
        } else {
            let hidden = if extending_space {
                self.with_trailing_space(range)
            } else {
                range.clone()
            };
            self.hidden
                .push(StyleRun::new(hidden, PreviewStyle::Hidden));
        }
    }

    fn run(&mut self) {
        let mut ancestors: Vec<&SyntaxNode> = Vec::new();
        for node in &self.document.nodes {
            while let Some(top) = ancestors.last() {
                if top.range.start <= node.range.start && node.range.end <= top.range.end {
                    break;
                }
                ancestors.pop();
            }
            let parent = ancestors.last().map(|top| top.kind);
            ancestors.push(node);
            self.visit(node, parent);
        }
        let tables = self.document.tables();
        if tables.is_empty() {
            return;
        }
        let gathered: Vec<StyleRun> = self
            .block
            .iter()
            .chain(&self.inline)
            .chain(&self.hidden)
            .cloned()
            .collect();
        for table in &tables {
            match self.table_to_render(table, &gathered) {
                Some(rendered) => self.render_table(table, rendered),
                None => self.style_table_source(table),
            }
        }
    }

    fn table_to_render(
        &self,
        table: &MarkdownTable,
        gathered: &[StyleRun],
    ) -> Option<RenderedTable> {
        let revealed = self.mode == RenderMode::Editable && self.lines_active(&table.range);
        if revealed {
            return None;
        }
        rendered_table(self.document, table, gathered)
    }

    fn render_table(&mut self, table: &MarkdownTable, rendered: RenderedTable) {
        let (first, rest) = table
            .lines
            .split_first()
            .expect("a table has a header line");
        self.hidden
            .push(StyleRun::new(first.range.clone(), PreviewStyle::Hidden));
        if let Some(last) = rest.last() {
            let line_break = usize::from(last.range.end < self.document.length());
            self.hidden.push(StyleRun::new(
                rest[0].range.start..last.range.end + line_break,
                PreviewStyle::Hidden,
            ));
        }
        self.placements
            .retain(|(start, _)| !table.range.contains(start));
        self.placements
            .push((table.range.start, Placement::Table { table: rendered }));
    }

    fn style_table_source(&mut self, table: &MarkdownTable) {
        for line in &table.lines {
            self.block.push(StyleRun::new(
                line.range.clone(),
                PreviewStyle::TableSourceLine,
            ));
        }
        let delimiter = table.delimiter();
        self.muted(&(delimiter.row_start..delimiter.range.end));
        let rows = std::iter::once(table.header()).chain(table.rows());
        for line in rows {
            for position in line.row_start..line.range.end {
                let outside_cells = !line.cells.iter().any(|cell| cell.range.contains(&position));
                if self.document.units()[position] == PIPE && outside_cells {
                    self.muted(&(position..position + 1));
                }
            }
        }
    }

    fn visit(&mut self, node: &SyntaxNode, parent: Option<SyntaxKind>) {
        let range = &node.range;
        match node.kind {
            SyntaxKind::AtxHeading { level } | SyntaxKind::SetextHeading { level } => {
                self.block.push(StyleRun::new(
                    range.clone(),
                    PreviewStyle::Heading { level },
                ))
            }
            SyntaxKind::HeaderMark => {
                if matches!(parent, Some(SyntaxKind::AtxHeading { .. })) {
                    self.hide_unless_active(range, true);
                } else {
                    self.muted(range);
                }
            }
            SyntaxKind::Blockquote => self.add_lines(range, PreviewStyle::QuoteLine),
            SyntaxKind::QuoteMark => self.hide_unless_active(range, true),
            SyntaxKind::FencedCode | SyntaxKind::IndentedCode => {
                self.add_lines(range, PreviewStyle::CodeBlockLine)
            }
            SyntaxKind::ListMark => self.inline_style(range, PreviewStyle::ListMark),
            SyntaxKind::Emphasis => self.inline_style(range, PreviewStyle::Emphasis),
            SyntaxKind::StrongEmphasis => self.inline_style(range, PreviewStyle::Strong),
            SyntaxKind::Strikethrough => self.inline_style(range, PreviewStyle::Strikethrough),
            SyntaxKind::EmphasisMark | SyntaxKind::StrikethroughMark => {
                self.hide_unless_active(range, false)
            }
            SyntaxKind::InlineCode => self.inline_style(range, PreviewStyle::InlineCode),
            SyntaxKind::CodeMark => {
                if parent == Some(SyntaxKind::InlineCode) {
                    self.hide_unless_active(range, false);
                } else {
                    self.muted(range);
                }
            }
            SyntaxKind::LinkLabel => {
                if parent == Some(SyntaxKind::Link) {
                    self.inline_style(range, PreviewStyle::Link);
                }
            }
            SyntaxKind::LinkMark => {
                if parent == Some(SyntaxKind::Link) {
                    self.hide_unless_active(range, false);
                } else {
                    self.muted(range);
                }
            }
            SyntaxKind::Url => self.visit_url(node, parent),
            SyntaxKind::Autolink => self.inline_style(range, PreviewStyle::Url),
            SyntaxKind::Image => self.visit_image(node),
            SyntaxKind::TaskMarker { checked } => self.placements.push((
                range.start,
                Placement::Checkbox {
                    range: range.clone(),
                    checked,
                },
            )),
            SyntaxKind::HorizontalRule => {
                if !self.lines_active(range) {
                    self.hidden
                        .push(StyleRun::new(range.clone(), PreviewStyle::Hidden));
                    self.placements.push((
                        range.start,
                        Placement::Rule {
                            line_range: self.document.line_containing(range.start),
                        },
                    ));
                }
            }
            SyntaxKind::CodeInfo
            | SyntaxKind::CodeText
            | SyntaxKind::Task
            | SyntaxKind::Link
            | SyntaxKind::BulletList
            | SyntaxKind::OrderedList
            | SyntaxKind::ListItem
            | SyntaxKind::Paragraph
            | SyntaxKind::Table
            | SyntaxKind::HardBreak => {}
        }
    }

    fn inline_style(&mut self, range: &Range<usize>, style: PreviewStyle) {
        self.inline.push(StyleRun::new(range.clone(), style));
    }

    fn muted(&mut self, range: &Range<usize>) {
        self.inline_style(range, PreviewStyle::MutedMarker);
    }

    fn visit_url(&mut self, node: &SyntaxNode, parent: Option<SyntaxKind>) {
        if parent == Some(SyntaxKind::Link) && self.is_destination(node) {
            self.hide_unless_active(&node.range, false);
        } else if parent == Some(SyntaxKind::Image) && self.is_destination(node) {
            self.muted(&node.range);
        } else {
            self.inline_style(&node.range, PreviewStyle::Url);
        }
    }

    fn is_destination(&self, url: &SyntaxNode) -> bool {
        url.range.start > 0 && self.document.units()[url.range.start - 1] == 40
    }

    fn visit_image(&mut self, node: &SyntaxNode) {
        let Some(reference) = ImageReference::reference_for(node, self.document) else {
            return;
        };
        let active = self.lines_active(&node.range);
        if !active {
            self.hidden
                .push(StyleRun::new(node.range.clone(), PreviewStyle::Hidden));
        }
        self.placements.push((
            node.range.start,
            Placement::Image {
                reference,
                line_range: self.document.line_containing(node.range.start),
                source_visible: active,
            },
        ));
    }
}
