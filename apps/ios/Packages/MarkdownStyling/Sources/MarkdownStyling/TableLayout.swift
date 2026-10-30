public struct LayoutRect: Sendable, Equatable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public var maxX: Double { x + width }
    public var maxY: Double { y + height }

    public func contains(x px: Double, y py: Double) -> Bool {
        x <= px && px < maxX && y <= py && py < maxY
    }
}

public struct TableLayoutMetrics: Sendable, Equatable {
    public var cellPaddingX: Double
    public var cellPaddingY: Double
    public var border: Double
    public var emptyLineHeight: Double
    public var imageMaxHeight: Double
    public var imageMinWidth: Double
    public var itemGap: Double

    public init(
        cellPaddingX: Double = 8, cellPaddingY: Double = 4, border: Double = 1, emptyLineHeight: Double = 17,
        imageMaxHeight: Double = 160, imageMinWidth: Double = 24, itemGap: Double = 4
    ) {
        self.cellPaddingX = cellPaddingX
        self.cellPaddingY = cellPaddingY
        self.border = border
        self.emptyLineHeight = emptyLineHeight
        self.imageMaxHeight = imageMaxHeight
        self.imageMinWidth = imageMinWidth
        self.itemGap = itemGap
    }
}

public enum TableLayoutItem: Sendable, Equatable {
    /// minWidth: the widest unbreakable word; maxWidth: the whole text on one line.
    case text(minWidth: Double, maxWidth: Double)
    /// The image's natural size in points.
    case image(width: Double, height: Double)
}

public struct TableLayoutColumns: Sendable, Equatable {
    public var contentWidths: [Double]
    public var paddingX: Double

    public init(contentWidths: [Double], paddingX: Double) {
        self.contentWidths = contentWidths
        self.paddingX = paddingX
    }
}

public struct TableGeometry: Sendable, Equatable {
    /// Content width plus `2 * paddingX`, per column.
    public var columnWidths: [Double]
    /// Per row, including `2 * cellPaddingY`.
    public var rowHeights: [Double]
    public var width: Double
    public var height: Double
    /// `[row][column]`, the padded cell box inside the borders.
    public var cellFrames: [[LayoutRect]]
    /// `[row][column]`, `cellFrames` inset by the horizontal and vertical cell padding.
    public var contentFrames: [[LayoutRect]]
    /// `[row][column][item]`
    public var itemFrames: [[[LayoutRect]]]

    /// Each border belongs to the cell after it; the outer right and bottom borders belong to the last cell.
    public func cell(atX x: Double, y: Double) -> (row: Int, column: Int)? {
        guard x >= 0, x < width, y >= 0, y < height, let firstRow = cellFrames.first, !firstRow.isEmpty else {
            return nil
        }
        let column = firstRow.firstIndex { x < $0.maxX } ?? firstRow.count - 1
        let row = cellFrames.firstIndex { y < $0[0].maxY } ?? cellFrames.count - 1
        return (row, column)
    }
}

public enum TableLayout {
    public static func columns(
        cells: [[[TableLayoutItem]]], available: Double, metrics: TableLayoutMetrics
    ) -> TableLayoutColumns {
        let count = cells.first?.count ?? 0
        guard count > 0 else { return TableLayoutColumns(contentWidths: [], paddingX: metrics.cellPaddingX) }

        var minimums = [Double](repeating: 0, count: count)
        var maximums = [Double](repeating: 0, count: count)
        for row in cells {
            for (column, items) in row.enumerated() where column < count {
                for item in items {
                    let (low, high) = widthRange(item, metrics: metrics)
                    minimums[column] = max(minimums[column], low)
                    maximums[column] = max(maximums[column], high)
                }
            }
        }
        for column in 0..<count {
            minimums[column] = min(minimums[column], maximums[column])
        }

        let borders = Double(count + 1) * metrics.border
        let space = available - borders - Double(count) * 2 * metrics.cellPaddingX
        guard space >= 0 else {
            return TableLayoutColumns(
                contentWidths: [Double](repeating: 0, count: count),
                paddingX: max(0, (available - borders) / Double(2 * count)))
        }

        let totalMin = minimums.reduce(0, +)
        let totalMax = maximums.reduce(0, +)
        let widths: [Double]
        if totalMax <= space {
            widths = maximums
        } else if totalMin <= space {
            let spread = totalMax - totalMin
            let extra = space - totalMin
            widths = zip(minimums, maximums).map { low, high in
                spread > 0 ? low + (high - low) * extra / spread : low
            }
        } else {
            widths = minimums.map { totalMin > 0 ? space * $0 / totalMin : 0 }
        }
        return TableLayoutColumns(contentWidths: widths, paddingX: metrics.cellPaddingX)
    }

