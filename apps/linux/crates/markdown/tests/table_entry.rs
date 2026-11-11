use VerticalDirection::{Down, Up};
use commitnote_markdown::{
    LinePosition, TableGeometry, TableLayout, TableLayoutItem, VerticalDirection, parse,
    table_entry_target, table_page_target,
};
use std::ops::Range;

const TABLE: &str = "| a | b |\n| - | - |\n| 1 | 2 |";

fn position(line: usize, column: usize) -> Option<LinePosition> {
    Some(LinePosition { line, column })
}

fn target(
    text: &str,
    line: usize,
    goal_column: usize,
    direction: VerticalDirection,
    count: usize,
    rendered: Range<usize>,
) -> Option<LinePosition> {
    let rendered = [rendered];
    table_entry_target(&parse(text), line, goal_column, direction, count, &rendered)
}

fn vim_fixture() -> String {
    format!("0123456789\nab\n0123456789\n\n{TABLE}\n\nafter line")
}

#[test]
fn vim_motions_are_exact_line_arithmetic_around_a_rendered_table() {
    let text = vim_fixture();
    let cases = [
        (Down, 1, 3, position(4, 0)),
        (Up, 1, 7, position(6, 0)),
        (Down, 2, 3, position(5, 0)),
        (Down, 3, 3, position(6, 0)),
        (Down, 3, 2, position(5, 0)),
        (Up, 2, 7, position(5, 0)),
        (Up, 4, 8, position(4, 0)),
        (Down, 4, 3, position(7, 0)),
        (Up, 5, 8, position(3, 0)),
        (Down, 20, 3, position(8, 0)),
        (Down, 2, 0, None),
        (Down, 1, 2, None),
        (Down, 0, 3, None),
    ];
    for (direction, count, from, expected) in cases {
        assert_eq!(
            target(&text, from, 0, direction, count, 4..7),
            expected,
            "{direction:?} {count} from {from}"
        );
    }
}

#[test]
fn the_goal_column_is_clamped_to_the_target_line() {
    let text = vim_fixture();
    assert_eq!(target(&text, 2, 3, Down, 3, 4..7), position(5, 3));
    assert_eq!(target(&text, 3, 20, Down, 1, 4..7), position(4, 9));
}

#[test]
fn a_revealed_table_is_not_entered() {
    assert_eq!(
        table_entry_target(&parse(&vim_fixture()), 3, 0, Down, 1, &[]),
        None
    );
}

#[test]
fn a_motion_from_beyond_the_document_has_no_target() {
    assert_eq!(target(&vim_fixture(), 9, 0, Up, 1, 4..7), None);
}

#[test]
fn an_empty_rendered_range_is_ignored() {
    assert_eq!(target(&vim_fixture(), 3, 0, Down, 3, 5..5), None);
}

#[test]
fn arrow_down_enters_from_the_line_above() {
    let text = format!("Intro\n\n## a\n{TABLE}\n\nafter");
    assert_eq!(target(&text, 2, 2, Down, 1, 3..6), position(3, 2));
}

#[test]
fn arrow_up_enters_from_the_line_below() {
    let text = format!("Intro\n\n{TABLE}\n## a heading longer than the row");
    assert_eq!(target(&text, 5, 28, Up, 1, 2..5), position(4, 9));
}

#[test]
fn arrows_two_lines_away_or_the_other_way_do_not_enter() {
    let text = format!("Intro\n\n{TABLE}\n\nafter");
    assert_eq!(target(&text, 0, 0, Down, 1, 2..5), None);
    assert_eq!(target(&text, 6, 0, Up, 1, 2..5), None);
    assert_eq!(target(&text, 1, 0, Up, 1, 2..5), None);
    assert_eq!(target(&text, 5, 0, Down, 1, 2..5), None);
}

#[test]
fn arrows_at_the_document_edges_do_not_enter() {
    let at_start = format!("{TABLE}\n\nafter");
    assert_eq!(target(&at_start, 0, 0, Up, 1, 0..3), None);
    let at_end = format!("Intro\n\n{TABLE}");
    assert_eq!(target(&at_end, 4, 0, Down, 1, 2..5), None);
}

#[test]
fn columns_in_a_nested_table_include_the_container_prefix() {
    let text = "Intro\n\n> | a | b |\n> | - | - |\n> | 1 | 2 |\n\nafter";
    assert_eq!(target(text, 1, 0, Down, 1, 2..5), position(2, 0));
    assert_eq!(target(text, 5, 4, Up, 1, 2..5), position(4, 4));
}

#[test]
fn columns_are_utf16_code_units() {
    let text = "x\n\n| 😀 | b |\n| - | - |\n| 1 | 2 |";
    assert_eq!(target(text, 1, 50, Down, 1, 2..5), position(2, 10));
}

const PAGING_TEXT: &str = "Intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |";

fn geometry(rows: usize) -> TableGeometry {
    let cell = vec![TableLayoutItem::Text {
        min_width: 10.0,
        max_width: 40.0,
    }];
    let cells = vec![vec![cell; 2]; rows];
    TableLayout::default().layout(&cells, 300.0, &[], |_, _, _, _| 17.0)
}

fn row_tops(geometry: &TableGeometry) -> Vec<f64> {
    geometry.cell_frames.iter().map(|row| row[0].y).collect()
}

fn page_target(geometry: &TableGeometry, y: f64) -> usize {
    let document = parse(PAGING_TEXT);
    let table = document.tables().remove(0);
    table_page_target(&document, &table, geometry, y)
}

#[test]
fn paging_maps_a_height_to_the_source_line_of_its_row() {
    let geometry = geometry(3);
    let tops = row_tops(&geometry);
    assert_eq!(page_target(&geometry, tops[0] + 1.0), 2);
    assert_eq!(page_target(&geometry, tops[1] + 1.0), 4);
    assert_eq!(page_target(&geometry, tops[2] + 1.0), 5);
}

#[test]
fn paging_clamps_heights_outside_the_table() {
    let geometry = geometry(3);
    assert_eq!(page_target(&geometry, -10.0), 2);
    assert_eq!(page_target(&geometry, geometry.height + 500.0), 5);
}

#[test]
fn paging_clamps_to_the_last_line_when_the_geometry_has_more_rows() {
    let geometry = geometry(5);
    let tops = row_tops(&geometry);
    assert_eq!(page_target(&geometry, tops[4] + 1.0), 5);
}

#[test]
fn paging_without_geometry_rows_targets_the_header_line() {
    assert_eq!(page_target(&geometry(0), 20.0), 2);
}
