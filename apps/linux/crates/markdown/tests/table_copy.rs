use commitnote_markdown::{
    Placement, RenderMode, RenderedTable, TableCellPiece, TableCellPosition, TableSelection,
    TableTextStyle, parse, render, table_copy,
};

const ID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const ROWS: usize = 4;
const COLUMNS: usize = 3;
const PLAIN: TableTextStyle = TableTextStyle {
    emphasis: false,
    strong: false,
    strikethrough: false,
    code: false,
};

fn table(text: &str) -> RenderedTable {
    render(&parse(text), &[], RenderMode::Editable)
        .placements
        .into_iter()
        .find_map(|placement| match placement {
            Placement::Table { table } => Some(table),
            _ => None,
        })
        .unwrap_or_else(|| panic!("no rendered table in {text:?}"))
}

fn grid() -> RenderedTable {
    table("| h0 | h1 | h2 |\n| - | - | - |\n| a0 | a1 | a2 |\n| b0 | b1 | b2 |\n| c0 | c1 | c2 |")
}

fn position(row: usize, column: usize) -> TableCellPosition {
    TableCellPosition { row, column }
}

fn range(
    table: &RenderedTable,
    anchor: TableCellPosition,
    focus: TableCellPosition,
) -> (String, String) {
    let copy = table_copy(table, &TableSelection::new(anchor, focus));
    (copy.text, copy.html)
}

fn one_cell(text: &str) -> RenderedTable {
    table(&format!("| {text} |\n| - |"))
}

fn cell_copy(table: &RenderedTable) -> (String, String) {
    range(table, position(0, 0), position(0, 0))
}

fn body_cell_copy(table: &RenderedTable) -> (String, String) {
    range(table, position(1, 0), position(1, 0))
}

fn text_piece(text: &str, style: TableTextStyle, link: Option<&str>) -> TableCellPiece {
    TableCellPiece::Text {
        text: text.to_owned(),
        style,
        link: link.map(str::to_owned),
    }
}

fn with_pieces(pieces: Vec<TableCellPiece>) -> RenderedTable {
    let mut table = grid();
    let cell = &mut table.rows[1][0];
    cell.plain_text = pieces
        .iter()
        .map(|piece| match piece {
            TableCellPiece::Text { text, .. } => text.clone(),
            TableCellPiece::Image { reference } => reference.alt.clone(),
        })
        .collect();
    cell.pieces = pieces;
    table
}

#[test]
fn every_selection_copies_its_cells_in_reading_order() {
    let table = grid();
    assert_eq!((table.row_count(), table.column_count()), (ROWS, COLUMNS));
    let known = |row: usize, column: usize| match row {
        0 => format!("h{column}"),
        _ => format!("{}{column}", (b'a' + (row as u8 - 1)) as char),
    };
    let positions: Vec<_> = (0..ROWS)
        .flat_map(|row| (0..COLUMNS).map(move |column| position(row, column)))
        .collect();
    for &anchor in &positions {
        for &focus in &positions {
            let selection = TableSelection::new(anchor, focus);
            let mut text_rows = Vec::new();
            let mut html = String::from("<table>");
            for row in 0..ROWS {
                let cells: Vec<_> = (0..COLUMNS)
                    .filter(|&column| selection.contains(position(row, column)))
                    .map(|column| known(row, column))
                    .collect();
                if cells.is_empty() {
                    continue;
                }
                let tag = if row == 0 { "th" } else { "td" };
                html.push_str("<tr>");
                for cell in &cells {
                    html.push_str(&format!("<{tag}>{cell}</{tag}>"));
                }
                html.push_str("</tr>");
                text_rows.push(cells.join("\t"));
            }
            html.push_str("</table>");

            let copy = table_copy(&table, &selection);
            assert_eq!(copy.text, text_rows.join("\n"), "{anchor:?} to {focus:?}");
            assert_eq!(copy.html, html, "{anchor:?} to {focus:?}");
        }
    }
}

#[test]
fn copies_a_single_cell() {
    assert_eq!(
        range(&grid(), position(2, 1), position(2, 1)),
        (
            "b1".to_owned(),
            "<table><tr><td>b1</td></tr></table>".to_owned()
        )
    );
    assert_eq!(
        range(&grid(), position(0, 2), position(0, 2)),
        (
            "h2".to_owned(),
            "<table><tr><th>h2</th></tr></table>".to_owned()
        )
    );
}

#[test]
fn copies_a_header_and_body_range() {
    assert_eq!(
        range(&grid(), position(0, 1), position(1, 1)),
        (
            "h1\th2\na0\ta1".to_owned(),
            "<table><tr><th>h1</th><th>h2</th></tr><tr><td>a0</td><td>a1</td></tr></table>"
                .to_owned()
        )
    );
}

#[test]
fn copies_a_range_from_mid_row_to_mid_row() {
    assert_eq!(
        range(&grid(), position(1, 2), position(3, 1)),
        (
            "a2\nb0\tb1\tb2\nc0\tc1".to_owned(),
            concat!(
                "<table><tr><td>a2</td></tr>",
                "<tr><td>b0</td><td>b1</td><td>b2</td></tr>",
                "<tr><td>c0</td><td>c1</td></tr></table>"
            )
            .to_owned()
        )
    );
}

#[test]
fn copies_a_reversed_range_like_a_forward_one() {
    let table = grid();
    assert_eq!(
        range(&table, position(2, 1), position(1, 2)),
        (
            "a2\nb0\tb1".to_owned(),
            "<table><tr><td>a2</td></tr><tr><td>b0</td><td>b1</td></tr></table>".to_owned()
        )
    );
    assert_eq!(
        range(&table, position(2, 1), position(1, 2)),
        range(&table, position(1, 2), position(2, 1))
    );
}

