use std::ops::Range;

use commitnote_markdown::{
    MarkdownDocument, MarkdownTable, MarkdownTableLine, SyntaxKind, SyntaxNode,
    TableAlignment as A, parse,
};

fn table(text: &str) -> MarkdownTable {
    let mut tables = parse(text).tables();
    assert_eq!(tables.len(), 1, "tables in {text:?}");
    tables.remove(0)
}

fn cells(line: &MarkdownTableLine) -> Vec<(Range<usize>, Range<usize>)> {
    line.cells
        .iter()
        .map(|cell| (cell.range.clone(), cell.content_range.clone()))
        .collect()
}

const BASIC: &str = "| a | b |\n| - | - |\n| 1 | 2 |";

#[test]
fn basic_table() {
    let table = table(BASIC);
    assert_eq!(table.range, 0..29);
    assert_eq!(table.container_prefix.as_deref(), Some(""));
    assert_eq!(table.column_count, 2);
    assert_eq!(table.alignments, [A::Unspecified, A::Unspecified]);
    assert_eq!(
        table
            .lines
            .iter()
            .map(|line| (line.range.clone(), line.row_start, line.trailing_pipe))
            .collect::<Vec<_>>(),
        [(0..9, 0, true), (10..19, 10, true), (20..29, 20, true)]
    );
    assert_eq!(cells(&table.lines[0]), [(1..4, 2..3), (5..8, 6..7)]);
    assert_eq!(cells(&table.lines[1]), [(11..14, 12..13), (15..18, 16..17)]);
    assert_eq!(cells(&table.lines[2]), [(21..24, 22..23), (25..28, 26..27)]);
}

#[test]
fn header_delimiter_and_rows() {
    let table = table(BASIC);
    assert_eq!(table.header(), &table.lines[0]);
    assert_eq!(table.delimiter(), &table.lines[1]);
    assert_eq!(table.rows(), &table.lines[2..]);
    assert_eq!(table.rows().len(), 1);
    assert_eq!(table.rows()[0].range, 20..29);
}

#[test]
fn alignments_follow_the_delimiter_colons() {
    let table = table("| a | b | c | d |\n| --- | :-- | :-: | --: |\n| 1 | 2 | 3 | 4 |");
    assert_eq!(
        table.alignments,
        [A::Unspecified, A::Left, A::Center, A::Right]
    );
}

#[test]
fn table_node_with_fewer_delimiter_cells_than_header_cells_is_not_a_table() {
    let text = "| a | b | c |\n| :-: |";
    let document =
        MarkdownDocument::from_nodes(text, vec![SyntaxNode::new(SyntaxKind::Table, 0..21)]);
    assert_eq!(document.tables(), []);
}

#[test]
fn table_in_a_blockquote() {
    let table = table("> | a | b |\n> | - | - |\n> | 1 | 2 |");
    assert_eq!(table.range, 0..35);
    assert_eq!(table.container_prefix.as_deref(), Some("> "));
    assert_eq!(
        table
            .lines
            .iter()
            .map(|line| (line.range.clone(), line.row_start))
            .collect::<Vec<_>>(),
        [(0..11, 2), (12..23, 14), (24..35, 26)]
    );
    assert_eq!(cells(table.header()), [(3..6, 4..5), (7..10, 8..9)]);
}

#[test]
fn table_in_a_nested_blockquote() {
    let table = table("> > | a |\n> > | - |");
    assert_eq!(table.range, 0..19);
    assert_eq!(table.container_prefix.as_deref(), Some("> > "));
    assert_eq!(table.column_count, 1);
    assert_eq!(table.header().row_start, 4);
    assert_eq!(cells(table.header()), [(5..8, 6..7)]);
}

#[test]
fn table_in_a_list_item() {
    let table = table("- item\n\n  | a | b |\n  | - | - |\n  | 1 | 2 |");
    assert_eq!(table.range, 8..43);
    assert_eq!(table.container_prefix.as_deref(), Some("  "));
    assert_eq!(table.header().range, 8..19);
    assert_eq!(table.header().row_start, 10);
}

#[test]
fn lazy_last_row_in_a_blockquote_has_no_prefix() {
    let table = table("> | a | b |\n> | - | - |\n| 1 | 2 |");
    assert_eq!(table.range, 0..33);
    assert_eq!(table.container_prefix, None);
    assert_eq!(table.rows()[0].range, 24..33);
    assert_eq!(table.rows()[0].row_start, 24);
}

