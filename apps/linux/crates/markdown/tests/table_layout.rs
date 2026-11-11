use commitnote_markdown::{
    LayoutRect, TableAlignment as A, TableGeometry, TableLayout, TableLayoutColumns,
    TableLayoutItem, TableLayoutMetrics,
};

type Cells = Vec<Vec<Vec<TableLayoutItem>>>;

const ACCURACY: f64 = 1e-9;

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() <= ACCURACY,
        "{actual} is not within {ACCURACY} of {expected}"
    );
}

fn rect(x: f64, y: f64, width: f64, height: f64) -> LayoutRect {
    LayoutRect {
        x,
        y,
        width,
        height,
    }
}

fn text(low: f64, high: f64) -> Vec<TableLayoutItem> {
    vec![TableLayoutItem::Text {
        min_width: low,
        max_width: high,
    }]
}

fn image(width: f64, height: f64) -> TableLayoutItem {
    TableLayoutItem::Image { width, height }
}

fn uniform_heights(cells: &Cells, height: f64) -> Vec<Vec<Vec<f64>>> {
    cells
        .iter()
        .map(|row| {
            row.iter()
                .map(|items| items.iter().map(|_| height).collect())
                .collect()
        })
        .collect()
}

fn fits_cells() -> Cells {
    vec![
        vec![text(20.0, 50.0), text(30.0, 80.0)],
        vec![text(10.0, 40.0), text(25.0, 60.0)],
    ]
}

fn fits_geometry() -> TableGeometry {
    let layout = TableLayout::default();
    let cells = fits_cells();
    let columns = layout.columns(&cells, 300.0);
    layout.geometry(&cells, &columns, &uniform_heights(&cells, 17.0), &[])
}

fn uniform_geometry(
    layout: &TableLayout,
    cells: &Cells,
    available: f64,
    height: f64,
) -> TableGeometry {
    let columns = layout.columns(cells, available);
    layout.geometry(cells, &columns, &uniform_heights(cells, height), &[])
}

#[test]
fn fits_gives_each_column_its_maximum_and_does_not_stretch() {
    let layout = TableLayout::default();
    let columns = layout.columns(&fits_cells(), 300.0);
    assert_eq!(columns.content_widths, [50.0, 80.0]);
    assert_eq!(columns.padding_x, 8.0);

    let geometry = fits_geometry();
    assert_eq!(geometry.column_widths, [66.0, 96.0]);
    assert_eq!(geometry.row_heights, [25.0, 25.0]);
    assert_eq!(geometry.width, 165.0);
    assert_eq!(geometry.height, 53.0);
    assert!(geometry.width < 300.0);
    assert_eq!(geometry.cell_frames[0][0], rect(1.0, 1.0, 66.0, 25.0));
    assert_eq!(geometry.cell_frames[0][1], rect(68.0, 1.0, 96.0, 25.0));
    assert_eq!(geometry.cell_frames[1][0], rect(1.0, 27.0, 66.0, 25.0));
    assert_eq!(geometry.cell_frames[1][1], rect(68.0, 27.0, 96.0, 25.0));
    assert_eq!(geometry.content_frames[0][0], rect(9.0, 5.0, 50.0, 17.0));
    assert_eq!(geometry.content_frames[1][1], rect(76.0, 31.0, 80.0, 17.0));
    assert_eq!(geometry.item_frames[0][1], [rect(76.0, 5.0, 80.0, 17.0)]);
}

#[test]
fn extra_space_is_shared_in_proportion_to_the_range_between_minimum_and_maximum() {
    let layout = TableLayout::default();
    let cells = vec![vec![text(20.0, 100.0), text(40.0, 200.0)]];
    let columns = layout.columns(&cells, 200.0);
    assert_close(columns.content_widths[0], 55.0);
    assert_close(columns.content_widths[1], 110.0);
    assert!(columns.content_widths[0] >= 20.0);
    assert!(columns.content_widths[1] >= 40.0);

    let geometry = layout.geometry(&cells, &columns, &uniform_heights(&cells, 17.0), &[]);
    assert_close(geometry.width, 200.0);
}