    public static func imageSize(
        width: Double, height: Double, contentWidth: Double, metrics: TableLayoutMetrics
    ) -> (width: Double, height: Double) {
        guard width > 0, height > 0 else { return (0, 0) }
        let displayWidth = min(width, metrics.imageMaxHeight * width / height, contentWidth)
        return (displayWidth, height * displayWidth / width)
    }

    public static func geometry(
        cells: [[[TableLayoutItem]]], columns: TableLayoutColumns, textHeights: [[[Double]]],
        alignments: [TableAlignment], metrics: TableLayoutMetrics
    ) -> TableGeometry {
        let columnCount = columns.contentWidths.count
        let border = metrics.border
        let columnWidths = columns.contentWidths.map { $0 + 2 * columns.paddingX }

        var itemSizes: [[[ItemSize]]] = []
        var rowHeights: [Double] = []
        for (rowIndex, row) in cells.enumerated() {
            var rowSizes: [[ItemSize]] = []
            var tallest = 0.0
            for column in 0..<columnCount {
                let items = column < row.count ? row[column] : []
                let sizes: [ItemSize] = items.enumerated().map { itemIndex, item in
                    switch item {
                    case .text:
                        let height = textHeights[safe: rowIndex]?[safe: column]?[safe: itemIndex] ?? 0
                        return ItemSize(width: columns.contentWidths[column], height: height, isImage: false)
                    case .image(let width, let height):
                        let size = imageSize(
                            width: width, height: height, contentWidth: columns.contentWidths[column],
                            metrics: metrics)
                        return ItemSize(width: size.width, height: size.height, isImage: true)
                    }
                }
                rowSizes.append(sizes)
                let stacked = sizes.map(\.height).reduce(0, +) + metrics.itemGap * Double(sizes.count - 1)
                let content = sizes.isEmpty ? metrics.emptyLineHeight : stacked
                tallest = max(tallest, content)
            }
            itemSizes.append(rowSizes)
            rowHeights.append(tallest + 2 * metrics.cellPaddingY)
        }

        var cellFrames: [[LayoutRect]] = []
        var contentFrames: [[LayoutRect]] = []
        var itemFrames: [[[LayoutRect]]] = []
        var y = border
        for (rowIndex, rowHeight) in rowHeights.enumerated() {
            var rowCells: [LayoutRect] = []
            var rowContents: [LayoutRect] = []
            var rowItems: [[LayoutRect]] = []
            var x = border
            for column in 0..<columnCount {
                let cellFrame = LayoutRect(x: x, y: y, width: columnWidths[column], height: rowHeight)
                let contentFrame = LayoutRect(
                    x: x + columns.paddingX, y: y + metrics.cellPaddingY,
                    width: columns.contentWidths[column], height: rowHeight - 2 * metrics.cellPaddingY)
                let alignment = column < alignments.count ? alignments[column] : .unspecified
                var itemY = contentFrame.y
                var frames: [LayoutRect] = []
                for size in itemSizes[rowIndex][column] {
                    let offset = size.isImage ? alignedOffset(alignment, free: contentFrame.width - size.width) : 0
                    frames.append(
                        LayoutRect(x: contentFrame.x + offset, y: itemY, width: size.width, height: size.height))
                    itemY += size.height + metrics.itemGap
                }
                rowCells.append(cellFrame)
                rowContents.append(contentFrame)
                rowItems.append(frames)
                x += columnWidths[column] + border
            }
            cellFrames.append(rowCells)
            contentFrames.append(rowContents)
            itemFrames.append(rowItems)
            y += rowHeight + border
        }

        return TableGeometry(
            columnWidths: columnWidths,
            rowHeights: rowHeights,
            width: columnWidths.reduce(0, +) + Double(columnCount + 1) * border,
            height: rowHeights.reduce(0, +) + Double(rowHeights.count + 1) * border,
            cellFrames: cellFrames,
            contentFrames: contentFrames,
            itemFrames: itemFrames)
    }

    private struct ItemSize {
        var width: Double
        var height: Double
        var isImage: Bool
    }

    private static func widthRange(_ item: TableLayoutItem, metrics: TableLayoutMetrics) -> (Double, Double) {
        switch item {
        case .text(let minWidth, let maxWidth):
            return (minWidth, maxWidth)
        case .image(let width, let height):
            let natural = imageSize(width: width, height: height, contentWidth: .infinity, metrics: metrics).width
            return (min(natural, metrics.imageMinWidth), natural)
        }
    }

    private static func alignedOffset(_ alignment: TableAlignment, free: Double) -> Double {
        switch alignment {
        case .right: free
        case .center: free / 2
        case .left, .unspecified: 0
        }
    }
}

extension Array {
    fileprivate subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