#[test]
fn blank_cell_has_empty_content_at_its_start() {
    let table = table("| a |   | c |\n| - | - | - |");
    assert_eq!(
        cells(table.header()),
        [(1..4, 2..3), (5..8, 5..5), (9..12, 10..11)]
    );
}

#[test]
fn escaped_pipe_stays_in_the_cell() {
    let table = table("| a \\| x | b |\n| - | - |");
    assert_eq!(cells(table.header()), [(1..9, 2..8), (10..13, 11..12)]);
}

#[test]
fn pipe_inside_a_code_span_splits_the_cell() {
    let table = table("| `a|b` | c |\n| - | - | - |");
    assert_eq!(table.column_count, 3);
    assert_eq!(
        cells(table.header()),
        [(1..4, 2..4), (5..8, 5..7), (9..12, 10..11)]
    );
}

#[test]
fn offsets_are_utf16_units() {
    let table = table("| 😀 | b |\n| - | - |");
    assert_eq!(table.range, 0..20);
    assert_eq!(table.header().range, 0..10);
    assert_eq!(cells(table.header()), [(1..5, 2..4), (6..9, 7..8)]);
}

#[test]
fn tables_come_in_document_order() {
    let tables = parse("| a |\n| - |\n\ntext\n\n| b | c |\n| - | - |").tables();
    assert_eq!(
        tables
            .iter()
            .map(|table| (table.range.clone(), table.column_count))
            .collect::<Vec<_>>(),
        [(0..11, 1), (19..38, 2)]
    );
}

#[test]
fn table_right_after_a_paragraph_starts_at_its_header() {
    let table = table("text\n| a | b |\n| - | - |");
    assert_eq!(table.range, 5..24);
    assert_eq!(table.header().row_start, 5);
    assert_eq!(table.container_prefix.as_deref(), Some(""));
}

#[test]
fn cell_at_positions() {
    let table = table(BASIC);
    for (position, expected) in [
        (2, (0, 0)),
        (6, (0, 1)),
        (0, (0, 0)),
        (4, (0, 0)),
        (8, (0, 1)),
        (9, (0, 1)),
        (12, (1, 0)),
        (16, (1, 1)),
        (99, (2, 1)),
    ] {
        assert_eq!(table.cell_at(position), expected, "position {position}");
    }
}

#[test]
fn display_rows_skip_the_delimiter_line() {
    let table = table("| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |");
    for (row, line) in [(0, 0), (1, 2), (2, 3), (3, 3), (9, 3)] {
        assert_eq!(table.line_for_row(row), line, "row {row}");
    }
}

#[test]
fn delimiter_that_reads_as_a_list_item_is_not_a_table() {
    assert_eq!(parse("a | b\n- | -\n1 | 2").tables(), []);
    assert_eq!(parse("a | b\n-\t| -\n1 | 2").tables(), []);
    assert_eq!(table("a | b\n-|-\n1 | 2").range, 0..15);
    assert_eq!(table("| a | b |\n| - | - |").range, 0..19);
}

#[test]
fn delimiter_with_trailing_space_after_its_last_pipe_is_not_a_table() {
    assert_eq!(parse("| a | b |\n| - | - | \n| 1 | 2 |").tables(), []);
    assert_eq!(parse("| a | b |\n| - | - |\t").tables(), []);
    assert_eq!(table("| a | b |\n| - | -\n| 1 | 2 |").range, 0..27);
}

#[test]
fn delimiter_with_an_unclosed_dash_run_is_not_a_table() {
    assert_eq!(parse("| a |\n| -").tables(), []);
    assert_eq!(parse("| a\n| -").tables(), []);
}

#[test]
fn quoted_delimiter_with_trailing_space_is_not_a_table() {
    assert_eq!(parse("> | a |\n> | - | \n> | 1 |").tables(), []);
}

#[test]
fn dash_underline_turns_the_table_into_a_heading() {
    assert_eq!(parse("| a |\n| - |\n| 1 |\n---").tables(), []);
    assert_eq!(parse("| a |\n| - |\n-").tables(), []);
    assert_eq!(parse("| a |\n| - |\n   ---").tables(), []);
    assert_eq!(table("| a |\n| - |\n| 1 |\n\n---").range, 0..17);
}

#[test]
fn equals_underline_turns_the_table_into_a_heading() {
    assert_eq!(parse("| a |\n| - |\n| 1 |\n=").tables(), []);
    assert_eq!(parse("| a |\n| - |\n=\n| 1 |").tables(), []);
}