#[test]
fn the_largest_minimum_and_maximum_in_a_column_decide() {
    let layout = TableLayout::default();
    let cells = vec![
        vec![text(10.0, 30.0)],
        vec![text(25.0, 20.0)],
        vec![text(5.0, 60.0)],
    ];
    let columns = layout.columns(&cells, 1000.0);
    assert_eq!(columns.content_widths, [60.0]);

    let narrow = layout.columns(&cells, 2.0 + 16.0 + 40.0);
    assert_close(narrow.content_widths[0], 40.0);
    assert!(narrow.content_widths[0] >= 25.0);
}

#[test]
fn overflow_scales_columns_below_their_minima_and_fills_the_container() {
    let layout = TableLayout::default();
    let cells = vec![vec![text(100.0, 200.0), text(100.0, 300.0)]];
    let columns = layout.columns(&cells, 150.0);
    assert_close(columns.content_widths[0], 57.5);
    assert_close(columns.content_widths[1], 57.5);
    assert_eq!(columns.padding_x, 8.0);

    let geometry = layout.geometry(&cells, &columns, &uniform_heights(&cells, 34.0), &[]);
    assert_close(geometry.width, 150.0);
}

#[test]
fn overflow_splits_in_proportion_to_the_minima() {
    let layout = TableLayout::default();
    let cells = vec![vec![text(100.0, 200.0), text(300.0, 300.0)]];
    let columns = layout.columns(&cells, 3.0 + 32.0 + 200.0);
    assert_close(columns.content_widths[0], 50.0);
    assert_close(columns.content_widths[1], 150.0);
}

#[test]
fn tiny_container_collapses_content_and_reduces_padding() {
    let layout = TableLayout::default();
    let cells = fits_cells();
    let columns = layout.columns(&cells, 20.0);
    assert_eq!(columns.content_widths, [0.0, 0.0]);
    assert_close(columns.padding_x, 4.25);

    let geometry = layout.geometry(&cells, &columns, &uniform_heights(&cells, 17.0), &[]);
    assert_eq!(geometry.column_widths, [8.5, 8.5]);
    assert_close(geometry.width, 20.0);
    assert!(geometry.width <= 20.0 + ACCURACY);
}

#[test]
fn container_narrower_than_the_borders_never_gets_negative_padding() {
    let columns = TableLayout::default().columns(&fits_cells(), 1.0);
    assert_eq!(columns.content_widths, [0.0, 0.0]);
    assert_eq!(columns.padding_x, 0.0);
}

#[test]
fn large_text_still_fits_and_rows_get_taller() {
    let layout = TableLayout::default();
    let normal = vec![vec![text(20.0, 100.0), text(40.0, 200.0)]];
    let large = vec![vec![text(60.0, 300.0), text(120.0, 600.0)]];
    let available = 200.0;

    let normal_geometry = uniform_geometry(&layout, &normal, available, 17.0);

    let large_columns = layout.columns(&large, available);
    let large_geometry = layout.geometry(
        &large,
        &large_columns,
        &uniform_heights(&large, 51.0 * 3.0),
        &[],
    );

    assert_close(large_columns.content_widths[0], 55.0);
    assert_close(large_columns.content_widths[1], 110.0);
    assert!(large_geometry.width <= available + ACCURACY);
    assert_close(large_geometry.width, 200.0);
    assert_eq!(normal_geometry.row_heights, [25.0]);
    assert_eq!(large_geometry.row_heights, [161.0]);
    assert!(large_geometry.height > normal_geometry.height);
}

#[test]
fn width_never_exceeds_available_across_many_sizes() {
    let layout = TableLayout::default();
    let cells = vec![
        vec![text(30.0, 120.0), text(10.0, 400.0), text(50.0, 50.0)],
        vec![text(5.0, 60.0), text(90.0, 90.0), text(1.0, 10.0)],
    ];
    let mut available = 4.0;
    while available <= 900.0 {
        let geometry = uniform_geometry(&layout, &cells, available, 17.0);
        assert!(
            geometry.width <= available + ACCURACY,
            "available {available}"
        );
        available += 7.0;
    }
}