#[test]
fn clamps_positions_into_the_table() {
    let table = grid();
    assert_eq!(
        range(&table, position(9, 9), position(9, 9)),
        range(&table, position(3, 2), position(3, 2))
    );
    assert_eq!(
        range(&table, position(2, 5), position(40, 1)),
        range(&table, position(2, 2), position(3, 1))
    );
    assert_eq!(
        range(&table, position(0, 0), position(7, 7)),
        range(&table, position(0, 0), position(3, 2))
    );
}

#[test]
fn shows_a_space_for_tabs_and_newlines() {
    let mut table = grid();
    let cell = &mut table.rows[1][0];
    cell.plain_text = "a\tb\r\nc\nd".to_owned();
    cell.pieces = vec![text_piece("a\tb\r\nc\nd", PLAIN, None)];
    assert_eq!(
        body_cell_copy(&table),
        (
            "a b  c d".to_owned(),
            "<table><tr><td>a b  c d</td></tr></table>".to_owned()
        )
    );
}

#[test]
fn escapes_html_in_text_and_link_urls() {
    let table = with_pieces(vec![
        text_piece("a & b < c > d \"e\"", PLAIN, None),
        text_piece("x", PLAIN, Some("https://e.com/?a=1&b=\"2\"")),
    ]);
    let (text, html) = body_cell_copy(&table);
    assert_eq!(text, "a & b < c > d \"e\"x");
    assert_eq!(
        html,
        concat!(
            "<table><tr><td>a &amp; b &lt; c &gt; d &quot;e&quot;",
            "<a href=\"https://e.com/?a=1&amp;b=&quot;2&quot;\">x</a>",
            "</td></tr></table>"
        )
    );
}

#[test]
fn wraps_each_style_in_its_tag() {
    let cases = [
        ("**s**", "<strong>s</strong>"),
        ("*s*", "<em>s</em>"),
        ("~~s~~", "<del>s</del>"),
        ("`s`", "<code>s</code>"),
        ("[s](https://e.com)", "<a href=\"https://e.com\">s</a>"),
    ];
    for (markdown, expected) in cases {
        let (text, html) = body_cell_copy(&table(&format!("| h |\n| - |\n| {markdown} |")));
        assert_eq!(text, "s", "{markdown}");
        assert_eq!(
            html,
            format!("<table><tr><td>{expected}</td></tr></table>"),
            "{markdown}"
        );
    }
}

#[test]
fn nests_tags_outermost_first() {
    let all = TableTextStyle {
        emphasis: true,
        strong: true,
        strikethrough: true,
        code: true,
    };
    let table = with_pieces(vec![
        text_piece(
            "both",
            TableTextStyle {
                emphasis: true,
                strong: true,
                ..PLAIN
            },
            Some("https://e.com"),
        ),
        text_piece("all", all, None),
    ]);
    assert_eq!(
        body_cell_copy(&table).1,
        concat!(
            "<table><tr><td>",
            "<a href=\"https://e.com\"><strong><em>both</em></strong></a>",
            "<strong><em><del><code>all</code></del></em></strong>",
            "</td></tr></table>"
        )
    );
}

#[test]
fn wraps_adjacent_pieces_separately() {
    let (_, html) = body_cell_copy(&table("| h |\n| - |\n| plain **bold** *a***b** |"));
    assert_eq!(
        html,
        "<table><tr><td>plain <strong>bold</strong> <em>a</em><strong>b</strong></td></tr></table>"
    );
    let strong = TableTextStyle {
        strong: true,
        ..PLAIN
    };
    let table = with_pieces(vec![
        text_piece("a", strong, None),
        text_piece("b", strong, None),
    ]);
    assert_eq!(
        body_cell_copy(&table).1,
        "<table><tr><td><strong>a</strong><strong>b</strong></td></tr></table>"
    );
}

#[test]
fn copies_an_image_as_its_alt_text() {
    let (text, html) = body_cell_copy(&table(&format!(
        "| h |\n| - |\n| ![a <cat> & co](image:{ID}) |"
    )));
    assert_eq!(text, "a <cat> & co");
    assert_eq!(
        html,
        "<table><tr><td>a &lt;cat&gt; &amp; co</td></tr></table>"
    );
}

#[test]
fn copies_an_image_without_alt_text_as_nothing() {
    let (text, html) = body_cell_copy(&table(&format!("| h |\n| - |\n| ![](image:{ID}) |")));
    assert_eq!(text, "");
    assert_eq!(html, "<table><tr><td></td></tr></table>");
}

#[test]
fn keeps_text_and_image_in_order() {
    let (text, html) = body_cell_copy(&table(&format!(
        "| h |\n| - |\n| before ![cat](image:{ID}) **after** |"
    )));
    assert_eq!(text, "before cat after");
    assert_eq!(
        html,
        "<table><tr><td>before cat <strong>after</strong></td></tr></table>"
    );
}

#[test]
fn copies_an_empty_cell_as_an_empty_field() {
    let table = table("| h0 | h1 |\n| - | - |\n| | x |");
    assert_eq!(
        range(&table, position(1, 0), position(1, 1)),
        (
            "\tx".to_owned(),
            "<table><tr><td></td><td>x</td></tr></table>".to_owned()
        )
    );
    assert_eq!(
        range(&table, position(1, 0), position(1, 0)),
        (
            "".to_owned(),
            "<table><tr><td></td></tr></table>".to_owned()
        )
    );
    assert_eq!(
        cell_copy(&one_cell("")).1,
        "<table><tr><th></th></tr></table>"
    );
}