#[test]
fn underline_inside_the_container_turns_a_nested_table_into_a_heading() {
    assert_eq!(parse("> | a |\n> | - |\n> ---").tables(), []);
    assert_eq!(parse("- | a |\n  | - |\n  =").tables(), []);
    assert_eq!(parse("- a\n\n   | x |\n   | - |\n  ---").tables(), []);
    assert_eq!(table("> | a |\n> | - |\n---").range, 0..15);
    assert_eq!(table("- | a |\n  | - |\n---").range, 0..15);
    assert_eq!(table("- | a |\n  | - |\n  -").range, 0..15);
}

#[test]
fn header_and_delimiter_cell_counts_must_match() {
    assert_eq!(parse("| a | b |\n| - |").tables(), []);
    assert_eq!(parse("| a | \u{a0}\n| - |").tables(), []);
}

#[test]
fn lazy_row_after_a_table_in_a_list_item_has_no_prefix() {
    let table = table("- a\n\n  | x |\n  | - |\n  | 1 |\n| 2 |");
    assert_eq!(table.range, 5..34);
    assert_eq!(table.container_prefix, None);
    assert_eq!(
        table
            .lines
            .iter()
            .map(|line| line.range.clone())
            .collect::<Vec<_>>(),
        [5..12, 13..20, 21..28, 29..34]
    );
}

#[test]
fn crlf_table_is_not_a_table() {
    assert_eq!(parse("| a |\r\n| - |\r\n| 1 |").tables(), []);
    assert_eq!(parse("| a |\n| - |\r\n| 1 |").tables(), []);
}

fn line_ranges(table: &MarkdownTable) -> Vec<Range<usize>> {
    table.lines.iter().map(|line| line.range.clone()).collect()
}

#[test]
fn header_continuing_a_paragraph_with_a_pipe_is_not_a_table() {
    assert_eq!(parse("x |\n| a |\n| - |").tables(), []);
    assert_eq!(parse("`a|b`\n| a |\n| - |").tables(), []);
    assert_eq!(parse("> x |\n> | a |\n> | - |").tables(), []);
    assert_eq!(
        table("x |\n| a |\n| - |\n| 1 |\n\n| b |\n| - |").range,
        23..34
    );
}

#[test]
fn header_continuing_a_paragraph_without_a_pipe_on_its_first_line_is_a_table() {
    assert_eq!(table("x\ny |\n| a |\n| - |").range, 6..17);
    assert_eq!(table("a \\| b\n| a |\n| - |").range, 7..18);
    assert_eq!(table("x |\n\n| a |\n| - |").range, 5..16);
}

#[test]
fn lazy_text_after_a_quoted_table_is_a_row_without_a_prefix() {
    let table = table("> | a |\n> | - |\nfoo");
    assert_eq!(table.range, 0..19);
    assert_eq!(line_ranges(&table), [0..7, 8..15, 16..19]);
    assert_eq!(table.container_prefix, None);
}

#[test]
fn lazy_text_after_a_table_in_a_list_item_is_a_row_without_a_prefix() {
    let table = table("- a\n\n  | x |\n  | - |\nfoo");
    assert_eq!(table.range, 5..24);
    assert_eq!(line_ranges(&table), [5..12, 13..20, 21..24]);
    assert_eq!(table.container_prefix, None);
}

#[test]
fn line_indented_four_columns_is_a_row() {
    let table = table("| a |\n| - |\n    ---");
    assert_eq!(table.range, 0..19);
    assert_eq!(line_ranges(&table), [0..5, 6..11, 12..19]);
}

#[test]
fn ordered_item_not_numbered_one_is_a_row() {
    let table = table("| a |\n| - |\n2. | b |");
    assert_eq!(line_ranges(&table), [0..5, 6..11, 12..20]);
}

#[test]
fn html_block_start_ends_the_table() {
    let table = table("| a |\n| - |\n<div>|");
    assert_eq!(line_ranges(&table), [0..5, 6..11]);
}

#[test]
fn task_marker_is_part_of_the_first_header_cell() {
    let table = table("- [ ] a | b\n  --- | ---");
    assert_eq!(table.range, 0..23);
    assert_eq!(table.container_prefix, None);
    assert_eq!(table.header().row_start, 2);
    assert_eq!(cells(table.header()), [(2..8, 2..7), (9..11, 10..11)]);
}

#[test]
fn task_marker_counts_as_a_header_cell() {
    assert_eq!(parse("- [ ] | a |\n  | - |").tables(), []);
    assert_eq!(parse("> - [ ] | a |\n>   | - |").tables(), []);
    assert_eq!(parse("- [X] | a |\n  | - |\n  | 1 |").tables(), []);
}
