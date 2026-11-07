use std::ops::Range;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SyntaxKind {
    AtxHeading { level: u8 },
    SetextHeading { level: u8 },
    HeaderMark,
    Blockquote,
    QuoteMark,
    BulletList,
    OrderedList,
    ListItem,
    ListMark,
    Task,
    TaskMarker { checked: bool },
    FencedCode,
    CodeMark,
    CodeInfo,
    CodeText,
    IndentedCode,
    HorizontalRule,
    Paragraph,
    Emphasis,
    StrongEmphasis,
    EmphasisMark,
    Strikethrough,
    StrikethroughMark,
    InlineCode,
    Link,
    LinkMark,
    LinkLabel,
    Url,
    Autolink,
    Image,
    Table,
    HardBreak,
}

/// A syntax node; `range` is in UTF-16 code units.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SyntaxNode {
    pub kind: SyntaxKind,
    pub range: Range<usize>,
}

impl SyntaxNode {
    pub fn new(kind: SyntaxKind, range: Range<usize>) -> Self {
        Self { kind, range }
    }
}

#[derive(Debug, Clone)]
pub struct MarkdownDocument {
    pub text: String,
    /// Document order, parents before children.
    pub nodes: Vec<SyntaxNode>,
    /// UTF-16 offset of the start of each line.
    pub lines: Vec<usize>,
    units: Vec<u16>,
}

impl MarkdownDocument {
    pub(crate) fn new(text: String, nodes: Vec<SyntaxNode>, units: Vec<u16>) -> Self {
        let mut lines = vec![0];
        lines.extend(
            units
                .iter()
                .enumerate()
                .filter(|(_, unit)| **unit == u16::from(b'\n'))
                .map(|(index, _)| index + 1),
        );
        Self {
            text,
            nodes,
            lines,
            units,
        }
    }

    /// `nodes` must be in document order, parents before children.
    pub fn from_nodes(text: &str, nodes: Vec<SyntaxNode>) -> Self {
        Self::new(text.to_owned(), nodes, text.encode_utf16().collect())
    }

    pub fn units(&self) -> &[u16] {
        &self.units
    }

    /// Length in UTF-16 code units.
    pub fn length(&self) -> usize {
        self.units.len()
    }

    pub fn slice(&self, range: Range<usize>) -> String {
        let end = range.end.min(self.units.len());
        let start = range.start.min(end);
        String::from_utf16_lossy(&self.units[start..end])
    }

    /// The line around `offset`, without its line break.
    pub fn line_containing(&self, offset: usize) -> Range<usize> {
        let clamped = offset.min(self.length());
        let index = self.lines.partition_point(|&start| start <= clamped) - 1;
        let end = self
            .lines
            .get(index + 1)
            .map_or(self.length(), |next| next - 1);
        self.lines[index]..end
    }

    /// Nodes intersecting `range`; an empty range matches nodes that contain or touch its position.
    pub fn nodes_overlapping(&self, range: Range<usize>) -> Vec<&SyntaxNode> {
        if range.is_empty() {
            let position = range.start;
            return self
                .nodes
                .iter()
                .filter(|node| node.range.start <= position && position <= node.range.end)
                .collect();
        }
        self.nodes
            .iter()
            .filter(|node| node.range.start < range.end && range.start < node.range.end)
            .collect()
    }
}
