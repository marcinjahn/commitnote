use std::collections::HashMap;
use std::ops::Range;

use crate::commands::link_url;
use crate::image_reference::{ImageReference, image_label_range};
use crate::live_preview::{PreviewStyle, StyleRun};
use crate::syntax::{MarkdownDocument, SyntaxKind};
use crate::table::{MarkdownTable, MarkdownTableCell, TableAlignment};

const BACKSLASH: u16 = b'\\' as u16;
const SPACE: u16 = b' ' as u16;
const IMAGE_LABEL: &str = "Image";
const EMPTY_LABEL: &str = "Empty";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct TableTextStyle {
    pub emphasis: bool,
    pub strong: bool,
    pub strikethrough: bool,
    pub code: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TableCellPiece {
    Text {
        text: String,
        style: TableTextStyle,
        link: Option<String>,
    },
    Image {
        reference: ImageReference,
    },
}

impl TableCellPiece {
    fn same_content(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Image { reference: a }, Self::Image { reference: b }) => {
                a.image_id == b.image_id
                    && a.width == b.width
                    && a.height == b.height
                    && a.alt == b.alt
            }
            _ => self == other,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableCellContent {
    pub pieces: Vec<TableCellPiece>,
    /// The pieces' text, an image contributing its alt text.
    pub plain_text: String,
    /// The trimmed plain text with an image without alt text read as "Image"; "Empty" when blank.
    pub accessible_label: String,
    /// A UTF-16 offset in the document.
    pub caret_offset: usize,
}

impl TableCellContent {
    fn new(pieces: Vec<TableCellPiece>, caret_offset: usize) -> Self {
        let mut plain_text = String::new();
        let mut label = String::new();
        for piece in &pieces {
            match piece {
                TableCellPiece::Text { text, .. } => {
                    plain_text.push_str(text);
                    label.push_str(text);
                }
                TableCellPiece::Image { reference } => {
                    plain_text.push_str(&reference.alt);
                    label.push_str(if reference.alt.is_empty() {
                        IMAGE_LABEL
                    } else {
                        &reference.alt
                    });
                }
            }
        }
        let label = label.trim();
        Self {
            pieces,
            plain_text,
            accessible_label: if label.is_empty() { EMPTY_LABEL } else { label }.to_owned(),
            caret_offset,
        }
    }

    fn same_content(&self, other: &Self) -> bool {
        self.plain_text == other.plain_text
            && self.accessible_label == other.accessible_label
            && self.pieces.len() == other.pieces.len()
            && self
                .pieces
                .iter()
                .zip(&other.pieces)
                .all(|(a, b)| a.same_content(b))
    }
}

/// A table as the live preview shows it when no selection touches it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedTable {
    pub source: MarkdownTable,
    /// The header row, then the body rows; each holds exactly `source.column_count` cells.
    pub rows: Vec<Vec<TableCellContent>>,
    /// The number of `>` in the container prefix.
    pub quote_level: usize,
}

impl RenderedTable {
    pub fn range(&self) -> Range<usize> {
        self.source.range.clone()
    }

    pub fn alignments(&self) -> &[TableAlignment] {
        &self.source.alignments
    }

    pub fn container_prefix(&self) -> &str {
        self.source.container_prefix.as_deref().unwrap_or_default()
    }

    /// The container prefix after its last `>` and the one space or tab that follows it.
    pub fn list_prefix(&self) -> &str {
        let prefix = self.container_prefix();
        match prefix.rfind('>') {
            Some(mark) => {
                let rest = &prefix[mark + 1..];
                rest.strip_prefix([' ', '\t']).unwrap_or(rest)
            }
            None => prefix,
        }
    }

    pub fn column_count(&self) -> usize {
        self.source.column_count
    }

    pub fn row_count(&self) -> usize {
        self.rows.len()
    }

    /// Whether both show the same thing, whatever their source ranges and caret offsets.
    pub fn same_content(&self, other: &Self) -> bool {
        self.alignments() == other.alignments()
            && self.container_prefix() == other.container_prefix()
            && self.quote_level == other.quote_level
            && self.rows.len() == other.rows.len()
            && self
                .rows
                .iter()
                .zip(&other.rows)
                .all(|(a, b)| a.len() == b.len() && a.iter().zip(b).all(|(a, b)| a.same_content(b)))
    }
}

/// `runs` are the live preview's runs for a render in which no selection touches `table`.
/// `None` when the table's line prefixes are irregular.
pub fn rendered_table(
    document: &MarkdownDocument,
    table: &MarkdownTable,
    runs: &[StyleRun],
) -> Option<RenderedTable> {
    let prefix = table.container_prefix.as_deref()?;
    let reader = CellReader::new(document, table.range.clone(), runs);
    let rows = std::iter::once(table.header())
        .chain(table.rows())
        .map(|line| {
            (0..table.column_count)
                .map(|column| match line.cells.get(column) {
                    Some(cell) => reader.content(cell),
                    None => TableCellContent::new(Vec::new(), line.range.end),
                })
                .collect()
        })
        .collect();
    Some(RenderedTable {
        source: table.clone(),
        rows,
        quote_level: prefix.matches('>').count(),
    })
}

#[derive(Debug, Clone, Copy, Default)]
struct UnitMarks {
    dropped: bool,
    /// Inside inline code or a URL, where a backslash is not an escape.
    verbatim: bool,
    linked: bool,
    style: TableTextStyle,
}

impl UnitMarks {
    fn apply(&mut self, style: PreviewStyle) {
        match style {
            PreviewStyle::Hidden | PreviewStyle::MutedMarker => self.dropped = true,
            PreviewStyle::Emphasis => self.style.emphasis = true,
            PreviewStyle::Strong => self.style.strong = true,
            PreviewStyle::Strikethrough => self.style.strikethrough = true,
            PreviewStyle::InlineCode => {
                self.style.code = true;
                self.verbatim = true;
            }
            PreviewStyle::Link => self.linked = true,
            PreviewStyle::Url => {
                self.linked = true;
                self.verbatim = true;
            }
            PreviewStyle::Heading { .. }
            | PreviewStyle::CodeBlockLine
            | PreviewStyle::TableSourceLine
            | PreviewStyle::QuoteLine
            | PreviewStyle::ListMark => {}
        }
    }
}

enum CellImage {
    Reference(ImageReference),
    Label(Range<usize>),
}

struct CellReader<'a> {
    document: &'a MarkdownDocument,
    base: usize,
    marks: Vec<UnitMarks>,
    /// Keyed by the image node's start, with its end.
    images: HashMap<usize, (usize, CellImage)>,
}

