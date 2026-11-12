use commitnote_markdown::{TableCellPosition, TableSelection};

const ROWS: usize = 4;
const COLUMNS: usize = 3;

fn position(row: usize, column: usize) -> TableCellPosition {
    TableCellPosition { row, column }
}

fn all_positions() -> Vec<TableCellPosition> {
    (0..ROWS)
        .flat_map(|row| (0..COLUMNS).map(move |column| position(row, column)))
        .collect()
}

fn index(position: TableCellPosition) -> usize {
    position.row * COLUMNS + position.column
}

fn selected_by_reference(
    anchor: TableCellPosition,
    focus: TableCellPosition,
) -> Vec<TableCellPosition> {
    let low = index(anchor).min(index(focus));
    let high = index(anchor).max(index(focus));
    all_positions()
        .into_iter()
        .filter(|&cell| (low..=high).contains(&index(cell)))
        .collect()
}

fn selected_rows(selection: &TableSelection) -> Vec<(usize, Vec<usize>)> {
    selection
        .rows(COLUMNS)
        .map(|(row, columns)| (row, columns.collect()))
        .collect()
}

#[test]
fn every_selection_runs_in_reading_order() {
    let positions = all_positions();
    assert_eq!(positions.len() * positions.len(), 144);
    for &anchor in &positions {
        for &focus in &positions {
            let selection = TableSelection::new(anchor, focus);
            let expected = selected_by_reference(anchor, focus);

            let contained: Vec<_> = positions
                .iter()
                .copied()
                .filter(|&cell| selection.contains(cell))
                .collect();
            assert_eq!(contained, expected, "contains for {anchor:?} to {focus:?}");

            let mut expected_rows: Vec<(usize, Vec<usize>)> = Vec::new();
            for cell in &expected {
                match expected_rows.last_mut() {
                    Some((row, columns)) if *row == cell.row => columns.push(cell.column),
                    _ => expected_rows.push((cell.row, vec![cell.column])),
                }
            }
            assert_eq!(
                selected_rows(&selection),
                expected_rows,
                "rows for {anchor:?} to {focus:?}"
            );

            let swapped = TableSelection::new(focus, anchor);
            assert_eq!(swapped.ordered(), selection.ordered());
            assert_eq!(swapped.ordered(), {
                let first = *expected.first().unwrap();
                let last = *expected.last().unwrap();
                (first, last)
            });
            assert_eq!(selected_rows(&swapped), selected_rows(&selection));
            for &cell in &positions {
                assert_eq!(swapped.contains(cell), selection.contains(cell));
            }
        }
    }
}

#[test]
fn a_cell_selection_contains_only_that_cell() {
    for &target in &all_positions() {
        let selection = TableSelection::cell(target);
        assert_eq!(selection.anchor, target);
        assert_eq!(selection.focus, target);
        assert_eq!(selection.ordered(), (target, target));
        for &cell in &all_positions() {
            assert_eq!(selection.contains(cell), cell == target);
        }
        assert_eq!(
            selected_rows(&selection),
            [(target.row, vec![target.column])]
        );
    }
}

#[test]
fn positions_order_by_row_then_column() {
    assert!(position(0, 2) < position(1, 0));
    assert!(position(1, 0) < position(1, 1));
}

#[test]
fn a_multi_row_selection_spans_the_rest_of_the_first_row_and_the_start_of_the_last() {
    let selection = TableSelection::new(position(1, 1), position(3, 0));
    assert_eq!(
        selected_rows(&selection),
        [(1, vec![1, 2]), (2, vec![0, 1, 2]), (3, vec![0])]
    );
}