#[test]
fn image_size_scales_down_to_the_column_and_caps_the_height() {
    let layout = TableLayout::default();
    let (width, height) = layout.image_size(400.0, 200.0, 100.0);
    assert_close(width, 100.0);
    assert_close(height, 50.0);

    let (width, height) = layout.image_size(100.0, 400.0, 100.0);
    assert_close(width, 40.0);
    assert_close(height, 160.0);

    let (width, height) = layout.image_size(30.0, 20.0, 100.0);
    assert_close(width, 30.0);
    assert_close(height, 20.0);
}

#[test]
fn image_size_of_an_image_without_size_is_empty() {
    let layout = TableLayout::default();
    assert_eq!(layout.image_size(0.0, 10.0, 100.0), (0.0, 0.0));
    assert_eq!(layout.image_size(10.0, -1.0, 100.0), (0.0, 0.0));
}

#[test]
fn image_columns_have_a_small_minimum_and_a_natural_maximum() {
    let layout = TableLayout::default();
    let cells = vec![vec![vec![image(400.0, 200.0)]]];
    assert_eq!(layout.columns(&cells, 1000.0).content_widths, [320.0]);

    let narrow = layout.columns(&cells, 2.0 + 16.0 + 82.0);
    assert_close(narrow.content_widths[0], 82.0);

    let tiny = layout.columns(&cells, 2.0 + 16.0 + 10.0);
    assert_close(tiny.content_widths[0], 10.0);
}

#[test]
fn images_are_aligned_by_the_column_alignment() {
    let layout = TableLayout::default();
    let item = vec![image(40.0, 40.0)];
    let cells = vec![vec![item.clone(), item.clone(), item]];
    let columns = TableLayoutColumns {
        content_widths: vec![100.0, 100.0, 100.0],
        padding_x: 8.0,
    };
    let geometry = layout.geometry(
        &cells,
        &columns,
        &[vec![vec![0.0], vec![0.0], vec![0.0]]],
        &[A::Left, A::Center, A::Right],
    );

    assert_eq!(geometry.item_frames[0][0], [rect(9.0, 5.0, 40.0, 40.0)]);
    assert_eq!(
        geometry.item_frames[0][1],
        [rect(126.0 + 30.0, 5.0, 40.0, 40.0)]
    );
    assert_eq!(
        geometry.item_frames[0][2],
        [rect(243.0 + 60.0, 5.0, 40.0, 40.0)]
    );
    assert_eq!(geometry.row_heights, [48.0]);
}

#[test]
fn missing_alignments_count_as_unspecified() {
    let cells = vec![vec![vec![image(40.0, 40.0)], vec![image(40.0, 40.0)]]];
    let columns = TableLayoutColumns {
        content_widths: vec![100.0, 100.0],
        padding_x: 8.0,
    };
    let geometry = TableLayout::default().geometry(
        &cells,
        &columns,
        &[vec![vec![0.0], vec![0.0]]],
        &[A::Right],
    );
    assert_eq!(geometry.item_frames[0][0][0].x, 9.0 + 60.0);
    assert_eq!(geometry.item_frames[0][1][0].x, 126.0);
}

#[test]
fn image_and_text_items_stack_with_the_item_gap() {
    let cells = vec![vec![vec![
        image(400.0, 200.0),
        TableLayoutItem::Text {
            min_width: 10.0,
            max_width: 90.0,
        },
    ]]];
    let columns = TableLayoutColumns {
        content_widths: vec![100.0],
        padding_x: 8.0,
    };
    let geometry =
        TableLayout::default().geometry(&cells, &columns, &[vec![vec![999.0, 34.0]]], &[A::Center]);

    assert_eq!(geometry.item_frames[0][0][0], rect(9.0, 5.0, 100.0, 50.0));
    assert_eq!(geometry.item_frames[0][0][1], rect(9.0, 59.0, 100.0, 34.0));
    assert_eq!(geometry.content_frames[0][0].height, 88.0);
    assert_eq!(geometry.row_heights, [96.0]);
    assert_eq!(geometry.height, 98.0);
}