impl<'a> CellReader<'a> {
    fn new(document: &'a MarkdownDocument, range: Range<usize>, runs: &[StyleRun]) -> Self {
        let base = range.start;
        let mut marks = vec![UnitMarks::default(); range.len()];
        let mut mark = |offsets: Range<usize>, style: PreviewStyle| {
            for offset in offsets.start.max(range.start)..offsets.end.min(range.end) {
                marks[offset - base].apply(style);
            }
        };
        for run in runs {
            mark(run.range.clone(), run.style);
        }
        let mut images = HashMap::new();
        for node in document.nodes_overlapping(range.clone()) {
            match node.kind {
                SyntaxKind::Autolink => {
                    mark(node.range.start..node.range.start + 1, PreviewStyle::Hidden);
                    mark(node.range.end - 1..node.range.end, PreviewStyle::Hidden);
                }
                SyntaxKind::Image => {
                    let image = match ImageReference::reference_for(node, document) {
                        Some(reference) => Some(CellImage::Reference(reference)),
                        None => image_label_range(node, document).map(CellImage::Label),
                    };
                    if let Some(image) = image {
                        images.insert(node.range.start, (node.range.end, image));
                    }
                }
                _ => {}
            }
        }
        Self {
            document,
            base,
            marks,
            images,
        }
    }

    fn content(&self, cell: &MarkdownTableCell) -> TableCellContent {
        let units = self.document.units();
        let content = cell.content_range.clone();
        let mut pieces = PieceBuilder::default();
        let mut stretch_link: Option<Option<String>> = None;
        let mut escaped = false;
        let mut index = content.start;
        while index < content.end {
            if let Some((end, image)) = self
                .images
                .get(&index)
                .filter(|(end, _)| *end <= content.end)
            {
                match image {
                    CellImage::Reference(reference) => pieces.push_image(reference.clone()),
                    CellImage::Label(label) => {
                        pieces.push_text(&units[label.clone()], TableTextStyle::default(), None);
                    }
                }
                stretch_link = None;
                escaped = false;
                index = *end;
                continue;
            }
            let marks = self.marks[index - self.base];
            let escapes = !escaped
                && !marks.verbatim
                && units[index] == BACKSLASH
                && index + 1 < content.end
                && is_ascii_punctuation(units[index + 1]);
            if marks.dropped || escapes {
                escaped = escapes && !marks.dropped;
                stretch_link = None;
                index += 1;
                continue;
            }
            escaped = false;
            let link = if marks.linked {
                stretch_link
                    .get_or_insert_with(|| link_url(self.document, index))
                    .as_deref()
            } else {
                stretch_link = None;
                None
            };
            pieces.push_text(&units[index..index + 1], marks.style, link);
            index += 1;
        }
        TableCellContent::new(pieces.finish(), caret_offset(units, cell))
    }
}

fn caret_offset(units: &[u16], cell: &MarkdownTableCell) -> usize {
    if !cell.content_range.is_empty() {
        cell.content_range.end
    } else if !cell.range.is_empty() && units[cell.range.start] == SPACE {
        cell.range.start + 1
    } else {
        cell.range.start
    }
}

fn is_ascii_punctuation(unit: u16) -> bool {
    u8::try_from(unit).is_ok_and(|byte| byte.is_ascii_punctuation())
}

#[derive(Default)]
struct PieceBuilder {
    pieces: Vec<TableCellPiece>,
    text: Vec<u16>,
    style: TableTextStyle,
    link: Option<String>,
}

impl PieceBuilder {
    fn push_text(&mut self, units: &[u16], style: TableTextStyle, link: Option<&str>) {
        if units.is_empty() {
            return;
        }
        if self.text.is_empty() || self.style != style || self.link.as_deref() != link {
            self.flush();
            self.style = style;
            self.link = link.map(str::to_owned);
        }
        self.text.extend_from_slice(units);
    }

    fn push_image(&mut self, reference: ImageReference) {
        self.flush();
        self.pieces.push(TableCellPiece::Image { reference });
    }

    fn flush(&mut self) {
        if self.text.is_empty() {
            return;
        }
        self.pieces.push(TableCellPiece::Text {
            text: String::from_utf16_lossy(&self.text),
            style: self.style,
            link: self.link.take(),
        });
        self.text.clear();
    }

    fn finish(mut self) -> Vec<TableCellPiece> {
        self.flush();
        self.pieces
    }
}
