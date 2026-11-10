use crate::table::TableAlignment;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LayoutRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl LayoutRect {
    pub fn max_x(&self) -> f64 {
        self.x + self.width
    }

    pub fn max_y(&self) -> f64 {
        self.y + self.height
    }

    /// Half-open: the minimum edges are inside, the maximum edges are outside.
    pub fn contains(&self, x: f64, y: f64) -> bool {
        self.x <= x && x < self.max_x() && self.y <= y && y < self.max_y()
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TableLayoutMetrics {
    pub cell_padding_x: f64,
    pub cell_padding_y: f64,
    pub border: f64,
    pub empty_line_height: f64,
    pub image_max_height: f64,
    pub image_min_width: f64,
    pub item_gap: f64,
}

impl Default for TableLayoutMetrics {
    fn default() -> Self {
        Self {
            cell_padding_x: 8.0,
            cell_padding_y: 4.0,
            border: 1.0,
            empty_line_height: 17.0,
            image_max_height: 160.0,
            image_min_width: 24.0,
            item_gap: 4.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TableLayoutItem {
    /// `min_width` is the widest unbreakable word, `max_width` the whole text on one line.
    Text { min_width: f64, max_width: f64 },
    /// The image's natural size in points.
    Image { width: f64, height: f64 },
}

#[derive(Debug, Clone, PartialEq)]
pub struct TableLayoutColumns {
    pub content_widths: Vec<f64>,
    pub padding_x: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TableGeometry {
    /// Content width plus `2 * padding_x`, per column.
    pub column_widths: Vec<f64>,
    /// Per row, including `2 * cell_padding_y`.
    pub row_heights: Vec<f64>,
    pub width: f64,
    pub height: f64,
    /// `[row][column]`, the padded cell box inside the borders.
    pub cell_frames: Vec<Vec<LayoutRect>>,
    /// `[row][column]`, `cell_frames` inset by the horizontal and vertical cell padding.
    pub content_frames: Vec<Vec<LayoutRect>>,
    /// `[row][column][item]`
    pub item_frames: Vec<Vec<Vec<LayoutRect>>>,
    row_ends: Vec<f64>,
}

impl TableGeometry {
    /// Returns `(row, column)`, clamped to the nearest cell; each border belongs to the cell after it and the outer right and bottom borders to the last cell.
    pub fn cell_at(&self, x: f64, y: f64) -> Option<(usize, usize)> {
        let row = self.row_at_height(y)?;
        let first_row = self.cell_frames.first().filter(|cells| !cells.is_empty())?;
        let column = first_row
            .iter()
            .position(|cell| x < cell.max_x())
            .unwrap_or(first_row.len() - 1);
        Some((row, column))
    }

    /// Clamped like `cell_at`; `None` only when there are no rows.
    pub fn row_at_height(&self, y: f64) -> Option<usize> {
        let last = self.row_ends.len().checked_sub(1)?;
        Some(
            self.row_ends
                .iter()
                .position(|&end| y < end)
                .unwrap_or(last),
        )
    }
}

#[derive(Debug, Clone, Default)]
pub struct TableLayout {
    pub metrics: TableLayoutMetrics,
}

#[derive(Clone, Copy)]
struct ItemSize {
    width: f64,
    height: f64,
    is_image: bool,
}

impl TableLayout {
    pub fn new(metrics: TableLayoutMetrics) -> Self {
        Self { metrics }
    }

    pub fn columns(
        &self,
        cells: &[Vec<Vec<TableLayoutItem>>],
        available: f64,
    ) -> TableLayoutColumns {
        let metrics = &self.metrics;
        let count = cells.first().map_or(0, Vec::len);
        if count == 0 {
            return TableLayoutColumns {
                content_widths: Vec::new(),
                padding_x: metrics.cell_padding_x,
            };
        }

        let mut minimums = vec![0.0_f64; count];
        let mut maximums = vec![0.0_f64; count];
        for row in cells {
            for (column, items) in row.iter().enumerate().take(count) {
                for item in items {
                    let (low, high) = self.width_range(item);
                    minimums[column] = minimums[column].max(low);
                    maximums[column] = maximums[column].max(high);
                }
            }
        }
        for (minimum, maximum) in minimums.iter_mut().zip(&maximums) {
            *minimum = minimum.min(*maximum);
        }

        let borders = (count + 1) as f64 * metrics.border;
        let space = available - borders - count as f64 * 2.0 * metrics.cell_padding_x;
        if space < 0.0 {
            return TableLayoutColumns {
                content_widths: vec![0.0; count],
                padding_x: ((available - borders) / (2 * count) as f64).max(0.0),
            };
        }

        let total_min: f64 = minimums.iter().sum();
        let total_max: f64 = maximums.iter().sum();
        let content_widths = if total_max <= space {
            maximums
        } else if total_min <= space {
            let spread = total_max - total_min;
            let extra = space - total_min;
            minimums
                .iter()
                .zip(&maximums)
                .map(|(&low, &high)| {
                    if spread > 0.0 {
                        low + (high - low) * extra / spread
                    } else {
                        low
                    }
                })
                .collect()
        } else {
            minimums
                .iter()
                .map(|&low| {
                    if total_min > 0.0 {
                        space * low / total_min
                    } else {
                        0.0
                    }
                })
                .collect()
        };
        TableLayoutColumns {
            content_widths,
            padding_x: metrics.cell_padding_x,
        }
    }

    pub fn image_size(&self, width: f64, height: f64, content_width: f64) -> (f64, f64) {
        if !(width > 0.0 && height > 0.0) {
            return (0.0, 0.0);
        }
        let display_width = width
            .min(self.metrics.image_max_height * width / height)
            .min(content_width);
        (display_width, height * display_width / width)
    }

    /// `text_heights` is `[row][column][item]` and only read for text items; a missing entry counts as 0.
    pub fn geometry(
        &self,
        cells: &[Vec<Vec<TableLayoutItem>>],
        columns: &TableLayoutColumns,
        text_heights: &[Vec<Vec<f64>>],
        alignments: &[TableAlignment],
    ) -> TableGeometry {
        let metrics = &self.metrics;
        let column_count = columns.content_widths.len();
        let border = metrics.border;
        let column_widths: Vec<f64> = columns
            .content_widths
            .iter()
            .map(|width| width + 2.0 * columns.padding_x)
            .collect();

        let mut item_sizes: Vec<Vec<Vec<ItemSize>>> = Vec::with_capacity(cells.len());
        let mut row_heights = Vec::with_capacity(cells.len());
        for (row_index, row) in cells.iter().enumerate() {
            let mut row_sizes = Vec::with_capacity(column_count);
            let mut tallest = 0.0_f64;
            for column in 0..column_count {
                let items = row.get(column).map_or(&[][..], Vec::as_slice);
                let sizes: Vec<ItemSize> = items
                    .iter()
                    .enumerate()
                    .map(|(item_index, item)| match *item {
                        TableLayoutItem::Text { .. } => ItemSize {
                            width: columns.content_widths[column],
                            height: text_heights
                                .get(row_index)
                                .and_then(|row| row.get(column))
                                .and_then(|column| column.get(item_index))
                                .copied()
                                .unwrap_or(0.0),
                            is_image: false,
                        },
                        TableLayoutItem::Image { width, height } => {
                            let (width, height) =
                                self.image_size(width, height, columns.content_widths[column]);
                            ItemSize {
                                width,
                                height,
                                is_image: true,
                            }
                        }
                    })
                    .collect();
                let content = if sizes.is_empty() {
                    metrics.empty_line_height
                } else {
                    sizes.iter().map(|size| size.height).sum::<f64>()
                        + metrics.item_gap * (sizes.len() - 1) as f64
                };
                tallest = tallest.max(content);
                row_sizes.push(sizes);
            }
            item_sizes.push(row_sizes);
            row_heights.push(tallest + 2.0 * metrics.cell_padding_y);
        }

        let mut cell_frames = Vec::with_capacity(row_heights.len());
        let mut content_frames = Vec::with_capacity(row_heights.len());
        let mut item_frames = Vec::with_capacity(row_heights.len());
        let mut row_ends = Vec::with_capacity(row_heights.len());
        let mut y = border;
        for (row_index, &row_height) in row_heights.iter().enumerate() {
            let mut row_cells = Vec::with_capacity(column_count);
            let mut row_contents = Vec::with_capacity(column_count);
            let mut row_items = Vec::with_capacity(column_count);
            let mut x = border;
            for column in 0..column_count {
                let cell_frame = LayoutRect {
                    x,
                    y,
                    width: column_widths[column],
                    height: row_height,
                };
                let content_frame = LayoutRect {
                    x: x + columns.padding_x,
                    y: y + metrics.cell_padding_y,
                    width: columns.content_widths[column],
                    height: row_height - 2.0 * metrics.cell_padding_y,
                };
                let alignment = alignments.get(column).copied().unwrap_or_default();
                let mut item_y = content_frame.y;
                let mut frames = Vec::with_capacity(item_sizes[row_index][column].len());
                for size in &item_sizes[row_index][column] {
                    let offset = if size.is_image {
                        aligned_offset(alignment, content_frame.width - size.width)
                    } else {
                        0.0
                    };
                    frames.push(LayoutRect {
                        x: content_frame.x + offset,
                        y: item_y,
                        width: size.width,
                        height: size.height,
                    });
                    item_y += size.height + metrics.item_gap;
                }
                row_cells.push(cell_frame);
                row_contents.push(content_frame);
                row_items.push(frames);
                x += column_widths[column] + border;
            }
            cell_frames.push(row_cells);
            content_frames.push(row_contents);
            item_frames.push(row_items);
            row_ends.push(y + row_height);
            y += row_height + border;
        }

        TableGeometry {
            width: column_widths.iter().sum::<f64>() + (column_count + 1) as f64 * border,
            height: row_heights.iter().sum::<f64>() + (row_heights.len() + 1) as f64 * border,
            column_widths,
            row_heights,
            cell_frames,
            content_frames,
            item_frames,
            row_ends,
        }
    }

    /// `text_height(row, column, item, content_width)` is called once per text item, at its column's content width.
    pub fn layout(
        &self,
        cells: &[Vec<Vec<TableLayoutItem>>],
        available: f64,
        alignments: &[TableAlignment],
        mut text_height: impl FnMut(usize, usize, usize, f64) -> f64,
    ) -> TableGeometry {
        let columns = self.columns(cells, available);
        let text_heights: Vec<Vec<Vec<f64>>> = cells
            .iter()
            .enumerate()
            .map(|(row, row_cells)| {
                row_cells
                    .iter()
                    .take(columns.content_widths.len())
                    .enumerate()
                    .map(|(column, items)| {
                        items
                            .iter()
                            .enumerate()
                            .map(|(item, kind)| match kind {
                                TableLayoutItem::Text { .. } => {
                                    text_height(row, column, item, columns.content_widths[column])
                                }
                                TableLayoutItem::Image { .. } => 0.0,
                            })
                            .collect()
                    })
                    .collect()
            })
            .collect();
        self.geometry(cells, &columns, &text_heights, alignments)
    }

    fn width_range(&self, item: &TableLayoutItem) -> (f64, f64) {
        match *item {
            TableLayoutItem::Text {
                min_width,
                max_width,
            } => (min_width, max_width),
            TableLayoutItem::Image { width, height } => {
                let natural = self.image_size(width, height, f64::INFINITY).0;
                (natural.min(self.metrics.image_min_width), natural)
            }
        }
    }
}

fn aligned_offset(alignment: TableAlignment, free: f64) -> f64 {
    match alignment {
        TableAlignment::Right => free,
        TableAlignment::Center => free / 2.0,
        TableAlignment::Left | TableAlignment::Unspecified => 0.0,
    }
}