#[test]
fn text_items_take_the_full_content_width_regardless_of_alignment() {
    let cells = vec![vec![text(10.0, 90.0)]];
    let columns = TableLayoutColumns {
        content_widths: vec![100.0],
        padding_x: 8.0,
    };
    let geometry =
        TableLayout::default().geometry(&cells, &columns, &[vec![vec![17.0]]], &[A::Right]);
    assert_eq!(geometry.item_frames[0][0], [rect(9.0, 5.0, 100.0, 17.0)]);
}

#[test]
fn empty_cells_use_the_empty_line_height_and_empty_columns_have_no_content() {
    let layout = TableLayout::new(TableLayoutMetrics {
        empty_line_height: 20.0,
        ..TableLayoutMetrics::default()
    });
    let cells = vec![vec![text(10.0, 30.0), vec![]], vec![vec![], vec![]]];
    let columns = layout.columns(&cells, 300.0);
    assert_eq!(columns.content_widths, [30.0, 0.0]);

    let geometry = layout.geometry(
        &cells,
        &columns,
        &[vec![vec![30.0], vec![]], vec![vec![], vec![]]],
        &[],
    );
    assert_eq!(geometry.row_heights, [38.0, 28.0]);
    assert_eq!(geometry.column_widths, [46.0, 16.0]);
    assert_eq!(geometry.content_frames[1][0], rect(9.0, 44.0, 30.0, 20.0));
    assert_eq!(geometry.content_frames[0][1].width, 0.0);
    assert!(geometry.item_frames[1][0].is_empty());
    assert!(geometry.item_frames[0][1].is_empty());
    assert_eq!(geometry.width, 46.0 + 16.0 + 3.0);
    assert_eq!(geometry.height, 38.0 + 28.0 + 3.0);
}

#[test]
fn an_empty_table_has_only_outer_borders() {
    let layout = TableLayout::default();
    let columns = layout.columns(&[], 100.0);
    assert!(columns.content_widths.is_empty());
    assert_eq!(columns.padding_x, 8.0);

    let geometry = layout.geometry(&[], &columns, &[], &[]);
    assert_eq!(geometry.width, 1.0);
    assert_eq!(geometry.height, 1.0);
    assert_eq!(geometry.cell_at(0.0, 0.0), None);
}

#[test]
fn hairline_borders_are_honoured() {
    let layout = TableLayout::new(TableLayoutMetrics {
        border: 0.5,
        ..TableLayoutMetrics::default()
    });
    let geometry = uniform_geometry(&layout, &fits_cells(), 300.0, 17.0);
    assert_close(geometry.width, 162.0 + 1.5);
    assert_close(geometry.height, 50.0 + 1.5);
    assert_close(geometry.cell_frames[1][1].x, 0.5 + 66.0 + 0.5);
    assert_close(geometry.cell_frames[1][1].y, 0.5 + 25.0 + 0.5);
}

