use std::ops::Range;

use crate::rendered_table::{RenderedTable, TableCellContent, TableCellPiece, TableTextStyle};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct TableCellPosition {
    pub row: usize,
    pub column: usize,
}

/// Cells of one rendered table, selected like text in reading order rather than as a rectangle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TableSelection {
    /// Where the selection started.
    pub anchor: TableCellPosition,
    /// Where the selection now ends; it may come before the anchor.
    pub focus: TableCellPosition,
}

impl TableSelection {
    pub fn new(anchor: TableCellPosition, focus: TableCellPosition) -> Self {
        Self { anchor, focus }
    }

    pub fn cell(position: TableCellPosition) -> Self {
        Self::new(position, position)
    }

    /// The earlier and the later of anchor and focus in row-major order.
    pub fn ordered(&self) -> (TableCellPosition, TableCellPosition) {
        if self.anchor <= self.focus {
            (self.anchor, self.focus)
        } else {
            (self.focus, self.anchor)
        }
    }

    pub fn contains(&self, position: TableCellPosition) -> bool {
        let (start, end) = self.ordered();
        start <= position && position <= end
    }

    /// Each touched row with its selected columns: the first row from the start column to the row's
    /// end, the full rows between, and the last row up to the end column.
    pub fn rows(&self, column_count: usize) -> impl Iterator<Item = (usize, Range<usize>)> {
        let (start, end) = self.ordered();
        (start.row..=end.row).map(move |row| {
            let first = if row == start.row { start.column } else { 0 };
            let last = if row == end.row {
                end.column + 1
            } else {
                column_count
            };
            (row, first..last)
        })
    }

    fn clamped(&self, table: &RenderedTable) -> Self {
        let last_row = table.row_count().saturating_sub(1);
        let last_column = table.column_count().saturating_sub(1);
        let clamp = |position: TableCellPosition| TableCellPosition {
            row: position.row.min(last_row),
            column: position.column.min(last_column),
        };
        Self::new(clamp(self.anchor), clamp(self.focus))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableCopy {
    pub text: String,
    pub html: String,
}

/// The selected cells as tab-separated text and as an HTML table.
pub fn table_copy(table: &RenderedTable, selection: &TableSelection) -> TableCopy {
    let selection = selection.clamped(table);
    let touched: Vec<(usize, &[TableCellContent])> = selection
        .rows(table.column_count())
        .map(|(row, columns)| (row, &table.rows[row][columns]))
        .collect();

    let text = touched
        .iter()
        .map(|(_, cells)| {
            cells
                .iter()
                .map(|cell| single_line(&cell.plain_text))
                .collect::<Vec<_>>()
                .join("\t")
        })
        .collect::<Vec<_>>()
        .join("\n");

    let mut html = String::from("<table>");
    for (row, cells) in touched {
        let tag = if row == 0 { "th" } else { "td" };
        html.push_str("<tr>");
        for cell in cells {
            html.push_str(&format!("<{tag}>"));
            for piece in &cell.pieces {
                push_piece(&mut html, piece);
            }
            html.push_str(&format!("</{tag}>"));
        }
        html.push_str("</tr>");
    }
    html.push_str("</table>");

    TableCopy { text, html }
}

fn single_line(text: &str) -> String {
    text.replace(['\t', '\r', '\n'], " ")
}

fn push_escaped(html: &mut String, text: &str) {
    for character in single_line(text).chars() {
        match character {
            '&' => html.push_str("&amp;"),
            '<' => html.push_str("&lt;"),
            '>' => html.push_str("&gt;"),
            '"' => html.push_str("&quot;"),
            other => html.push(other),
        }
    }
}

fn push_piece(html: &mut String, piece: &TableCellPiece) {
    match piece {
        TableCellPiece::Text { text, style, link } => {
            push_text(html, text, *style, link.as_deref())
        }
        TableCellPiece::Image { reference } => push_escaped(html, &reference.alt),
    }
}

fn push_text(html: &mut String, text: &str, style: TableTextStyle, link: Option<&str>) {
    if let Some(url) = link {
        html.push_str("<a href=\"");
        push_escaped(html, url);
        html.push_str("\">");
    }
    let tags: Vec<&str> = [
        (style.strong, "strong"),
        (style.emphasis, "em"),
        (style.strikethrough, "del"),
        (style.code, "code"),
    ]
    .into_iter()
    .filter_map(|(enabled, tag)| enabled.then_some(tag))
    .collect();
    for tag in &tags {
        html.push_str(&format!("<{tag}>"));
    }
    push_escaped(html, text);
    for tag in tags.iter().rev() {
        html.push_str(&format!("</{tag}>"));
    }
    if link.is_some() {
        html.push_str("</a>");
    }
}