#[test]
fn hit_test_finds_cells_borders_and_edges_and_clamps_outside_points() {
    let geometry = fits_geometry();
    let hit = |x: f64, y: f64| geometry.cell_at(x, y);

    assert_eq!(hit(10.0, 10.0), Some((0, 0)));
    assert_eq!(hit(100.0, 10.0), Some((0, 1)));
    assert_eq!(hit(10.0, 40.0), Some((1, 0)));
    assert_eq!(hit(100.0, 40.0), Some((1, 1)));

    assert_eq!(hit(0.0, 0.0), Some((0, 0)));
    assert_eq!(hit(66.9, 10.0), Some((0, 0)));
    assert_eq!(hit(67.0, 10.0), Some((0, 1)));
    assert_eq!(hit(10.0, 25.9), Some((0, 0)));
    assert_eq!(hit(10.0, 26.0), Some((1, 0)));

    assert_eq!(hit(164.0, 10.0), Some((0, 1)));
    assert_eq!(hit(164.9, 52.9), Some((1, 1)));
    assert_eq!(hit(10.0, 52.0), Some((1, 0)));

    assert_eq!(hit(165.0, 10.0), Some((0, 1)));
    assert_eq!(hit(10.0, 53.0), Some((1, 0)));
    assert_eq!(hit(-0.1, 10.0), Some((0, 0)));
    assert_eq!(hit(10.0, -0.1), Some((0, 0)));
}

#[test]
fn cell_at_clamps_far_outside_each_side_and_corner() {
    let geometry = fits_geometry();
    let hit = |x: f64, y: f64| geometry.cell_at(x, y);

    assert_eq!(hit(-1000.0, 10.0), Some((0, 0)));
    assert_eq!(hit(-1000.0, 40.0), Some((1, 0)));
    assert_eq!(hit(1000.0, 10.0), Some((0, 1)));
    assert_eq!(hit(1000.0, 40.0), Some((1, 1)));
    assert_eq!(hit(100.0, -1000.0), Some((0, 1)));
    assert_eq!(hit(10.0, -1000.0), Some((0, 0)));
    assert_eq!(hit(100.0, 1000.0), Some((1, 1)));
    assert_eq!(hit(10.0, 1000.0), Some((1, 0)));

    assert_eq!(hit(-1000.0, -1000.0), Some((0, 0)));
    assert_eq!(hit(1000.0, -1000.0), Some((0, 1)));
    assert_eq!(hit(-1000.0, 1000.0), Some((1, 0)));
    assert_eq!(hit(1000.0, 1000.0), Some((1, 1)));
}

#[test]
fn cell_at_is_none_without_rows_or_columns() {
    let layout = TableLayout::default();
    let no_columns: Cells = vec![vec![], vec![]];
    let geometry = uniform_geometry(&layout, &no_columns, 100.0, 17.0);
    assert_eq!(geometry.row_heights.len(), 2);
    assert_eq!(geometry.cell_at(5.0, 5.0), None);
}

#[test]
fn row_at_height_finds_rows_borders_and_clamps_outside_points() {
    let geometry = fits_geometry();
    let row = |y: f64| geometry.row_at_height(y);

    assert_eq!(row(10.0), Some(0));
    assert_eq!(row(40.0), Some(1));

    assert_eq!(row(0.0), Some(0));
    assert_eq!(row(1.0), Some(0));
    assert_eq!(row(25.9), Some(0));
    assert_eq!(row(26.0), Some(1));
    assert_eq!(row(27.0), Some(1));
    assert_eq!(row(52.0), Some(1));

    assert_eq!(row(-0.1), Some(0));
    assert_eq!(row(-1000.0), Some(0));
    assert_eq!(row(53.0), Some(1));
    assert_eq!(row(1000.0), Some(1));
}

#[test]
fn row_at_height_does_not_depend_on_the_column_count() {
    let layout = TableLayout::default();
    let no_columns: Cells = vec![vec![], vec![]];
    let geometry = uniform_geometry(&layout, &no_columns, 100.0, 17.0);
    assert_eq!(geometry.row_heights, [8.0, 8.0]);
    assert_eq!(geometry.row_at_height(8.9), Some(0));
    assert_eq!(geometry.row_at_height(9.0), Some(1));
    assert_eq!(geometry.row_at_height(1000.0), Some(1));
}

#[test]
fn row_at_height_of_an_empty_table_is_none() {
    let layout = TableLayout::default();
    let geometry = uniform_geometry(&layout, &Vec::new(), 100.0, 17.0);
    assert_eq!(geometry.row_at_height(0.0), None);
    assert_eq!(geometry.row_at_height(100.0), None);
}

#[test]
fn header_row_is_laid_out_like_any_other_row() {
    let layout = TableLayout::default();
    let cells = fits_cells();
    let columns = layout.columns(&cells, 300.0);
    let geometry = layout.geometry(
        &cells,
        &columns,
        &[vec![vec![30.0], vec![17.0]], vec![vec![17.0], vec![17.0]]],
        &[],
    );

    assert_eq!(geometry.row_heights, [38.0, 25.0]);
    assert_eq!(geometry.cell_frames[0][0], rect(1.0, 1.0, 66.0, 38.0));
    assert_eq!(geometry.cell_frames[1][0], rect(1.0, 40.0, 66.0, 25.0));
    assert_eq!(geometry.item_frames[0][1], [rect(76.0, 5.0, 80.0, 17.0)]);
}

#[test]
fn layout_rect_contains_is_half_open() {
    let rect = rect(10.0, 20.0, 5.0, 6.0);
    assert_eq!(rect.max_x(), 15.0);
    assert_eq!(rect.max_y(), 26.0);
    assert!(rect.contains(10.0, 20.0));
    assert!(rect.contains(14.9, 25.9));
    assert!(!rect.contains(15.0, 22.0));
    assert!(!rect.contains(12.0, 26.0));
    assert!(!rect.contains(9.9, 22.0));
}

#[test]
fn default_metrics() {
    assert_eq!(
        TableLayoutMetrics::default(),
        TableLayoutMetrics {
            cell_padding_x: 8.0,
            cell_padding_y: 4.0,
            border: 1.0,
            empty_line_height: 17.0,
            image_max_height: 160.0,
            image_min_width: 24.0,
            item_gap: 4.0,
        }
    );
    assert_eq!(
        TableLayout::default().metrics,
        TableLayoutMetrics::default()
    );
}

#[test]
fn layout_matches_columns_plus_geometry_with_explicit_heights() {
    let layout = TableLayout::default();
    let cells: Cells = vec![
        vec![
            vec![
                TableLayoutItem::Text {
                    min_width: 20.0,
                    max_width: 100.0,
                },
                image(40.0, 40.0),
            ],
            text(40.0, 200.0),
        ],
        vec![
            text(10.0, 50.0),
            vec![
                image(400.0, 200.0),
                TableLayoutItem::Text {
                    min_width: 5.0,
                    max_width: 30.0,
                },
            ],
        ],
    ];
    let alignments = [A::Center, A::Right];
    let available = 200.0;
    let height_of = |row: usize, column: usize, item: usize| {
        10.0 + row as f64 * 100.0 + column as f64 * 10.0 + item as f64
    };

    let mut calls = Vec::new();
    let geometry = layout.layout(
        &cells,
        available,
        &alignments,
        |row, column, item, width| {
            calls.push((row, column, item, width));
            height_of(row, column, item)
        },
    );

    let columns = layout.columns(&cells, available);
    let heights: Vec<Vec<Vec<f64>>> = cells
        .iter()
        .enumerate()
        .map(|(row, row_cells)| {
            row_cells
                .iter()
                .enumerate()
                .map(|(column, items)| {
                    (0..items.len())
                        .map(|item| height_of(row, column, item))
                        .collect()
                })
                .collect()
        })
        .collect();
    assert_eq!(
        geometry,
        layout.geometry(&cells, &columns, &heights, &alignments)
    );

    let widths = &columns.content_widths;
    assert_eq!(
        calls,
        [
            (0, 0, 0, widths[0]),
            (0, 1, 0, widths[1]),
            (1, 0, 0, widths[0]),
            (1, 1, 1, widths[1]),
        ]
    );
}

#[test]
fn layout_of_an_empty_table_asks_for_no_text_heights() {
    let layout = TableLayout::default();
    let geometry = layout.layout(&[], 100.0, &[], |_, _, _, _| panic!("no text items"));
    assert_eq!(geometry.width, 1.0);
    assert_eq!(geometry.height, 1.0);
}
